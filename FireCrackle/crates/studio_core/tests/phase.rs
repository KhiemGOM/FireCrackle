//! Phase tests, no sync strip. Ground truth comes from a tiny simulation of the game written out from
//! docs/PHASE-EVIDENCE.md (E1 step per tick, E2 row per sheet, E4/E7 executed ticks N(T) = floor(rate * T)),
//! never from the code under test.

use studio_core::label::Label;
use studio_core::phase::*;

// ------------------------------------------------------ the simulated game

/// The game as the evidence describes it.
#[derive(Clone, Copy)]
struct Game {
    /// Executed ticks per second of video time.
    rate: f64,
    /// Constant offset between video time and game time, seconds.
    offset: f64,
    /// Animation step at game time 0.
    s0: i64,
}

impl Game {
    /// Animation step visible at video time `t` (E1, E7).
    fn step_at(&self, t: f64) -> i64 {
        (self.s0 + (self.rate * (t + self.offset)).floor() as i64).rem_euclid(32)
    }
}

/// Animation index is shared by both sheets.
fn row_of(_sheet: u8, s: i64) -> u8 {
    s.rem_euclid(32) as u8
}

fn fire(frame: u32, pts: f64, sheet: u8, row: u8) -> FrameObs {
    FrameObs {
        frame,
        pts,
        label: Label::Fire {
            sheet,
            row,
            mirrored: false,
        },
    }
}

const G: Game = Game {
    rate: 20.0,
    offset: 0.37,
    s0: 9,
};

/// `n` frames at `fps`, every frame labelled from the game on `sheet`.
fn video(n: u32, fps: f64, sheet: u8, g: Game) -> Vec<FrameObs> {
    (0..n)
        .map(|i| {
            let t = i as f64 / fps;
            fire(i, t, sheet, row_of(sheet, g.step_at(t)))
        })
        .collect()
}

fn run(o: &[FrameObs]) -> Analysis {
    analyze(o, &Config::default()).unwrap()
}

fn flags_of(a: &Analysis) -> Vec<(u32, FlagKind, Severity)> {
    a.flags
        .iter()
        .map(|f| (f.frame, f.kind, f.severity))
        .collect()
}

/// Shortest distance between two phases on the 32-tick circle.
fn circ(a: f64, b: f64) -> f64 {
    let d = (a - b).rem_euclid(32.0);
    d.min(32.0 - d)
}

fn set_row(o: &mut FrameObs, f: impl Fn(u8) -> u8) {
    if let Label::Fire { row, .. } = &mut o.label {
        *row = f(*row);
    }
}

// ------------------------------------------------------- step / rows (E2)

#[test]
fn simultaneous_sheets_share_the_same_animation_index() {
    for index in 0..32u8 {
        assert!(pair_consistent(index, index));
        assert!(!pair_consistent(index, (index + 1) % 32));
    }
}
#[test]
fn predict_row_advances_with_ticks_and_wraps() {
    assert_eq!(predict_row(5, 0), 5);
    assert_eq!(predict_row(5, 1), 6);
    assert_eq!(predict_row(31, 1), 0);
    assert_eq!(predict_row(30, 2), 0);
    assert_eq!(predict_row(5, 32), 5);
    assert_eq!(predict_row(0, 10), 10);
    assert_eq!(
        predict_row(31, u32::MAX),
        30,
        "no overflow: 31 + (2^32 - 1) mod 32"
    );
}

// ------------------------------------------------------------ the phase

#[test]
fn point_phase_is_rate_times_pts_minus_step_mod_32() {
    // At 1.0 s, 20 ticks minus animation index 4 gives phase 16 on either sheet.
    // Animation index 16 gives phase 4. At 0.5 s, index 12 gives phase 30.
    let o = vec![
        fire(0, 0.5, 1, 12),
        fire(1, 1.0, 1, 4),
        fire(2, 1.0, 0, 4),
        fire(3, 1.0, 0, 16),
    ];
    let a = run(&o);
    let got: Vec<(u8, f64)> = a.points.iter().map(|p| (p.step, p.phase)).collect();
    assert_eq!(got, vec![(12, 30.0), (4, 16.0), (4, 16.0), (16, 4.0)]);
    assert_eq!((a.points[0].frame, a.points[0].pts), (0, 0.5));
}

