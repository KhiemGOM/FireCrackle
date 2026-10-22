//! Everything the app needs behind one handle: the project folder, the session, the autosave log and the frame
//! service. The Tauri layer is a thin shim over this; the UI sends a `UiAction` and gets a `View` back.

use crate::autosave::{AutosaveError, AutosaveLog};
use crate::chart::decimate;
use crate::config::{DecodeConfig, SettingError, SettingInfo, Settings};
use crate::decode_plan::{
    fill_job, plan, trim_job, DecodeJob, FrameCache, PlanError, DEFAULT_FIRST_AHEAD,
};
use crate::frames::{decode_job, DecodeError, DecodedFrame};
use crate::import::{import_video, ImportError, Tools};
use crate::index::FrameIndex;
use crate::label::Label;
use crate::lane::{buckets, Bucket};
use crate::phase::{Flag, Point, Run};
use crate::project::{Project, ProjectError};
use crate::session::{Move, PickState, Session, SessionError, Suggestion};
use crate::thumbs::{generate, nearest, Thumb, ThumbError, ThumbKey, ThumbPlan, ThumbStore};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

// ============================================================ frame service

/// The longest a request waits for the background decode that already covers its frame, before decoding it itself.
const FILL_WAIT: Duration = Duration::from_secs(4);

/// Where decoded frames come from. The real one is ffmpeg; tests use a fake that counts calls.
pub trait FrameSource: Send + Sync {
    fn decode(
        &self,
        job: &DecodeJob,
        cancel: &AtomicBool,
    ) -> Result<Vec<DecodedFrame>, DecodeError>;

    /// One pass producing the timeline thumbnails the plan asks for. Sources that cannot say so.
    fn thumbnails(
        &self,
        _plan: &ThumbPlan,
        _cancel: &AtomicBool,
    ) -> Result<Vec<Thumb>, ThumbError> {
        Err(ThumbError::Unsupported)
    }
}

/// The ffmpeg-backed source for one video.
pub struct FfmpegSource {
    pub tools: Tools,
    pub video: PathBuf,
    pub index: Arc<FrameIndex>,
    /// Shared with the workspace so a changed setting reaches the next decode.
    pub cfg: Arc<Mutex<DecodeConfig>>,
}

impl FrameSource for FfmpegSource {
    fn decode(
        &self,
        job: &DecodeJob,
        cancel: &AtomicBool,
    ) -> Result<Vec<DecodedFrame>, DecodeError> {
        let cfg = *self.cfg.lock().expect("decode settings lock");
        decode_job(&self.tools, &self.video, &self.index, job, &cfg, cancel)
    }

