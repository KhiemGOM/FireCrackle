use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use studio_core::config::{IndexConfig, Settings};
use studio_core::decode_plan::DecodeJob;
use studio_core::frames::{DecodeError, DecodedFrame};
use studio_core::index::{build_index, Packet};
use studio_core::project::{Project, VideoMeta};
use studio_core::thumbs::{Thumb, ThumbError, ThumbPlan};
use studio_core::workspace::*;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fc_thws_{}_{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// 300 frames at 30 fps, a keyframe every 30: ten keyframes.
fn project() -> Project {
    let pk: Vec<Packet> = (0..300)
        .map(|i| Packet {
            pts: Some(i as f64 / 30.0),
            dts: None,
            key: i % 30 == 0,
        })
        .collect();
    let idx = build_index(&pk, &IndexConfig::default()).unwrap();
    let meta = VideoMeta {
        width: 1920,
        height: 1080,
        fps_num: 30,
        fps_den: 1,
        codec: "h264".into(),
    };
    Project::assemble("v.mkv", 1, "1:4096:0".into(), meta, &idx)
}

#[derive(Default)]
struct Fake {
    calls: AtomicUsize,
    plans: Mutex<Vec<ThumbPlan>>,
    fail: AtomicBool,
    /// Block inside the run until cancelled (or released).
    block: AtomicBool,
    started: AtomicBool,
    unsupported: bool,
    delay_ms: u64,
}

impl FrameSource for Fake {
    fn decode(&self, job: &DecodeJob, _c: &AtomicBool) -> Result<Vec<DecodedFrame>, DecodeError> {
        Ok((job.first..=job.last)
            .map(|f| DecodedFrame {
                frame: f,
                jpeg: vec![f as u8; 8],
            })
            .collect())
    }

    fn thumbnails(&self, plan: &ThumbPlan, cancel: &AtomicBool) -> Result<Vec<Thumb>, ThumbError> {
        if self.unsupported {
            return Err(ThumbError::Unsupported);
        }
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.plans.lock().unwrap().push(plan.clone());
        self.started.store(true, Ordering::SeqCst);
        if self.delay_ms > 0 {
            std::thread::sleep(Duration::from_millis(self.delay_ms));
        }
        while self.block.load(Ordering::SeqCst) {
            if cancel.load(Ordering::SeqCst) {
                return Err(ThumbError::Cancelled);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        if self.fail.load(Ordering::SeqCst) {
            return Err(ThumbError::FfmpegFailed("boom".into()));
        }
        Ok(plan
            .frames
            .iter()
            .map(|&f| Thumb {
                frame: f,
                jpeg: vec![f as u8; 12],
            })
            .collect())
    }
}

fn open(dir: &Path, src: Arc<Fake>) -> Workspace {
    Workspace::from_parts(dir, project(), &Settings::default(), src).unwrap()
}

fn ready(w: &mut Workspace) -> ThumbStatus {
    w.thumbs_start();
    w.wait_thumbs();
    w.thumbs_status()
}

// ------------------------------------------------------------ basics

#[test]
fn a_new_workspace_has_no_thumbnails_yet() {
    let dir = scratch("idle");
    let w = open(&dir, Arc::new(Fake::default()));
    let s = w.thumbs_status();
    assert_eq!((s.state, s.count), (ThumbState::Idle, 0));
    assert!(s.error.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn starting_generates_all_keyframe_thumbnails_and_reports_ready() {
    let dir = scratch("ready");
    let src = Arc::new(Fake::default());
    let mut w = open(&dir, src.clone());
    let s = ready(&mut w);
    assert_eq!((s.state, s.count), (ThumbState::Ready, 10));
    assert_eq!(src.calls.load(Ordering::SeqCst), 1);
    let p = &src.plans.lock().unwrap()[0];
    assert_eq!((p.width, p.quality, p.stride), (96, 5, 1));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn nearest_thumbnails_and_the_pictures_come_from_the_store() {
    let dir = scratch("nearest");
    let mut w = open(&dir, Arc::new(Fake::default()));
    ready(&mut w);
    assert_eq!(
        w.thumb_nearest(&[0, 14, 16, 299, 150]),
        vec![Some(0), Some(0), Some(30), Some(270), Some(150)]
    );
    assert_eq!(w.thumb_nearest(&[]), Vec::<Option<u32>>::new());
    assert_eq!(w.thumb_jpeg(60).unwrap(), vec![60u8; 12]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn before_they_exist_nothing_is_nearest() {
    let dir = scratch("nostrip");
    let w = open(&dir, Arc::new(Fake::default()));
    assert_eq!(w.thumb_nearest(&[0, 5, 10]), vec![None, None, None]);
    assert!(w.thumb_jpeg(0).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_status_serialises_to_json_the_ui_can_read() {
    let dir = scratch("json");
    let mut w = open(&dir, Arc::new(Fake::default()));
    let s = ready(&mut w);
    let v = serde_json::to_value(&s).unwrap();
    assert_eq!(v["state"], "ready");
    assert_eq!(v["count"], 10);
    assert!(v["error"].is_null());
    let _ = std::fs::remove_dir_all(&dir);
}

// ------------------------------------------------------------ persistence and staleness

#[test]
fn thumbnails_survive_reopening_without_regenerating() {
    let dir = scratch("reopen");
    {
        let mut w = open(&dir, Arc::new(Fake::default()));
        ready(&mut w);
    }
    let src = Arc::new(Fake::default());
    let mut w = open(&dir, src.clone());
    assert_eq!(
        w.thumbs_status().state,
        ThumbState::Ready,
        "the cache on disk is valid"
    );
    let s = ready(&mut w);
    assert_eq!(s.state, ThumbState::Ready);
    assert_eq!(
        src.calls.load(Ordering::SeqCst),
        0,
        "the cache must be reused"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn changing_the_width_makes_the_cache_stale_and_it_is_regenerated() {
    let dir = scratch("width");
    let src = Arc::new(Fake::default());
    let mut w = open(&dir, src.clone());
    ready(&mut w);
    w.set_setting("timeline.thumb_width_px", 160.0).unwrap();
    assert_eq!(
        w.thumbs_status().state,
        ThumbState::Idle,
        "stale until regenerated"
    );
    let s = ready(&mut w);
    assert_eq!(s.state, ThumbState::Ready);
    assert_eq!(src.calls.load(Ordering::SeqCst), 2);
    assert_eq!(src.plans.lock().unwrap()[1].width, 160);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn changing_the_cap_changes_the_stride_and_the_count() {
    let dir = scratch("cap");
    let mut w = open(&dir, Arc::new(Fake::default()));
    ready(&mut w);
    w.set_setting("timeline.thumb_max_count", 4.0).unwrap(); // 10 keyframes, cap 4 -> stride 3 -> 4 pictures
    let s = ready(&mut w);
    assert_eq!((s.state, s.count), (ThumbState::Ready, 4));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_cache_of_another_video_is_not_reused() {
    let dir = scratch("othervideo");
    {
        let mut w = open(&dir, Arc::new(Fake::default()));
        ready(&mut w);
    }
    let mut p = project();
    p.fingerprint = "2:8192:99".into();
    let src = Arc::new(Fake::default());
    let mut w = Workspace::from_parts(&dir, p, &Settings::default(), src.clone()).unwrap();
    assert_eq!(w.thumbs_status().state, ThumbState::Idle);
    ready(&mut w);
    assert_eq!(src.calls.load(Ordering::SeqCst), 1);
    let _ = std::fs::remove_dir_all(&dir);
}

// ------------------------------------------------------------ failures and lifecycle

#[test]
fn a_failed_run_is_reported_and_not_run_again_until_the_video_is_opened_again() {
    // the timeline starts thumbnails each time it is shown: a failure was run again, and reported again, on every
    // screen switch. It is reported once per opened video; opening the video again tries again
    let dir = scratch("fail");
    let src = Arc::new(Fake::default());
    src.fail.store(true, Ordering::SeqCst);
    let mut w = open(&dir, src.clone());
    let s = ready(&mut w);
    assert_eq!(s.state, ThumbState::Failed);
    assert!(
        s.error.as_deref().unwrap_or("").contains("boom"),
        "{:?}",
        s.error
    );
    src.fail.store(false, Ordering::SeqCst);
    let again = ready(&mut w);
    assert_eq!(again.state, ThumbState::Failed);
    assert_eq!(again.error, s.error);
    assert_eq!(src.calls.load(Ordering::SeqCst), 1);
    drop(w);
    let mut w = open(&dir, src.clone());
    let s = ready(&mut w);
    assert_eq!((s.state, s.count), (ThumbState::Ready, 10));
    assert_eq!(src.calls.load(Ordering::SeqCst), 2);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_source_without_thumbnail_support_is_failed_not_a_panic() {
    let dir = scratch("unsupported");
    let mut w = open(
        &dir,
        Arc::new(Fake {
            unsupported: true,
            ..Fake::default()
        }),
    );
    let s = ready(&mut w);
    assert_eq!(s.state, ThumbState::Failed);
    assert!(s.error.is_some());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_failed_run_does_not_stop_labelling() {
    let dir = scratch("labelling");
    let src = Arc::new(Fake::default());
    src.fail.store(true, Ordering::SeqCst);
    let mut w = open(&dir, src);
    ready(&mut w);
    let v = w.apply(UiAction::ClickCell { col: 1, row: 4 }).unwrap();
    assert_eq!(v.labelled_count, 1);
    assert!(v.save_error.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn two_quick_starts_run_once() {
    let dir = scratch("twice");
    let src = Arc::new(Fake {
        delay_ms: 150,
        ..Fake::default()
    });
    let mut w = open(&dir, src.clone());
    let a = w.thumbs_start();
    let b = w.thumbs_start();
    assert_eq!(
        (a.state, b.state),
        (ThumbState::Running, ThumbState::Running)
    );
    w.wait_thumbs();
    assert_eq!(src.calls.load(Ordering::SeqCst), 1);
    assert_eq!(w.thumbs_status().state, ThumbState::Ready);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn starting_when_already_ready_does_nothing() {
    let dir = scratch("already");
    let src = Arc::new(Fake::default());
    let mut w = open(&dir, src.clone());
    ready(&mut w);
    ready(&mut w);
    assert_eq!(src.calls.load(Ordering::SeqCst), 1);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn disabled_does_nothing_and_says_so() {
    let dir = scratch("disabled");
    let src = Arc::new(Fake::default());
    let mut w = open(&dir, src.clone());
    w.set_setting("timeline.thumbs_enabled", 0.0).unwrap();
    let s = w.thumbs_start();
    assert_eq!(s.state, ThumbState::Disabled);
    w.wait_thumbs();
    assert_eq!(src.calls.load(Ordering::SeqCst), 0);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn dropping_the_workspace_cancels_a_running_job_without_hanging() {
    let dir = scratch("drop");
    let src = Arc::new(Fake {
        block: AtomicBool::new(true),
        ..Fake::default()
    });
    let mut w = open(&dir, src.clone());
    w.thumbs_start();
    let t = Instant::now();
    while !src.started.load(Ordering::SeqCst) && t.elapsed() < Duration::from_secs(2) {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(src.started.load(Ordering::SeqCst), "the job never started");
    let t = Instant::now();
    drop(w);
    assert!(
        t.elapsed() < Duration::from_secs(2),
        "drop waited for the blocked job"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_unknown_frame_is_an_error() {
    let dir = scratch("unknown");
    let mut w = open(&dir, Arc::new(Fake::default()));
    ready(&mut w);
    assert!(
        w.thumb_jpeg(7).is_err(),
        "frame 7 is not a keyframe thumbnail"
    );
    assert!(w.thumb_jpeg(100_000).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}