#[test]
fn the_phase_follows_the_configured_tick_rate() {
    let o = vec![fire(0, 1.0, 1, 4)];
    let cfg = Config {
        tick_rate: 10.0,
        ..Config::default()
    };
    assert_eq!(
        analyze(&o, &cfg).unwrap().points[0].phase,
        6.0,
        "10 ticks - step 4"
    );
}

// ---------------------------------------------- clean footage: no flags

#[test]
fn a_clean_60fps_video_has_no_flags_and_one_narrow_run() {
    let o = video(600, 60.0, 1, G); // 10 s = 200 ticks, several 31 -> 0 wraps
    let a = run(&o);
    assert!(a.flags.is_empty(), "{:?}", a.flags);
    assert_eq!(a.runs.len(), 1);
    let r = a.runs[0];
    assert_eq!((r.first_frame, r.last_frame, r.points), (0, 599, 600));
    assert!(
        r.width < 1.0 + 1e-9,
        "floor noise is at most one tick, got {}",
        r.width
    );
    // phi = frac - rate*offset - s0 = [..) around -7.4 - 9 = -16.4 = 15.6 mod 32
    assert!(circ(r.center, 15.6 + 0.5) < 0.6, "center {}", r.center);
    assert_eq!(a.points.len(), 600);
}

#[test]
fn clean_footage_is_clean_at_every_frame_rate_and_on_both_sheets() {
    for fps in [24.0, 25.0, 30.0, 59.94, 60.0, 120.0, 144.0] {
        for sheet in [0u8, 1] {
            let a = run(&video((fps * 12.0) as u32, fps, sheet, G));
            assert!(
                a.flags.is_empty(),
                "fps {fps} sheet {sheet}: {:?}",
                &a.flags[..a.flags.len().min(3)]
            );
            assert_eq!(a.runs.len(), 1, "fps {fps} sheet {sheet}");
        }
    }
}

#[test]
fn a_phase_straddling_the_0_32_wrap_is_still_one_run() {
    // offset 0.03 s * 20 = 0.6 ticks, s0 = 0: phi in [31.4, 32.4), across the wrap point
    let g = Game {
        rate: 20.0,
        offset: 0.03,
        s0: 0,
    };
    let a = run(&video(600, 60.0, 1, g));
    assert!(a.flags.is_empty(), "{:?}", a.flags);
    assert_eq!(a.runs.len(), 1);
    assert!(a.runs[0].width < 1.0 + 1e-9);
    assert!(
        circ(a.runs[0].center, 31.9) < 0.6,
        "center {}",
        a.runs[0].center
    );
    assert!(
        a.points.iter().any(|p| p.phase > 31.0) && a.points.iter().any(|p| p.phase < 1.0),
        "really straddles"
    );
}

#[test]
fn sparse_labelling_every_seventh_frame_is_clean() {
    let o: Vec<FrameObs> = video(1200, 60.0, 1, G)
        .into_iter()
        .filter(|f| f.frame % 7 == 0)
        .collect();
    assert!(run(&o).flags.is_empty());
}

#[test]
fn mixing_sheets_between_frames_is_fine_when_the_step_agrees() {
    let o: Vec<FrameObs> = (0..600u32)
        .map(|i| {
            let t = i as f64 / 60.0;
            let sheet = (i % 2) as u8;
            fire(i, t, sheet, row_of(sheet, G.step_at(t)))
        })
        .collect();
    assert!(run(&o).flags.is_empty());
}