    fn thumbnails(&self, plan: &ThumbPlan, cancel: &AtomicBool) -> Result<Vec<Thumb>, ThumbError> {
        let tolerance = self
            .cfg
            .lock()
            .expect("decode settings lock")
            .align_tolerance;
        generate(
            &self.tools,
            &self.video,
            &self.index,
            plan,
            tolerance,
            cancel,
        )
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum FrameError {
    /// The frame is not in the video.
    OutOfRange(u32),
    Decode(DecodeError),
    Plan(PlanError),
}

struct State {
    cache: FrameCache,
    data: HashMap<u32, Arc<Vec<u8>>>,
}

struct Inner {
    index: Arc<FrameIndex>,
    source: Arc<dyn FrameSource>,
    cfg: Mutex<DecodeConfig>,
    /// Whether the capacity follows `cfg.cache_mb` (false for an explicit capacity).
    capacity_from_cfg: bool,
    state: Mutex<State>,
    /// How far past a missing frame its own job decodes (`decode_plan::DEFAULT_FIRST_AHEAD`); 0 decodes the whole window.
    first_ahead: AtomicU32,
    /// The frame most recently asked for: the background fill works around wherever the playhead is now.
    latest: AtomicU32,
    /// The frames the background worker is decoding right now: a request for one of them waits for it.
    background: Mutex<Option<(u32, u32)>>,
    background_done: Condvar,
    busy: AtomicBool,
    worker: Mutex<Option<JoinHandle<()>>>,
    cancelled: AtomicBool,
    foreground: Mutex<()>,
}

impl Inner {
    /// The next background job around the playhead (one keyframe interval at most), published as the range being
    /// decoded. None when the window is full, or when the job would be for the playhead's own frame: a request is
    /// decoding that one.
    fn next_fill(&self) -> Option<DecodeJob> {
        if self.cancelled.load(Ordering::SeqCst) {
            return None;
        }
        let cfg = *self.cfg.lock().expect("decode config lock");
        let around = self.latest.load(Ordering::SeqCst);
        let job = {
            let st = self.state.lock().expect("frame cache lock");
            plan(&self.index, &st.cache, around, &cfg)
                .ok()
                .and_then(|p| p.job)
        }?;
        if (job.first..=job.last).contains(&around) {
            return None;
        }
        let job = fill_job(&self.index, job, around, &cfg);
        *self.background.lock().expect("background lock") = Some((job.first, job.last));
        Some(job)
    }

    /// The published background job is done (or abandoned): wake the requests waiting for it.
    fn finish_fill(&self) {
        *self.background.lock().expect("background lock") = None;
        self.background_done.notify_all();
    }

    /// Store decoded frames (evicted ones leave memory too). `last` is inserted last so it is the most recently
    /// used and survives even a cache smaller than the window.
    fn insert(&self, frames: Vec<DecodedFrame>, last: Option<u32>) -> Option<Arc<Vec<u8>>> {
        let mut st = self.state.lock().expect("frame cache lock");
        let mut keep: Option<Arc<Vec<u8>>> = None;
        let (mut first_pass, mut second_pass): (Vec<DecodedFrame>, Vec<DecodedFrame>) =
            (Vec::new(), Vec::new());
        for f in frames {
            if Some(f.frame) == last {
                second_pass.push(f);
            } else {
                first_pass.push(f);
            }
        }
        first_pass.extend(second_pass);
        for f in first_pass {
            let bytes = Arc::new(f.jpeg);
            if Some(f.frame) == last {
                keep = Some(bytes.clone());
            }
            for gone in st.cache.insert(f.frame, bytes.len() as u64) {
                st.data.remove(&gone);
            }
            st.data.insert(f.frame, bytes);
        }
        keep
    }
}

/// Decoded frames in memory around the playhead: a byte cache driven by the decode planner, with a background
/// prefetch that follows the planner's hysteresis. Cloning gives another handle on the same cache, so a caller can
/// take one out of a locked workspace and decode without holding the workspace.
#[derive(Clone)]
pub struct FrameService {
    inner: Arc<Inner>,
}

impl FrameService {
    /// Cache capacity comes from `cfg.cache_mb`.
    pub fn new(
        index: Arc<FrameIndex>,
        source: Arc<dyn FrameSource>,
        cfg: DecodeConfig,
    ) -> FrameService {
        let cap = cfg.cache_mb as u64 * 1024 * 1024;
        FrameService::build(index, source, cfg, cap, true)
    }

    /// Like `new` with an explicit capacity in bytes (tests use tiny caches).
    pub fn with_capacity(
        index: Arc<FrameIndex>,
        source: Arc<dyn FrameSource>,
        cfg: DecodeConfig,
        cap_bytes: u64,
    ) -> FrameService {
        FrameService::build(index, source, cfg, cap_bytes, false)
    }

    fn build(
        index: Arc<FrameIndex>,
        source: Arc<dyn FrameSource>,
        cfg: DecodeConfig,
        cap: u64,
        from_cfg: bool,
    ) -> FrameService {
        FrameService {
            inner: Arc::new(Inner {
                index,
                source,
                cfg: Mutex::new(cfg),
                capacity_from_cfg: from_cfg,
                state: Mutex::new(State {
                    cache: FrameCache::new(cap),
                    data: HashMap::new(),
                }),
                first_ahead: AtomicU32::new(DEFAULT_FIRST_AHEAD),
                latest: AtomicU32::new(0),
                background: Mutex::new(None),
                background_done: Condvar::new(),
                busy: AtomicBool::new(false),
                worker: Mutex::new(None),
                cancelled: AtomicBool::new(false),
                foreground: Mutex::new(()),
            }),
        }
    }

    /// The JPEG of `frame`. A miss decodes the planned run and blocks; a hit returns at once and may start a
    /// background prefetch. A failed decode is an error and leaves the cache unchanged.
    pub fn get(&self, frame: u32) -> Result<Arc<Vec<u8>>, FrameError> {
        let inner = &self.inner;
        if frame as usize >= inner.index.frames.len() {
            return Err(FrameError::OutOfRange(frame));
        }
        inner.latest.store(frame, Ordering::SeqCst);
        let cfg = *inner.cfg.lock().expect("decode config lock");
        let mut foreground = None;
        loop {
            if inner.cancelled.load(Ordering::SeqCst) {
                return Err(FrameError::Decode(DecodeError::Cancelled));
            }
            let plan = {
                let st = inner.state.lock().expect("frame cache lock");
                plan(&inner.index, &st.cache, frame, &cfg).map_err(FrameError::Plan)?
            };
            if !plan.want_cached && self.wait_for_background(frame) {
                continue; // the background decode has finished: plan again, the frame is probably cached now
            }
            if plan.want_cached {
                let hit = {
                    let mut st = inner.state.lock().expect("frame cache lock");
                    let bytes = st.data.get(&frame).cloned();
                    if bytes.is_some() {
                        st.cache.touch(frame);
                    }
                    bytes
                };
                if let Some(bytes) = hit {
                    if plan.job.is_some() {
                        self.prefetch(frame);
                    }
                    return Ok(bytes);
                }
                continue; // evicted between planning and reading: plan again
            }
            if foreground.is_none() {
                foreground = Some(inner.foreground.lock().expect("foreground decode lock"));
                continue; // Recheck the cache: the preceding request may have filled this frame.
            }
            // The frame's own job stops a short way around it, so it is shown after one short decode; the rest of the
            // window is filled in the background right after it (a decode costs about 300 ms plus 1.7 ms a frame).
            let job = trim_job(
                &inner.index,
                plan.job.expect("a missing frame always has a job"),
                frame,
                inner.first_ahead.load(Ordering::SeqCst),
                &cfg,
            );
            let decoded = inner
                .source
                .decode(&job, &inner.cancelled)
                .map_err(FrameError::Decode)?;
            let kept = inner.insert(decoded, Some(frame)).ok_or_else(|| {
                FrameError::Decode(DecodeError::BadStream(format!(
                    "the decode did not contain frame {frame}"
                )))
            })?;
            self.prefetch(frame);
            return Ok(kept);
        }
    }

    /// Top the window up around `around` on a background thread (no-op while one is running or nothing is due).
    pub fn prefetch(&self, around: u32) {
        if self.inner.cancelled.load(Ordering::SeqCst) {
            return;
        }
        self.inner.latest.store(around, Ordering::SeqCst);
        if self.inner.busy.swap(true, Ordering::SeqCst) {
            return;
        }
        // The first job is chosen here rather than on the thread: a request for one of its frames that arrives a
        // moment later then already finds the range published, and waits for it instead of decoding it again.
        let Some(first) = self.inner.next_fill() else {
            self.inner.busy.store(false, Ordering::SeqCst);
            return;
        };
        let inner = self.inner.clone();
        let handle = std::thread::spawn(move || {
            // Passes of at most one keyframe interval: ahead, then behind, around wherever the playhead is by then,
            // so one request fills both sides without waiting for the next one.
            let mut job = Some(first);
            for _ in 0..8 {
                let Some(current) = job.take() else { break };
                // a failed prefetch is not an error: the next request plans again
                let decoded = inner.source.decode(&current, &inner.cancelled);
                let ok = decoded.is_ok();
                if let Ok(frames) = decoded {
                    inner.insert(frames, None);
                }
                inner.finish_fill();
                if !ok {
                    break;
                }
                job = inner.next_fill();
            }
            if job.is_some() {
                inner.finish_fill(); // out of passes with a job published: nobody will decode it
            }
            inner.busy.store(false, Ordering::SeqCst);
        });
        *self.inner.worker.lock().expect("worker lock") = Some(handle);
    }

    /// If the background worker is decoding `frame`, wait for it (true: it finished or gave up, plan again). False:
    /// nothing is decoding it, or the wait ran out, so the caller decodes it itself.
    fn wait_for_background(&self, frame: u32) -> bool {
        let covers =
            |range: &Option<(u32, u32)>| range.is_some_and(|(a, b)| a <= frame && frame <= b);
        let guard = self.inner.background.lock().expect("background lock");
        if !covers(&guard) {
            return false;
        }
        let (_guard, timeout) = self
            .inner
            .background_done
            .wait_timeout_while(guard, FILL_WAIT, |range| {
                covers(range) && !self.inner.cancelled.load(Ordering::SeqCst)
            })
            .expect("background lock");
        !timeout.timed_out()
    }

    /// How far past a missing frame its own job decodes (0: the whole window at once).
    pub fn set_first_frames(&self, frames: u32) {
        self.inner.first_ahead.store(frames, Ordering::SeqCst);
    }

    /// Stop this workspace's queued/running frame work, including clones held by IPC requests.
    pub fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::SeqCst);
        self.inner.background_done.notify_all();
    }

