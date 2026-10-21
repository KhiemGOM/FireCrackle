//! Optional, cancellable scan with canonical GUI-neutral first-person matching.
use crate::scan_cache::Journal;
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
    scan_with_worker_state_resuming(
        project,
        tools,
        cancel,
        slot,
        scan_workers(w * h * 3),
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

/// Shared exact raw decoder for first-person, no-fire and GUI scans.
pub(crate) fn open_scan_decoder<'a>(
    project: &'a Project,
    tools: &Tools,
    start: usize,
    slot: &Mutex<Option<Child>>,
) -> Result<
    (
        CheckedFrames<'a, std::process::ChildStdout>,
        std::thread::JoinHandle<String>,
    ),
    String,
> {
    if start >= project.frames.len() {
        return Err("Resume frame is outside the video".into());
    }
    let frame_bytes = project
        .meta
        .width
        .checked_mul(project.meta.height)
        .and_then(|n| n.checked_mul(3))
        .ok_or("Video dimensions overflow")?;
    let mut command = studio_core::proc::ffmpeg_command(&tools.ffmpeg);
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
    command
        .arg("-i")
        .arg(&project.video_path)
        .args(["-map", "0:v:0"])
        // Trim by display-frame index (not approximate timestamp seeking), preserving VFR frame identity.
        .args([
            "-vf",
            &format!("trim=start_frame={},showinfo", start - prefix),
        ])
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
    let (time_tx, time_rx) = std::sync::mpsc::channel();
    let errors = std::thread::spawn(move || {
        use std::io::BufRead;
        let mut saved = std::collections::VecDeque::new();
        let mut tick = None;
        for line in std::io::BufReader::new(stderr)
            .lines()
            .map_while(Result::ok)
        {
            if line.contains("showinfo") {
                if let Some(raw) = line
                    .split_once("config in time_base:")
                    .map(|(_, raw)| raw.trim())
                {
                    tick = raw
                        .split_whitespace()
                        .next()
                        .and_then(|v| v.trim_end_matches(',').split_once('/'))
                        .and_then(|(a, b)| Some(a.parse::<f64>().ok()? / b.parse::<f64>().ok()?));
                }
                if line.contains("] n:") {
                    let pts = tick.and_then(|tick| {
                        line.split_once(" pts:")?
                            .1
                            .split_whitespace()
                            .next()?
                            .parse::<f64>()
                            .ok()
                            .map(|n| n * tick)
                    });
                    // Integer pts + timebase avoids showinfo's rounded pts_time on long videos.
                    let _ = time_tx.send(pts.unwrap_or(f64::NAN));
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
    workers: usize,
    completed: &[Option<i16>],
    initialize: impl Fn() -> S + Sync,
    process: impl Fn(&mut S, &[u8]) -> Result<Option<u8>, String> + Sync,
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
    let (pipe, errors) = open_scan_decoder(project, tools, start, slot)?;
    parallel_frames_indexed_with_state(
        pipe,
        frame_bytes,
        (project.frames.len() - start) as u32,
        workers.clamp(1, 12),
        cancel,
        initialize,
        |state, n, rgb| match completed.get(start + n as usize).copied().flatten() {
            Some(row) => Ok((row >= 0).then_some(row as u8)),
            None => process(state, rgb),
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
            let (mut reader, diagnostics) =
                open_scan_decoder(&project, &tools, start, &slot).unwrap();
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
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime");
        let suffix = std::env::consts::EXE_SUFFIX;
        let tools = Tools {
            ffmpeg: root.join(format!("ffmpeg{suffix}")).into_os_string(),
            ffprobe: root.join(format!("ffprobe{suffix}")).into_os_string(),
        };
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
                .args([
                    "-vf",
                    "setpts=PTS+2/TB+floor(N/7)*0.02/TB",
                    "-fps_mode",
                    "passthrough",
                    "-c:v",
                    codec,
                    "-g",
                    "12",
                ]);
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
                .args([
                    "-map",
                    "0:v:0",
                    "-fps_mode",
                    "passthrough",
                    "-pix_fmt",
                    "rgb24",
                    "-f",
                    "rawvideo",
                    "-",
                ])
                .output()
                .unwrap();
            assert!(baseline.status.success());
            let bytes = 16 * 16 * 3;
            for start in [13, 35, 73] {
                let slot = Mutex::new(None);
                let (mut reader, diagnostics) =
                    open_scan_decoder(&project, &tools, start, &slot).unwrap();
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
