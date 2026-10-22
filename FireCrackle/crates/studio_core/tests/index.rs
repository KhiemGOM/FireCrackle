use studio_core::config::IndexConfig;
use studio_core::index::*;

fn p(pts: f64, key: bool) -> Packet {
    Packet {
        pts: Some(pts),
        dts: None,
        key,
    }
}

fn build(packets: &[Packet]) -> FrameIndex {
    build_index(packets, &IndexConfig::default()).unwrap()
}

/// First lines of the real recording (1080p60 mkv, B-frames, ms timestamps), decode order.
const REAL: &str = "0.000000,N/A,K__\n0.067000,N/A,___\n0.033000,0.000000,___\n0.017000,0.017000,___\n\
                    0.050000,0.033000,___\n0.133000,0.050000,___\n0.100000,0.067000,___\n0.083000,0.083000,___\n";

// ------------------------------------------------------------ parsing

#[test]
fn parses_the_real_recording_fixture() {
    let pk = parse_packets(REAL).unwrap();
    assert_eq!(pk.len(), 8);
    assert_eq!(
        pk[0],
        Packet {
            pts: Some(0.0),
            dts: None,
            key: true
        }
    );
    assert_eq!(
        pk[1],
        Packet {
            pts: Some(0.067),
            dts: None,
            key: false
        }
    );
    assert_eq!(
        pk[2],
        Packet {
            pts: Some(0.033),
            dts: Some(0.0),
            key: false
        }
    );
    assert!(pk[1..].iter().all(|x| !x.key));
}

#[test]
fn tolerates_crlf_blank_lines_and_trailing_spaces() {
    let text = "0.000000,N/A,K__\r\n\r\n  0.033000,0.000000,___  \r\n\n";
    let pk = parse_packets(text).unwrap();
    assert_eq!(pk.len(), 2);
    assert!(pk[0].key && !pk[1].key);
}

#[test]
fn na_pts_becomes_none_and_negative_pts_parses() {
    let pk = parse_packets("N/A,N/A,___\n-0.033000,-0.066000,K__\n").unwrap();
    assert_eq!(pk[0].pts, None);
    assert_eq!(pk[1].pts, Some(-0.033));
    assert_eq!(pk[1].dts, Some(-0.066));
}

#[test]
fn keyframe_is_any_k_in_the_flags() {
    let pk = parse_packets("0,0,K__\n1,1,_K_\n2,2,KD_\n3,3,___\n4,4,__\n").unwrap();
    assert_eq!(
        pk.iter().map(|x| x.key).collect::<Vec<_>>(),
        vec![true, true, true, false, false]
    );
}

#[test]
fn empty_text_parses_to_no_packets() {
    assert_eq!(parse_packets("").unwrap(), vec![]);
    assert_eq!(parse_packets("\n\r\n").unwrap(), vec![]);
}

#[test]
fn malformed_lines_report_their_line_number() {
    for (text, line) in [
        ("0.0,0.0,K__\ngarbage\n", 2),
        ("0.0,0.0\n", 1),
        ("abc,0.0,K__\n", 1),
        ("0.0,0.0,K__\n\n0.1,xyz,___\n", 3),
        ("0.0,0.0,K__,extra\n", 1),
    ] {
        match parse_packets(text) {
            Err(IndexError::Parse { line: l, .. }) => assert_eq!(l, line, "{text:?}"),
            other => panic!("{text:?}: expected Parse error, got {other:?}"),
        }
    }
}

// ------------------------------------------------------ display order

#[test]
fn b_frame_reordering_is_sorted_into_display_order() {
    let idx = build(&parse_packets(REAL).unwrap());
    let pts: Vec<f64> = idx.frames.iter().map(|f| f.pts).collect();
    assert_eq!(pts, vec![0.0, 0.017, 0.033, 0.05, 0.067, 0.083, 0.1, 0.133]);
    assert_eq!(
        idx.frames.iter().map(|f| f.n).collect::<Vec<_>>(),
        (0..8).collect::<Vec<u32>>()
    );
    assert_eq!(idx.summary.frame_count, 8);
}

