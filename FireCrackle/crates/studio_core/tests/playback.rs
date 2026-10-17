//! Playback must not stall. Measured on a 1080p 60 fps recording (keyframe every 240 frames): a decode costs about
//! 300 ms plus 1.7 ms per frame, so a window that refills too late, a refill that only starts on the next request, and a
//! workspace lock held across the decode made playback pause for up to 1.5 s. See the playback job on the board.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use studio_core::config::{DecodeConfig, IndexConfig, Settings};
use studio_core::decode_plan::{
    cap_job, job_for, trim_job, DecodeJob, DEFAULT_FIRST_AHEAD, FIRST_JOB_BACK, MAX_FILL_FRAMES,
};
use studio_core::frames::{DecodeError, DecodedFrame};
use studio_core::index::{build_index, FrameIndex, Packet};
use studio_core::project::{Project, VideoMeta};
use studio_core::workspace::{FrameService, FrameSource, Workspace};

// ------------------------------------------------------------ helpers

fn payload(f: u32) -> Vec<u8> {
    let mut v = f.to_le_bytes().to_vec();
    v.extend([0xAB; 16]);
    v
}

#[derive(Default)]
struct Fake {
    /// (keyframe, first, last) of every successful decode.
    calls: Mutex<Vec<(u32, u32, u32)>>,
    delay_ms: u64,
    /// Jobs whose first frame is at or after the frame sleep this long (a slow background fill).
    slow_from: Option<(u32, u64)>,
    /// Jobs whose first frame is at or after this frame fail.
    fail_from: Option<u32>,
    /// Jobs that end after this frame fail.
    fail_last_above: Option<u32>,
    started: AtomicUsize,
}

impl FrameSource for Fake {
    fn decode(
        &self,
        job: &DecodeJob,
        _cancel: &AtomicBool,
    ) -> Result<Vec<DecodedFrame>, DecodeError> {
        self.started.fetch_add(1, Ordering::SeqCst);
        if self.delay_ms > 0 {
            std::thread::sleep(Duration::from_millis(self.delay_ms));
        }
        if let Some((from, ms)) = self.slow_from {
            if job.first >= from {
                std::thread::sleep(Duration::from_millis(ms));
            }
        }
        if self.fail_from.is_some_and(|n| job.first >= n)
            || self.fail_last_above.is_some_and(|n| job.last > n)
        {
            return Err(DecodeError::FfmpegFailed("boom".into()));
        }
        self.calls
            .lock()
            .unwrap()
            .push((job.keyframe, job.first, job.last));
        Ok((job.first..=job.last)
            .map(|f| DecodedFrame {
                frame: f,
                jpeg: payload(f),
            })
            .collect())
    }
}

impl Fake {
    /// Every successful decode, in a fixed order (the head and the fill run side by side).
    fn calls(&self) -> Vec<(u32, u32, u32)> {
        let mut calls = self.calls.lock().unwrap().clone();
        calls.sort();
        calls
    }
}

fn index_of(n: usize, key_every: usize) -> Arc<FrameIndex> {
    let pk: Vec<Packet> = (0..n)
        .map(|i| Packet {
            pts: Some(i as f64 / 60.0),
            dts: None,
            key: i % key_every == 0,
        })
        .collect();
    Arc::new(build_index(&pk, &IndexConfig::default()).unwrap())
}

fn cfg(back: u32, ahead: u32, fraction: f64) -> DecodeConfig {
    DecodeConfig {
        window_back: back,
        window_ahead: ahead,
        prefetch_fraction: fraction,
        ..DecodeConfig::default()
    }
}

fn service(n: usize, c: DecodeConfig, fake: &Arc<Fake>) -> FrameService {
    FrameService::new(index_of(n, 60), fake.clone() as Arc<dyn FrameSource>, c)
}

// ------------------------------------------------- limiting the first job

fn trimmed(whole: DecodeJob, want: u32, ahead: u32) -> DecodeJob {
    trim_job(
        &index_of(3000, 60),
        whole,
        want,
        ahead,
        &DecodeConfig::default(),
    )
}

