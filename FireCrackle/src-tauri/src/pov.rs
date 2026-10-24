//! Optional, cancellable scan with canonical GUI-neutral first-person matching.
use crate::{jobs::JobControl, scan_cache::Journal};
use fire_core::{
    gui_mask::GuiFitHint,
    pov::PovMatcher,
    video::{parallel_frames_indexed_with_state, scan_workers},
};
use serde::Serialize;
use std::{
    io::Read,
    process::{Child, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use studio_core::{import::Tools, project::Project};

const SHEET: &[u8] = include_bytes!("../../../fire-detection/data/assets/fire_1.rgba");
#[cfg(test)]
const THRESHOLD: f64 = 0.5;
type Completion = Box<dyn FnOnce(&Project, &[(u32, u8)]) -> Result<usize, String> + Send>;

/// The app's first-person match of one frame (`pov_match`): the labeller's accepted row and FOV (none when it accepts
/// nothing), and up to three rows to offer, its answer first.
#[derive(Debug, Serialize)]
pub struct FrameMatch {
    pub row: Option<u8>,
    pub fov: Option<u8>,
    pub candidates: Vec<FrameCandidate>,
}
#[derive(Debug, Serialize)]
pub struct FrameCandidate {
    pub row: u8,
    pub fov: u8,
    /// Colour evidence (-1..1), when measured.
    pub evidence: Option<f64>,
    pub accepted: bool,
}

/// Match the first-person fire on a native frame's PNG with the production labeller (`fire_core::pov::PovMatcher`,
/// the one the scan uses), kept between calls for the frame size it was built for.
pub fn match_png(png: &[u8]) -> Result<FrameMatch, String> {
    static KEPT: Mutex<Option<((usize, usize), Arc<PovMatcher>)>> = Mutex::new(None);
    let (rgb, w, h) = studio_core::gui::png_rgb(png)?;
    let matcher = {
        let mut kept = KEPT.lock().map_err(|_| "first-person matcher unavailable")?;
        match kept.as_ref() {
            Some((size, m)) if *size == (w, h) => m.clone(),
            _ => {
                let m = Arc::new(PovMatcher::new(SHEET, studio_core::gui::pov_textures()?, w, h)?);
                *kept = Some(((w, h), m.clone()));
                m
            }
        }
    };
    let found = matcher.candidates(&rgb)?;
    Ok(FrameMatch {
        row: found.result.row,
        fov: found.result.fov,
        candidates: found
            .ranked
            .iter()
            .map(|c| FrameCandidate {
                row: c.row,
                fov: c.fov,
                evidence: c.evidence.is_finite().then_some(c.evidence),
                accepted: c.accepted,
            })
            .collect(),
    })
}

#[derive(Clone, Serialize)]
pub struct Status {
    pub id: u64,
    pub video_path: String,
    pub state: String,
    pub processed: u32,
    pub total: u32,
    pub accepted: usize,
    pub applied: usize,
    pub error: Option<String>,
}
struct Job {
    project: Project,
    status: Status,
    rows: Vec<(u32, u8)>,
    control: JobControl,
    cache: Option<Journal>,
}
#[derive(Clone, Default)]
pub struct Jobs {
    current: Arc<Mutex<Option<Job>>>,
    next: Arc<AtomicU64>,
    /// The last project status polling found no usable journal for. Checking
    /// hashes the whole project and reads the journal file; on a long video
    /// with a stale cache that is far too slow to repeat on every poll.
    missing: Arc<Mutex<Option<Project>>>,
}

impl Jobs {
    /// Recover progress/results for the open video without starting work during status polling.
    pub fn restore(&self, project: &Project, no_fire: bool) -> Result<Option<Status>, String> {
        let mut state = self.current.lock().map_err(|_| "Scan state unavailable")?;
        if let Some(job) = state.as_ref() {
            if job.project == *project {
                return Ok(Some(job.status.clone()));
            }
            if matches!(job.status.state.as_str(), "running" | "saving") {
                return Ok(None);
            }
        }
        let mut missing = self.missing.lock().map_err(|_| "Scan state unavailable")?;
        if missing.as_ref() == Some(project) {
            *state = None;
            return Ok(None);
        }
        let Some(cache) = Journal::load(project, no_fire) else {
            *state = None;
            *missing = Some(project.clone());
            return Ok(None);
        };
        *missing = None;
        drop(missing);
        let rows = cache.rows();
        let status = Status {
            id: self.next.fetch_add(1, Ordering::Relaxed) + 1,
            video_path: project.video_path.clone(),
            state: if cache.finished { "done" } else { "cancelled" }.into(),
            processed: cache.processed(),
            total: project.frames.len() as u32,
            accepted: rows.len(),
            applied: cache.applied,
            error: None,
        };
        *state = Some(Job {
            project: project.clone(),
            status: status.clone(),
            rows,
            control: JobControl::default(),
            cache: Some(cache),
        });
        Ok(Some(status))
    }
    #[cfg(test)]
    pub fn status(&self) -> Result<Option<Status>, String> {
        Ok(self
            .current
            .lock()
            .map_err(|_| "Scan state unavailable")?
            .as_ref()
            .map(|j| j.status.clone()))
    }
    pub fn cancel(&self, id: u64) -> Result<(), String> {
        let state = self.current.lock().map_err(|_| "Scan state unavailable")?;
        let job = state
            .as_ref()
            .filter(|j| j.status.id == id)
            .ok_or("Scan is no longer current")?;
        if job.status.state == "saving" {
            return Err("Scan results are already being saved".into());
        }
        job.control.cancel();
        Ok(())
    }
    /// Stop a running scan (opening another video, or exit). A scan that is saving its labels is left to finish.
    pub fn shutdown(&self) {
        if let Ok(state) = self.current.lock()
            && let Some(job) = state.as_ref().filter(|j| j.status.state == "running")
        {
            job.control.cancel();
        }
    }
    pub fn start(&self, project: Project, tools: Tools) -> Result<Status, String> {
        self.start_impl(project, tools, false, None)
    }
    #[cfg(test)]
    pub fn start_no_fire(&self, project: Project, tools: Tools) -> Result<Status, String> {
        self.start_no_fire_with(project, tools, None)
    }
    pub fn start_no_fire_saving(
        &self,
        project: Project,
        tools: Tools,
        complete: Completion,
    ) -> Result<Status, String> {
        self.start_no_fire_with(project, tools, Some(complete))
    }
    fn start_no_fire_with(
        &self,
        project: Project,
        tools: Tools,
        complete: Option<Completion>,
    ) -> Result<Status, String> {
        self.start_impl(project, tools, true, complete)
    }
    pub fn candidates(&self, id: u64, offset: usize) -> Result<Vec<u32>, String> {
        let state = self.current.lock().map_err(|_| "Scan state unavailable")?;
        let job = state
            .as_ref()
            .filter(|j| j.status.id == id)
            .ok_or("Scan is no longer current")?;
        if job.status.state != "done" {
            return Err("Finish the scan before reviewing results".into());
        }
        Ok(job
            .rows
            .iter()
            .skip(offset)
            .take(100)
            .map(|r| r.0)
            .collect())
    }
    fn start_impl(
        &self,
        project: Project,
        tools: Tools,
        no_fire: bool,
        complete: Option<Completion>,
    ) -> Result<Status, String> {
        let mut state = self.current.lock().map_err(|_| "Scan state unavailable")?;
        if state
            .as_ref()
            .is_some_and(|j| matches!(j.status.state.as_str(), "running" | "saving"))
        {
            return Err("A scan for this tool is already running".into());
        }
        if let Some(job) = state.as_mut()
            && let Some(cache) = job.cache.as_mut()
        {
            cache.close()?;
        }
        let cache = Journal::open(&project, no_fire)?;
        *self.missing.lock().map_err(|_| "Scan state unavailable")? = None;
        let already_finished = cache.finished;
        let decisions = cache.decisions.clone();
        let rows = cache.rows();
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let status = Status {
            id,
            video_path: project.video_path.clone(),
            state: if cache.finished && complete.is_none() {
                "done"
            } else {
                "running"
            }
            .into(),
            processed: cache.processed(),
            total: project.frames.len() as u32,
            accepted: rows.len(),
            applied: cache.applied,
            error: None,
        };
        let control = JobControl::default();
        *state = Some(Job {
            project: project.clone(),
            status: status.clone(),
            rows,
            control: control.clone(),
            cache: Some(cache),
        });
        if status.state == "done" {
            return Ok(status);
        }
        let shared = self.current.clone();
        let jobs = self.clone();
        std::thread::spawn(move || {
            let (cancel, child) = (control.flag(), control.slot());
            let update = |frame, row| {
                if let Ok(mut state) = shared.lock()
                    && let Some(job) = state.as_mut().filter(|j| j.status.id == id)
                {
                    if let Some(cache) = job.cache.as_mut() {
                        match cache.record(frame, row) {
                            Ok(false) => return, // Already completed before the restart.
                            Ok(true) => {}
                            Err(error) => {
                                job.status.error = Some(error);
                                job.control.cancel();
                                return;
                            }
                        }
                    }
                    job.status.processed += 1;
                    if let Some(row) = row {
                        job.rows.push((frame, row));
                        job.status.accepted = job.rows.len();
                    }
                }
            };
            let result = crate::jobs::guarded("Scan", || {
                if already_finished {
                    Ok(()) // Explicitly reapply completed no-fire results without decoding/inference.
                } else if decisions.iter().all(Option::is_some) {
                    // All decisions may have arrived before decoder EOF validation or a crash.
                    // Verify the final output/EOF without loading AI or redoing any inference.
                    scan_with_workers_resuming(
                        &project,
                        &tools,
                        cancel,
                        child,
                        1,
                        &decisions,
                        |_| unreachable!("all frames are cached"),
                        update,
                    )
                } else if no_fire {
                    crate::no_fire::scan_resuming(
                        &project, &tools, cancel, child, &decisions, update,
                    )
                } else {
                    scan_resuming(&project, &tools, cancel, child, &decisions, update)
                }
            });
            // Stop and reap the decoder on success, failure, cancellation, or premature EOF.
            control.kill_child();
            let _ = jobs.finish(id, result, complete);
        });
        Ok(status)
    }
    // Release the scan mutex before saving into the workspace (which has its own mutex).
    // Completion executes once, only after a successful, uncancelled full scan.
    fn finish(
        &self,
        id: u64,
        result: Result<(), String>,
        complete: Option<Completion>,
    ) -> Result<(), String> {
        let (project, rows) = {
            let mut state = self.current.lock().map_err(|_| "Scan state unavailable")?;
            let job = state
                .as_mut()
                .filter(|j| j.status.id == id && j.status.state == "running")
                .ok_or("Scan is no longer running")?;
            if job.control.cancelled() {
                if let Some(cache) = job.cache.as_mut()
                    && let Err(error) = cache.close()
                {
                    job.status.error = Some(error);
                }
                job.status.state = if job.status.error.is_some() {
                    "failed"
                } else {
                    "cancelled"
                }
                .into();
                return Ok(());
            }
            if let Err(error) = result {
                if let Some(cache) = job.cache.as_mut() {
                    let _ = cache.close();
                }
                job.status.state = "failed".into();
                job.status.error = Some(error);
                return Ok(());
            }
            job.rows.sort_unstable_by_key(|r| r.0);
            if job.status.processed != job.status.total {
                job.status.state = "failed".into();
                job.status.error = Some(
                    "Scan stopped before every frame was processed; progress is saved.".into(),
                );
                return Ok(());
            }
            if complete.is_none() {
                if let Some(cache) = job.cache.as_mut()
                    && let Err(error) = cache.finish(job.status.applied)
                {
                    job.status.state = "failed".into();
                    job.status.error = Some(error);
                    return Ok(());
                }
                job.status.state = "done".into();
                return Ok(());
            }
            job.status.state = "saving".into();
            (job.project.clone(), job.rows.clone())
        };
        let saved = complete.unwrap()(&project, &rows);
        let mut state = self.current.lock().map_err(|_| "Scan state unavailable")?;
        let job = state
            .as_mut()
            .filter(|j| j.status.id == id)
            .ok_or("Scan is no longer current")?;
        match saved {
            Ok(count) => {
                job.status.applied = count;
                if let Some(cache) = job.cache.as_mut()
                    && let Err(error) = cache.finish(count)
                {
                    job.status.state = "failed".into();
                    job.status.error = Some(error);
                    return Ok(());
                }
                job.status.state = "done".into();
            }
            Err(error) => {
                job.status.state = "failed".into();
                job.status.error = Some(error);
            }
        }
        Ok(())
    }
    pub fn apply<T>(
        &self,
        id: u64,
        project: &Project,
        f: impl FnOnce(&[(u32, u8)]) -> Result<(T, usize), String>,
    ) -> Result<T, String> {
        let mut state = self.current.lock().map_err(|_| "Scan state unavailable")?;
        let job = state
            .as_mut()
            .filter(|j| j.status.id == id)
            .ok_or("Scan is no longer current")?;
        if job.status.state != "done" {
            return Err("Finish the scan before applying results".into());
        }
        if job.project.video_path != project.video_path
            || job.project.fingerprint != project.fingerprint
            || job.project.frames.len() != project.frames.len()
        {
            return Err("These results belong to a different video".into());
        }
        let (value, count) = f(&job.rows)?;
        job.status.applied += count;
        if let Some(cache) = job.cache.as_mut()
            && let Err(error) = cache.finish(job.status.applied)
        {
            job.status.error = Some(error);
        }
        Ok(value)
    }
}

#[cfg(test)]
fn accepted(row: u8, evidence: f64) -> Option<u8> {
    (row < 32 && evidence.is_finite() && evidence >= THRESHOLD).then_some(row)
}

#[cfg(test)]
fn scan(
    project: &Project,
    tools: &Tools,
    cancel: &AtomicBool,
    slot: &Mutex<Option<Child>>,
    update: impl FnMut(u32, Option<u8>),
) -> Result<(), String> {
    scan_resuming(project, tools, cancel, slot, &[], update)
}

fn scan_resuming(
    project: &Project,
    tools: &Tools,
    cancel: &AtomicBool,
    slot: &Mutex<Option<Child>>,
    completed: &[Option<i16>],
    update: impl FnMut(u32, Option<u8>),
) -> Result<(), String> {
    let (w, h) = (project.meta.width, project.meta.height);
    let matcher = PovMatcher::new(SHEET, studio_core::gui::pov_textures()?, w, h)?;
    let feed = ScanFeed::for_scan(project, tools, None);
    scan_with_worker_state_resuming(
        project,
        tools,
        cancel,
        slot,
        &feed,
        scan_workers(feed.frame_bytes()),
        completed,
        GuiFitHint::default,
        |hint, frame| Ok(matcher.match_frame_with_hint(frame, hint)?.row),
        update,
    )
}

/// Validate each RGB frame against its indexed timestamp before any worker can
/// classify/cache it. A bad seek must fail explicitly, never shift scan labels.
pub(crate) struct CheckedFrames<'a, R> {
    reader: R,
    times: std::sync::mpsc::Receiver<f64>,
    expected: &'a [studio_core::project::FrameRecord],
    frame: usize,
    offset: usize,
    frame_bytes: usize,
    time_base: f64,
}
impl<R: Read> Read for CheckedFrames<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        let size = buffer.len().min(self.frame_bytes - self.offset);
        let count = self.reader.read(&mut buffer[..size])?;
        if count == 0 {
            return Ok(0);
        }
        if self.offset == 0 && self.frame < self.expected.len() {
            let expected = self.expected[self.frame];
            let time =
                self.times.recv().map_err(|_| {
                    std::io::Error::other("Decoder did not report a frame timestamp")
                })? + self.time_base;
            let next = self
                .expected
                .get(self.frame + 1)
                .map(|next| next.pts - expected.pts)
                .filter(|gap| *gap > 0.);
            let previous = self
                .frame
                .checked_sub(1)
                .map(|n| expected.pts - self.expected[n].pts)
                .filter(|gap| *gap > 0.);
            let interval = next.into_iter().chain(previous).fold(0.04_f64, f64::min);
            if !time.is_finite() || (time - expected.pts).abs() > interval * 0.5 {
                return Err(std::io::Error::other(format!(
                    "Resume decoder frame {} is misaligned: expected {:.6}s, got {:.6}s",
                    self.frame, expected.pts, time
                )));
            }
        }
        self.offset += count;
        if self.offset == self.frame_bytes {
            self.frame += 1;
            self.offset = 0;
        }
        Ok(count)
    }
}

