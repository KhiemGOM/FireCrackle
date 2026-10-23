//! One frame-preserving video pass, shared source detector, resumable local evidence.
use crate::jobs::JobControl;
use fire_core::video::scan_workers;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
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
    /// Both neighbouring frames are already scanned (or the range touches a video edge), so the range can no longer
    /// grow, split or merge and anything computed from it stays valid.
    pub sealed: bool,
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
/// One frame of the GUI scan: the detected panel, or `None` when no GUI piece is on screen.
pub(crate) type Hit = Option<Surface>;

#[derive(Serialize, Deserialize)]
pub struct HitSaved {
    hit: Hit,
}

impl crate::scan_cache::Decision for Hit {
    type Saved = HitSaved;
    fn save(&self) -> HitSaved {
        HitSaved { hit: self.clone() }
    }
    fn load(saved: HitSaved) -> Option<Hit> {
        Some(saved.hit)
    }
}

type Cache = crate::scan_cache::Journal<Hit>;

/// Results are reused only for the same project, video file and scan pipeline (detector, decoder, app version).
fn cache_key(project: &Project, pipeline: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(b"gui-presence-v2");
    hash.update(pipeline);
    hash.update(serde_json::to_vec(project).unwrap_or_default());
    crate::scan_cache::hash_video_file(&mut hash, &project.video_path);
    crate::hex(&hash.finalize())
}