#[test]
fn a_missing_frames_job_is_cut_to_a_short_way_around_it() {
    // the planner's window is 120 back and 300 ahead; the first job keeps FIRST_JOB_BACK and 90 ahead
    let whole = job_for(&index_of(3000, 60), 380, 800, &DecodeConfig::default());
    let cut = trimmed(whole, 500, 90);
    assert_eq!((cut.first, cut.last), (500 - FIRST_JOB_BACK, 590));
    assert_eq!(
        cut.keyframe, 420,
        "the keyframe at or before the first frame kept"
    );
    assert_eq!(cut.decode_count, 590 - 420 + 1);
}

#[test]
fn a_cut_job_is_an_ordinary_job_for_its_run() {
    let index = index_of(3000, 60);
    let whole = job_for(&index, 380, 800, &DecodeConfig::default());
    assert_eq!(
        trimmed(whole, 500, 90),
        job_for(&index, 470, 590, &DecodeConfig::default())
    );
}

#[test]
fn an_ahead_of_zero_keeps_the_whole_job() {
    let whole = job_for(&index_of(3000, 60), 380, 800, &DecodeConfig::default());
    assert_eq!(trimmed(whole, 500, 0), whole);
}

#[test]
fn a_job_already_inside_the_cut_is_unchanged() {
    let small = job_for(&index_of(3000, 60), 480, 560, &DecodeConfig::default());
    assert_eq!(trimmed(small, 500, 90), small);
}

#[test]
fn a_job_that_does_not_contain_the_wanted_frame_is_a_prefetch_and_is_never_cut() {
    let prefetch = job_for(&index_of(3000, 60), 591, 800, &DecodeConfig::default());
    assert_eq!(trimmed(prefetch, 500, 90), prefetch);
    assert_eq!(trimmed(prefetch, 900, 90), prefetch);
}

#[test]
fn the_cut_stays_inside_the_video_at_both_ends() {
    let index = index_of(200, 60);
    let cfg = DecodeConfig::default();
    let start = trim_job(&index, job_for(&index, 0, 199, &cfg), 5, 90, &cfg);
    assert_eq!((start.first, start.last), (0, 95));
    let end = trim_job(&index, job_for(&index, 0, 199, &cfg), 195, 90, &cfg);
    assert_eq!((end.first, end.last), (195 - FIRST_JOB_BACK, 199));
}

#[test]
fn the_slow_flag_follows_the_cut_run() {
    let index = index_of(3000, 600); // a keyframe every 600 frames
    let cfg = DecodeConfig {
        max_gop_frames: 300,
        ..DecodeConfig::default()
    };
    let whole = job_for(&index, 1100, 1500, &cfg); // starts 500 after its keyframe: slow
    assert!(whole.slow);
    // the cut starts at 1120, still 520 after the keyframe at 600: slow
    assert!(trim_job(&index, whole, 1150, 90, &cfg).slow);
    // the cut starts at 1370, after the keyframe at 1200 (170 away): not slow, though the whole job was
    assert!(!trim_job(&index, whole, 1400, 90, &cfg).slow);
}

// The refill starts when the first job ends and takes about 1 s (300 ms + 1.7 ms a frame, from the keyframe), so the
// frames of the first job have to last that long at 60 fps (78 frames are 1.3 s); a longer first job makes the first
// frame slower.
const _: () = assert!(DEFAULT_FIRST_AHEAD >= 78 && DEFAULT_FIRST_AHEAD <= 150);
const _: () = assert!(FIRST_JOB_BACK <= 60);

// ------------------------------------------------ capping a background job

fn capped(whole: DecodeJob, want: u32, max: u32) -> DecodeJob {
    cap_job(
        &index_of(3000, 60),
        whole,
        want,
        max,
        &DecodeConfig::default(),
    )
}