/// What the scan decoder's pipe carries.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PixelFormat {
    /// FFmpeg converts (and scales) to RGB itself.
    Rgb24,
    /// FFmpeg delivers planar YUV at native size; each worker converts with the
    /// same arithmetic swscale would have used (`fire_core::yuv`): half the bytes
    /// over the pipe, and the conversion runs on every worker.
    Yuv420p(fire_core::yuv::Matrix),
}

/// How a scan receives its frames: size as scanned, pipe format and decoder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ScanFeed {
    pub width: usize,
    pub height: usize,
    pub pixel_format: PixelFormat,
    /// An NVDEC decoder (`av1_cuvid`, `h264_cuvid`, ...) that was verified on this video.
    pub decoder: Option<String>,
}
impl ScanFeed {
    /// `target`: the size the scan wants (`None` = native). YUV only when FFmpeg
    /// would not scale, the dimensions are even and the stream's matrix is one
    /// the converter reproduces; otherwise FFmpeg's own conversion is used.
    pub fn plan(
        meta: &studio_core::project::VideoMeta,
        target: Option<(usize, usize)>,
        matrix: Option<fire_core::yuv::Matrix>,
        decoder: Option<String>,
    ) -> ScanFeed {
        let (width, height) = target.unwrap_or((meta.width, meta.height));
        let native = (width, height) == (meta.width, meta.height);
        let pixel_format = match matrix {
            Some(matrix) if native && width % 2 == 0 && height % 2 == 0 => {
                PixelFormat::Yuv420p(matrix)
            }
            _ => PixelFormat::Rgb24,
        };
        ScanFeed {
            width,
            height,
            pixel_format,
            decoder,
        }
    }
    /// Probe the video once for its colour matrix and for NVDEC support of its codec.
    pub fn for_scan(project: &Project, tools: &Tools, target: Option<(usize, usize)>) -> ScanFeed {
        let matrix = colour_space(tools, &project.video_path)
            .and_then(|tag| fire_core::yuv::Matrix::for_colour_space(&tag));
        let decoder = nvdec_decoder(&project.meta.codec)
            .filter(|_| {
                prefer_nvdec(
                    &project.meta.codec,
                    crate::external_tools::has_dav1d(&tools.ffmpeg),
                )
            })
            .filter(|name| nvdec_available(tools, &project.video_path, name))
            .map(str::to_string);
        Self::plan(&project.meta, target, matrix, decoder)
    }
    pub fn frame_bytes(&self) -> usize {
        match self.pixel_format {
            PixelFormat::Rgb24 => self.width * self.height * 3,
            PixelFormat::Yuv420p(_) => fire_core::yuv::frame_bytes(self.width, self.height),
        }
    }
    pub fn ffmpeg_pix_fmt(&self) -> &'static str {
        match self.pixel_format {
            PixelFormat::Rgb24 => "rgb24",
            PixelFormat::Yuv420p(_) => "yuv420p",
        }
    }
    pub fn scaled(&self, meta: &studio_core::project::VideoMeta) -> bool {
        (self.width, self.height) != (meta.width, meta.height)
    }
    /// The RGB24 frame a scan works on: the pipe frame itself, or its conversion in `buffer`.
    pub fn rgb<'a>(&self, frame: &'a [u8], buffer: &'a mut Vec<u8>) -> Result<&'a [u8], String> {
        match self.pixel_format {
            PixelFormat::Rgb24 => {
                if frame.len() != self.frame_bytes() {
                    return Err("Decoded frame has the wrong size".into());
                }
                Ok(frame)
            }
            PixelFormat::Yuv420p(matrix) => {
                buffer.resize(self.width * self.height * 3, 0);
                fire_core::yuv::yuv420p_to_rgb24(frame, self.width, self.height, matrix, buffer)?;
                Ok(buffer.as_slice())
            }
        }
    }
}

