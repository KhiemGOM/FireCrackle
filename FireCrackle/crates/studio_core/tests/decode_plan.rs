use studio_core::config::{DecodeConfig, IndexConfig};
use studio_core::decode_plan::*;
use studio_core::index::{build_index, FrameIndex, Packet};

/// `n` frames at 60 fps; a keyframe where `i % key_every == 0` (`key_every == 0`: no keyframes at all).
fn index_of(n: usize, key_every: usize) -> FrameIndex {
    let pk: Vec<Packet> = (0..n)
        .map(|i| Packet {
            pts: Some(i as f64 / 60.0),
            dts: None,
            key: key_every != 0 && i % key_every == 0,
        })
        .collect();
    build_index(&pk, &IndexConfig::default()).unwrap()
}

fn cfg(back: u32, ahead: u32, fraction: f64) -> DecodeConfig {
    DecodeConfig {
        window_back: back,
        window_ahead: ahead,
        prefetch_fraction: fraction,
        ..DecodeConfig::default()
    }
}

fn cache_of(frames: impl IntoIterator<Item = u32>) -> FrameCache {
    let mut c = FrameCache::new(u64::MAX / 4);
    for f in frames {
        c.insert(f, 1);
    }
    c
}

#[test]
fn refill_finishes_a_nearby_gop_without_redecoding_it_next_time() {
    let index = index_of(2000, 330);
    let config = DecodeConfig::default();
    let first = fill_job(&index, job_for(&index, 91, 690, &config), 90, &config);
    assert_eq!((first.first, first.last, first.keyframe), (91, 329, 0));
    let next = fill_job(&index, job_for(&index, 330, 900, &config), 300, &config);
    assert_eq!((next.first, next.last, next.keyframe), (330, 659, 330));
    assert_eq!(next.decode_count, 330);
}

#[test]
fn refill_stays_bounded_for_long_gops_short_windows_and_backward_work() {
    let index = index_of(3000, 1000);
    let config = DecodeConfig::default();
    for (first, last, want) in [(1, 900, 0), (1, 20, 0), (0, 900, 950)] {
        let job = job_for(&index, first, last, &config);
        assert_eq!(fill_job(&index, job, want, &config), cap_job(&index, job, want, MAX_FILL_FRAMES, &config));
    }
    let index = index_of(400, 330);
    let job = job_for(&index, 331, 399, &config);
    assert_eq!(fill_job(&index, job, 330, &config), job);
    for key_every in [1, 8, 30] {
        let index = index_of(1000, key_every);
        let job = job_for(&index, 1, 600, &config);
        assert_eq!(fill_job(&index, job, 0, &config), cap_job(&index, job, 0, MAX_FILL_FRAMES, &config));
    }
}

// ================================================================ FrameCache

#[test]
fn an_empty_cache_has_nothing() {
    let c = FrameCache::new(100);
    assert_eq!((c.len(), c.used_bytes(), c.capacity_bytes()), (0, 0, 100));
    assert!(!c.contains(0));
    assert!(c.frames().is_empty());
}

#[test]
fn insert_then_contains_and_frames_are_sorted() {
    let mut c = FrameCache::new(100);
    assert!(c.insert(7, 10).is_empty());
    c.insert(3, 20);
    c.insert(9, 5);
    assert!(c.contains(7) && c.contains(3) && c.contains(9) && !c.contains(4));
    assert_eq!(c.frames(), vec![3, 7, 9]);
    assert_eq!((c.len(), c.used_bytes()), (3, 35));
}

#[test]
fn the_least_recently_used_frame_is_evicted_first() {
    let mut c = FrameCache::new(3);
    for f in [1, 2, 3] {
        c.insert(f, 1);
    }
    assert_eq!(c.insert(4, 1), vec![1]);
    assert_eq!(c.frames(), vec![2, 3, 4]);
    assert!(c.touch(2), "2 becomes the most recently used");
    assert_eq!(c.insert(5, 1), vec![3], "3 is now the oldest, not 2");
    assert_eq!(c.frames(), vec![2, 4, 5]);
}

#[test]
fn eviction_follows_bytes_not_counts() {
    let mut c = FrameCache::new(10);
    assert!(c.insert(1, 6).is_empty());
    assert!(c.insert(2, 3).is_empty());
    assert_eq!(
        c.insert(3, 4),
        vec![1],
        "6 + 3 + 4 = 13 > 10: drop the oldest"
    );
    assert_eq!(c.used_bytes(), 7);
    assert_eq!(c.frames(), vec![2, 3]);
}