#[test]
fn a_job_ahead_of_the_playhead_is_cut_at_its_far_end() {
    let index = index_of(3000, 60);
    let ahead = job_for(&index, 591, 800, &DecodeConfig::default());
    let cut = capped(ahead, 500, 100);
    assert_eq!((cut.first, cut.last), (591, 690));
    assert_eq!(cut, job_for(&index, 591, 690, &DecodeConfig::default()));
}

#[test]
fn a_job_behind_the_playhead_is_cut_at_its_far_end_keeping_the_part_next_to_the_playhead() {
    let index = index_of(3000, 60);
    let behind = job_for(&index, 380, 469, &DecodeConfig::default());
    let cut = capped(behind, 500, 50);
    assert_eq!((cut.first, cut.last), (420, 469));
    assert_eq!(cut, job_for(&index, 420, 469, &DecodeConfig::default()));
}

#[test]
fn a_short_job_and_a_cap_of_zero_leave_the_job_alone() {
    let ahead = job_for(&index_of(3000, 60), 591, 700, &DecodeConfig::default());
    assert_eq!(capped(ahead, 500, 110), ahead);
    assert_eq!(capped(ahead, 500, 240), ahead);
    assert_eq!(capped(ahead, 500, 0), ahead);
}

#[test]
fn a_job_for_the_wanted_frame_itself_is_not_capped() {
    let miss = job_for(&index_of(3000, 60), 380, 800, &DecodeConfig::default());
    assert_eq!(
        capped(miss, 500, 100),
        miss,
        "a miss is cut by trim_job, not here"
    );
}

#[test]
fn the_background_never_decodes_more_than_a_cap_at_a_time_but_still_fills_a_big_window() {
    let fake = Arc::new(Fake::default());
    let svc = service(5000, cfg(120, 900, 0.75), &fake);
    svc.get(500).unwrap();
    svc.wait_idle();
    let calls = fake.calls();
    for &(_, first, last) in calls.iter().filter(|&&(_, first, _)| first != 470) {
        assert!(
            last - first < MAX_FILL_FRAMES,
            "a fill job of {} frames",
            last - first + 1
        );
    }
    assert!(calls.len() >= 5, "{calls:?}");
    // the refill rule tops up only below 75% of the window, so it stops about 810 frames ahead, not at 900
    assert!(
        svc.cached_frames().contains(&1300),
        "the window was filled ahead"
    );
    assert!(svc.cached_frames().contains(&380), "and behind");
}

// A fill job restarts the decoder at a keyframe: a cap of about one 4 s interval keeps its cost near 1 s.
const _: () = assert!(MAX_FILL_FRAMES >= 120 && MAX_FILL_FRAMES <= 300);

// ------------------------------------------- the frame service's first job

#[test]
fn a_cold_request_decodes_a_short_first_job_then_fills_both_sides_in_the_background() {
    let fake = Arc::new(Fake::default());
    let svc = service(3000, cfg(120, 300, 0.67), &fake);
    assert_eq!(*svc.get(500).unwrap(), payload(500));
    svc.wait_idle();
    // the first job (470..=590), then the rest ahead (591..=800), then behind (380..=469)
    assert_eq!(
        fake.calls(),
        vec![(360, 380, 469), (420, 470, 590), (540, 591, 800)]
    );
    assert_eq!(svc.cached_frames(), (380..=800).collect::<Vec<u32>>());
}

#[test]
fn the_first_job_can_be_turned_off_to_get_the_old_one_window_decode() {
    let fake = Arc::new(Fake::default());
    let svc = service(3000, cfg(120, 300, 0.67), &fake);
    svc.set_first_frames(0);
    svc.get(500).unwrap();
    svc.wait_idle();
    assert_eq!(fake.calls(), vec![(360, 380, 800)]);
}

