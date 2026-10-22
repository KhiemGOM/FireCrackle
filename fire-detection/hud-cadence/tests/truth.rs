//! Test plan. A recording with the strip gives, per video frame, the renderer frame ID (or None when the strip
//! was unreadable). From that and the mod's per-frame log we need: how the recorder sampled the game (each video
//! frame = one new renderer frame, a duplicate, or a skip of k renderer frames); the TRUE video frame of every FPS
//! change (first video frame whose ID is at or after the renderer frame where the value changed); and the game's own
//! phase (nanoTime of the change mod 1 s). Ways this breaks: an unreadable strip frame must not count as a dup or a
//! skip; IDs that go backwards (a torn frame mis-decoded) must be flagged, not folded into the stats; a change whose
//! renderer frame never made it to video (skipped) still maps to the next captured frame; a change before the first
//! captured frame or after the last is dropped, not mapped to the edge.
use hud_cadence::truth::{align, expected_changes, LogRow};

#[test]
fn alignment_counts_new_duplicate_and_skipped_frames_and_ignores_unreadable_ones() {
    // (first) new  dup  skip2 unread new  back: three new transitions, the first frame has no predecessor
    let ids = [Some(10), Some(11), Some(11), Some(14), None, Some(15), Some(9)];
    let a = align(&ids);
    assert_eq!((a.readable, a.new, a.duplicates, a.skipped_renderer_frames, a.backwards), (6, 3, 1, 2, 1));
}

#[test]
fn expected_change_frames_map_to_the_first_captured_frame_at_or_after_the_change() {
    let rows = vec![
        LogRow { frame: 100, nanos: 1_000_000_000, fps: 60, changed: true },
        LogRow { frame: 101, nanos: 1_016_000_000, fps: 60, changed: false },
        LogRow { frame: 160, nanos: 2_000_000_000, fps: 61, changed: true }, // skipped by the recorder
        LogRow { frame: 230, nanos: 3_000_000_000, fps: 61, changed: false },
        LogRow { frame: 231, nanos: 3_016_000_000, fps: 62, changed: true },
        LogRow { frame: 400, nanos: 6_000_000_000, fps: 63, changed: true }, // after the last captured frame
    ];
    let ids = [Some(99), Some(100), Some(101), None, Some(159), Some(161), Some(230), Some(231), Some(232)];
    let e = expected_changes(&rows, &ids);
    assert_eq!(e.iter().map(|c| (c.video_frame, c.renderer_frame)).collect::<Vec<_>>(), vec![(1, 100), (5, 160), (7, 231)]);
    assert_eq!(e[1].nanos, 2_000_000_000);
}

#[test]
fn a_change_before_the_first_captured_frame_is_dropped() {
    let rows = vec![LogRow { frame: 5, nanos: 0, fps: 1, changed: true }, LogRow { frame: 50, nanos: 1, fps: 2, changed: true }];
    let ids = [Some(40), Some(41), Some(50)];
    let e = expected_changes(&rows, &ids);
    assert_eq!(e.iter().map(|c| c.renderer_frame).collect::<Vec<_>>(), vec![50]);
}

#[test]
fn a_change_inside_a_strip_gap_is_not_mapped_to_the_frame_after_the_gap() {
    // ids unreadable for several frames (a toast covered the strip); the change at renderer frame 120 happened
    // somewhere inside the gap, so its video frame is unknown and must be dropped rather than guessed as 7.
    let rows = vec![LogRow { frame: 120, nanos: 0, fps: 1, changed: true }, LogRow { frame: 200, nanos: 0, fps: 2, changed: true }];
    let ids = [Some(100), Some(101), None, None, None, None, None, Some(160), Some(199), Some(201)];
    let e = expected_changes(&rows, &ids);
    assert_eq!(e.iter().map(|c| (c.renderer_frame, c.video_frame)).collect::<Vec<_>>(), vec![(200, 9)]);
}
