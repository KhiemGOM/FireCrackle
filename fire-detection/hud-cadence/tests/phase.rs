//! Test plan. The counter changes once per wall-clock second. In a 60 fps video the change frames should all
//! be congruent modulo 60 (±1 frame of capture jitter). Ways this can break: equal consecutive values give no
//! change at a boundary (missing sample, must not count as a jump); a one-frame drift from a dropped capture
//! frame must be reported as drift, not a cut; a cut removes a non-integer number of seconds and shows as a
//! sudden phase jump; wrap-around at 59→0 must be measured as a 1-frame difference, not 59; a cut of exactly
//! N seconds is invisible (documented limitation, tested as "no jump").
use hud_cadence::phase::{analyse, Event, Period};

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