/// FFmpeg's NVDEC decoder for a codec name as ffprobe reports it.
pub(crate) fn nvdec_decoder(codec: &str) -> Option<&'static str> {
    match codec {
        "av1" => Some("av1_cuvid"),
        "h264" => Some("h264_cuvid"),
        "hevc" => Some("hevc_cuvid"),
        "vp9" => Some("vp9_cuvid"),
        _ => None,
    }
}

/// NVDEC decodes H.264/HEVC/VP9 exactly, and AV1 about as fast as libdav1d; but on
/// one recovered AV1 recording it produced ~2 % of frames differently, while dav1d
/// matches the reference decoder bit for bit. With dav1d bundled, AV1 stays in software.
pub(crate) fn prefer_nvdec(codec: &str, has_dav1d: bool) -> bool {
    !(codec == "av1" && has_dav1d)
}

/// The no-fire policy and model are 1920×1080-only; every recording is scanned
/// at that size (FFmpeg scales other resolutions).
pub(crate) fn no_fire_scan_size(_meta: &studio_core::project::VideoMeta) -> (usize, usize) {
    (1920, 1080)
}

/// The stream's `color_space` tag as ffprobe reports it (`unknown` when untagged).
fn colour_space(tools: &Tools, video: &str) -> Option<String> {
    let output = studio_core::proc::hidden_command(&tools.ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=color_space",
            "-of",
            "default=nw=1:nk=1",
        ])
        .arg(video)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string(),
    )
}

/// Decode one frame with the NVDEC decoder; remembered per decoder for this process.
fn nvdec_available(tools: &Tools, video: &str, decoder: &str) -> bool {
    static PROBED: Mutex<Vec<(String, bool)>> = Mutex::new(Vec::new());
    if let Ok(probed) = PROBED.lock()
        && let Some((_, ok)) = probed.iter().find(|(name, _)| name == decoder)
    {
        return *ok;
    }
    let ok = studio_core::proc::background_command(&tools.ffmpeg)
        .args(["-v", "error", "-nostdin", "-c:v", decoder, "-i"])
        .arg(video)
        .args(["-frames:v", "1", "-f", "null", "-"])
        .output()
        .is_ok_and(|output| output.status.success());
    if let Ok(mut probed) = PROBED.lock() {
        probed.push((decoder.to_string(), ok));
    }
    ok
}

/// The exact decoder command for a scan: trim by display-frame index from an
/// accurate seek, `showinfo` for per-frame timestamp validation, then the feed's
/// pipe format (and FFmpeg's own scaler when the feed is not native size).
/// No decoder thread caps: a scan owns the machine while it runs, at below-normal
/// priority. Returns the command and the seek's time base.
pub(crate) fn scan_decoder_command(
    project: &Project,
    tools: &Tools,
    start: usize,
    feed: &ScanFeed,
) -> Result<(std::process::Command, f64), String> {
    if start >= project.frames.len() {
        return Err("Resume frame is outside the video".into());
    }
    let mut command = studio_core::proc::background_command(&tools.ffmpeg);
    // Seek near the saved position using the exact preview decoder's backoff.
    // Some demuxers/B-frame streams return an earlier GOP without accurate seek;
    // retain accurate seeking and validate every output timestamp instead.
    let key = project.frames[..=start]
        .iter()
        .rposition(|entry| entry.key)
        .unwrap_or(0);
    let seek = studio_core::frames::seek_arg(project.frames[key].pts, 0.5);
    let time_base = seek
        .as_ref()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(project.frames[0].pts);
    let prefix = if seek.is_some() {
        project
            .frames
            .partition_point(|entry| entry.pts < time_base)
            .min(start)
    } else {
        0
    };
    command.args(["-nostdin", "-hide_banner", "-loglevel", "info", "-nostats"]);
    if let Some(seek) = &seek {
        command.args(["-seek_timestamp", "1", "-ss", seek]);
    }
    if let Some(decoder) = &feed.decoder {
        command.args(["-c:v", decoder]);
    }
    // Trim by display-frame index (not approximate timestamp seeking), preserving VFR frame identity.
    let mut filters = format!("trim=start_frame={},showinfo", start - prefix);
    if feed.scaled(&project.meta) {
        filters.push_str(&format!(",scale={}:{}", feed.width, feed.height));
    }
    command
        .arg("-i")
        .arg(&project.video_path)
        .args(["-map", "0:v:0"])
        .args(["-vf", &filters])
        .args(studio_core::import::passthrough_args(&tools.ffmpeg))
        .args(["-pix_fmt", feed.ffmpeg_pix_fmt(), "-f", "rawvideo", "-"]);
    Ok((command, time_base))
}

