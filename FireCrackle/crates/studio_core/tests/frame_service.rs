use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use studio_core::config::{DecodeConfig, IndexConfig};
use studio_core::decode_plan::DecodeJob;
use studio_core::frames::{DecodeError, DecodedFrame};
use studio_core::index::{build_index, FrameIndex, Packet};
use studio_core::workspace::{FrameError, FrameService, FrameSource};

// ------------------------------------------------------------ helpers

/// Frame `f` is `f` as 4 little-endian bytes followed by 16 marker bytes: 20 bytes, and it says which frame it is.
fn payload(f: u32) -> Vec<u8> {
    let mut v = f.to_le_bytes().to_vec();
    v.extend([0xAB; 16]);
    v
}

const FRAME_BYTES: u64 = 20;

#[derive(Default)]
struct Fake {
    /// (keyframe, first, last) of every decode.
    calls: Mutex<Vec<(u32, u32, u32)>>,
    fail_next: AtomicBool,
    delay_ms: u64,
    /// Size of every frame; 0 = the 20-byte `payload`.
    frame_bytes: usize,
}

impl FrameSource for Fake {
    fn decode(
        &self,
        job: &DecodeJob,
        _cancel: &AtomicBool,
    ) -> Result<Vec<DecodedFrame>, DecodeError> {
        if self.delay_ms > 0 {
            std::thread::sleep(Duration::from_millis(self.delay_ms));
        }
        if self.fail_next.swap(false, Ordering::SeqCst) {
            return Err(DecodeError::FfmpegFailed("boom".into()));
        }
        self.calls
            .lock()
            .unwrap()
            .push((job.keyframe, job.first, job.last));
        let bytes = |f: u32| {
            if self.frame_bytes > 0 {
                vec![f as u8; self.frame_bytes]
            } else {
                payload(f)
            }
        };
        Ok((job.first..=job.last)
            .map(|f| DecodedFrame {
                frame: f,
                jpeg: bytes(f),
            })
            .collect())
    }
}

impl Fake {
    fn calls(&self) -> Vec<(u32, u32, u32)> {
        self.calls.lock().unwrap().clone()
    }
}