    /// Block until no background prefetch is running.
    pub fn wait_idle(&self) {
        let handle = self.inner.worker.lock().expect("worker lock").take();
        if let Some(h) = handle {
            let _ = h.join();
        }
    }

    /// Cached frames, ascending.
    pub fn cached_frames(&self) -> Vec<u32> {
        self.inner
            .state
            .lock()
            .expect("frame cache lock")
            .cache
            .frames()
    }

    pub fn used_bytes(&self) -> u64 {
        self.inner
            .state
            .lock()
            .expect("frame cache lock")
            .cache
            .used_bytes()
    }

    /// New window sizes and capacity apply from the next request on (a smaller cache evicts at once).
    pub fn set_config(&self, cfg: DecodeConfig) {
        *self.inner.cfg.lock().expect("decode config lock") = cfg;
        if self.inner.capacity_from_cfg {
            let mut st = self.inner.state.lock().expect("frame cache lock");
            for gone in st.cache.set_capacity(cfg.cache_mb as u64 * 1024 * 1024) {
                st.data.remove(&gone);
            }
        }
    }
}

// ============================================================== workspace

/// One user action from the Label tab.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UiAction {
    AnalysisMode { combined: bool },
    Step { frames: i64 },
    BigStep { dir: i64 },
    ManualStep { frames: i64 },
    ManualBigStep { dir: i64 },
    Home,
    End,
    GoTo { frame: u32 },
    NextUnlabelled { dir: i64 },
    NextFlag { dir: i64 },
    ToggleSheet,
    ToggleMirror,
    Digit { digit: u8 },
    FlushTyped,
    CancelTyping,
    AcceptSuggestion,
    Clear,
    NoFire,
    Skip,
    Undo,
    ClickCell { col: u32, row: u32 },
    SetLabel { label: Label },
    FillRange { start: u32, end: u32, label: Label },
}