#[test]
fn mirrored_flag_does_not_affect_the_phase() {
    let mut o = video(300, 60.0, 1, G);
    for (i, f) in o.iter_mut().enumerate() {
        if let Label::Fire { mirrored, .. } = &mut f.label {
            *mirrored = i % 2 == 0;
        }
    }
    assert!(run(&o).flags.is_empty());
}

#[test]
fn timestamp_jitter_inside_the_window_is_not_flagged() {
    // each frame time is off by up to 0.4 frame (alternating): +-0.13 tick extra spread at 60 fps
    let o: Vec<FrameObs> = (0..900u32)
        .map(|i| {
            let ideal = i as f64 / 60.0;
            let t = ideal + if i % 2 == 0 { -0.4 } else { 0.4 } / 60.0;
            fire(i, t, 1, row_of(1, G.step_at(ideal))) // the game ran on the ideal time
        })
        .collect();
    let a = run(&o);
    assert!(a.flags.is_empty(), "{:?}", a.flags);
}

#[test]
fn non_fire_labels_are_ignored_even_with_bad_pts() {
    let mut o = video(120, 60.0, 1, G);
    o.push(FrameObs {
        frame: 500,
        pts: f64::NAN,
        label: Label::NoFire,
    });
    o.push(FrameObs {
        frame: 501,
        pts: -5.0,
        label: Label::Skip,
    });
    o.push(FrameObs {
        frame: 502,
        pts: 0.0,
        label: Label::Unset,
    });
    let a = run(&o);
    assert!(a.flags.is_empty());
    assert_eq!(a.points.len(), 120);
}

#[test]
fn equal_pts_from_a_duplicated_video_frame_are_allowed() {
    let mut o = video(200, 60.0, 1, G);
    let dup = o[50].pts;
    o[51] = fire(51, dup, 1, row_of(1, G.step_at(dup))); // same video time as frame 50
    assert!(run(&o).flags.is_empty());
}

#[test]
fn empty_and_single_observations_do_not_panic() {
    let a = run(&[]);
    assert!(a.points.is_empty() && a.flags.is_empty() && a.runs.is_empty());
    let b = run(&video(1, 60.0, 1, G));
    assert_eq!((b.points.len(), b.runs.len()), (1, 1));
    assert!(b.flags.is_empty());
}

// ------------------------------------------------------ labelling errors

#[test]
fn one_label_off_by_5_rows_is_a_soft_outlier_on_that_frame_only() {
    let mut o = video(600, 60.0, 1, G);
    set_row(&mut o[300], |r| (r + 5) % 32);
    let a = run(&o);
    assert_eq!(
        flags_of(&a),
        vec![(300, FlagKind::PhaseOutlier, Severity::Soft)]
    );
    assert!(
        (a.flags[0].phase_delta + 5.0).abs() < 1.0,
        "delta {}",
        a.flags[0].phase_delta
    );
}

#[test]
fn changing_sheet_preserves_the_animation_phase() {
    // Changing appearance does not change the animation index.
    let mut o = video(600, 60.0, 1, G);
    if let Label::Fire { sheet, .. } = &mut o[200].label {
        *sheet = 0;
    }
    let a = run(&o);
    assert!(a.flags.is_empty());
}

#[test]
fn a_label_off_by_16_rows_is_a_hard_outlier() {
    let mut o = video(600, 60.0, 1, G);
    set_row(&mut o[111], |r| (r + 16) % 32);
    assert_eq!(
        flags_of(&run(&o)),
        vec![(111, FlagKind::PhaseOutlier, Severity::Hard)]
    );
}

#[test]
fn two_wrong_frames_in_a_row_are_both_outliers() {
    let mut o = video(600, 60.0, 1, G);
    set_row(&mut o[300], |r| (r + 7) % 32);
    set_row(&mut o[301], |r| (r + 7) % 32);
    let f = flags_of(&run(&o));
    assert_eq!(
        f,
        vec![
            (300, FlagKind::PhaseOutlier, Severity::Soft),
            (301, FlagKind::PhaseOutlier, Severity::Soft)
        ]
    );
}