#[test]
fn keyframe_flags_follow_their_frame_through_the_sort() {
    // the keyframe is the third packet in decode order but display frame 1
    let idx = build(&[p(0.0, false), p(0.2, false), p(0.1, true)]);
    assert_eq!(
        idx.frames.iter().map(|f| f.key).collect::<Vec<_>>(),
        vec![false, true, false]
    );
}

#[test]
fn equal_pts_keep_decode_order_and_are_counted() {
    let idx = build(&[p(0.0, true), p(0.1, false), p(0.1, true), p(0.2, false)]);
    assert_eq!(idx.summary.duplicate_pts, 1);
    assert_eq!(
        idx.summary.frame_count, 4,
        "both duplicates stay in the index"
    );
    assert!(!idx.frames[1].key);
    assert!(idx.frames[2].key, "stable: decode order breaks the tie");
}

#[test]
fn packets_without_pts_are_left_out_and_counted() {
    let pk = [
        Packet {
            pts: None,
            dts: None,
            key: false,
        },
        p(0.0, true),
        Packet {
            pts: None,
            dts: Some(0.1),
            key: false,
        },
        p(0.1, false),
    ];
    let idx = build(&pk);
    assert_eq!(idx.summary.frame_count, 2);
    assert_eq!(idx.summary.missing_pts, 2);
}

#[test]
fn no_packets_and_no_timestamps_are_errors() {
    assert_eq!(
        build_index(&[], &IndexConfig::default()),
        Err(IndexError::NoPackets)
    );
    let none = [Packet {
        pts: None,
        dts: None,
        key: true,
    }];
    assert_eq!(
        build_index(&none, &IndexConfig::default()),
        Err(IndexError::NoTimestamps)
    );
}

#[test]
fn negative_start_pts_is_fine_and_duration_is_last_minus_first() {
    let idx = build(&[p(-0.05, true), p(0.0, false), p(0.05, false)]);
    assert!((idx.summary.duration - 0.1).abs() < 1e-12);
}

// ------------------------------------------------------------ timing

fn ms_rounded_60fps(n: usize) -> Vec<Packet> {
    (0..n)
        .map(|i| p((i as f64 * 1000.0 / 60.0).round() / 1000.0, i == 0))
        .collect()
}

#[test]
fn ms_rounded_60fps_is_regular_with_a_60_average_fps() {
    let idx = build(&ms_rounded_60fps(600));
    let s = &idx.summary;
    assert_eq!(s.irregular_intervals, 0, "16 vs 17 ms is rounding, not VFR");
    assert!(!s.vfr);
    assert!((s.fps - 60.0).abs() < 0.2, "fps {}", s.fps);
    assert!((s.median_interval - 0.017).abs() < 1e-9 || (s.median_interval - 0.016).abs() < 1e-9);
    assert_eq!(s.duplicate_pts, 0);
}

#[test]
fn alternating_short_and_long_intervals_is_vfr() {
    let mut t = 0.0;
    let pk: Vec<Packet> = (0..200)
        .map(|i| {
            t += if i % 2 == 0 { 0.01 } else { 0.04 };
            p(t, i == 0)
        })
        .collect();
    let s = build(&pk).summary;
    assert!(s.vfr);
    assert!(s.irregular_intervals > 50);
}

#[test]
fn one_dropped_footage_gap_is_irregular_and_visible_but_not_vfr() {
    let mut pk = ms_rounded_60fps(1000);
    for x in pk.iter_mut().skip(500) {
        x.pts = x.pts.map(|v| v + 0.2); // 200 ms hole
    }
    let s = build(&pk).summary;
    assert_eq!(s.irregular_intervals, 1);
    assert!(!s.vfr, "1 irregular interval in 999 is 0.1%");
    assert!((s.max_gap - 0.217).abs() < 0.002, "max_gap {}", s.max_gap);
}

#[test]
fn single_frame_summary_is_all_zero_and_does_not_divide_by_zero() {
    let s = build(&[p(5.0, true)]).summary;
    assert_eq!(s.frame_count, 1);
    assert_eq!(s.duration, 0.0);
    assert_eq!(s.median_interval, 0.0);
    assert_eq!(s.fps, 0.0);
    assert_eq!(s.irregular_intervals, 0);
    assert!(!s.vfr);
    assert_eq!(s.max_gap, 0.0);
}