/// Shared exact raw decoder for first-person, no-fire and GUI scans.
pub(crate) fn open_scan_decoder<'a>(
    project: &'a Project,
    tools: &Tools,
    start: usize,
    slot: &Mutex<Option<Child>>,
    feed: &ScanFeed,
) -> Result<
    (
        CheckedFrames<'a, std::process::ChildStdout>,
        std::thread::JoinHandle<String>,
    ),
    String,
> {
    let frame_bytes = feed.frame_bytes();
    let (mut command, time_base) = scan_decoder_command(project, tools, start, feed)?;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start FFmpeg: {e}"))?;
    let pipe = child.stdout.take().ok_or("Decoder output missing")?;
    let stderr = child.stderr.take().ok_or("Decoder errors missing")?;
    let (time_tx, time_rx) = std::sync::mpsc::channel();
    let errors = std::thread::spawn(move || {
        use std::io::BufRead;
        let mut saved = std::collections::VecDeque::new();
        let mut times = studio_core::frames::ShowinfoTimes::default();
        for line in std::io::BufReader::new(stderr)
            .lines()
            .map_while(Result::ok)
        {
            if line.contains("showinfo") {
                if let Some(time) = times.line(&line) {
                    let _ = time_tx.send(time);
                }
            } else {
                saved.push_back(line.chars().take(1000).collect::<String>());
                if saved.len() > 12 {
                    saved.pop_front();
                }
            }
        }
        saved.into_iter().collect::<Vec<_>>().join("\n")
    });
    *slot.lock().map_err(|_| "Decoder state unavailable")? = Some(child);
    Ok((
        CheckedFrames {
            reader: pipe,
            times: time_rx,
            expected: &project.frames,
            frame: start,
            offset: 0,
            frame_bytes,
            time_base,
        },
        errors,
    ))
}

#[allow(clippy::too_many_arguments)] // Decoder ownership, resume state and the two closures are independent.
pub(crate) fn scan_with_workers_resuming(
    project: &Project,
    tools: &Tools,
    cancel: &AtomicBool,
    slot: &Mutex<Option<Child>>,
    workers: usize,
    completed: &[Option<i16>],
    process: impl Fn(&[u8]) -> Result<Option<u8>, String> + Sync,
    update: impl FnMut(u32, Option<u8>),
) -> Result<(), String> {
    scan_with_worker_state_resuming(
        project,
        tools,
        cancel,
        slot,
        &ScanFeed::plan(&project.meta, None, None, None),
        workers,
        completed,
        || (),
        |_, rgb| process(rgb),
        update,
    )
}

#[allow(clippy::too_many_arguments)] // Decoder/resume ownership and private worker state factory.
pub(crate) fn scan_with_worker_state_resuming<S>(
    project: &Project,
    tools: &Tools,
    cancel: &AtomicBool,
    slot: &Mutex<Option<Child>>,
    feed: &ScanFeed,
    workers: usize,
    completed: &[Option<i16>],
    initialize: impl Fn() -> S + Sync,
    process: impl Fn(&mut S, &[u8]) -> Result<Option<u8>, String> + Sync,
    update: impl FnMut(u32, Option<u8>),
) -> Result<(), String> {
    scan_frames(
        project,
        tools,
        cancel,
        slot,
        feed,
        workers,
        completed,
        |row| (*row >= 0).then_some(*row as u8),
        initialize,
        process,
        update,
    )
}