// ------------------------------------------------ runs, shifts, outliers

/// fps 20 = exactly one tick per frame, so the phase of frame `i` is a clean constant per run:
/// `lens[j]` frames each, all labelled with `extra[j]` ticks added to the step.
fn runs_of(lens: &[u32], extra: &[i64]) -> Vec<FrameObs> {
    let g = Game {
        rate: 20.0,
        offset: 0.0,
        s0: 3,
    };
    let mut o = Vec::new();
    let mut f = 0u32;
    for (&n, &e) in lens.iter().zip(extra) {
        for _ in 0..n {
            let t = f as f64 / 20.0;
            o.push(fire(f, t, 1, row_of(1, g.step_at(t) + e)));
            f += 1;
        }
    }
    o
}

#[test]
fn a_persistent_phase_change_is_one_soft_shift_with_its_delta() {
    // e.g. a resource reload (E5): the step jumps by 7 ticks at frame 300
    let mut o = video(600, 60.0, 1, G);
    for f in o.iter_mut().skip(300) {
        set_row(f, |r| (r + 7) % 32);
    }
    let a = run(&o);
    assert_eq!(
        flags_of(&a),
        vec![(300, FlagKind::PhaseShift, Severity::Soft)]
    );
    assert!(
        (a.flags[0].phase_delta + 7.0).abs() < 1.0,
        "step +7 means phase -7, got {}",
        a.flags[0].phase_delta
    );
    assert_eq!(a.runs.len(), 2);
}

#[test]
fn the_shift_delta_is_signed_and_wraps_into_minus_16_to_16() {
    let mut o = video(600, 60.0, 1, G);
    for f in o.iter_mut().skip(300) {
        set_row(f, |r| (r + 20) % 32); // phase -20 == +12
    }
    let a = run(&o);
    assert_eq!(a.flags.len(), 1);
    assert!(
        (a.flags[0].phase_delta - 12.0).abs() < 1.0,
        "{}",
        a.flags[0].phase_delta
    );
    assert!(a.flags[0].phase_delta > -16.0 && a.flags[0].phase_delta <= 16.0);
}

#[test]
fn shift_at_the_end_or_start_with_a_short_run_is_soft_not_an_outlier() {
    assert_eq!(
        flags_of(&run(&runs_of(&[10, 2], &[0, 8]))),
        vec![(10, FlagKind::PhaseShift, Severity::Soft)]
    );
    assert_eq!(
        flags_of(&run(&runs_of(&[2, 10], &[8, 0]))),
        vec![(2, FlagKind::PhaseShift, Severity::Soft)]
    );
}

#[test]
fn a_short_run_between_compatible_phases_is_an_outlier_below_min_run() {
    let a = run(&runs_of(&[10, 2, 10], &[0, 8, 0]));
    assert_eq!(
        flags_of(&a),
        vec![
            (10, FlagKind::PhaseOutlier, Severity::Soft),
            (11, FlagKind::PhaseOutlier, Severity::Soft)
        ]
    );
}

#[test]
fn a_run_of_exactly_min_run_that_returns_is_one_excursion_not_an_outlier() {
    // (spec change: it used to be two shifts; a level that comes back is now reported once, see excursions below)
    let a = run(&runs_of(&[10, 3, 10], &[0, 8, 0]));
    assert_eq!(
        flags_of(&a),
        vec![(10, FlagKind::PhaseExcursion, Severity::Soft)]
    );
    assert_eq!(a.flags[0].end_frame, 12);
    assert!((a.flags[0].phase_delta + 8.0).abs() < 1.0);
}

#[test]
fn a_short_run_between_different_phases_is_two_shifts() {
    let a = run(&runs_of(&[10, 2, 10], &[0, 8, 16]));
    assert_eq!(
        flags_of(&a),
        vec![
            (10, FlagKind::PhaseShift, Severity::Soft),
            (12, FlagKind::PhaseShift, Severity::Soft)
        ]
    );
}