/// Everything the UI draws, after any action.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct View {
    pub current: u32,
    pub frame_count: u32,
    /// Presentation time of the current frame, seconds.
    pub pts: f64,
    pub fps: f64,
    pub label: Label,
    pub label_sources: Vec<crate::label::LabelSource>,
    pub pick: PickState,
    /// First digit of a two-digit row typed so far.
    pub typed_pending: Option<u8>,
    pub suggestion: Option<Suggestion>,
    pub labelled_count: usize,
    pub undo_depth: usize,
    pub flag_count: usize,
    /// Things worth telling the user: import warnings, a repaired log, unreadable settings.
    pub warnings: Vec<String>,
    /// The last autosave failed; the changes are queued and retried with the next action.
    pub save_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum WorkspaceError {
    Import(ImportError),
    Project(ProjectError),
    Autosave(AutosaveError),
    Session(SessionError),
    Frame(FrameError),
    Setting(SettingError),
    Thumb(ThumbError),
    Io(String),
    /// An action the UI should not have sent (cell outside the grid, ...).
    BadAction(String),
}

/// The picker columns, left to right: (sheet, mirrored). Must match `COLUMNS` in `src/lib/grid.ts`.
const COLUMNS: [(u8, bool); 4] = [(0, false), (1, false), (0, true), (1, true)];