#[test]
fn one_big_insert_can_evict_several_frames_oldest_first() {
    let mut c = FrameCache::new(10);
    c.insert(1, 4);
    c.insert(2, 4);
    assert_eq!(c.insert(3, 8), vec![1, 2]);
    assert_eq!((c.frames(), c.used_bytes()), (vec![3], 8));
}

#[test]
fn a_frame_bigger_than_the_whole_cache_is_kept_alone() {
    let mut c = FrameCache::new(5);
    c.insert(1, 2);
    assert_eq!(c.insert(2, 9), vec![1]);
    assert!(c.contains(2));
    assert_eq!(
        c.used_bytes(),
        9,
        "over capacity, documented: the frame being shown must stay"
    );
}

#[test]
fn a_zero_capacity_cache_keeps_only_the_latest_frame() {
    let mut c = FrameCache::new(0);
    c.insert(1, 1);
    assert_eq!(c.insert(2, 1), vec![1]);
    assert_eq!(c.frames(), vec![2]);
}

#[test]
fn reinserting_replaces_the_size_without_duplicating() {
    let mut c = FrameCache::new(100);
    c.insert(1, 50);
    c.insert(2, 10);
    assert!(c.insert(1, 20).is_empty());
    assert_eq!((c.len(), c.used_bytes()), (2, 30));
    // and it became the most recently used
    let mut small = FrameCache::new(2);
    small.insert(1, 1);
    small.insert(2, 1);
    small.insert(1, 1);
    assert_eq!(small.insert(3, 1), vec![2]);
}

#[test]
fn touch_remove_and_clear() {
    let mut c = FrameCache::new(100);
    c.insert(1, 10);
    c.insert(2, 10);
    assert!(!c.touch(99));
    assert!(c.remove(1));
    assert!(!c.remove(1));
    assert_eq!((c.frames(), c.used_bytes()), (vec![2], 10));
    c.clear();
    assert_eq!((c.len(), c.used_bytes()), (0, 0));
}

// ===================================================================== plan

#[test]
fn a_cold_cache_decodes_the_window_from_the_governing_keyframe() {
    let idx = index_of(1000, 60);
    let p = plan(&idx, &cache_of([]), 100, &cfg(30, 90, 0.5)).unwrap();
    assert!(!p.want_cached);
    let j = p.job.unwrap();
    assert_eq!((j.first, j.last), (70, 190));
    assert_eq!(j.keyframe, 60);
    assert_eq!(j.seek_pts, idx.frames[60].pts);
    assert_eq!(j.decode_count, 131, "frames 60..=190");
    assert!(!j.slow);
}

#[test]
fn a_huge_gop_is_flagged_slow() {
    let idx = index_of(3000, 2000); // only frame 0 and 2000 are keyframes
    let j = plan(&idx, &cache_of([]), 1500, &cfg(30, 90, 0.5))
        .unwrap()
        .job
        .unwrap();
    assert_eq!(j.keyframe, 0);
    assert_eq!((j.first, j.last), (1470, 1590));
    assert_eq!(j.decode_count, 1591);
    assert!(j.slow, "1470 frames from the keyframe");
}

#[test]
fn slow_is_exactly_beyond_max_gop_frames() {
    let idx = index_of(3000, 2000);
    let mut c = cfg(0, 0, 0.5);
    c.window_ahead = 1;
    c.max_gop_frames = 1470;
    // run starts at the wanted frame 1470, 1470 frames after the keyframe: not slow at the limit
    let j = plan(&idx, &cache_of([]), 1470, &c).unwrap().job.unwrap();
    assert!(!j.slow);
    c.max_gop_frames = 1469;
    assert!(
        plan(&idx, &cache_of([]), 1470, &c)
            .unwrap()
            .job
            .unwrap()
            .slow
    );
}

#[test]
fn the_window_is_clipped_to_the_video() {
    let idx = index_of(1000, 60);
    let j = plan(&idx, &cache_of([]), 5, &cfg(30, 90, 0.5))
        .unwrap()
        .job
        .unwrap();
    assert_eq!((j.first, j.last, j.keyframe), (0, 95, 0));
    let j = plan(&idx, &cache_of([]), 999, &cfg(30, 90, 0.5))
        .unwrap()
        .job
        .unwrap();
    assert_eq!((j.first, j.last, j.keyframe), (969, 999, 960));
}