#[test]
fn the_first_frame_is_returned_without_waiting_for_the_background_fill() {
    // the first job takes 100 ms, the fill after it 600 ms
    let fake = Arc::new(Fake {
        delay_ms: 100,
        slow_from: Some((591, 500)),
        ..Fake::default()
    });
    let svc = service(3000, cfg(120, 300, 0.67), &fake);
    let start = Instant::now();
    svc.get(500).unwrap();
    let waited = start.elapsed();
    assert!(
        waited < Duration::from_millis(300),
        "waited {waited:?} for the first frame"
    );
    assert_eq!(fake.calls().len(), 1, "the fill is still decoding");
    svc.wait_idle();
    assert_eq!(fake.calls().len(), 3);
}

#[test]
fn the_fill_starts_by_itself_right_after_the_first_frame() {
    // no further request is made: the fill must not wait for the next frame to be asked for
    let fake = Arc::new(Fake {
        delay_ms: 30,
        ..Fake::default()
    });
    let svc = service(3000, cfg(120, 300, 0.67), &fake);
    svc.get(500).unwrap();
    svc.wait_idle();
    assert!(svc.cached_frames().contains(&800), "ahead was not filled");
    assert!(svc.cached_frames().contains(&380), "behind was not filled");
}

#[test]
fn the_fill_follows_the_playhead_when_it_has_moved_on() {
    let fake = Arc::new(Fake {
        delay_ms: 60,
        ..Fake::default()
    });
    let svc = service(5000, cfg(120, 300, 0.67), &fake);
    svc.get(500).unwrap();
    svc.get(2000).unwrap(); // a jump while the first fill runs
    svc.wait_idle();
    svc.get(2001).unwrap();
    svc.wait_idle();
    assert!(
        svc.cached_frames().contains(&2300),
        "nothing was filled ahead of the new position"
    );
}

#[test]
fn a_request_inside_the_range_the_background_is_decoding_waits_for_it_instead_of_decoding_it_again()
{
    // the first job (470..=590) is quick, the fill after it (591..=830) takes 600 ms
    let fake = Arc::new(Fake {
        delay_ms: 20,
        slow_from: Some((591, 580)),
        ..Fake::default()
    });
    let svc = service(3000, cfg(120, 300, 0.67), &fake);
    svc.get(500).unwrap();
    let start = Instant::now();
    assert_eq!(*svc.get(600).unwrap(), payload(600)); // inside the fill
    let waited = start.elapsed();
    svc.wait_idle();
    // the fill is the one job that starts at 591; a second one would be frame 600 decoded again
    assert_eq!(
        fake.calls()
            .iter()
            .filter(|&&(_, first, _)| first == 591)
            .count(),
        1,
        "frame 600 was decoded a second time: {:?}",
        fake.calls()
    );
    assert!(
        waited > Duration::from_millis(200),
        "it should have waited for the fill ({waited:?})"
    );
    assert!(waited < Duration::from_millis(900), "waited {waited:?}");
}

#[test]
fn a_request_that_waited_for_a_failed_fill_decodes_for_itself() {
    // the fill (591..=830) fails; frame 600's own job (591..=690) is shorter and succeeds
    let fake = Arc::new(Fake {
        delay_ms: 20,
        fail_last_above: Some(700),
        ..Fake::default()
    });
    let svc = service(3000, cfg(120, 300, 0.67), &fake);
    svc.get(500).unwrap();
    assert_eq!(*svc.get(600).unwrap(), payload(600));
    svc.wait_idle();
}

#[test]
fn many_requests_inside_one_background_range_all_get_their_frames() {
    let fake = Arc::new(Fake {
        delay_ms: 20,
        slow_from: Some((591, 300)),
        ..Fake::default()
    });
    let svc = service(3000, cfg(120, 300, 0.67), &fake);
    svc.get(500).unwrap();
    let handles: Vec<_> = (0..6u32)
        .map(|k| {
            let svc = svc.clone();
            std::thread::spawn(move || (*svc.get(600 + k * 20).unwrap()).clone())
        })
        .collect();
    for (k, h) in handles.into_iter().enumerate() {
        assert_eq!(h.join().unwrap(), payload(600 + k as u32 * 20));
    }
    svc.wait_idle();
}