/// What the Phase tab draws.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TextureObservation {
    pub frame: u32,
    pub pts: f64,
    pub atlas: crate::label::AnimationAtlas,
    pub row: u8,
    pub mirrored: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PhaseChart {
    pub normal_points: Vec<Point>,
    pub texture_points: Vec<TextureObservation>,
    pub label_sources: std::collections::BTreeMap<u32, Vec<crate::label::LabelSource>>,
    pub points: Vec<Point>,
    pub runs: Vec<Run>,
    pub flags: Vec<Flag>,
    pub tick_rate: f64,
    /// Width of the arc one steady run fits in (the `phase.window_ticks` setting), for the chart's bands.
    pub window_ticks: f64,
    pub reference_phase: Option<f64>,
    pub flag_details: Vec<crate::phase_v2::FlagDetail>,
    pub clock_residuals: Vec<crate::phase_compare::ClockResidual>,
    pub lag_intervals: Vec<crate::phase_v2::LagInterval>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ThumbState {
    /// Nothing usable stored and nothing running (not started yet, or stale after a settings change).
    Idle,
    Running,
    Ready,
    Failed,
    /// `timeline.thumbs_enabled` is off.
    Disabled,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ThumbStatus {
    pub state: ThumbState,
    /// Thumbnails available (when ready).
    pub count: usize,
    pub error: Option<String>,
}

/// Progress of the background thumbnail job, shared with its thread.
#[derive(Default)]
struct ThumbShared {
    cancel: AtomicBool,
    run: Mutex<ThumbRun>,
}

#[derive(Default, Clone, PartialEq)]
enum ThumbRun {
    #[default]
    Idle,
    Running,
    Failed(String),
}

pub struct Workspace {
    dir: PathBuf,
    session: Session,
    log: AutosaveLog,
    frames: FrameService,
    source: Arc<dyn FrameSource>,
    index: Arc<FrameIndex>,
    thumb_store: Arc<ThumbStore>,
    thumb_shared: Arc<ThumbShared>,
    thumb_job: Mutex<Option<JoinHandle<()>>>,
    /// The frames of the valid store, cached under the key they were read for.
    thumb_frames: Mutex<Option<(ThumbKey, Vec<u32>)>>,
    /// Shared with the ffmpeg source (absent when the source is supplied by a test).
    decode_cfg: Option<Arc<Mutex<DecodeConfig>>>,
    warnings: Vec<String>,
    save_error: Option<String>,
}

fn io_err(e: std::io::Error) -> WorkspaceError {
    WorkspaceError::Io(e.to_string())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), WorkspaceError> {
    crate::fsutil::write_atomic(path, bytes).map_err(io_err)
}

impl Workspace {
    /// Open (or create) the project for `video`: `<video>.firecrackle/` holds `project.json`, `labels.jsonl` and
    /// `settings.json`. An existing project is loaded instead of re-imported; a replaced video or a label log of
    /// another video is refused.
    pub fn open(
        tools: &Tools,
        video: &Path,
        defaults: &Settings,
    ) -> Result<Workspace, WorkspaceError> {
        let mut name = video
            .file_name()
            .ok_or_else(|| WorkspaceError::Io("the video path has no file name".into()))?
            .to_os_string();
        name.push(".firecrackle");
        let dir = video.with_file_name(name);
        std::fs::create_dir_all(&dir).map_err(io_err)?;
        let project_path = dir.join("project.json");

        let project = if project_path.is_file() {
            let mut p = Project::load(&project_path).map_err(WorkspaceError::Project)?;
            let here = video.to_string_lossy().into_owned();
            let moved = p.video_path != here;
            p.video_path = here; // the project folder travels with the video
            p.verify_video().map_err(WorkspaceError::Project)?;
            if moved {
                p.save(&project_path).map_err(WorkspaceError::Project)?;
            }
            p
        } else {
            let p = import_video(tools, video, defaults).map_err(WorkspaceError::Import)?;
            p.save(&project_path).map_err(WorkspaceError::Project)?;
            p
        };

        let decode_cfg = Arc::new(Mutex::new(defaults.decode));
        let index = Arc::new(project.frame_index());
        let source = Arc::new(FfmpegSource {
            tools: tools.clone(),
            video: video.to_path_buf(),
            index,
            cfg: decode_cfg.clone(),
        });
        Workspace::build(&dir, project, defaults, source, Some(decode_cfg))
    }

    /// The same with the project and the frame source supplied (tests; the real `open` calls the same code).
    pub fn from_parts(
        dir: &Path,
        project: Project,
        defaults: &Settings,
        source: Arc<dyn FrameSource>,
    ) -> Result<Workspace, WorkspaceError> {
        Workspace::build(dir, project, defaults, source, None)
    }

    fn build(
        dir: &Path,
        project: Project,
        defaults: &Settings,
        source: Arc<dyn FrameSource>,
        decode_cfg: Option<Arc<Mutex<DecodeConfig>>>,
    ) -> Result<Workspace, WorkspaceError> {
        std::fs::create_dir_all(dir).map_err(io_err)?;
        let mut warnings = project.warnings.clone();

        let settings = match std::fs::read(dir.join("settings.json")) {
            Ok(bytes) => match serde_json::from_slice::<Settings>(&bytes) {
                Ok(s) => s,
                Err(e) => {
                    warnings.push(format!(
                        "settings.json could not be read ({e}); using the default settings."
                    ));
                    *defaults
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => *defaults,
            Err(e) => {
                warnings.push(format!(
                    "settings.json could not be read ({e}); using the default settings."
                ));
                *defaults
            }
        };
        if let Some(h) = &decode_cfg {
            *h.lock().expect("decode settings lock") = settings.decode;
        }

        let (log, store, report) = AutosaveLog::open(
            &dir.join("labels.jsonl"),
            project.frames.len() as u32,
            &settings.autosave,
        )
        .map_err(WorkspaceError::Autosave)?;
        if report.torn_tail_repaired {
            warnings.push(
                "The label log ended in a partial line (a crash while saving?). The partial line was removed; \\
                 every complete label was kept: the log was repaired."
                    .to_string(),
            );
        }

        let index = Arc::new(project.frame_index());
        let frames = FrameService::new(index.clone(), source.clone(), settings.decode);
        let session = Session::new(project, store, settings).map_err(WorkspaceError::Session)?;
        Ok(Workspace {
            dir: dir.to_path_buf(),
            session,
            log,
            frames,
            source,
            index,
            thumb_store: Arc::new(ThumbStore::new(&dir.join("thumbs"))),
            thumb_shared: Arc::new(ThumbShared::default()),
            thumb_job: Mutex::new(None),
            thumb_frames: Mutex::new(None),
            decode_cfg,
            warnings,
            save_error: None,
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn automation_project(&self) -> Project {
        self.session.project().clone()
    }

    pub fn add_auto_predictions(
        &mut self,
        rows: &[(u32, u8)],
    ) -> Result<(View, usize), WorkspaceError> {
        let added = self
            .session
            .add_auto_predictions(rows)
            .map_err(WorkspaceError::Session)?;
        self.flush();
        Ok((self.view(), added))
    }

    pub fn add_auto_no_fire(&mut self, frames: &[u32]) -> Result<(View, usize), WorkspaceError> {
        let added = self
            .session
            .add_auto_no_fire(frames)
            .map_err(WorkspaceError::Session)?;
        self.flush();
        Ok((self.view(), added))
    }

    pub fn export_labels(&self) -> String {
        self.session
            .store()
            .export_json(&self.session.project().fingerprint)
    }

    pub fn export_labels_to(&mut self, path: &Path) -> Result<View, WorkspaceError> {
        let view = self.apply(UiAction::FlushTyped)?;
        write_atomic(path, self.export_labels().as_bytes())?;
        Ok(view)
    }

    pub fn import_labels(&mut self, text: &str) -> Result<View, WorkspaceError> {
        self.session
            .import_labels(text)
            .map_err(WorkspaceError::Session)?;
        self.flush();
        Ok(self.view())
    }

    pub fn view(&mut self) -> View {
        let current = self.session.current();
        let project = self.session.project();
        let pts = project.frames[current as usize].pts;
        let index_fps = project.index.fps;
        let fps = if index_fps > 0.0 {
            index_fps
        } else {
            project.meta.fps_num as f64 / project.meta.fps_den.max(1) as f64
        };
        let frame_count = self.session.store().frame_count();
        let flag_count = self.session.flags().len();
        View {
            current,
            frame_count,
            pts,
            fps,
            label: self.session.label(),
            label_sources: self.session.store().sources(current).into_iter().collect(),
            pick: self.session.pick(),
            typed_pending: self.session.typed_pending(),
            suggestion: self.session.suggestion(),
            labelled_count: self.session.store().labelled_count(),
            undo_depth: self.session.store().undo_depth(),
            flag_count,
            warnings: self.warnings.clone(),
            save_error: self.save_error.clone(),
        }
    }

    /// Execute an action, flush the autosave queue, return the new view.
    pub fn apply(&mut self, action: UiAction) -> Result<View, WorkspaceError> {
        let bad = |why: &str| WorkspaceError::BadAction(why.to_string());
        let session_err = WorkspaceError::Session;
        let big = self.session.settings().label.big_step_frames as i64;
        let direction = |dir: i64, what: &str| -> Result<bool, WorkspaceError> {
            match dir {
                d if d > 0 => Ok(true),
                d if d < 0 => Ok(false),
                _ => Err(WorkspaceError::BadAction(format!(
                    "{what} needs a direction (+1 or -1)"
                ))),
            }
        };
        match action {
            UiAction::AnalysisMode { combined } => self.session.set_combined_fire(combined),
            UiAction::ManualStep { frames } => {
                self.session.manual_advance(frames).map_err(session_err)?;
            }
            UiAction::ManualBigStep { dir } => {
                let forward = direction(dir, "a manual big step")?;
                self.session
                    .manual_advance(if forward { big } else { -big })
                    .map_err(session_err)?;
            }
            UiAction::Step { frames } => {
                self.session.go(Move::Frames(frames));
            }
            UiAction::BigStep { dir } => {
                let forward = direction(dir, "a big step")?;
                self.session
                    .go(Move::Frames(if forward { big } else { -big }));
            }
            UiAction::Home => {
                self.session.go(Move::Home);
            }
            UiAction::End => {
                self.session.go(Move::End);
            }
            UiAction::GoTo { frame } => {
                self.session.go(Move::To(frame));
            }
            UiAction::NextUnlabelled { dir } => {
                let forward = direction(dir, "next unlabelled")?;
                self.session.go(if forward {
                    Move::NextUnlabelled
                } else {
                    Move::PrevUnlabelled
                });
            }
            UiAction::NextFlag { dir } => {
                let forward = direction(dir, "next flag")?;
                self.session.go(if forward {
                    Move::NextFlag
                } else {
                    Move::PrevFlag
                });
            }
            UiAction::ToggleSheet => self.session.toggle_sheet(),
            UiAction::ToggleMirror => self.session.toggle_mirror(),
            UiAction::Digit { digit } => {
                self.session.type_digit(digit).map_err(session_err)?;
            }
            UiAction::FlushTyped => {
                self.session.flush_typed().map_err(session_err)?;
            }
            UiAction::CancelTyping => self.session.cancel_typed(),
            UiAction::AcceptSuggestion => {
                self.session.accept_suggestion().map_err(session_err)?;
            }
            UiAction::Clear => {
                self.session.apply(Label::Unset).map_err(session_err)?;
            }
            UiAction::NoFire => {
                self.session.apply(Label::NoFire).map_err(session_err)?;
            }
            UiAction::Skip => {
                self.session.apply(Label::Skip).map_err(session_err)?;
            }
            UiAction::Undo => {
                self.session.undo();
            }
            UiAction::SetLabel { label } => {
                self.session.apply(label).map_err(session_err)?;
            }
            UiAction::ClickCell { col, row } => {
                let (sheet, mirrored) = *COLUMNS
                    .get(col as usize)
                    .ok_or_else(|| bad("the picker has only 4 columns"))?;
                let row = u8::try_from(row).map_err(|_| bad("row out of range"))?;
                self.session
                    .click_cell(sheet, row, mirrored)
                    .map_err(session_err)?;
            }
            UiAction::FillRange { start, end, label } => {
                self.session
                    .fill_range(start, end, label)
                    .map_err(session_err)?;
            }
        }
        self.flush();
        Ok(self.view())
    }

    /// Write the queued log lines; a failure keeps them queued and is reported, never fatal.
    fn flush(&mut self) {
        let lines = self.session.take_log();
        if !lines.is_empty() {
            match self.log.append(&lines) {
                Ok(()) => self.save_error = None,
                Err(e) => {
                    self.session.requeue_log(lines);
                    self.save_error = Some(format!("Could not save the labels: {e:?}. The changes are kept and will be retried."));
                    return;
                }
            }
        }
        if let Err(e) = self.log.compact_if_needed(self.session.store()) {
            self.save_error = Some(format!("Could not compact the label log: {e:?}"));
        }
    }

    /// A handle on this workspace's frame cache that works without the workspace, and so without its lock.
    pub fn frame_service(&self) -> FrameService {
        self.frames.clone()
    }

    pub fn frame_jpeg(&self, frame: u32) -> Result<Arc<Vec<u8>>, WorkspaceError> {
        self.frames.get(frame).map_err(WorkspaceError::Frame)
    }

    pub fn timeline(&mut self, start: u32, end: u32, n: usize) -> Vec<Bucket> {
        let flags = self.session.flags().to_vec();
        buckets(self.session.store(), &flags, start, end, n)
    }

    pub fn flags(&mut self) -> Vec<Flag> {
        self.session.flags().to_vec()
    }

    /// Everything the Phase tab draws: the phase series (reduced to at most `max_points`), the runs and the flags.
    pub fn phase_chart(&mut self, max_points: usize) -> PhaseChart {
        self.phase_chart_source(max_points, None)
    }

    pub fn phase_chart_source(
        &mut self,
        max_points: usize,
        source: Option<crate::label::LabelSource>,
    ) -> PhaseChart {
        let tick_rate = self.session.settings().phase.tick_rate;
        let window_ticks = self.session.settings().phase.window_ticks;
        let a = match source {
            Some(source) => self.session.analysis_for_source(source),
            None => self.session.analysis().clone(),
        };
        let label_sources = a
            .points
            .iter()
            .map(|p| {
                (
                    p.frame,
                    self.session.store().sources(p.frame).into_iter().collect(),
                )
            })
            .collect();
        let normal_points = crate::phase_v2::analyze(
            &self.session.fire_observations(source, Some(false)),
            self.session.settings(),
        )
        .expect("valid normal fire")
        .points;
        let project_frames = &self.session.project().frames;
        let texture_points = self
            .session
            .store()
            .iter()
            .into_iter()
            .flat_map(|(frame, label)| {
                let sources = self.session.store().sources(frame);
                let labels: Vec<_> = if let Label::FirePair { soul, .. } = label {
                    if source.is_some_and(|s| !soul.has_source(s)) {
                        vec![]
                    } else {
                        vec![soul.label(true)]
                    }
                } else if source.is_some_and(|s| !sources.contains(&s)) {
                    vec![]
                } else {
                    vec![label]
                };
                labels
                    .into_iter()
                    .filter_map(move |label| {
                        if let Label::Texture {
                            atlas,
                            row,
                            mirrored,
                        } = label
                        {
                            Some(TextureObservation {
                                frame,
                                pts: project_frames[frame as usize].pts,
                                atlas,
                                row,
                                mirrored,
                            })
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .collect();
        PhaseChart {
            normal_points,
            texture_points,
            label_sources,
            points: decimate(&a.points, max_points),
            runs: a.runs.clone(),
            flags: a.flags.clone(),
            tick_rate,
            window_ticks,
            reference_phase: a.reference_phase,
            flag_details: a.flag_details.clone(),
            clock_residuals: a.clock_residuals.clone(),
            lag_intervals: a.lag_intervals.clone(),
        }
    }

    // ------------------------------------------------------------ thumbnails

    fn thumb_plan(&self) -> (ThumbPlan, ThumbKey) {
        let plan = ThumbPlan::new(&self.index, &self.session.settings().timeline);
        let key = plan.key(&self.session.project().fingerprint);
        (plan, key)
    }

    /// The frames of the stored thumbnails if the store is valid for `key` (cached per key).
    fn stored_thumbs(&self, key: &ThumbKey) -> Option<Vec<u32>> {
        let mut cached = self.thumb_frames.lock().expect("thumbnail cache lock");
        if let Some((k, frames)) = cached.as_ref() {
            if k == key {
                return Some(frames.clone());
            }
        }
        let frames = self.thumb_store.frames(key)?;
        *cached = Some((key.clone(), frames.clone()));
        Some(frames)
    }

    pub fn thumbs_status(&self) -> ThumbStatus {
        let status = |state, count, error| ThumbStatus {
            state,
            count,
            error,
        };
        if !self.session.settings().timeline.thumbs_enabled {
            return status(ThumbState::Disabled, 0, None);
        }
        let run = self
            .thumb_shared
            .run
            .lock()
            .expect("thumbnail state lock")
            .clone();
        if run == ThumbRun::Running {
            return status(ThumbState::Running, 0, None);
        }
        let (_, key) = self.thumb_plan();
        if let Some(frames) = self.stored_thumbs(&key) {
            return status(ThumbState::Ready, frames.len(), None);
        }
        match run {
            ThumbRun::Failed(msg) => status(ThumbState::Failed, 0, Some(msg)),
            _ => status(ThumbState::Idle, 0, None),
        }
    }

    /// Make sure thumbnails exist: nothing when disabled, already stored, or already running; otherwise start the
    /// background pass. Returns the status right after.
    pub fn thumbs_start(&mut self) -> ThumbStatus {
        let current = self.thumbs_status();
        if matches!(
            current.state,
            ThumbState::Disabled | ThumbState::Running | ThumbState::Ready
        ) {
            return current;
        }
        let (plan, key) = self.thumb_plan();
        {
            let mut run = self.thumb_shared.run.lock().expect("thumbnail state lock");
            *run = ThumbRun::Running;
        }
        self.thumb_shared.cancel.store(false, Ordering::SeqCst);
        let (source, store, shared) = (
            self.source.clone(),
            self.thumb_store.clone(),
            self.thumb_shared.clone(),
        );
        let handle = std::thread::spawn(move || {
            let outcome = match source.thumbnails(&plan, &shared.cancel) {
                Ok(thumbs) => store.save(&key, &thumbs),
                Err(e) => Err(e),
            };
            let mut run = shared.run.lock().expect("thumbnail state lock");
            *run = match outcome {
                Ok(()) | Err(ThumbError::Cancelled) => ThumbRun::Idle,
                Err(e) => ThumbRun::Failed(format!("{e:?}")),
            };
        });
        *self.thumb_job.lock().expect("thumbnail job lock") = Some(handle);
        self.thumbs_status()
    }

    /// Wait for a running thumbnail pass (tests).
    pub fn wait_thumbs(&self) {
        let handle = self.thumb_job.lock().expect("thumbnail job lock").take();
        if let Some(h) = handle {
            let _ = h.join();
        }
    }

    /// For each wanted frame, the frame of the nearest stored thumbnail (`None` while there are none).
    pub fn thumb_nearest(&self, frames: &[u32]) -> Vec<Option<u32>> {
        let (_, key) = self.thumb_plan();
        match self.stored_thumbs(&key) {
            Some(stored) => frames.iter().map(|&f| nearest(&stored, f)).collect(),
            None => vec![None; frames.len()],
        }
    }

    /// The JPEG of a stored thumbnail (a frame returned by `thumb_nearest`).
    pub fn thumb_jpeg(&self, frame: u32) -> Result<Vec<u8>, WorkspaceError> {
        let (_, key) = self.thumb_plan();
        match self.stored_thumbs(&key) {
            Some(stored) if stored.binary_search(&frame).is_ok() => {
                self.thumb_store.get(frame).map_err(WorkspaceError::Thumb)
            }
            _ => Err(WorkspaceError::Thumb(ThumbError::Io(format!(
                "there is no thumbnail for frame {frame}"
            )))),
        }
    }

    pub fn settings(&self) -> Settings {
        *self.session.settings()
    }

    pub fn describe_settings(&self) -> Vec<SettingInfo> {
        self.session.settings().describe()
    }

    /// Validate, apply and persist one setting.
    pub fn set_setting(&mut self, key: &str, value: f64) -> Result<View, WorkspaceError> {
        let mut s = self.settings();
        s.set(key, value).map_err(WorkspaceError::Setting)?;
        let json = serde_json::to_vec_pretty(&s).map_err(|e| WorkspaceError::Io(e.to_string()))?;
        write_atomic(&self.dir.join("settings.json"), &json)?;
        self.session.set_settings(s);
        self.frames.set_config(s.decode);
        if let Some(h) = &self.decode_cfg {
            *h.lock().expect("decode settings lock") = s.decode;
        }
        self.log.set_config(&s.autosave);
        Ok(self.view())
    }

    pub fn wait_idle(&self) {
        self.frames.wait_idle();
    }
}

impl Drop for Workspace {
    /// A running thumbnail pass is cancelled (ffmpeg is killed); it is not waited for.
    fn drop(&mut self) {
        self.frames.cancel();
        self.thumb_shared.cancel.store(true, Ordering::SeqCst);
    }
}