#[test]
fn outliers_further_than_max_lag_are_hard() {
    let a = run(&runs_of(&[10, 2, 10], &[0, 12, 0]));
    assert!(
        a.flags
            .iter()
            .all(|f| f.kind == FlagKind::PhaseOutlier && f.severity == Severity::Hard),
        "{:?}",
        a.flags
    );
    assert_eq!(a.flags.len(), 2);
}

#[test]
fn a_lag_stall_is_flagged_but_never_hard() {
    // the sprite freezes for 12 frames (0.2 s = 4 ticks behind), then catches up: E7 "lag shorter than the cap"
    let mut o = video(600, 60.0, 1, G);
    let frozen = o[200].label;
    for f in o.iter_mut().take(212).skip(200) {
        f.label = frozen;
    }
    let a = run(&o);
    assert!(!a.flags.is_empty(), "a 4 tick excursion must be visible");
    assert!(
        a.flags.iter().all(|f| f.severity == Severity::Soft),
        "{:?}",
        a.flags
    );
}

#[test]
fn flags_come_out_sorted_by_frame() {
    let mut o = video(900, 60.0, 1, G);
    set_row(&mut o[100], |r| (r + 5) % 32);
    for f in o.iter_mut().skip(600) {
        set_row(f, |r| (r + 9) % 32);
    }
    set_row(&mut o[300], |r| (r + 16) % 32);
    let frames: Vec<u32> = run(&o).flags.iter().map(|f| f.frame).collect();
    assert_eq!(frames, vec![100, 300, 600]);
}

// ------------------------------------------------------------- config

#[test]
fn defaults_match_the_documented_thresholds() {
    let c = Config::default();
    assert_eq!(c.min_run, 3);
    assert_eq!(c.tick_rate, 20.0);
    assert_eq!(c.window_ticks, 2.0);
    assert_eq!(c.max_lag_ticks, 10.0);
    assert_eq!(c.min_shift_ticks, 1.0);
    assert_eq!(c.max_excursion_seconds, 30.0);
}

#[test]
fn min_run_is_configurable() {
    let o = runs_of(&[10, 4, 10], &[0, 8, 0]);
    let strict = analyze(
        &o,
        &Config {
            min_run: 5,
            ..Config::default()
        },
    )
    .unwrap();
    assert_eq!(strict.flags.len(), 4);
    assert!(strict
        .flags
        .iter()
        .all(|f| f.kind == FlagKind::PhaseOutlier));
    let lax = analyze(
        &o,
        &Config {
            min_run: 2,
            ..Config::default()
        },
    )
    .unwrap();
    assert!(!lax.flags.is_empty());
    assert!(
        lax.flags.iter().all(|f| f.kind == FlagKind::PhaseExcursion),
        "{:?}",
        lax.flags
    );
}

#[test]
fn max_lag_ticks_is_configurable() {
    let o = runs_of(&[10, 2, 10], &[0, 5, 0]);
    assert!(run(&o).flags.iter().all(|f| f.severity == Severity::Soft));
    let cfg = Config {
        max_lag_ticks: 3.0,
        ..Config::default()
    };
    assert!(analyze(&o, &cfg)
        .unwrap()
        .flags
        .iter()
        .all(|f| f.severity == Severity::Hard));
}

#[test]
fn tick_rate_is_configurable_for_footage_not_at_real_time() {
    // the game ran at 20 tps but the video is slowed to half speed: 10 ticks per video second
    let g = Game {
        rate: 10.0,
        offset: 0.2,
        s0: 4,
    };
    let o = video(720, 60.0, 1, g);
    assert!(
        !run(&o).flags.is_empty(),
        "with the default 20 the phase drifts and is flagged"
    );
    let cfg = Config {
        tick_rate: 10.0,
        ..Config::default()
    };
    let a = analyze(&o, &cfg).unwrap();
    assert!(a.flags.is_empty(), "{:?}", a.flags);
    assert_eq!(a.runs.len(), 1);
}