#[test]
fn a_request_outside_the_background_range_does_not_wait_for_it() {
    let fake = Arc::new(Fake {
        delay_ms: 20,
        slow_from: Some((591, 600)),
        ..Fake::default()
    });
    let svc = service(5000, cfg(120, 300, 0.67), &fake);
    svc.get(500).unwrap();
    let start = Instant::now();
    svc.get(100).unwrap(); // a different place (the fake only slows jobs from 591 on): its own job, not the fill's
    assert!(
        start.elapsed() < Duration::from_millis(400),
        "waited {:?}",
        start.elapsed()
    );
    svc.wait_idle();
}

#[test]
fn a_miss_near_the_end_of_the_video_stays_inside_it() {
    let fake = Arc::new(Fake::default());
    let svc = service(130, cfg(30, 90, 0.5), &fake);
    assert_eq!(*svc.get(125).unwrap(), payload(125));
    svc.wait_idle();
    assert!(
        fake.calls().iter().all(|&(_, _, last)| last <= 129),
        "{:?}",
        fake.calls()
    );
    assert_eq!(svc.get(129).map(|b| (*b).clone()).unwrap(), payload(129));
}

#[test]
fn the_first_frame_of_the_video_works() {
    let fake = Arc::new(Fake::default());
    let svc = service(1000, cfg(30, 300, 0.67), &fake);
    assert_eq!(*svc.get(0).unwrap(), payload(0));
    svc.wait_idle();
    assert_eq!(svc.cached_frames().first(), Some(&0));
    assert!(svc.cached_frames().contains(&300));
}

#[test]
fn a_failing_background_fill_is_swallowed_and_the_next_miss_decodes_normally() {
    let fake = Arc::new(Fake {
        fail_from: Some(191),
        ..Fake::default()
    });
    let svc = service(2000, cfg(30, 300, 0.67), &fake);
    assert_eq!(
        *svc.get(100).unwrap(),
        payload(100),
        "the first job succeeded"
    );
    svc.wait_idle(); // the fill after it failed
    assert_eq!(
        *svc.get(110).unwrap(),
        payload(110),
        "frames from the first job still come from the cache"
    );
    svc.wait_idle();
    // a miss far away needs a decode, which the fake fails
    assert!(svc.get(900).is_err());
    assert_eq!(
        svc.cached_frames(),
        (70..=190).collect::<Vec<u32>>(),
        "a failed decode leaves the cache as it was"
    );
}

#[test]
fn two_threads_asking_for_the_same_missing_frame_both_get_it() {
    let fake = Arc::new(Fake {
        delay_ms: 40,
        ..Fake::default()
    });
    let svc = service(2000, cfg(30, 90, 0.5), &fake);
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let svc = svc.clone();
            std::thread::spawn(move || (*svc.get(500).unwrap()).clone())
        })
        .collect();
    for h in handles {
        assert_eq!(h.join().unwrap(), payload(500));
    }
    svc.wait_idle();
}

#[test]
fn stepping_backwards_through_the_whole_back_window_never_waits_for_a_decode() {
    let fake = Arc::new(Fake {
        delay_ms: 100,
        ..Fake::default()
    });
    let svc = service(3000, cfg(120, 300, 0.67), &fake);
    svc.get(500).unwrap();
    svc.wait_idle();
    let mut worst = Duration::ZERO;
    for f in (390..=500).rev() {
        let t = Instant::now();
        assert_eq!(*svc.get(f).unwrap(), payload(f));
        worst = worst.max(t.elapsed());
        std::thread::sleep(Duration::from_millis(3)); // a held arrow key is about 30 steps a second
    }
    svc.wait_idle();
    assert!(
        worst < Duration::from_millis(40),
        "a step back waited {worst:?}"
    );
}