/// The one exact, resumable, frame-preserving video pass every automatic scan runs on (first-person, no-fire, GUI).
/// Decoding starts at the first frame without a saved result (`completed`, original frame numbers); frames that
/// already have one are passed through `cached` instead of being processed again. `update` sees every frame from the
/// start point on, in any order. The decoder's exit status is checked unless the scan was cancelled.
#[allow(clippy::too_many_arguments)] // Decoder/resume ownership, worker state factory and the result callbacks.
pub(crate) fn scan_frames<S, R: Send, C: Sync>(
    project: &Project,
    tools: &Tools,
    cancel: &AtomicBool,
    slot: &Mutex<Option<Child>>,
    feed: &ScanFeed,
    workers: usize,
    completed: &[Option<C>],
    cached: impl Fn(&C) -> R + Sync,
    initialize: impl Fn() -> S + Sync,
    process: impl Fn(&mut S, &[u8]) -> Result<R, String> + Sync,
    mut update: impl FnMut(u32, R),
) -> Result<(), String> {
    if !completed.is_empty() && completed.len() != project.frames.len() {
        return Err("Scan cache has the wrong frame count".into());
    }
    let start = completed
        .iter()
        .position(Option::is_none)
        .unwrap_or(if completed.is_empty() {
            0
        } else {
            completed.len().saturating_sub(1)
        });
    if start == project.frames.len() {
        return Ok(());
    }
    let (pipe, errors) = open_scan_decoder(project, tools, start, slot, feed)?;
    parallel_frames_indexed_with_state(
        pipe,
        feed.frame_bytes(),
        (project.frames.len() - start) as u32,
        workers.clamp(1, 12),
        cancel,
        || (initialize(), Vec::new()),
        |(state, buffer), n, frame| match completed.get(start + n as usize).and_then(Option::as_ref)
        {
            Some(saved) => Ok(cached(saved)),
            None => process(state, feed.rgb(frame, buffer)?),
        },
        |n, result| update(n + start as u32, result),
    )?;
    if cancel.load(Ordering::Relaxed) {
        return Ok(());
    }
    let success = slot
        .lock()
        .map_err(|_| "Decoder state unavailable")?
        .as_mut()
        .ok_or("Decoder missing")?
        .wait()
        .map_err(|e| e.to_string())?
        .success();
    let message = errors.join().unwrap_or_default();
    if !success {
        return Err(format!("FFmpeg failed: {message}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decoder_rejects_shifted_frames_even_beside_a_long_timestamp_gap() {
        let expected =
            [0., 0.05, 5., 5.05].map(|pts| studio_core::project::FrameRecord { pts, key: false });
        let (tx, times) = std::sync::mpsc::channel();
        tx.send(0.).unwrap();
        drop(tx);
        let mut reader = CheckedFrames {
            reader: std::io::Cursor::new(vec![1; 3]),
            times,
            expected: &expected,
            frame: 1,
            offset: 0,
            frame_bytes: 3,
            time_base: 0.,
        };
        let error = reader.read(&mut [0; 3]).unwrap_err();
        assert!(error.to_string().contains("frame 1 is misaligned"));
    }
    #[test]
    #[ignore = "Requires SCAN_RESUME_PROJECT pointing to an existing imported real video project"]
    fn real_resume_first_output_timing() {
        let project: Project = serde_json::from_slice(
            &std::fs::read(std::env::var("SCAN_RESUME_PROJECT").unwrap()).unwrap(),
        )
        .unwrap();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime");
        let suffix = std::env::consts::EXE_SUFFIX;
        let tools = Tools {
            ffmpeg: root.join(format!("ffmpeg{suffix}")).into_os_string(),
            ffprobe: root.join(format!("ffprobe{suffix}")).into_os_string(),
        };
        for start in [0, 659, 3178, 90000] {
            if start >= project.frames.len() {
                continue;
            }
            let slot = Mutex::new(None);
            let began = std::time::Instant::now();
            let feed = ScanFeed::plan(&project.meta, None, None, None);
            let (mut reader, diagnostics) =
                open_scan_decoder(&project, &tools, start, &slot, &feed).unwrap();
            let mut frame = vec![0; project.meta.width * project.meta.height * 3];
            let result = reader.read_exact(&mut frame);
            let elapsed = began.elapsed();
            drop(reader);
            let mut child = slot.lock().unwrap().take().unwrap();
            let _ = child.kill();
            let _ = child.wait();
            let log = diagnostics.join().unwrap();
            result.unwrap_or_else(|e| panic!("frame {start}: {e}; {log}"));
            println!(
                "resume frame {start}: {:.3} s, indexed timestamp validated",
                elapsed.as_secs_f64()
            );
        }
    }
    #[test]
    fn seeked_scan_rgb_matches_full_decode_with_vfr_nonzero_start_and_b_frames() {
        let f = crate::scan_cache::tests::fixture(96);
        let tools = test_tools();
        let raw = f.root.join("frames.rgb");
        let data: Vec<u8> = (0..96u8).flat_map(|n| vec![n * 2; 16 * 16 * 3]).collect();
        std::fs::write(&raw, &data).unwrap();
        for codec in ["ffv1", "libx264"] {
            let mut command = studio_core::proc::ffmpeg_command(&tools.ffmpeg);
            command
                .args([
                    "-y",
                    "-v",
                    "error",
                    "-f",
                    "rawvideo",
                    "-pixel_format",
                    "rgb24",
                    "-video_size",
                    "16x16",
                    "-framerate",
                    "20",
                    "-i",
                ])
                .arg(&raw)
                .args(["-vf", "setpts=PTS+2/TB+floor(N/7)*0.02/TB"])
                .args(studio_core::import::passthrough_args(&tools.ffmpeg))
                .args(["-c:v", codec, "-g", "12"]);
            if codec == "libx264" {
                command.args(["-bf", "2", "-pix_fmt", "yuv420p"]);
            }
            let output = command.arg(&f.project.video_path).output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            let project = studio_core::import::import_video(
                &tools,
                std::path::Path::new(&f.project.video_path),
                &Default::default(),
            )
            .unwrap();
            assert!(project.frames[0].pts > 1.9);
            let baseline = studio_core::proc::ffmpeg_command(&tools.ffmpeg)
                .args(["-v", "error", "-i"])
                .arg(&project.video_path)
                .args(["-map", "0:v:0"])
                .args(studio_core::import::passthrough_args(&tools.ffmpeg))
                .args(["-pix_fmt", "rgb24", "-f", "rawvideo", "-"])
                .output()
                .unwrap();
            assert!(baseline.status.success());
            let bytes = 16 * 16 * 3;
            for start in [13, 35, 73] {
                let slot = Mutex::new(None);
                let feed = ScanFeed::plan(&project.meta, None, None, None);
                let (mut reader, diagnostics) =
                    open_scan_decoder(&project, &tools, start, &slot, &feed).unwrap();
                let mut decoded = Vec::new();
                let result = reader.read_to_end(&mut decoded);
                drop(reader);
                let mut child = slot.lock().unwrap().take().unwrap();
                if result.is_err() {
                    let _ = child.kill();
                }
                let status = child.wait().unwrap();
                let log = diagnostics.join().unwrap();
                result.unwrap_or_else(|e| panic!("{codec} start{start}: {e}; {log}"));
                assert!(status.success(), "{log}");
                assert_eq!(
                    decoded,
                    &baseline.stdout[start * bytes..],
                    "{codec} start{start}"
                );
            }
        }
    }
    /// The bundled FFmpeg on Windows (`runtime/`), otherwise FFmpeg from PATH
    /// (Linux builds use the system FFmpeg).
    fn test_tools() -> Tools {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime");
        let suffix = std::env::consts::EXE_SUFFIX;
        let bundled = root.join(format!("ffmpeg{suffix}"));
        if bundled.is_file() {
            Tools {
                ffmpeg: bundled.into_os_string(),
                ffprobe: root.join(format!("ffprobe{suffix}")).into_os_string(),
            }
        } else {
            Tools {
                ffmpeg: "ffmpeg".into(),
                ffprobe: "ffprobe".into(),
            }
        }
    }
    fn meta(width: usize, height: usize, codec: &str) -> studio_core::project::VideoMeta {
        studio_core::project::VideoMeta {
            width,
            height,
            fps_num: 60,
            fps_den: 1,
            codec: codec.into(),
        }
    }
    #[test]
    fn scan_feed_takes_yuv_at_native_size_and_rgb_when_scaling_or_uncertain() {
        use fire_core::yuv::Matrix;
        let native = ScanFeed::plan(&meta(1920, 1080, "h264"), None, Some(Matrix::Bt709), None);
        assert_eq!(
            (
                native.width,
                native.height,
                native.pixel_format,
                native.frame_bytes()
            ),
            (
                1920,
                1080,
                PixelFormat::Yuv420p(Matrix::Bt709),
                1920 * 1080 * 3 / 2
            )
        );
        assert_eq!(native.ffmpeg_pix_fmt(), "yuv420p");
        let same = ScanFeed::plan(
            &meta(1920, 1080, "h264"),
            Some((1920, 1080)),
            Some(Matrix::Bt601),
            None,
        );
        assert_eq!(same.pixel_format, PixelFormat::Yuv420p(Matrix::Bt601));
        let scaled = ScanFeed::plan(
            &meta(2560, 1440, "av1"),
            Some((1920, 1080)),
            Some(Matrix::Bt709),
            None,
        );
        assert_eq!(
            (
                scaled.width,
                scaled.height,
                scaled.pixel_format,
                scaled.frame_bytes()
            ),
            (1920, 1080, PixelFormat::Rgb24, 1920 * 1080 * 3)
        );
        assert_eq!(scaled.ffmpeg_pix_fmt(), "rgb24");
        let odd = ScanFeed::plan(&meta(1281, 721, "h264"), None, Some(Matrix::Bt709), None);
        assert_eq!(odd.pixel_format, PixelFormat::Rgb24);
        let unknown = ScanFeed::plan(&meta(1920, 1080, "h264"), None, None, None);
        assert_eq!(unknown.pixel_format, PixelFormat::Rgb24);
        let nvdec = ScanFeed::plan(
            &meta(1920, 1080, "h264"),
            None,
            Some(Matrix::Bt709),
            Some("h264_cuvid".into()),
        );
        assert_eq!(nvdec.decoder.as_deref(), Some("h264_cuvid"));
    }
    #[test]
    fn scan_feed_converts_yuv_frames_and_passes_rgb_through() {
        use fire_core::yuv::Matrix;
        let feed = ScanFeed::plan(&meta(2, 2, "h264"), None, Some(Matrix::Bt709), None);
        let mut buffer = Vec::new();
        let rgb = feed
            .rgb(&[128, 128, 128, 128, 128, 128], &mut buffer)
            .unwrap();
        assert_eq!(rgb, &[130; 12]);
        let feed = ScanFeed::plan(&meta(2, 2, "h264"), None, None, None);
        let frame = [7u8; 12];
        let rgb = feed.rgb(&frame, &mut buffer).unwrap();
        assert_eq!(rgb, &frame);
        assert!(feed.rgb(&[7u8; 11], &mut buffer).is_err());
    }
    #[test]
    fn nvdec_decoder_names_follow_the_codec() {
        assert_eq!(nvdec_decoder("av1"), Some("av1_cuvid"));
        assert_eq!(nvdec_decoder("h264"), Some("h264_cuvid"));
        assert_eq!(nvdec_decoder("hevc"), Some("hevc_cuvid"));
        assert_eq!(nvdec_decoder("vp9"), Some("vp9_cuvid"));
        assert_eq!(nvdec_decoder("ffv1"), None);
        assert_eq!(nvdec_decoder(""), None);
    }
    #[test]
    fn av1_stays_in_software_when_dav1d_is_bundled() {
        assert!(!prefer_nvdec("av1", true));
        assert!(prefer_nvdec("av1", false));
        assert!(prefer_nvdec("h264", true));
        assert!(prefer_nvdec("hevc", true));
    }
    #[test]
    fn no_fire_scans_every_resolution_at_1080p() {
        assert_eq!(no_fire_scan_size(&meta(1920, 1080, "h264")), (1920, 1080));
        assert_eq!(no_fire_scan_size(&meta(2560, 1440, "av1")), (1920, 1080));
        assert_eq!(no_fire_scan_size(&meta(1280, 720, "h264")), (1920, 1080));
    }
    #[test]
    fn scan_decoder_command_selects_pipe_and_decoder_without_thread_caps() {
        use fire_core::yuv::Matrix;
        let f = crate::scan_cache::tests::fixture(4);
        let tools = Tools {
            ffmpeg: "ffmpeg".into(),
            ffprobe: "ffprobe".into(),
        };
        let args_of = |feed: &ScanFeed| -> Vec<String> {
            let (command, _) = scan_decoder_command(&f.project, &tools, 0, feed).unwrap();
            command
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect()
        };
        let feed = ScanFeed {
            width: 16,
            height: 16,
            pixel_format: PixelFormat::Yuv420p(Matrix::Bt601),
            decoder: Some("h264_cuvid".into()),
        };
        let args = args_of(&feed);
        assert!(!args.windows(2).any(|w| w == ["-threads", "2"]), "{args:?}");
        assert!(!args.iter().any(|a| a == "-filter_threads"), "{args:?}");
        let input = args.iter().position(|a| a == "-i").unwrap();
        let codec = args.iter().position(|a| a == "-c:v").unwrap();
        assert!(codec < input && args[codec + 1] == "h264_cuvid", "{args:?}");
        assert!(
            args.windows(2).any(|w| w == ["-pix_fmt", "yuv420p"]),
            "{args:?}"
        );
        let filters = &args[args.iter().position(|a| a == "-vf").unwrap() + 1];
        assert!(
            filters.starts_with("trim=start_frame=0,showinfo") && !filters.contains("scale="),
            "{filters}"
        );
        let feed = ScanFeed {
            width: 8,
            height: 8,
            pixel_format: PixelFormat::Rgb24,
            decoder: None,
        };
        let args = args_of(&feed);
        assert!(!args.iter().any(|a| a == "-c:v"), "{args:?}");
        assert!(
            args.windows(2).any(|w| w == ["-pix_fmt", "rgb24"]),
            "{args:?}"
        );
        let filters = &args[args.iter().position(|a| a == "-vf").unwrap() + 1];
        assert!(filters.ends_with("showinfo,scale=8:8"), "{filters}");
    }
    #[test]
    fn yuv_pipe_reproduces_ffmpeg_rgb24_exactly() {
        let f = crate::scan_cache::tests::fixture(48);
        let tools = test_tools();
        let raw = f.root.join("frames.rgb");
        let data: Vec<u8> = (0..48u32)
            .flat_map(|n| {
                (0..32 * 32).flat_map(move |i| {
                    [
                        (n * 5 + i as u32) as u8,
                        (i as u32 * 7 + n) as u8,
                        (255 - n * 3) as u8,
                    ]
                })
            })
            .collect();
        std::fs::write(&raw, &data).unwrap();
        let output = studio_core::proc::ffmpeg_command(&tools.ffmpeg)
            .args([
                "-y",
                "-v",
                "error",
                "-f",
                "rawvideo",
                "-pixel_format",
                "rgb24",
                "-video_size",
                "32x32",
                "-framerate",
                "20",
                "-i",
            ])
            .arg(&raw)
            .args([
                "-c:v", "libx264", "-g", "12", "-bf", "2", "-pix_fmt", "yuv420p",
            ])
            .arg(&f.project.video_path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let project = studio_core::import::import_video(
            &tools,
            std::path::Path::new(&f.project.video_path),
            &Default::default(),
        )
        .unwrap();
        let baseline = studio_core::proc::ffmpeg_command(&tools.ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&project.video_path)
            .args(["-map", "0:v:0"])
            .args(studio_core::import::passthrough_args(&tools.ffmpeg))
            .args(["-pix_fmt", "rgb24", "-f", "rawvideo", "-"])
            .output()
            .unwrap();
        assert!(baseline.status.success());
        // Untagged stream: swscale (and therefore the feed) uses BT.601.
        let feed = ScanFeed::for_scan(&project, &tools, None);
        assert_eq!(
            feed.pixel_format,
            PixelFormat::Yuv420p(fire_core::yuv::Matrix::Bt601)
        );
        let slot = Mutex::new(None);
        let (mut reader, diagnostics) =
            open_scan_decoder(&project, &tools, 0, &slot, &feed).unwrap();
        let mut decoded = Vec::new();
        reader.read_to_end(&mut decoded).unwrap();
        drop(reader);
        let mut child = slot.lock().unwrap().take().unwrap();
        assert!(
            child.wait().unwrap().success(),
            "{}",
            diagnostics.join().unwrap()
        );
        assert_eq!(decoded.len(), 48 * feed.frame_bytes());
        let mut buffer = Vec::new();
        for (n, frame) in decoded.chunks_exact(feed.frame_bytes()).enumerate() {
            let rgb = feed.rgb(frame, &mut buffer).unwrap();
            assert_eq!(
                rgb,
                &baseline.stdout[n * 32 * 32 * 3..(n + 1) * 32 * 32 * 3],
                "frame {n}"
            );
        }
    }
    #[test]
    fn status_polling_remembers_a_missing_journal_until_the_project_changes() {
        let f = crate::scan_cache::tests::fixture(3);
        let jobs = Jobs::default();
        assert!(jobs.restore(&f.project, false).unwrap().is_none());
        // A journal that appears afterwards is not re-read on every poll for the
        // same project (each read hashes the whole project and reads the file).
        let mut cache = Journal::open(&f.project, false).unwrap();
        cache.record(0, None).unwrap();
        drop(cache);
        assert!(jobs.restore(&f.project, false).unwrap().is_none());
        // Opening another video and coming back checks again.
        let mut other = f.project.clone();
        other.fingerprint = "other".into();
        assert!(jobs.restore(&other, false).unwrap().is_none());
        let back = jobs.restore(&f.project, false).unwrap().unwrap();
        assert_eq!((back.state.as_str(), back.processed), ("cancelled", 1));
    }
    /// Status polling on a real long project with stale journals (the freeze):
    /// the first poll may be slow, every later poll must be cheap.
    #[test]
    #[ignore = "Requires STATUS_POLL_PROJECT pointing to a long imported project.json"]
    fn status_polling_stays_cheap_on_a_long_real_project() {
        let project: Project = serde_json::from_slice(
            &std::fs::read(std::env::var("STATUS_POLL_PROJECT").unwrap()).unwrap(),
        )
        .unwrap();
        let time = |f: &mut dyn FnMut()| {
            let started = std::time::Instant::now();
            f();
            started.elapsed().as_secs_f64() * 1000.
        };
        let old = time(&mut || {
            let _ = Journal::load(&project, false);
        });
        for no_fire in [false, true] {
            let jobs = Jobs::default();
            let first = time(&mut || {
                let _ = jobs.restore(&project, no_fire).unwrap();
            });
            let later: Vec<f64> = (0..20)
                .map(|_| {
                    time(&mut || {
                        let _ = jobs.restore(&project, no_fire).unwrap();
                    })
                })
                .collect();
            let worst = later.iter().cloned().fold(0., f64::max);
            eprintln!(
                "frames {} no_fire {no_fire}: old per-poll load {old:.1} ms; first poll {first:.1} ms; next 20 polls worst {worst:.2} ms",
                project.frames.len()
            );
            assert!(worst < 50., "a repeated poll took {worst:.1} ms");
        }
    }
    #[test]
    fn starting_a_scan_forgets_a_remembered_missing_journal() {
        let f = crate::scan_cache::tests::fixture(3);
        let jobs = Jobs::default();
        assert!(jobs.restore(&f.project, false).unwrap().is_none());
        let mut cache = Journal::open(&f.project, false).unwrap();
        for frame in 0..3 {
            cache.record(frame, None).unwrap();
        }
        cache.finish(0).unwrap();
        drop(cache);
        // A completed journal makes start report "done" without decoding.
        let started = jobs.start(f.project.clone(), Tools::default()).unwrap();
        assert_eq!(started.state, "done");
        assert_eq!(
            jobs.restore(&f.project, false).unwrap().unwrap().state,
            "done"
        );
    }
    #[test]
    fn recovers_partial_and_completed_jobs_with_stable_candidate_frames() {
        let f = crate::scan_cache::tests::fixture(3);
        let mut cache = Journal::open(&f.project, false).unwrap();
        cache.record(2, Some(4)).unwrap();
        cache.record(0, None).unwrap();
        drop(cache);
        let jobs = Jobs::default();
        let paused = jobs.restore(&f.project, false).unwrap().unwrap();
        assert_eq!(
            (paused.state.as_str(), paused.processed, paused.accepted),
            ("cancelled", 2, 1)
        );
        assert!(jobs.candidates(paused.id, 0).is_err());
        let mut cache = Journal::open(&f.project, false).unwrap();
        cache.record(1, None).unwrap();
        cache.finish(0).unwrap();
        drop(cache);
        let recovered = Jobs::default();
        let done = recovered.restore(&f.project, false).unwrap().unwrap();
        assert_eq!((done.state.as_str(), done.processed), ("done", 3));
        assert_eq!(recovered.candidates(done.id, 0).unwrap(), vec![2]);
        recovered
            .apply(done.id, &f.project, |rows| {
                assert_eq!(rows, &[(2, 4)]);
                Ok(((), 1))
            })
            .unwrap();
        drop(recovered);
        assert_eq!(
            Jobs::default()
                .restore(&f.project, false)
                .unwrap()
                .unwrap()
                .applied,
            1
        );
        // A completed compatible cache returns without attempting to launch a decoder.
        assert_eq!(
            Jobs::default()
                .start(f.project.clone(), Tools::default())
                .unwrap()
                .state,
            "done"
        );
    }
    #[test]
    fn completed_no_fire_reapplication_does_not_load_ai_or_decode_again() {
        use std::sync::atomic::AtomicUsize;
        let mut f = crate::scan_cache::tests::fixture(2);
        f.project.meta.width = 1920;
        f.project.meta.height = 1080;
        let mut cache = Journal::open(&f.project, true).unwrap();
        cache.record(0, Some(0)).unwrap();
        cache.record(1, None).unwrap();
        cache.finish(1).unwrap();
        drop(cache);
        let calls = Arc::new(AtomicUsize::new(0));
        let called = calls.clone();
        let jobs = Jobs::default();
        jobs.start_no_fire_saving(
            f.project.clone(),
            Tools::default(),
            Box::new(move |_, rows| {
                called.fetch_add(1, Ordering::Relaxed);
                assert_eq!(rows, &[(0, 0)]);
                Ok(1)
            }),
        )
        .unwrap();
        let started = std::time::Instant::now();
        loop {
            let status = jobs.status().unwrap().unwrap();
            if status.state != "running" && status.state != "saving" {
                assert_eq!(status.state, "done", "{:?}", status.error);
                break;
            }
            assert!(started.elapsed().as_secs() < 5);
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert_eq!(calls.load(Ordering::Relaxed), 1);
    }
    #[test]
    fn ffmpeg_resume_preserves_original_frame_numbers_and_skips_cached_inference() {
        use std::sync::atomic::AtomicUsize;
        let f = crate::scan_cache::tests::fixture(6);
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime");
        let ffmpeg = root.join(if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
        let ffmpeg = if ffmpeg.is_file() {
            ffmpeg.into_os_string()
        } else {
            "ffmpeg".into()
        };
        let tools = Tools {
            ffmpeg: ffmpeg.clone(),
            ffprobe: "ffprobe".into(),
        };
        let raw = f.root.join("frames.rgb");
        let data: Vec<u8> = (0..6u8).flat_map(|n| vec![n; 16 * 16 * 3]).collect();
        std::fs::write(&raw, data).unwrap();
        let result = studio_core::proc::ffmpeg_command(&ffmpeg)
            .args([
                "-y",
                "-v",
                "error",
                "-f",
                "rawvideo",
                "-pixel_format",
                "rgb24",
                "-video_size",
                "16x16",
                "-framerate",
                "20",
                "-i",
            ])
            .arg(raw)
            .args(["-c:v", "ffv1", "-pix_fmt", "bgr0"])
            .arg(&f.project.video_path)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let completed = vec![Some(0), None, Some(-1), None, Some(4), None];
        let calls = AtomicUsize::new(0);
        let slot = Mutex::new(None);
        let mut rows = Vec::new();
        scan_with_workers_resuming(
            &f.project,
            &tools,
            &AtomicBool::new(false),
            &slot,
            2,
            &completed,
            |rgb| {
                calls.fetch_add(1, Ordering::Relaxed);
                Ok(Some(rgb[0]))
            },
            |n, row| rows.push((n, row)),
        )
        .unwrap();
        if let Some(mut child) = slot.lock().unwrap().take() {
            let _ = child.wait();
        }
        rows.sort_unstable_by_key(|r| r.0);
        assert_eq!(
            rows,
            vec![
                (1, Some(1)),
                (2, None),
                (3, Some(3)),
                (4, Some(4)),
                (5, Some(5))
            ]
        );
        assert_eq!(calls.load(Ordering::Relaxed), 3);
        let all_cached: Vec<_> = (0..6).map(Some).collect();
        let mut final_rows = Vec::new();
        scan_with_workers_resuming(
            &f.project,
            &tools,
            &AtomicBool::new(false),
            &slot,
            1,
            &all_cached,
            |_| panic!("fully cached inference must not run"),
            |n, row| final_rows.push((n, row)),
        )
        .unwrap();
        if let Some(mut child) = slot.lock().unwrap().take() {
            let _ = child.wait();
        }
        assert_eq!(final_rows, vec![(5, Some(5))]);
        let mut wrong_index = f.project.clone();
        wrong_index.frames.truncate(5);
        let error = scan_with_workers_resuming(
            &wrong_index,
            &tools,
            &AtomicBool::new(false),
            &slot,
            1,
            &all_cached[..5],
            |_| panic!("cached inference must not run"),
            |_, _| {},
        )
        .unwrap_err();
        if let Some(mut child) = slot.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        assert!(error.contains("more frames"), "{error}");
    }
    #[test]
    fn uncertain_or_invalid_evidence_abstains() {
        assert_eq!(accepted(2, 0.5), Some(2));
        assert_eq!(accepted(2, 0.499), None);
        assert_eq!(accepted(32, 1.), None);
        assert_eq!(accepted(2, f64::NAN), None);
    }
    #[test]
    fn completion_saves_once_without_holding_scan_lock_and_reports_errors() {
        let jobs = job("running");
        let observer = jobs.clone();
        jobs.finish(
            1,
            Ok(()),
            Some(Box::new(move |_, rows| {
                assert_eq!(observer.status().unwrap().unwrap().state, "saving");
                assert!(observer.cancel(1).is_err());
                assert!(observer.start(project(), Tools::default()).is_err());
                assert_eq!(rows, &[(0, 4)]);
                Ok(1)
            })),
        )
        .unwrap();
        let status = jobs.status().unwrap().unwrap();
        assert_eq!((status.state.as_str(), status.applied), ("done", 1));
        assert!(
            jobs.finish(
                1,
                Ok(()),
                Some(Box::new(|_, _| panic!("must not save twice")))
            )
            .is_err()
        );
        let jobs = job("running");
        jobs.finish(
            1,
            Ok(()),
            Some(Box::new(|_, _| Err("Video changed".into()))),
        )
        .unwrap();
        assert_eq!(
            jobs.status().unwrap().unwrap().error.as_deref(),
            Some("Video changed")
        );
        assert_eq!(jobs.status().unwrap().unwrap().applied, 0);
    }
    #[test]
    fn cancelled_or_failed_scan_never_saves_partial_candidates() {
        let jobs = job("running");
        jobs.cancel(1).unwrap();
        jobs.finish(1, Ok(()), Some(Box::new(|_, _| panic!("cancelled"))))
            .unwrap();
        assert_eq!(jobs.status().unwrap().unwrap().state, "cancelled");
        let jobs = job("running");
        jobs.finish(
            1,
            Err("decoder failed".into()),
            Some(Box::new(|_, _| panic!("failed"))),
        )
        .unwrap();
        assert_eq!(jobs.status().unwrap().unwrap().state, "failed");
    }
    fn project() -> Project {
        use studio_core::{
            config::IndexConfig,
            index::{Packet, build_index},
            project::VideoMeta,
        };
        let index = build_index(
            &[Packet {
                pts: Some(0.),
                dts: None,
                key: true,
            }],
            &IndexConfig::default(),
        )
        .unwrap();
        Project::assemble(
            "video.mkv",
            1,
            "fp".into(),
            VideoMeta {
                width: 1920,
                height: 1080,
                fps_num: 60,
                fps_den: 1,
                codec: "h264".into(),
            },
            &index,
        )
    }
    fn job(state: &str) -> Jobs {
        let jobs = Jobs::default();
        let p = project();
        *jobs.current.lock().unwrap() = Some(Job {
            status: Status {
                id: 1,
                video_path: p.video_path.clone(),
                state: state.into(),
                processed: 1,
                total: 1,
                accepted: 1,
                applied: 0,
                error: None,
            },
            project: p,
            rows: vec![(0, 4)],
            control: JobControl::default(),
            cache: None,
        });
        jobs
    }
    #[test]
    fn apply_rejects_unfinished_stale_and_wrong_video_results() {
        for state in ["running", "failed", "cancelled"] {
            assert!(job(state).apply(1, &project(), |_| Ok(((), 1))).is_err());
        }
        let jobs = job("done");
        let mut other = project();
        other.fingerprint = "other".into();
        assert!(
            jobs.apply::<()>(1, &other, |_| panic!("must not apply another video"))
                .is_err()
        );
        assert!(
            jobs.apply::<()>(2, &project(), |_| panic!("must not apply stale scan"))
                .is_err()
        );
        jobs.apply(1, &project(), |rows| {
            assert_eq!(rows, &[(0, 4)]);
            Ok(((), 1))
        })
        .unwrap();
        assert_eq!(jobs.status().unwrap().unwrap().applied, 1);
    }
    #[test]
    fn cancellation_sets_worker_flag_and_running_jobs_cannot_be_replaced() {
        let jobs = job("running");
        assert!(jobs.start(project(), Tools::default()).is_err());
        jobs.cancel(1).unwrap();
        assert!(
            jobs.current
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .control
                .cancelled()
        );
        assert!(jobs.cancel(2).is_err());
    }
    #[test]
    fn shutdown_cancels_only_a_running_scan() {
        let cancelled = |jobs: &Jobs| {
            jobs.current
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .control
                .cancelled()
        };
        let running = job("running");
        running.shutdown();
        assert!(cancelled(&running));
        // Saving writes labels into the workspace; stopping it halfway would lose them.
        for state in ["saving", "done", "cancelled", "failed"] {
            let jobs = job(state);
            jobs.shutdown();
            assert!(!cancelled(&jobs), "{state}");
        }
        Jobs::default().shutdown(); // no job: nothing to do, no panic
    }
    #[test]
    fn candidate_review_requires_completed_scan_and_keeps_original_frame_numbers() {
        assert!(job("running").candidates(1, 0).is_err());
        assert!(job("cancelled").candidates(1, 0).is_err());
        assert!(job("failed").candidates(1, 0).is_err());
        let jobs = job("done");
        assert_eq!(jobs.candidates(1, 0).unwrap(), vec![0]);
        assert!(jobs.candidates(1, 100).unwrap().is_empty());
        assert!(jobs.candidates(2, 0).is_err());
        // Any resolution is accepted now: the no-fire scan runs on a 1080p view.
        let mut p = project();
        p.meta.width = 1280;
        let started = jobs.start_no_fire(p, Tools::default()).unwrap();
        assert_eq!(started.state, "running");
        jobs.cancel(started.id).unwrap();
    }
    /// Full app scan of a real clip against decision vectors recorded by the perf
    /// lab from the app's previous decoder path. `SCAN_PARITY_VIDEO` names the
    /// clip; `SCAN_PARITY_POV_ROWS` / `SCAN_PARITY_NOFIRE_ROWS` name JSONL files of
    /// `{n,row}` / `{n,clear}` lines.
    #[test]
    #[ignore = "Requires SCAN_PARITY_VIDEO and the lab's recorded decision vectors"]
    fn full_scan_matches_recorded_decisions() {
        let video = std::env::var("SCAN_PARITY_VIDEO").unwrap();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime");
        let suffix = std::env::consts::EXE_SUFFIX;
        let tools = Tools {
            ffmpeg: root.join(format!("ffmpeg{suffix}")).into_os_string(),
            ffprobe: root.join(format!("ffprobe{suffix}")).into_os_string(),
        };
        crate::no_fire::configure(root.join("ai"));
        let project = studio_core::import::import_video(
            &tools,
            std::path::Path::new(&video),
            &studio_core::config::Settings::default(),
        )
        .unwrap();
        let feed = ScanFeed::for_scan(&project, &tools, None);
        eprintln!("feed: {feed:?}");
        let wait = |jobs: &Jobs| loop {
            let status = jobs.status().unwrap().unwrap();
            if status.state != "running" {
                assert_eq!(status.state, "done", "{:?}", status.error);
                let rows = jobs.current.lock().unwrap().as_ref().unwrap().rows.clone();
                break (status, rows);
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        };
        let recorded = |name: &str| -> Vec<(u32, Option<u8>)> {
            let Ok(path) = std::env::var(name) else {
                return Vec::new();
            };
            std::fs::read_to_string(path)
                .unwrap()
                .lines()
                .map(|line| {
                    let v: serde_json::Value = serde_json::from_str(line).unwrap();
                    let n = v["n"].as_u64().unwrap() as u32;
                    let row = v["row"].as_u64().map(|r| r as u8);
                    let clear = v["clear"].as_bool().filter(|&c| c).map(|_| 0u8);
                    (n, row.or(clear))
                })
                .collect()
        };
        for (name, no_fire) in [
            ("SCAN_PARITY_POV_ROWS", false),
            ("SCAN_PARITY_NOFIRE_ROWS", true),
        ] {
            let expected = recorded(name);
            if expected.is_empty() {
                continue;
            }
            let mut cache_folder = std::path::Path::new(&project.video_path)
                .file_name()
                .unwrap()
                .to_os_string();
            cache_folder.push(".firecrackle");
            let _ = std::fs::remove_dir_all(
                std::path::Path::new(&project.video_path)
                    .with_file_name(cache_folder)
                    .join("auto-cache"),
            );
            let jobs = Jobs::default();
            let started = std::time::Instant::now();
            if no_fire {
                jobs.start_no_fire(project.clone(), tools.clone()).unwrap();
            } else {
                jobs.start(project.clone(), tools.clone()).unwrap();
            }
            let (status, rows) = wait(&jobs);
            let seconds = started.elapsed().as_secs_f64();
            let expected_accepted: Vec<(u32, u8)> = expected
                .iter()
                .filter_map(|&(n, r)| r.map(|r| (n, r)))
                .collect();
            let mut got = rows.clone();
            got.sort();
            assert_eq!(expected.len() as u32, status.total, "frame count");
            assert_eq!(got, expected_accepted, "{name}: decisions differ");
            eprintln!(
                "{name}: {} frames in {seconds:.1}s = {:.1} fps, {} accepted, identical",
                status.total,
                status.total as f64 / seconds,
                got.len()
            );
        }
    }
    #[test]
    #[ignore = "Requires the lossless real clip2 frame765 fixture and FFmpeg paths"]
    fn real_video_scan_accepts_known_overlay_row() {
        let video = std::env::var("POV_SMOKE_VIDEO").expect("POV_SMOKE_VIDEO");
        let tools = Tools {
            ffmpeg: std::env::var_os("POV_SMOKE_FFMPEG").expect("FFmpeg path"),
            ffprobe: std::env::var_os("POV_SMOKE_FFPROBE").expect("FFprobe path"),
        };
        let p = studio_core::import::import_video(
            &tools,
            std::path::Path::new(&video),
            &studio_core::config::Settings::default(),
        )
        .unwrap();
        assert_eq!(p.frames.len(), 1);
        let slot = Mutex::new(None);
        let mut rows = Vec::new();
        scan(&p, &tools, &AtomicBool::new(false), &slot, |n, row| {
            rows.push((n, row))
        })
        .unwrap();
        assert_eq!(rows, vec![(0, Some(27))]);
        if let Some(mut process) = slot.lock().unwrap().take() {
            let _ = process.wait();
        }
    }
}

#[cfg(test)]
mod frame_match_tests {
    use super::*;
    fn png(w: u32, h: u32, rgb: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut e = png::Encoder::new(&mut out, w, h);
            e.set_color(png::ColorType::Rgb);
            e.set_depth(png::BitDepth::Eight);
            e.write_header().unwrap().write_image_data(rgb).unwrap();
        }
        out
    }
    #[test]
    fn a_frame_without_first_person_fire_has_no_row_but_offers_up_to_three() {
        let m = match_png(&png(640, 360, &vec![40; 640 * 360 * 3])).unwrap();
        assert_eq!((m.row, m.fov), (None, None));
        assert!(!m.candidates.is_empty() && m.candidates.len() <= 3);
        assert!(m.candidates.iter().all(|c| !c.accepted && (c.fov == 70 || c.fov == 60)));
    }
    #[test]
    fn a_picture_that_is_not_a_png_is_an_error() {
        assert!(match_png(b"nope").is_err());
    }
    #[test]
    fn frames_of_another_size_get_their_own_matcher() {
        assert!(match_png(&png(320, 180, &vec![40; 320 * 180 * 3])).is_ok());
        assert!(match_png(&png(640, 360, &vec![40; 640 * 360 * 3])).is_ok());
    }
}