fn index_of(n: usize, key_every: usize) -> Arc<FrameIndex> {
    let pk: Vec<Packet> = (0..n)
        .map(|i| Packet {
            pts: Some(i as f64 / 60.0),
            dts: None,
            key: key_every != 0 && i % key_every == 0,
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

/// These tests are about the window policy (what is cached, when it refills), so a miss decodes the whole window in
/// one job here, as it did before the first job was cut short (see tests/playback.rs for that).
fn service(n: usize, c: DecodeConfig, fake: &Arc<Fake>) -> FrameService {
    let svc = FrameService::new(index_of(n, 60), fake.clone() as Arc<dyn FrameSource>, c);
    svc.set_first_frames(0); // whole-window misses, see `service`
    svc.set_first_frames(0);
    svc
}

// ---------------------------------------------------------------- basics

#[test]
fn a_cold_request_decodes_the_planned_window_once_and_returns_the_frame() {
    let fake = Arc::new(Fake::default());
    let svc = service(1000, cfg(30, 90, 0.5), &fake);
    let bytes = svc.get(100).unwrap();
    assert_eq!(*bytes, payload(100));
    assert_eq!(fake.calls(), vec![(60, 70, 190)]);
    assert_eq!(svc.cached_frames(), (70..=190).collect::<Vec<u32>>());
    assert_eq!(svc.used_bytes(), 121 * FRAME_BYTES);
}

#[test]
fn hits_inside_the_window_do_not_decode_and_return_the_same_bytes() {
    let fake = Arc::new(Fake::default());
    let svc = service(1000, cfg(30, 90, 0.5), &fake);
    let a = svc.get(100).unwrap();
    for f in 101..=140 {
        assert_eq!(*svc.get(f).unwrap(), payload(f));
    }
    svc.wait_idle();
    assert_eq!(fake.calls().len(), 1);
    assert!(
        Arc::ptr_eq(&a, &svc.get(100).unwrap()),
        "a hit hands out the cached bytes, not a copy"
    );
}

#[test]
fn running_low_ahead_starts_a_background_prefetch_of_a_whole_window() {
    let fake = Arc::new(Fake::default());
    let svc = service(1000, cfg(30, 90, 0.5), &fake);
    svc.get(100).unwrap(); // cached 70..=190
    svc.get(145).unwrap(); // 45 cached ahead: not below 45
    svc.wait_idle();
    assert_eq!(fake.calls().len(), 1);
    svc.get(146).unwrap(); // 44 < 45: prefetch 191..=236
    svc.wait_idle();
    assert_eq!(fake.calls(), vec![(60, 70, 190), (180, 191, 236)]);
    assert!(svc.cached_frames().contains(&236));
}

#[test]
fn prefetch_is_single_flight() {
    let fake = Arc::new(Fake {
        delay_ms: 40,
        ..Fake::default()
    });
    let svc = service(1000, cfg(30, 90, 0.5), &fake);
    svc.get(100).unwrap();
    for _ in 0..6 {
        svc.get(150).unwrap(); // every call finds the same shortage
    }
    svc.wait_idle();
    assert_eq!(
        fake.calls().len(),
        2,
        "one cold decode and exactly one prefetch: {:?}",
        fake.calls()
    );
}

#[test]
fn stepping_backwards_prefetches_behind() {
    let fake = Arc::new(Fake::default());
    let svc = service(1000, cfg(30, 90, 0.5), &fake);
    svc.get(100).unwrap(); // 70..=190
    svc.get(80).unwrap(); // 10 cached behind of 30: below 15
    svc.wait_idle();
    assert_eq!(fake.calls()[1], (0, 50, 69));
    assert!(svc.cached_frames().contains(&50));
}

// ---------------------------------------------------------------- memory

#[test]
fn evicted_frames_are_dropped_from_memory() {
    let fake = Arc::new(Fake::default());
    let svc = FrameService::with_capacity(
        index_of(1000, 60),
        fake.clone() as Arc<dyn FrameSource>,
        cfg(2, 2, 0.5),
        5 * FRAME_BYTES,
    );
    svc.set_first_frames(0); // whole-window misses, see `service`
    svc.get(100).unwrap();
    assert_eq!(svc.cached_frames(), vec![98, 99, 100, 101, 102]);
    svc.get(500).unwrap();
    assert_eq!(svc.cached_frames(), vec![498, 499, 500, 501, 502]);
    assert!(svc.used_bytes() <= 5 * FRAME_BYTES);
}

#[test]
fn the_wanted_frame_survives_a_window_bigger_than_the_cache() {
    let fake = Arc::new(Fake::default());
    let svc = FrameService::with_capacity(
        index_of(1000, 60),
        fake.clone() as Arc<dyn FrameSource>,
        cfg(2, 2, 0.5),
        3 * FRAME_BYTES,
    );
    svc.set_first_frames(0); // whole-window misses, see `service`
    let bytes = svc.get(100).unwrap();
    assert_eq!(*bytes, payload(100));
    assert!(svc.cached_frames().contains(&100));
    assert_eq!(svc.cached_frames().len(), 3);
}

#[test]
fn the_default_capacity_comes_from_cache_mb() {
    let fake = Arc::new(Fake::default());
    let svc = FrameService::new(
        index_of(1000, 60),
        fake.clone() as Arc<dyn FrameSource>,
        DecodeConfig {
            cache_mb: 16,
            ..cfg(30, 90, 0.5)
        },
    );
    svc.set_first_frames(0); // whole-window misses, see `service`
    svc.get(100).unwrap();
    assert_eq!(
        svc.cached_frames().len(),
        121,
        "a handful of tiny test frames fit easily in 16 MiB"
    );
}

// --------------------------------------------------------------- failures

#[test]
fn a_failed_decode_is_an_error_and_leaves_the_cache_unchanged() {
    let fake = Arc::new(Fake::default());
    let svc = service(1000, cfg(30, 90, 0.5), &fake);
    fake.fail_next.store(true, Ordering::SeqCst);
    assert!(matches!(
        svc.get(100),
        Err(FrameError::Decode(DecodeError::FfmpegFailed(_)))
    ));
    assert!(svc.cached_frames().is_empty());
    assert_eq!(
        *svc.get(100).unwrap(),
        payload(100),
        "the next request retries and succeeds"
    );
}

#[test]
fn a_frame_beyond_the_video_is_out_of_range() {
    let fake = Arc::new(Fake::default());
    let svc = service(1000, cfg(30, 90, 0.5), &fake);
    assert_eq!(svc.get(1000), Err(FrameError::OutOfRange(1000)));
    assert_eq!(svc.get(u32::MAX), Err(FrameError::OutOfRange(u32::MAX)));
    assert!(fake.calls().is_empty());
}

#[test]
fn a_failed_prefetch_is_swallowed_and_retried_later() {
    let fake = Arc::new(Fake::default());
    let svc = service(1000, cfg(30, 90, 0.5), &fake);
    svc.get(100).unwrap();
    fake.fail_next.store(true, Ordering::SeqCst);
    assert_eq!(
        *svc.get(146).unwrap(),
        payload(146),
        "the hit itself is unaffected"
    );
    svc.wait_idle();
    assert_eq!(fake.calls().len(), 1);
    assert!(!svc.cached_frames().contains(&191));
    svc.get(147).unwrap();
    svc.wait_idle();
    assert_eq!(
        fake.calls().len(),
        2,
        "the shortage is still there, so the next hit retries"
    );
    assert!(svc.cached_frames().contains(&191));
}

// ------------------------------------------------------------- edges / misc

#[test]
fn the_first_and_the_last_frame() {
    let fake = Arc::new(Fake::default());
    let svc = service(1000, cfg(30, 90, 0.5), &fake);
    assert_eq!(*svc.get(0).unwrap(), payload(0));
    assert_eq!(*svc.get(999).unwrap(), payload(999));
    assert_eq!(fake.calls(), vec![(0, 0, 90), (960, 969, 999)]);
}

#[test]
fn a_new_config_applies_from_the_next_request() {
    let fake = Arc::new(Fake::default());
    let svc = service(1000, cfg(0, 10, 0.5), &fake);
    svc.get(100).unwrap();
    svc.set_config(cfg(0, 50, 0.5));
    svc.get(500).unwrap();
    assert_eq!(fake.calls(), vec![(60, 100, 110), (480, 500, 550)]);
}

#[test]
fn two_threads_asking_for_different_frames_both_get_the_right_ones() {
    let fake = Arc::new(Fake {
        delay_ms: 20,
        ..Fake::default()
    });
    let svc = service(1000, cfg(30, 90, 0.5), &fake);
    std::thread::scope(|s| {
        let a = s.spawn(|| {
            (100..140)
                .map(|f| (f, svc.get(f).unwrap()))
                .collect::<Vec<_>>()
        });
        let b = s.spawn(|| {
            (700..740)
                .map(|f| (f, svc.get(f).unwrap()))
                .collect::<Vec<_>>()
        });
        for (f, bytes) in a.join().unwrap().into_iter().chain(b.join().unwrap()) {
            assert_eq!(*bytes, payload(f));
        }
    });
    svc.wait_idle();
}

#[test]
fn waiting_when_idle_returns_at_once() {
    let fake = Arc::new(Fake::default());
    let svc = service(100, cfg(30, 90, 0.5), &fake);
    svc.wait_idle();
    svc.get(10).unwrap();
    svc.wait_idle();
    svc.wait_idle();
}

#[test]
fn lowering_cache_mb_evicts_frames_at_once() {
    const MIB: usize = 1 << 20;
    let fake = Arc::new(Fake {
        frame_bytes: MIB,
        ..Fake::default()
    });
    let c = DecodeConfig {
        window_back: 0,
        window_ahead: 19,
        cache_mb: 32,
        ..cfg(0, 19, 0.5)
    };
    let svc = FrameService::new(index_of(1000, 60), fake.clone() as Arc<dyn FrameSource>, c);
    svc.set_first_frames(0); // whole-window misses, see `service`
    svc.get(100).unwrap();
    assert_eq!(svc.cached_frames().len(), 20);
    svc.set_config(DecodeConfig { cache_mb: 8, ..c });
    assert_eq!(
        svc.cached_frames().len(),
        8,
        "only the 8 most recently used frames fit in 8 MiB"
    );
    assert!(svc.used_bytes() <= 8 * MIB as u64);
    assert!(
        svc.cached_frames().contains(&100),
        "the playhead frame was the most recently used"
    );
}