#[test]
fn playing_forward_never_waits_for_a_decode_after_the_first_frame() {
    // a decode takes 40 ms; the 300-frame window is 300 ms of playback at 1 ms a frame
    let fake = Arc::new(Fake {
        delay_ms: 40,
        ..Fake::default()
    });
    let svc = service(4000, cfg(120, 300, 0.67), &fake);
    svc.get(1000).unwrap();
    let mut worst = Duration::ZERO;
    for f in 1001..2200 {
        let t = Instant::now();
        svc.get(f).unwrap();
        worst = worst.max(t.elapsed());
        std::thread::sleep(Duration::from_millis(1));
    }
    svc.wait_idle();
    assert!(
        worst < Duration::from_millis(30),
        "a frame waited {worst:?}, which means it hit a decode"
    );
}

// ----------------------------------------------------------- the defaults

#[test]
fn the_default_windows_keep_seconds_of_playback_ready_in_a_small_part_of_the_cache() {
    let d = DecodeConfig::default();
    // 60 fps: the refill has to start with at least 2 s of video still ready, and a refill of a whole window takes
    // up to about 1.5 s when the keyframes are 4 s apart
    assert!(d.window_ahead >= 300, "ahead {}", d.window_ahead);
    assert!(d.window_back >= 120, "back {}", d.window_back);
    assert!(
        d.prefetch_fraction * d.window_ahead as f64 >= 120.0,
        "refill starts too late"
    );
    assert!(d.prefetch_fraction < 1.0);
    // about 100 KB a frame at 1280 wide is generous
    let window_mb = (d.window_back + d.window_ahead) as u64 * 100 / 1024;
    assert!(
        window_mb * 4 <= d.cache_mb as u64,
        "{window_mb} MB of a {} MB cache",
        d.cache_mb
    );
}

// ------------------------------------------------------ the workspace lock

fn project(n: usize) -> Project {
    let pk: Vec<Packet> = (0..n)
        .map(|i| Packet {
            pts: Some(i as f64 / 60.0),
            dts: None,
            key: i % 60 == 0,
        })
        .collect();
    let idx = build_index(&pk, &IndexConfig::default()).unwrap();
    let meta = VideoMeta {
        width: 1920,
        height: 1080,
        fps_num: 60,
        fps_den: 1,
        codec: "h264".into(),
    };
    Project::assemble("v.mkv", 1, "1:4096:0".into(), meta, &idx)
}

fn workspace(name: &str, fake: Arc<Fake>) -> Workspace {
    let dir = std::env::temp_dir().join(format!("fc_playback_{name}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    Workspace::from_parts(&dir, project(3000), &Settings::default(), fake).unwrap()
}

fn is_send_sync<T: Send + Sync + Clone>() {}

#[test]
fn a_slow_frame_decode_does_not_hold_the_workspace() {
    is_send_sync::<FrameService>();
    let fake = Arc::new(Fake {
        delay_ms: 300,
        ..Fake::default()
    });
    let w = workspace("lock", fake.clone());
    let service = w.frame_service(); // what the app clones out of the locked workspace
    let shared = Arc::new(Mutex::new(w));
    let decoding = {
        let service = service.clone();
        std::thread::spawn(move || (*service.get(500).unwrap()).clone())
    };
    std::thread::sleep(Duration::from_millis(60)); // the decode is under way
    let start = Instant::now();
    shared.lock().unwrap().view();
    assert!(
        start.elapsed() < Duration::from_millis(150),
        "the workspace was held for {:?}",
        start.elapsed()
    );
    assert_eq!(decoding.join().unwrap(), payload(500));
    service.wait_idle();
}

#[test]
fn the_service_handle_shares_the_workspaces_cache() {
    let fake = Arc::new(Fake::default());
    let w = workspace("share", fake.clone());
    let handle = w.frame_service();
    let a = handle.get(10).unwrap();
    let decodes = fake.calls().len();
    let b = w.frame_jpeg(10).unwrap();
    assert!(
        Arc::ptr_eq(&a, &b),
        "the workspace and the handle see the same cached bytes"
    );
    handle.wait_idle();
    assert!(fake.calls().len() >= decodes);
}
