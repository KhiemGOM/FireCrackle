//! Optional, cancellable video scan using the existing first-person matcher unchanged.
use fire_core::{
    overlay::SilhouetteMatcher,
    veil::detect_veil,
    video::{parallel_frames, scan_workers},
};
use serde::Serialize;
use std::{
    io::Read,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use studio_core::{import::Tools, project::Project};

const SHEET: &[u8] = include_bytes!("../../../fire-detection/data/assets/fire_1.rgba");
const THRESHOLD: f64 = 0.5;

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
}
#[derive(Clone, Default)]
pub struct Jobs {
    current: Arc<Mutex<Option<Job>>>,
    next: Arc<AtomicU64>,
}

impl Jobs {
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
        let mut state = self.current.lock().map_err(|_| "Scan state unavailable")?;
        if state.as_ref().is_some_and(|j| j.status.state == "running") {
            return Err("A first-person scan is already running".into());
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let status = Status {
            id,
            video_path: project.video_path.clone(),
            state: "running".into(),
            processed: 0,
            total: project.frames.len() as u32,
            accepted: 0,
            applied: 0,
            error: None,
        };
        let cancel = Arc::new(AtomicBool::new(false));
        let child = Arc::new(Mutex::new(None));
        *state = Some(Job {
            project: project.clone(),
            status: status.clone(),
            rows: Vec::new(),
            cancel: cancel.clone(),
            child: child.clone(),
        });
        let shared = self.current.clone();
        std::thread::spawn(move || {
            let result = scan(&project, &tools, &cancel, &child, |frame, row| {
                if let Ok(mut state) = shared.lock()
                    && let Some(job) = state.as_mut().filter(|j| j.status.id == id)
                {
                    job.status.processed += 1;
                    if let Some(row) = row {
                        job.rows.push((frame, row));
                        job.status.accepted = job.rows.len();
                    }
                }
            });
            // Kill and reap on success, failure, cancellation, or premature EOF.
            if let Ok(mut slot) = child.lock()
                && let Some(mut process) = slot.take()
            {
                let _ = process.kill();
                let _ = process.wait();
            }
            if let Ok(mut state) = shared.lock()
                && let Some(job) = state.as_mut().filter(|j| j.status.id == id)
            {
                if cancel.load(Ordering::Relaxed) {
                    job.status.state = "cancelled".into();
                } else if let Err(error) = result {
                    job.status.state = "failed".into();
                    job.status.error = Some(error);
                } else {
                    job.rows.sort_unstable_by_key(|row| row.0);
                    job.status.state = "done".into();
                }
            }
        });
        Ok(status)
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
        Ok(value)
    }
}

fn accepted(row: u8, evidence: f64) -> Option<u8> {
    (row < 32 && evidence.is_finite() && evidence >= THRESHOLD).then_some(row)
}

fn scan(
    project: &Project,
    tools: &Tools,
    cancel: &AtomicBool,
    slot: &Mutex<Option<Child>>,
    update: impl FnMut(u32, Option<u8>),
) -> Result<(), String> {
    let (w, h) = (project.meta.width, project.meta.height);
    let matcher70 = SilhouetteMatcher::new(SHEET, w, h, 70.0)?;
    let matcher60 = SilhouetteMatcher::new(SHEET, w, h, 60.0)?;
    let frame_bytes = w
        .checked_mul(h)
        .and_then(|n| n.checked_mul(3))
        .ok_or("Video dimensions overflow")?;
    let mut command = Command::new(&tools.ffmpeg);
    command
        .args(["-nostdin", "-v", "error", "-i"])
        .arg(&project.video_path)
        .args(["-map", "0:v:0"])
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
    parallel_frames(
        pipe,
        frame_bytes,
        project.frames.len() as u32,
        scan_workers(frame_bytes),
        cancel,
        |frame| {
            let veiled = detect_veil(frame, w, h, 16.min(h.saturating_sub(1)))?;
            let a = if veiled {
                matcher70.match_frame_veiled(frame)?
            } else {
                matcher70.match_frame(frame)?
            };
            let b = if veiled {
                matcher60.match_frame_veiled(frame)?
            } else {
                matcher60.match_frame(frame)?
            };
            let best = if b.colour_evidence > a.colour_evidence {
                b
            } else {
                a
            };
            Ok(accepted(best.ranked_colour[0].0, best.colour_evidence))
        },
        update,
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
    fn uncertain_or_invalid_evidence_abstains() {
        assert_eq!(accepted(2, 0.5), Some(2));
        assert_eq!(accepted(2, 0.499), None);
        assert_eq!(accepted(32, 1.), None);
        assert_eq!(accepted(2, f64::NAN), None);
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