#[test]
fn window_ticks_is_configurable() {
    // at 24 fps a frame is 0.83 tick, so the floor noise covers most of a tick, and 0.4 frame of alternating
    // timestamp jitter (+-0.33 tick) widens the phase spread to ~1.5 ticks: inside 2, outside 1.1.
    // (At 60 fps the phase only takes 3 discrete values per tick, so the same jitter spreads less.)
    let o: Vec<FrameObs> = (0..720u32)
        .map(|i| {
            let ideal = i as f64 / 24.0;
            let t = ideal + if i % 2 == 0 { -0.4 } else { 0.4 } / 24.0;
            fire(i, t, 1, row_of(1, G.step_at(ideal)))
        })
        .collect();
    assert!(run(&o).flags.is_empty());
    // (min_shift 0 so that only the window decides: with the default noise floor of 1 tick these small
    // boundaries are deliberately not flagged)
    let tight = Config {
        window_ticks: 1.1,
        min_shift_ticks: 0.0,
        ..Config::default()
    };
    assert!(!analyze(&o, &tight).unwrap().flags.is_empty());
}

#[test]
fn config_is_serialisable_with_defaults_for_missing_fields() {
    let c = Config {
        min_run: 4,
        tick_rate: 19.5,
        window_ticks: 3.0,
        max_lag_ticks: 8.0,
        min_shift_ticks: 0.5,
        max_excursion_seconds: 12.0,
    };
    let json = serde_json::to_string(&c).unwrap();
    assert_eq!(serde_json::from_str::<Config>(&json).unwrap(), c);
    assert_eq!(
        serde_json::from_str::<Config>("{}").unwrap(),
        Config::default()
    );
    assert_eq!(
        serde_json::from_str::<Config>(r#"{"min_run":9}"#)
            .unwrap()
            .tick_rate,
        20.0
    );
}

// --------------------------------------------------------------- errors

#[test]
fn frames_must_be_strictly_increasing() {
    let mut o = video(5, 60.0, 1, G);
    o[3].frame = 2;
    assert_eq!(
        analyze(&o, &Config::default()),
        Err(PhaseError::FramesNotIncreasing { frame: 2 })
    );
    let mut o2 = video(5, 60.0, 1, G);
    o2.swap(1, 2);
    assert!(matches!(
        analyze(&o2, &Config::default()),
        Err(PhaseError::FramesNotIncreasing { .. })
    ));
}

#[test]
fn bad_timestamps_are_errors_not_panics() {
    let mut o = video(5, 60.0, 1, G);
    o[2].pts = f64::NAN;
    assert_eq!(
        analyze(&o, &Config::default()),
        Err(PhaseError::InvalidPts { frame: 2 })
    );
    let mut o = video(5, 60.0, 1, G);
    o[1].pts = f64::INFINITY;
    assert_eq!(
        analyze(&o, &Config::default()),
        Err(PhaseError::InvalidPts { frame: 1 })
    );
    let mut o = video(5, 60.0, 1, G);
    o[3].pts = o[2].pts - 0.5;
    assert_eq!(
        analyze(&o, &Config::default()),
        Err(PhaseError::PtsDecreasing { frame: 3 })
    );
}

#[test]
fn invalid_fire_labels_are_errors() {
    let o = vec![fire(4, 1.0, 2, 0)];
    assert_eq!(
        analyze(&o, &Config::default()),
        Err(PhaseError::InvalidLabel { frame: 4 })
    );
    let o = vec![fire(4, 1.0, 0, 32)];
    assert_eq!(
        analyze(&o, &Config::default()),
        Err(PhaseError::InvalidLabel { frame: 4 })
    );
}

#[test]
fn a_big_labelling_session_is_analysed_quickly() {
    // 200k labelled frames (an hour of fire at 60 fps is ~216k)
    let a = run(&video(200_000, 60.0, 1, G));
    assert!(a.flags.is_empty());
    assert_eq!(a.points.len(), 200_000);
}