#[test]
fn a_frame_beyond_the_end_is_clamped_to_the_last_frame() {
    let idx = index_of(1000, 60);
    let a = plan(&idx, &cache_of([]), 5000, &cfg(30, 90, 0.5)).unwrap();
    let b = plan(&idx, &cache_of([]), 999, &cfg(30, 90, 0.5)).unwrap();
    assert_eq!(a, b);
    let cached = plan(&idx, &cache_of(960..1000), 5000, &cfg(30, 90, 0.5)).unwrap();
    assert!(cached.want_cached, "clamped to 999, which is cached");
}

#[test]
fn a_fully_cached_window_needs_no_job() {
    let idx = index_of(1000, 60);
    let p = plan(&idx, &cache_of(70..=190), 100, &cfg(30, 90, 0.5)).unwrap();
    assert!(p.want_cached);
    assert_eq!(p.job, None);
}

#[test]
fn prefetch_ahead_starts_only_below_the_fraction_of_the_window() {
    let idx = index_of(1000, 60);
    let c = cache_of(70..=190);
    // want 150: 40 cached ahead of a 90 window: 40 < 45
    let j = plan(&idx, &c, 150, &cfg(30, 90, 0.5)).unwrap().job.unwrap();
    assert_eq!((j.first, j.last), (191, 240));
    assert_eq!((j.keyframe, j.decode_count), (180, 61));
    // want 145: exactly 45 cached ahead: not below 45, so no prefetch
    assert_eq!(plan(&idx, &c, 145, &cfg(30, 90, 0.5)).unwrap().job, None);
}

#[test]
fn prefetch_behind_starts_below_the_fraction_of_the_back_window() {
    let idx = index_of(1000, 60);
    let c = cache_of(100..=190);
    // want 105, back window 30: only 5 cached behind (< 15); ahead is fine (85 of 90 with threshold 45)
    let j = plan(&idx, &c, 105, &cfg(30, 90, 0.5)).unwrap().job.unwrap();
    assert_eq!((j.first, j.last), (75, 99));
    assert_eq!((j.keyframe, j.decode_count), (60, 40));
}

#[test]
fn ahead_wins_when_both_sides_want_a_prefetch() {
    let idx = index_of(1000, 60);
    let j = plan(&idx, &cache_of([100]), 100, &cfg(30, 90, 0.5))
        .unwrap()
        .job
        .unwrap();
    assert_eq!((j.first, j.last), (101, 190));
}

#[test]
fn prefetch_fraction_zero_never_prefetches_and_one_always_does() {
    let idx = index_of(1000, 60);
    assert_eq!(
        plan(&idx, &cache_of([100]), 100, &cfg(30, 90, 0.0))
            .unwrap()
            .job,
        None
    );
    // the window minus its very last frame: only fraction 1.0 notices
    let j = plan(&idx, &cache_of(70..=189), 100, &cfg(30, 90, 1.0))
        .unwrap()
        .job
        .unwrap();
    assert_eq!((j.first, j.last), (190, 190));
    // 89 cached ahead is not below 0.98 * 90 = 88.2
    assert_eq!(
        plan(&idx, &cache_of(70..=189), 100, &cfg(30, 90, 0.98))
            .unwrap()
            .job,
        None
    );
}

#[test]
fn a_missing_wanted_frame_decodes_only_the_hole_around_it() {
    let idx = index_of(1000, 60);
    let c = cache_of((90..=110).filter(|&f| f != 100));
    let p = plan(&idx, &c, 100, &cfg(30, 90, 0.5)).unwrap();
    assert!(!p.want_cached);
    let j = p.job.unwrap();
    assert_eq!((j.first, j.last), (100, 100));
    assert_eq!(
        (j.keyframe, j.decode_count),
        (60, 41),
        "a single frame still costs the whole run from the keyframe"
    );
}

#[test]
fn a_missing_wanted_frame_decodes_the_run_up_to_the_window_edge() {
    let idx = index_of(1000, 60);
    let j = plan(&idx, &cache_of(0..100), 100, &cfg(30, 90, 0.5))
        .unwrap()
        .job
        .unwrap();
    assert_eq!((j.first, j.last), (100, 190));
}

