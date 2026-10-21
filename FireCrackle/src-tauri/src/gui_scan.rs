//! One frame-preserving video pass, shared source detector, resumable local evidence.
use fire_core::video::{parallel_frames_indexed, scan_workers};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::Child,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use studio_core::{import::Tools, project::Project};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Surface {
    pub bounds: [f64; 4],
    pub menu: bool,
}
#[derive(Clone, Serialize)]
pub struct Range {
    pub first: u32,
    pub last: u32,
    pub menu: bool,
}
#[derive(Clone, Serialize)]
pub struct Status {
    pub video_path: String,
    pub state: String,
    pub processed: u32,
    pub total: u32,
    pub detected: u32,
    pub ranges: Vec<Range>,
    pub error: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
enum Entry {
    Header { key: String, total: usize },
    Frame { frame: u32, hit: Option<Surface> },
    Finished,
}
struct Cache {
    path: PathBuf,
    key: String,
    frames: Vec<Option<Option<Surface>>>,
    finished: bool,
}
impl Cache {
    fn load(project: &Project) -> Self {
        let mut hash = Sha256::new();
        hash.update(b"gui-presence-source-bank-v1");
        hash.update(include_bytes!(
            "../../../fire-detection/core/src/gui_interaction_fast.rs"
        ));
        hash.update(include_bytes!(
            "../../../fire-detection/core/src/gui_interaction.rs"
        ));
        hash.update(include_bytes!(
            "../../../fire-detection/core/src/gui_tooltip.rs"
        ));
        hash.update(include_bytes!(
            "../../../fire-detection/data/assets/gui/interaction.bundle"
        ));
        hash.update(serde_json::to_vec(project).unwrap_or_default());
        if let Ok(meta) = std::fs::metadata(&project.video_path) {
            hash.update(meta.len().to_le_bytes());
            if let Ok(time) = meta.modified().and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .map_err(std::io::Error::other)
            }) {
                hash.update(time.as_nanos().to_le_bytes());
            }
        }
        let video = std::path::Path::new(&project.video_path);
        let mut name = video.file_name().unwrap_or_default().to_os_string();
        name.push(".firecrackle");
        let path = video
            .with_file_name(name)
            .join("auto-cache/gui-interactions.jsonl");
        let key = format!("{:x}", hash.finalize());
        let mut cache = Self {
            path,
            key,
            frames: vec![None; project.frames.len()],
            finished: false,
        };
        if let Ok(file) = File::open(&cache.path) {
            let mut lines = BufReader::new(file).lines();
            let valid=lines.next().and_then(Result::ok).and_then(|s|serde_json::from_str::<Entry>(&s).ok())
                .is_some_and(|e|matches!(e,Entry::Header{key,total} if key==cache.key && total==cache.frames.len()));
            if valid {
                for line in lines {
                    let Ok(line) = line else { break };
                    let Ok(entry) = serde_json::from_str::<Entry>(&line) else {
                        break;
                    };
                    match entry {
                        Entry::Frame { frame, hit } if (frame as usize) < cache.frames.len() => {
                            cache.frames[frame as usize] = Some(hit)
                        }
                        Entry::Finished => cache.finished = true,
                        _ => break,
                    }
                }
            }
        }
        cache.finished &= cache.frames.iter().all(Option::is_some);
        cache
    }
    // Rewrite the valid prefix before appending: interrupted/truncated final
    // JSON must never swallow a subsequently resumed record.
    fn writer(&self) -> Result<File, String> {
        std::fs::create_dir_all(self.path.parent().ok_or("GUI cache has no parent")?)
            .map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("tmp");
        let mut file = File::create(&tmp).map_err(|e| e.to_string())?;
        write_entry(
            &mut file,
            &Entry::Header {
                key: self.key.clone(),
                total: self.frames.len(),
            },
        )?;
        for (frame, hit) in self.frames.iter().enumerate() {
            if let Some(hit) = hit {
                write_entry(
                    &mut file,
                    &Entry::Frame {
                        frame: frame as u32,
                        hit: hit.clone(),
                    },
                )?;
            }
        }
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        std::fs::rename(&tmp, &self.path).map_err(|e| e.to_string())?;
        OpenOptions::new()
            .append(true)
            .open(&self.path)
            .map_err(|e| e.to_string())
    }
}
fn write_entry(file: &mut File, entry: &Entry) -> Result<(), String> {
    // Serialize before touching the file: one write per complete cache record,
    // instead of a Windows filesystem call for each JSON token. Do not buffer
    // across frames; interrupted scans still retain every completed record.
    let mut bytes = serde_json::to_vec(entry).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    file.write_all(&bytes).map_err(|e| e.to_string())
}
struct Job {
    project: Project,
    cache: Mutex<Cache>,
    state: Mutex<(String, Option<String>)>,
    cancel: AtomicBool,
    child: Mutex<Option<Child>>,
}
impl Job {
    fn status(&self) -> Result<Status, String> {
        let cache = self.cache.lock().map_err(|_| "GUI cache unavailable")?;
        let state = self.state.lock().map_err(|_| "GUI scan unavailable")?;
        let mut ranges: Vec<Range> = Vec::new();
        let mut detected = 0;
        for (frame, hit) in cache.frames.iter().enumerate() {
            if let Some(Some(hit)) = hit {
                detected += 1;
                if let Some(last) = ranges
                    .last_mut()
                    .filter(|last| last.last + 1 == frame as u32 && last.menu == hit.menu)
                {
                    last.last = frame as u32;
                } else {
                    ranges.push(Range {
                        first: frame as u32,
                        last: frame as u32,
                        menu: hit.menu,
                    });
                }
            }
        }
        Ok(Status {
            video_path: self.project.video_path.clone(),
            state: state.0.clone(),
            processed: cache.frames.iter().filter(|f| f.is_some()).count() as u32,
            total: cache.frames.len() as u32,
            detected,
            ranges,
            error: state.1.clone(),
        })
    }
}
#[derive(Clone, Default)]
pub struct Jobs {
    current: Arc<Mutex<Option<Arc<Job>>>>,
}
impl Jobs {
    pub fn shutdown(&self) {
        if let Ok(current) = self.current.lock()
            && let Some(job) = current.as_ref()
        {
            job.cancel.store(true, Ordering::Relaxed);
            if let Ok(mut child) = job.child.lock()
                && let Some(child) = child.as_mut()
            {
                let _ = child.kill();
            }
        }
    }
    fn job(&self, project: &Project) -> Result<Arc<Job>, String> {
        let mut current = self.current.lock().map_err(|_| "GUI scan unavailable")?;
        if let Some(job) = current.as_ref() {
            if job.project == *project {
                return Ok(job.clone());
            }
            if job.state.lock().map_err(|_| "GUI scan unavailable")?.0 == "running" {
                return Err("Pause the GUI scan for the previous video first".into());
            }
        }
        let cache = Cache::load(project);
        let state = if cache.finished { "done" } else { "ready" };
        let job = Arc::new(Job {
            project: project.clone(),
            cache: Mutex::new(cache),
            state: Mutex::new((state.into(), None)),
            cancel: AtomicBool::new(false),
            child: Mutex::new(None),
        });
        *current = Some(job.clone());
        Ok(job)
    }
    pub fn status(&self, project: &Project) -> Result<Status, String> {
        self.job(project)?.status()
    }
    pub fn cancel(&self, project: &Project) -> Result<(), String> {
        let job = self.job(project)?;
        job.cancel.store(true, Ordering::Relaxed);
        if let Some(child) = job
            .child
            .lock()
            .map_err(|_| "GUI decoder unavailable")?
            .as_mut()
        {
            let _ = child.kill();
        }
        Ok(())
    }
    pub fn start(&self, project: Project, tools: Tools) -> Result<Status, String> {
        let job = self.job(&project)?;
        {
            let mut state = job.state.lock().map_err(|_| "GUI scan unavailable")?;
            if state.0 == "running" || state.0 == "done" {
                drop(state);
                return job.status();
            }
            *state = ("running".into(), None);
            job.cancel.store(false, Ordering::Relaxed);
        }
        let running = job.clone();
        std::thread::spawn(move || {
            let result =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| scan(&running, &tools)))
                    .unwrap_or_else(|_| Err("GUI scan worker failed".into()));
            if let Ok(mut child) = running.child.lock()
                && let Some(mut child) = child.take()
            {
                let _ = child.kill();
                let _ = child.wait();
            }
            if let Ok(mut state) = running.state.lock() {
                *state = match result {
                    Err(e) => ("error".into(), Some(e)),
                    Ok(()) if running.cancel.load(Ordering::Relaxed) => ("paused".into(), None),
                    Ok(()) => ("done".into(), None),
                };
            }
        });
        job.status()
    }
}
fn scan(job: &Job, tools: &Tools) -> Result<(), String> {
    let detector = studio_core::gui::interaction_detector()?;
    let (w, h) = (job.project.meta.width, job.project.meta.height);
    let size = w
        .checked_mul(h)
        .and_then(|n| n.checked_mul(3))
        .ok_or("Invalid video dimensions")?;
    detector.prepare(w, h)?;
    let mut cache = job.cache.lock().map_err(|_| "GUI cache unavailable")?;
    std::fs::create_dir_all(cache.path.parent().ok_or("GUI cache has no parent")?)
        .map_err(|e| e.to_string())?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(cache.path.with_extension("lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock()
        .map_err(|_| "Another FireCrackle instance is using the GUI scan cache")?;
    *cache = Cache::load(&job.project);
    let start = cache
        .frames
        .iter()
        .position(Option::is_none)
        .unwrap_or(cache.frames.len()) as u32;
    let previous = cache.frames.clone();
    let mut file = cache.writer()?;
    drop(cache);
    let total = previous.len() as u32;
    if start < total {
        let (output, diagnostics) =
            crate::pov::open_scan_decoder(&job.project, tools, start as usize, &job.child)?;
        let mut write_error = None;
        let result = parallel_frames_indexed(
            output,
            size,
            total - start,
            scan_workers(size),
            &job.cancel,
            |index, rgb| {
                if let Some(hit) = &previous[(start + index) as usize] {
                    return Ok(hit.clone());
                }
                let d = detector.detect(rgb, w, h)?;
                Ok(d.alternatives.first().map(|hit| Surface {
                    bounds: [
                        hit.bounds.x,
                        hit.bounds.y,
                        hit.bounds.width,
                        hit.bounds.height,
                    ],
                    menu: hit.screen_type == "pause_screen"
                        || hit.screen_type.starts_with("options."),
                }))
            },
            |index, hit| {
                if write_error.is_some() {
                    return;
                }
                let frame = start + index;
                if previous[frame as usize].is_some() {
                    return;
                }
                let written = write_entry(
                    &mut file,
                    &Entry::Frame {
                        frame,
                        hit: hit.clone(),
                    },
                );
                if let Err(e) = written {
                    write_error = Some(e);
                    job.cancel.store(true, Ordering::Relaxed);
                    if let Ok(mut child) = job.child.lock()
                        && let Some(child) = child.as_mut()
                    {
                        let _ = child.kill();
                    }
                    return;
                }
                if let Ok(mut cache) = job.cache.lock() {
                    cache.frames[frame as usize] = Some(hit);
                }
            },
        );
        let status = {
            let mut slot = job.child.lock().map_err(|_| "GUI decoder unavailable")?;
            let child = slot.as_mut().ok_or("GUI decoder missing")?;
            if result.is_err() || job.cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
            }
            child.wait().map_err(|e| e.to_string())?
        };
        let diagnostics = diagnostics.join().unwrap_or_default();
        if let Some(e) = write_error {
            return Err(e);
        }
        if !job.cancel.load(Ordering::Relaxed) {
            result?;
            if !status.success() {
                return Err(format!("Video decode failed: {diagnostics}"));
            }
        }
    }
    if !job.cancel.load(Ordering::Relaxed) {
        write_entry(&mut file, &Entry::Finished)?;
        job.cache
            .lock()
            .map_err(|_| "GUI cache unavailable")?
            .finished = true;
    }
    file.sync_all().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_record_bytes_match_streamed_serialization() {
        let fixture = crate::scan_cache::tests::fixture(3);
        let path = fixture.root.join("entries-test");
        let mut file = File::create(&path).unwrap();
        let entries = [
            Entry::Header {
                key: "test".into(),
                total: 3,
            },
            Entry::Frame {
                frame: 0,
                hit: None,
            },
            Entry::Frame {
                frame: 2,
                hit: Some(Surface {
                    bounds: [1.0, 2.5, 30.0, 40.0],
                    menu: false,
                }),
            },
            Entry::Finished,
        ];
        let mut expected = Vec::new();
        for entry in entries {
            serde_json::to_writer(&mut expected, &entry).unwrap();
            expected.push(b'\n');
            write_entry(&mut file, &entry).unwrap();
        }
        drop(file);
        assert_eq!(std::fs::read(path).unwrap(), expected);
    }
    #[test]
    #[ignore = "Requires GUI_BENCH_PROJECT, GUI_BENCH_ROOT, GUI_SMOKE_FFMPEG/FFPROBE and GUI_SMOKE_REFERENCE"]
    fn benchmark_real_video_through_production_pipeline() {
        let mut project: Project = serde_json::from_slice(
            &std::fs::read(std::env::var("GUI_BENCH_PROJECT").unwrap()).unwrap(),
        )
        .unwrap();
        let count: usize = std::env::var("GUI_BENCH_FRAMES")
            .unwrap_or("36000".into())
            .parse()
            .unwrap();
        assert!(count > 0 && count <= project.frames.len());
        project.frames.truncate(count);
        let root = PathBuf::from(std::env::var("GUI_BENCH_ROOT").unwrap());
        std::fs::create_dir_all(&root).unwrap();
        let run = root.join(format!(
            "run-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&run).unwrap();
        let video = run.join("source.mkv");
        let tools = Tools {
            ffmpeg: std::env::var_os("GUI_SMOKE_FFMPEG").unwrap(),
            ffprobe: std::env::var_os("GUI_SMOKE_FFPROBE").unwrap(),
        };
        // Bound the input itself without re-encoding. Do not touch the original
        // video's live cache, or leave FFmpeg producing past this test's end.
        assert!(
            crate::external_tools::command(&tools.ffmpeg)
                .args([
                    "-v",
                    "error",
                    "-i",
                    &project.video_path,
                    "-map",
                    "0:v:0",
                    "-c:v",
                    "copy",
                    "-frames:v",
                    &count.to_string()
                ])
                .arg(&video)
                .status()
                .unwrap()
                .success()
        );
        project.video_path = video.to_string_lossy().into_owned();
        let start = std::time::Instant::now();
        let jobs = Jobs::default();
        jobs.start(project.clone(), tools).unwrap();
        loop {
            let status = jobs.status(&project).unwrap();
            if status.state != "running" {
                assert_eq!(status.state, "done", "{:?}", status.error);
                assert_eq!(status.processed as usize, count);
                break;
            }
            assert!(start.elapsed().as_secs() < 1800);
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let seconds = start.elapsed().as_secs_f64();
        eprintln!(
            "GUI_BENCH frames={count} seconds={seconds:.3} fps={:.2} cache={}",
            count as f64 / seconds,
            run.display()
        );
        let cache = Cache::load(&project);
        assert!(cache.finished);
        let mut compared = 0;
        for line in std::fs::read_to_string(std::env::var("GUI_SMOKE_REFERENCE").unwrap())
            .unwrap()
            .lines()
        {
            let value: serde_json::Value = serde_json::from_str(line).unwrap();
            let frame = value["frame"].as_u64().unwrap() as usize;
            if frame >= count {
                continue;
            }
            let expected: Option<[f64; 4]> =
                serde_json::from_value(value["bounds"].clone()).unwrap();
            assert_eq!(
                cache.frames[frame]
                    .as_ref()
                    .unwrap()
                    .as_ref()
                    .map(|s| s.bounds),
                expected,
                "frame {frame}"
            );
            compared += 1;
        }
        assert_eq!(compared, count);
        assert_eq!(
            Jobs::default()
                .start(project, Tools::default())
                .unwrap()
                .state,
            "done"
        );
    }
    #[test]
    fn cache_keeps_original_indices_and_retries_a_truncated_tail() {
        let f = crate::scan_cache::tests::fixture(5);
        let cache = Cache::load(&f.project);
        let path = cache.path.clone();
        let mut file = cache.writer().unwrap();
        write_entry(
            &mut file,
            &Entry::Frame {
                frame: 3,
                hit: Some(Surface {
                    bounds: [2., 3., 4., 5.],
                    menu: false,
                }),
            },
        )
        .unwrap();
        write_entry(
            &mut file,
            &Entry::Frame {
                frame: 0,
                hit: None,
            },
        )
        .unwrap();
        file.write_all(b"{\"type\":\"Frame\"").unwrap();
        drop(file);
        let recovered = Cache::load(&f.project);
        assert_eq!(recovered.frames[0], Some(None));
        assert!(recovered.frames[1].is_none());
        assert!(recovered.frames[3].as_ref().unwrap().is_some());
        assert!(!recovered.finished);
        let mut file = recovered.writer().unwrap();
        write_entry(
            &mut file,
            &Entry::Frame {
                frame: 4,
                hit: None,
            },
        )
        .unwrap();
        drop(file);
        assert_eq!(Cache::load(&f.project).frames[4], Some(None));
        let mut changed = f.project.clone();
        changed.fingerprint = "changed".into();
        assert!(Cache::load(&changed).frames.iter().all(Option::is_none));
        assert!(path.exists());
    }
    #[test]
    fn ranges_break_on_unknown_frames_and_menu_boundaries() {
        let f = crate::scan_cache::tests::fixture(5);
        let mut cache = Cache::load(&f.project);
        let panel = Surface {
            bounds: [1., 2., 3., 4.],
            menu: false,
        };
        cache.frames = vec![
            Some(Some(panel.clone())),
            None,
            Some(Some(panel.clone())),
            Some(Some(panel)),
            Some(Some(Surface {
                bounds: [1., 2., 3., 4.],
                menu: true,
            })),
        ];
        let job = Job {
            project: f.project.clone(),
            cache: Mutex::new(cache),
            state: Mutex::new(("paused".into(), None)),
            cancel: AtomicBool::new(false),
            child: Mutex::new(None),
        };
        let status = job.status().unwrap();
        assert_eq!(status.processed, 4);
        assert_eq!(status.ranges.len(), 3);
        assert_eq!((status.ranges[1].first, status.ranges[1].last), (2, 3));
        assert!(status.ranges[2].menu);
    }
    #[test]
    #[ignore = "Requires GUI_SMOKE_VIDEO, GUI_SMOKE_FFMPEG, GUI_SMOKE_FFPROBE and frozen GUI_SMOKE_REFERENCE"]
    fn real_video_resumes_and_matches_every_frozen_frame() {
        let video = std::env::var("GUI_SMOKE_VIDEO").unwrap();
        let tools = Tools {
            ffmpeg: std::env::var_os("GUI_SMOKE_FFMPEG").unwrap(),
            ffprobe: std::env::var_os("GUI_SMOKE_FFPROBE").unwrap(),
        };
        let project = studio_core::import::import_video(
            &tools,
            std::path::Path::new(&video),
            &studio_core::config::Settings::default(),
        )
        .unwrap();
        let started = std::time::Instant::now();
        let jobs = Jobs::default();
        jobs.start(project.clone(), tools.clone()).unwrap();
        loop {
            let s = jobs.status(&project).unwrap();
            if s.processed > 80 || s.state != "running" {
                break;
            }
            assert!(started.elapsed().as_secs() < 180);
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        jobs.cancel(&project).unwrap();
        while jobs.status(&project).unwrap().state == "running" {
            std::thread::sleep(std::time::Duration::from_millis(50));
            assert!(started.elapsed().as_secs() < 180);
        }
        let jobs = Jobs::default();
        jobs.start(project.clone(), tools.clone()).unwrap();
        loop {
            let s = jobs.status(&project).unwrap();
            if s.state != "running" {
                assert_eq!(s.state, "done", "{:?}", s.error);
                assert_eq!(s.processed, s.total);
                break;
            }
            assert!(started.elapsed().as_secs() < 600);
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let cache = Cache::load(&project);
        assert!(cache.finished);
        let reference =
            std::fs::read_to_string(std::env::var("GUI_SMOKE_REFERENCE").unwrap()).unwrap();
        for (n, line) in reference.lines().enumerate() {
            let r: serde_json::Value = serde_json::from_str(line).unwrap();
            assert_eq!(
                cache.frames[n].as_ref().unwrap().is_some(),
                r["candidate"].as_bool().unwrap(),
                "frame {n}"
            );
        }
        // A completed compatible cache returns without starting FFmpeg again.
        assert_eq!(
            Jobs::default()
                .start(project, Tools::default())
                .unwrap()
                .state,
            "done"
        );
    }
}