fn load_cache(project: &Project) -> Cache {
    let path =
        crate::scan_cache::auto_cache_file(project, "gui-interactions.jsonl").unwrap_or_default();
    let key = cache_key(project, crate::scan_cache::pipeline_version());
    let total = project.frames.len();
    Cache::load_at(path.clone(), key.clone(), total)
        .unwrap_or_else(|| Cache::empty(path, key, total))
}
struct Job {
    project: Project,
    cache: Mutex<Cache>,
    state: Mutex<(String, Option<String>)>,
    control: JobControl,
}
impl Job {
    fn status(&self) -> Result<Status, String> {
        let cache = self.cache.lock().map_err(|_| "GUI cache unavailable")?;
        let state = self.state.lock().map_err(|_| "GUI scan unavailable")?;
        let mut ranges: Vec<Range> = Vec::new();
        let mut detected = 0;
        for (frame, hit) in cache.decisions.iter().enumerate() {
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
                        sealed: false,
                    });
                }
            }
        }
        let scanned = |frame: Option<usize>| {
            frame.is_none_or(|i| cache.decisions.get(i).is_none_or(|f| f.is_some()))
        };
        for range in &mut ranges {
            let before = (range.first as usize).checked_sub(1);
            let after = range.last as usize + 1;
            range.sealed = scanned(before) && scanned(Some(after));
        }
        Ok(Status {
            video_path: self.project.video_path.clone(),
            state: state.0.clone(),
            processed: cache.processed(),
            total: cache.decisions.len() as u32,
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
            job.control.cancel();
        }
    }
    fn job(&self, project: &Project) -> Result<Arc<Job>, String> {
        let mut current = self.current.lock().map_err(|_| "GUI scan unavailable")?;
        if let Some(job) = current.as_ref() {
            if job.project == *project {
                return Ok(job.clone());
            }
            // A scan being stopped (e.g. by opening another video) no longer blocks; its worker owns the old job.
            if job.state.lock().map_err(|_| "GUI scan unavailable")?.0 == "running"
                && !job.control.cancelled()
            {
                return Err("Pause the GUI scan for the previous video first".into());
            }
        }
        let cache = load_cache(project);
        let state = if cache.finished { "done" } else { "ready" };
        let job = Arc::new(Job {
            project: project.clone(),
            cache: Mutex::new(cache),
            state: Mutex::new((state.into(), None)),
            control: JobControl::default(),
        });
        *current = Some(job.clone());
        Ok(job)
    }
    pub fn status(&self, project: &Project) -> Result<Status, String> {
        self.job(project)?.status()
    }
    pub fn cancel(&self, project: &Project) -> Result<(), String> {
        let job = self.job(project)?;
        job.control.cancel();
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
            job.control.resume();
        }
        let running = job.clone();
        std::thread::spawn(move || {
            let result = crate::jobs::guarded("GUI scan", || scan(&running, &tools));
            running.control.kill_child();
            if let Ok(mut state) = running.state.lock() {
                *state = match result {
                    Err(e) => ("error".into(), Some(e)),
                    Ok(()) if running.control.cancelled() => ("paused".into(), None),
                    Ok(()) => ("done".into(), None),
                };
            }
        });
        job.status()
    }
}
fn scan(job: &Job, tools: &Tools) -> Result<(), String> {
    let detector = studio_core::gui::interaction_detector()?;
    let hud = crate::gui::analyzer()?;
    let (w, h) = (job.project.meta.width, job.project.meta.height);
    detector.prepare(w, h)?;
    let mut cache = job.cache.lock().map_err(|_| "GUI cache unavailable")?;
    // Reread from disk (another window may have scanned meanwhile), then lock the journal for this scan.
    *cache = load_cache(&job.project);
    cache.begin()?;
    let previous = cache.decisions.clone();
    drop(cache);
    let feed = crate::pov::ScanFeed::for_scan(&job.project, tools, None);
    let mut write_error = None;
    let result = crate::pov::scan_frames(
        &job.project,
        tools,
        job.control.flag(),
        job.control.slot(),
        &feed,
        scan_workers(feed.frame_bytes()),
        &previous,
        Hit::clone,
        fire_core::gui_mask::GuiFitHint::default,
        |hint, rgb| {
            // a screen is drawn at the HUD's GUI scale (measured only when a panel is found)
            let d = detector.detect_at_hud_scale(rgb, w, h, || hud.hud_scale(rgb, w, h, hint))?;
            Ok(d.alternatives.first().map(|hit| Surface {
                bounds: [
                    hit.bounds.x,
                    hit.bounds.y,
                    hit.bounds.width,
                    hit.bounds.height,
                ],
                menu: hit.screen_type == "pause_screen" || hit.screen_type.starts_with("options."),
            }))
        },
        |frame, hit| {
            if write_error.is_some() || previous[frame as usize].is_some() {
                return;
            }
            let written = job
                .cache
                .lock()
                .map_err(|_| "GUI cache unavailable".to_string())
                .and_then(|mut cache| cache.put(frame, hit));
            if let Err(e) = written {
                write_error = Some(e);
                job.control.cancel();
            }
        },
    );
    if let Some(e) = write_error {
        return Err(e);
    }
    if !job.control.cancelled() {
        result?;
    }
    let mut cache = job.cache.lock().map_err(|_| "GUI cache unavailable")?;
    if job.control.cancelled() {
        cache.close()
    } else {
        cache.finish(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan_cache::Journal;
    fn panel(menu: bool) -> Surface {
        Surface {
            bounds: [1.0, 2.0, 3.0, 4.0],
            menu,
        }
    }
    const OLD_FORMAT: &str = "{\"type\":\"Header\",\"key\":\"k\",\"total\":4}
{\"type\":\"Frame\",\"frame\":0,\"hit\":null}
{\"type\":\"Frame\",\"frame\":2,\"hit\":{\"bounds\":[1.0,2.0,3.0,4.0],\"menu\":true}}
";
    #[test]
    fn reads_a_gui_cache_written_by_0_5_and_resumes_after_a_torn_last_line() {
        let f = crate::scan_cache::tests::fixture(4);
        let path = f.root.join("gui.jsonl");
        std::fs::write(&path, format!("{OLD_FORMAT}{{\"type\":\"Fra")).unwrap();
        let read = Journal::<Hit>::load_at(path.clone(), "k".into(), 4).unwrap();
        assert_eq!(
            read.decisions,
            vec![Some(None), None, Some(Some(panel(true))), None]
        );
        assert!(!read.finished);
        let mut journal = Journal::<Hit>::open_at(path.clone(), "k".into(), 4).unwrap();
        assert!(journal.put(1, Some(panel(false))).unwrap());
        assert!(
            !journal.put(0, Some(panel(false))).unwrap(),
            "a known frame is never rewritten"
        );
        assert!(journal.put(3, None).unwrap());
        journal.finish(0).unwrap();
        drop(journal);
        let again = Journal::<Hit>::load_at(path, "k".into(), 4).unwrap();
        assert!(again.finished);
        assert_eq!(again.decisions[1], Some(Some(panel(false))));
        assert_eq!(
            again.decisions[0],
            Some(None),
            "the torn record did not swallow later ones"
        );
    }
    #[test]
    fn a_finished_line_from_0_5_without_an_applied_count_still_counts() {
        let f = crate::scan_cache::tests::fixture(4);
        let path = f.root.join("gui.jsonl");
        let all = format!(
            "{OLD_FORMAT}{{\"type\":\"Frame\",\"frame\":1,\"hit\":null}}
{{\"type\":\"Frame\",\"frame\":3,\"hit\":null}}
{{\"type\":\"Finished\"}}
"
        );
        std::fs::write(&path, all).unwrap();
        assert!(
            Journal::<Hit>::load_at(path, "k".into(), 4)
                .unwrap()
                .finished
        );
    }
    #[test]
    fn a_second_window_cannot_write_the_same_gui_cache() {
        let f = crate::scan_cache::tests::fixture(4);
        let path = f.root.join("gui.jsonl");
        let _first = Journal::<Hit>::open_at(path.clone(), "k".into(), 4).unwrap();
        let second = Journal::<Hit>::open_at(path, "k".into(), 4).err().unwrap();
        assert!(second.contains("Another FireCrackle instance"), "{second}");
    }
    #[test]
    fn stale_or_oversized_gui_caches_are_ignored() {
        let f = crate::scan_cache::tests::fixture(4);
        let path = f.root.join("gui.jsonl");
        std::fs::write(&path, OLD_FORMAT).unwrap();
        assert!(Journal::<Hit>::load_at(path.clone(), "other".into(), 4).is_none());
        assert!(Journal::<Hit>::load_at(path.clone(), "k".into(), 5).is_none());
        std::fs::write(
            &path,
            format!("{OLD_FORMAT}{}", " ".repeat(2 * 1024 * 1024)),
        )
        .unwrap();
        assert!(Journal::<Hit>::load_at(path, "k".into(), 4).is_none());
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
        let root = std::path::PathBuf::from(std::env::var("GUI_BENCH_ROOT").unwrap());
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
        let cache = load_cache(&project);
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
                cache.decisions[frame]
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
        use std::io::Write;
        let f = crate::scan_cache::tests::fixture(5);
        let path =
            crate::scan_cache::auto_cache_file(&f.project, "gui-interactions.jsonl").unwrap();
        let mut cache = load_cache(&f.project);
        cache.begin().unwrap();
        cache
            .put(
                3,
                Some(Surface {
                    bounds: [2., 3., 4., 5.],
                    menu: false,
                }),
            )
            .unwrap();
        cache.put(0, None).unwrap();
        cache.close().unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{\"type\":\"Frame\"")
            .unwrap();
        let mut recovered = load_cache(&f.project);
        assert_eq!(recovered.decisions[0], Some(None));
        assert!(recovered.decisions[1].is_none());
        assert!(recovered.decisions[3].as_ref().unwrap().is_some());
        assert!(!recovered.finished);
        recovered.begin().unwrap();
        recovered.put(4, None).unwrap();
        recovered.close().unwrap();
        assert_eq!(load_cache(&f.project).decisions[4], Some(None));
        let mut changed = f.project.clone();
        changed.fingerprint = "changed".into();
        assert!(load_cache(&changed).decisions.iter().all(Option::is_none));
        assert!(path.exists());
    }
    #[test]
    fn ranges_break_on_unknown_frames_and_menu_boundaries() {
        let f = crate::scan_cache::tests::fixture(5);
        let mut cache = load_cache(&f.project);
        let panel = Surface {
            bounds: [1., 2., 3., 4.],
            menu: false,
        };
        cache.decisions = vec![
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
            control: JobControl::default(),
        };
        let status = job.status().unwrap();
        assert_eq!(status.processed, 4);
        assert_eq!(status.ranges.len(), 3);
        assert_eq!((status.ranges[1].first, status.ranges[1].last), (2, 3));
        assert!(status.ranges[2].menu);
    }
    #[test]
    fn a_cancelled_scan_for_the_previous_video_does_not_block_the_next_video() {
        let a = crate::scan_cache::tests::fixture(3);
        let b = crate::scan_cache::tests::fixture(4);
        let jobs = Jobs::default();
        let old = Arc::new(Job {
            project: a.project.clone(),
            cache: Mutex::new(load_cache(&a.project)),
            state: Mutex::new(("running".into(), None)),
            control: JobControl::default(),
        });
        *jobs.current.lock().unwrap() = Some(old.clone());
        assert!(
            jobs.status(&b.project).is_err(),
            "a live scan of another video still blocks"
        );
        jobs.shutdown();
        assert!(old.control.cancelled());
        // Its worker has not noticed yet (still "running"), but it is stopping, so the new video may start.
        let status = jobs.status(&b.project).unwrap();
        assert_eq!(status.total, b.project.frames.len() as u32);
    }
    #[test]
    fn the_gui_cache_key_follows_the_shared_pipeline_version() {
        // Decoder, ffmpeg arguments, app version: anything that invalidates first-person/no-fire caches must
        // invalidate GUI results too, not just the three detector sources.
        let f = crate::scan_cache::tests::fixture(3);
        assert_ne!(
            cache_key(&f.project, "pipeline-a"),
            cache_key(&f.project, "pipeline-b")
        );
        assert_eq!(
            cache_key(&f.project, "pipeline-a"),
            cache_key(&f.project, "pipeline-a")
        );
    }
    #[test]
    fn a_range_is_sealed_only_when_both_neighbours_are_scanned() {
        let f = crate::scan_cache::tests::fixture(8);
        let mut cache = load_cache(&f.project);
        let hit = |menu| {
            Some(Some(Surface {
                bounds: [1., 2., 3., 4.],
                menu,
            }))
        };
        cache.decisions = vec![
            hit(false), // 0 ┐ range 0..=1 starts at the video start
            hit(false), // 1 ┘
            hit(true),  // 2   menu range, both neighbours scanned
            Some(None), // 3   scanned, no GUI
            hit(false), // 4   range 4..=4, frame 5 not scanned yet
            None,       // 5
            hit(false), // 6 ┐ range 6..=7, frame 5 not scanned yet
            hit(false), // 7 ┘
        ];
        let job = Job {
            project: f.project.clone(),
            cache: Mutex::new(cache),
            state: Mutex::new(("running".into(), None)),
            control: JobControl::default(),
        };
        let sealed: Vec<(u32, u32, bool)> = job
            .status()
            .unwrap()
            .ranges
            .iter()
            .map(|r| (r.first, r.last, r.sealed))
            .collect();
        assert_eq!(
            sealed,
            vec![(0, 1, true), (2, 2, true), (4, 4, false), (6, 7, false)]
        );
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
        let cache = load_cache(&project);
        assert!(cache.finished);
        let reference =
            std::fs::read_to_string(std::env::var("GUI_SMOKE_REFERENCE").unwrap()).unwrap();
        for (n, line) in reference.lines().enumerate() {
            let r: serde_json::Value = serde_json::from_str(line).unwrap();
            assert_eq!(
                cache.decisions[n].as_ref().unwrap().is_some(),
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
