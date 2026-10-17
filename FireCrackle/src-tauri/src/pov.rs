//! Optional, cancellable scan with canonical GUI-neutral first-person matching.
use crate::scan_cache::Journal;
use fire_core::{
    pov::PovMatcher,
    video::{parallel_frames_indexed, scan_workers},
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
    cancel: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    cache: Option<Journal>,
}
#[derive(Clone, Default)]
pub struct Jobs {
    current: Arc<Mutex<Option<Job>>>,
    next: Arc<AtomicU64>,
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
        let Some(cache) = Journal::load(project, no_fire) else {
            *state = None;
            return Ok(None);
        };
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
            cancel: Arc::new(AtomicBool::new(false)),
            child: Arc::new(Mutex::new(None)),
            cache: Some(cache),
        });
        Ok(Some(status))
    }
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
        job.cancel.store(true, Ordering::Relaxed);
        if let Some(child) = job
            .child
            .lock()
            .map_err(|_| "Decoder state unavailable")?
            .as_mut()
        {
            let _ = child.kill();
        }
        Ok(())
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
        if project.meta.width != 1920 || project.meta.height != 1080 {
            return Err("No-fire scanning currently requires native 1920×1080 footage".into());
        }
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
        let cancel = Arc::new(AtomicBool::new(false));
        let child = Arc::new(Mutex::new(None));
        *state = Some(Job {
            project: project.clone(),
            status: status.clone(),
            rows,
            cancel: cancel.clone(),
            child: child.clone(),
            cache: Some(cache),
        });
        if status.state == "done" {
            return Ok(status);
        }
        let shared = self.current.clone();
        let jobs = self.clone();
        std::thread::spawn(move || {
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
                                job.cancel.store(true, Ordering::Relaxed);
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
            let result = if already_finished {
                Ok(()) // Explicitly reapply completed no-fire results without decoding/inference.
            } else if decisions.iter().all(Option::is_some) {
                // All decisions may have arrived before decoder EOF validation or a crash.
                // Verify the final output/EOF without loading AI or redoing any inference.
                scan_with_workers_resuming(
                    &project,
                    &tools,
                    &cancel,
                    &child,
                    1,
                    &decisions,
                    |_| unreachable!("all frames are cached"),
                    update,
                )
            } else if no_fire {
                crate::no_fire::scan_resuming(&project, &tools, &cancel, &child, &decisions, update)
            } else {
                scan_resuming(&project, &tools, &cancel, &child, &decisions, update)
            };
            // Kill and reap on success, failure, cancellation, or premature EOF.
            if let Ok(mut slot) = child.lock()
                && let Some(mut process) = slot.take()
            {
                let _ = process.kill();
                let _ = process.wait();
            }
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
            if job.cancel.load(Ordering::Relaxed) {
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
    scan_with_workers_resuming(
        project,
        tools,
        cancel,
        slot,
        scan_workers(w * h * 3),
        completed,
        |frame| Ok(matcher.match_frame(frame)?.row),
        update,
    )
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
    mut update: impl FnMut(u32, Option<u8>),
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
    let (w, h) = (project.meta.width, project.meta.height);
    let frame_bytes = w
        .checked_mul(h)
        .and_then(|n| n.checked_mul(3))
        .ok_or("Video dimensions overflow")?;
    let mut command = studio_core::proc::ffmpeg_command(&tools.ffmpeg);
    command
        .args(["-nostdin", "-v", "error", "-i"])
        .arg(&project.video_path)
        .args(["-map", "0:v:0"])
        // Trim by display-frame index (not approximate timestamp seeking), preserving VFR frame identity.
        .args(["-vf", &format!("trim=start_frame={start}")])
        .args(studio_core::import::passthrough_args(&tools.ffmpeg))
        .args(["-pix_fmt", "rgb24", "-f", "rawvideo", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start FFmpeg: {e}"))?;
    let pipe = child.stdout.take().ok_or("Decoder output missing")?;
    let stderr = child.stderr.take().ok_or("Decoder errors missing")?;
    let errors = std::thread::spawn(move || {
        let mut pipe = stderr;
        let mut saved = Vec::new();
        let mut buffer = [0u8; 4096];
        while let Ok(n) = pipe.read(&mut buffer) {
            if n == 0 {
                break;
            }
            let keep = n.min(16384usize.saturating_sub(saved.len()));
            saved.extend_from_slice(&buffer[..keep]);
        }
        String::from_utf8_lossy(&saved).into_owned()
    });
    *slot.lock().map_err(|_| "Decoder state unavailable")? = Some(child);
    parallel_frames_indexed(
        pipe,
        frame_bytes,
        (project.frames.len() - start) as u32,
        workers.clamp(1, 4),
        cancel,
        |n, rgb| match completed.get(start + n as usize).copied().flatten() {
            Some(row) => Ok((row >= 0).then_some(row as u8)),
            None => process(rgb),
        },
        |n, row| update(n + start as u32, row),
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
            cancel: Arc::new(AtomicBool::new(false)),
            child: Arc::new(Mutex::new(None)),
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
                .cancel
                .load(Ordering::Relaxed)
        );
        assert!(jobs.cancel(2).is_err());
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
        let mut p = project();
        p.meta.width = 1280;
        assert!(jobs.start_no_fire(p, Tools::default()).is_err());
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