#[test]
fn every_frame_a_keyframe_decodes_exactly_the_run() {
    let idx = index_of(500, 1);
    let j = plan(&idx, &cache_of([]), 200, &cfg(10, 20, 0.5))
        .unwrap()
        .job
        .unwrap();
    assert_eq!(
        (j.keyframe, j.first, j.last, j.decode_count),
        (190, 190, 220, 31)
    );
}

#[test]
fn without_any_keyframe_decoding_starts_at_frame_zero() {
    let idx = index_of(500, 0);
    let j = plan(&idx, &cache_of([]), 300, &cfg(10, 20, 0.5))
        .unwrap()
        .job
        .unwrap();
    assert_eq!(j.keyframe, 0);
    assert_eq!(j.seek_pts, idx.frames[0].pts);
    assert_eq!(j.decode_count, 321);
}

#[test]
fn a_late_first_keyframe_also_falls_back_to_frame_zero() {
    // keys at 60, 120...: frame 0 is not one
    let pk: Vec<Packet> = (0..200)
        .map(|i| Packet {
            pts: Some(i as f64 / 60.0),
            dts: None,
            key: i >= 60 && i % 60 == 0,
        })
        .collect();
    let idx = build_index(&pk, &IndexConfig::default()).unwrap();
    let j = plan(&idx, &cache_of([]), 30, &cfg(10, 20, 0.5))
        .unwrap()
        .job
        .unwrap();
    assert_eq!(j.keyframe, 0);
}

#[test]
fn a_one_frame_video_plans_that_frame() {
    let idx = index_of(1, 1);
    let j = plan(&idx, &cache_of([]), 0, &cfg(30, 90, 0.5))
        .unwrap()
        .job
        .unwrap();
    assert_eq!((j.keyframe, j.first, j.last, j.decode_count), (0, 0, 0, 1));
    assert_eq!(
        plan(&idx, &cache_of([0]), 0, &cfg(30, 90, 0.5))
            .unwrap()
            .job,
        None
    );
}

#[test]
fn zero_sized_windows_still_plan_the_wanted_frame() {
    let idx = index_of(1000, 60);
    let c = DecodeConfig {
        window_back: 0,
        window_ahead: 0,
        ..DecodeConfig::default()
    };
    let j = plan(&idx, &cache_of([]), 100, &c).unwrap().job.unwrap();
    assert_eq!((j.first, j.last), (100, 100));
    assert_eq!(plan(&idx, &cache_of([100]), 100, &c).unwrap().job, None);
}

#[test]
fn the_seek_time_comes_from_the_index_not_from_the_frame_rate() {
    // non-uniform timestamps (a variable frame rate recording)
    let pk: Vec<Packet> = (0..100)
        .map(|i| Packet {
            pts: Some(i as f64 * 0.02 + if i >= 50 { 1.0 } else { 0.0 }),
            dts: None,
            key: i % 25 == 0,
        })
        .collect();
    let idx = build_index(&pk, &IndexConfig::default()).unwrap();
    let j = plan(&idx, &cache_of([]), 60, &cfg(5, 5, 0.5))
        .unwrap()
        .job
        .unwrap();
    assert_eq!(j.keyframe, 50);
    assert_eq!(j.seek_pts, 50.0 * 0.02 + 1.0);
}

// ------------------------------------------------------- set_capacity

#[test]
fn shrinking_the_capacity_evicts_the_oldest_frames_first() {
    let mut c = FrameCache::new(100);
    for f in 1..=5u32 {
        c.insert(f, 10);
    }
    assert_eq!(c.set_capacity(30), vec![1, 2]);
    assert_eq!(c.frames(), vec![3, 4, 5]);
    assert_eq!((c.used_bytes(), c.capacity_bytes()), (30, 30));
}

#[test]
fn growing_or_equal_capacity_evicts_nothing_and_one_frame_is_always_kept() {
    let mut c = FrameCache::new(30);
    c.insert(1, 10);
    c.insert(2, 10);
    assert!(c.set_capacity(1000).is_empty());
    assert_eq!(c.capacity_bytes(), 1000);
    assert_eq!(
        c.set_capacity(0),
        vec![1],
        "never empties the cache completely"
    );
    assert_eq!(c.frames(), vec![2]);
}