#[test]
fn two_frames_use_their_single_interval_as_the_median() {
    let s = build(&[p(0.0, true), p(0.05, false)]).summary;
    assert!((s.median_interval - 0.05).abs() < 1e-12);
    assert!((s.fps - 20.0).abs() < 1e-9);
}

#[test]
fn thresholds_come_from_the_config() {
    // ms jitter becomes "irregular" when the deviation limit is tiny
    let pk = ms_rounded_60fps(600);
    let tight = IndexConfig {
        irregular_deviation: 0.01,
        ..IndexConfig::default()
    };
    assert!(build_index(&pk, &tight).unwrap().summary.vfr);
    // a 50% irregular stream is not VFR when the fraction limit is 90%
    let mut t = 0.0;
    let alt: Vec<Packet> = (0..200)
        .map(|i| {
            t += if i % 2 == 0 { 0.01 } else { 0.04 };
            p(t, i == 0)
        })
        .collect();
    let lax = IndexConfig {
        vfr_fraction: 0.9,
        ..IndexConfig::default()
    };
    assert!(!build_index(&alt, &lax).unwrap().summary.vfr);
    assert!(
        build_index(&alt, &lax).unwrap().summary.irregular_intervals > 50,
        "still counted"
    );
}

// ------------------------------------------------------------ lookup

fn ten_fps_with_keys(n: usize, keys: &[usize]) -> FrameIndex {
    let pk: Vec<Packet> = (0..n)
        .map(|i| p(i as f64 / 10.0, keys.contains(&i)))
        .collect();
    build(&pk)
}

#[test]
fn keyframe_at_or_before_finds_the_governing_keyframe() {
    let idx = ten_fps_with_keys(20, &[0, 8, 16]);
    assert_eq!(idx.keyframe_at_or_before(0), Some(0));
    assert_eq!(idx.keyframe_at_or_before(7), Some(0));
    assert_eq!(idx.keyframe_at_or_before(8), Some(8));
    assert_eq!(idx.keyframe_at_or_before(15), Some(8));
    assert_eq!(idx.keyframe_at_or_before(19), Some(16));
    assert_eq!(
        idx.keyframe_at_or_before(1_000_000),
        Some(16),
        "past the end is clamped"
    );
}

#[test]
fn keyframe_lookup_without_a_leading_keyframe() {
    let idx = ten_fps_with_keys(20, &[8]);
    assert_eq!(idx.keyframe_at_or_before(3), None);
    assert_eq!(idx.keyframe_at_or_before(9), Some(8));
    assert_eq!(ten_fps_with_keys(5, &[]).keyframe_at_or_before(2), None);
}

#[test]
fn frame_at_time_is_the_last_frame_not_after_t() {
    let idx = ten_fps_with_keys(10, &[0]);
    assert_eq!(idx.frame_at_time(0.35), Some(3));
    assert_eq!(idx.frame_at_time(4.0 / 10.0), Some(4), "exact hit");
    assert_eq!(idx.frame_at_time(0.0), Some(0));
    assert_eq!(idx.frame_at_time(-1.0), None);
    assert_eq!(idx.frame_at_time(99.0), Some(9));
}

#[test]
fn nearest_frame_picks_the_closest_presentation_time_and_the_earlier_frame_on_a_tie() {
    use studio_core::index::{nearest_frame, FrameEntry};
    let frames: Vec<FrameEntry> = [0.0, 0.1, 0.2, 0.4]
        .iter()
        .enumerate()
        .map(|(n, &pts)| FrameEntry {
            n: n as u32,
            pts,
            key: n == 0,
        })
        .collect();
    assert_eq!(nearest_frame(&frames, 0.1), 1, "exact time");
    assert_eq!(nearest_frame(&frames, 0.12), 1);
    assert_eq!(nearest_frame(&frames, 0.18), 2);
    assert_eq!(
        nearest_frame(&frames, 0.3),
        2,
        "a tie goes to the earlier frame"
    );
    assert_eq!(nearest_frame(&frames, -5.0), 0);
    assert_eq!(nearest_frame(&frames, 99.0), 3);
    assert_eq!(nearest_frame(&[], 1.0), 0);
}
