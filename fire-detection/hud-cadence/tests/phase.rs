//! Test plan. The counter changes once per wall-clock second. In a 60 fps video the change frames should all
//! be congruent modulo 60 (±1 frame of capture jitter). Ways this can break: equal consecutive values give no
//! change at a boundary (missing sample, must not count as a jump); a one-frame drift from a dropped capture
//! frame must be reported as drift, not a cut; a cut removes a non-integer number of seconds and shows as a
//! sudden phase jump; wrap-around at 59→0 must be measured as a 1-frame difference, not 59; a cut of exactly
//! N seconds is invisible (documented limitation, tested as "no jump").
use hud_cadence::phase::{analyse, Event, Kind, Period};

fn changes(frames: &[u32]) -> Vec<u32> {
    frames.to_vec()
}

#[test]
fn constant_phase_with_missing_boundaries_reports_no_events() {
    // boundaries at 17, 77, 137, (197 missing: same value twice), 257, 317
    let r = analyse(&changes(&[17, 77, 137, 257, 317]), Period::Frames(60));
    assert_eq!(r.phase, 17);
    assert!(r.events.is_empty(), "{:?}", r.events);
    assert_eq!(r.missing, 1);
}

#[test]
fn one_frame_jitter_is_tolerated_and_wraps_correctly() {
    let r = analyse(&changes(&[59, 120, 179, 240, 299]), Period::Frames(60));
    assert!(r.events.is_empty(), "{:?}", r.events);
    assert!(r.phase == 59 || r.phase == 0, "{}", r.phase);
}

#[test]
fn a_persistent_one_frame_shift_is_drift_and_a_large_shift_is_a_jump() {
    // +1 frame from 300 on (dropped capture frame), then a 23-frame jump at 600
    let r = analyse(&changes(&[10, 70, 130, 190, 250, 311, 371, 431, 491, 551, 634, 694, 754]), Period::Frames(60));
    let kinds: Vec<_> = r.events.iter().map(|e| (e.kind.clone(), e.frame)).collect();
    assert_eq!(kinds, vec![(hud_cadence::phase::Kind::Drift, 311), (hud_cadence::phase::Kind::Jump, 634)]);
    let j: &Event = &r.events[1];
    assert_eq!(j.shift, 23);
}

#[test]
fn a_cut_of_whole_seconds_is_invisible() {
    // 120 frames (2 s) removed between 190 and the next boundary: still congruent
    let r = analyse(&changes(&[10, 70, 130, 190, 250 - 120 + 120, 310, 370]), Period::Frames(60));
    assert!(r.events.is_empty());
}

#[test]
fn fewer_than_three_boundaries_is_not_analysed() {
    let r = analyse(&changes(&[10, 70]), Period::Frames(60));
    assert!(r.events.is_empty());
    assert_eq!(r.samples, 2);
}

// Change-frame extraction from per-frame readings. Ways this breaks: a one-frame misread (occluded digit reads
// "14" for "146") must not produce a change; unreadable frames (None) must be skipped, not treated as a value;
// a value that genuinely persists only briefly at the end of the window is still a change if it lasts min_run.
use hud_cadence::phase::change_frames;

fn vals(spec: &[(Option<&str>, usize)]) -> Vec<Option<String>> {
    spec.iter().flat_map(|(v, n)| std::iter::repeat(v.map(str::to_string)).take(*n)).collect()
}

#[test]
fn a_change_counts_only_when_the_new_value_persists() {
    let v = vals(&[(Some("146"), 60), (Some("14"), 1), (Some("146"), 59), (Some("150"), 60), (Some("151"), 5)]);
    assert_eq!(change_frames(&v, 20), vec![120]);
    assert_eq!(change_frames(&v, 5), vec![120, 180]);
}

#[test]
fn unreadable_frames_are_skipped_and_an_isolated_jump_back_is_not_two_changes() {
    let v = vals(&[(Some("9"), 30), (None, 10), (Some("9"), 20), (Some("10"), 40)]);
    assert_eq!(change_frames(&v, 20), vec![60]);
}

#[test]
fn a_single_outlier_phase_sample_is_not_a_jump() {
    // one mis-timed change at 220 (phase 40) between a steady run at phase 10
    let r = analyse(&[10, 70, 130, 190, 220, 310, 370, 430], Period::Frames(60));
    assert!(r.events.is_empty(), "{:?}", r.events);
    assert_eq!(r.outliers, 1);
}

#[test]
fn a_confirmed_two_frame_shift_is_still_drift_not_a_cut() {
    // jitter plus one dropped frame can read as +2 against the reference; it is capture drift, reported as such
    let r = analyse(&[10, 70, 130, 192, 252, 312], Period::Frames(60));
    assert_eq!(r.events.len(), 1);
    assert_eq!((r.events[0].kind.clone(), r.events[0].shift), (Kind::Drift, 2));
}

#[test]
fn the_reference_phase_comes_from_the_first_two_agreeing_samples_not_a_lone_first_one() {
    // the first boundary rendered late (recording started mid-stall); the run is really at phase 13
    let r = analyse(&[50, 73, 133, 193, 253, 313], Period::Frames(60));
    assert_eq!(r.phase, 13);
    assert!(r.events.is_empty(), "{:?}", r.events);
    assert_eq!(r.outliers, 1);
}

#[test]
fn a_transition_to_a_prefix_or_suffix_of_the_previous_value_is_a_covered_digit_not_a_change() {
    // a boss bar sits over the last digit for a while: 804 -> 80 -> 804; and over the first: 365 -> 65 -> 365
    let v = vals(&[(Some("804"), 60), (Some("80"), 40), (Some("804"), 20), (Some("365"), 60), (Some("65"), 30), (Some("365"), 30), (Some("371"), 60)]);
    assert_eq!(change_frames(&v, 20), vec![120, 240]);
}
