//! Cadence pairs inside JoltCracker's breaks. Jolt brackets a removal to a window of a few seconds; every pair of
//! consecutive FPS changes overlapping that window is listed with its spacing and its deviation from one second, so
//! the short (or long) pair that holds the cut stands out next to its exact neighbours. Ways this breaks: a pair that
//! straddles the bracket edge must still count as inside; a bracket without readings must not claim agreement;
//! the cadence only sees a removal modulo one second, so the comparison with Jolt is modulo the frame rate; an
//! unchanged value for a second (spacing 120) is not a cut; a pair
//! across an unreadable stretch (> 3 s) is shown but not counted; a break without frame positions falls back to seconds.
use hud_cadence::jolt::{breaks, window, wrap, AGREE_FRAMES};

fn changes(frames: &[u32]) -> Vec<(u32, String)> {
    frames.iter().enumerate().map(|(k, &f)| (f, (100 + k).to_string())).collect()
}

#[test]
fn breaks_are_read_from_frame_positions_and_fall_back_to_seconds() {
    let j = serde_json::json!({"fps": 58.8235, "breaks": [
        {"from": 1021.167, "to": 1023.483, "kind": "removed", "jump_seconds": 0.284,
         "frame_positions": [{"number": 61270}, {"number": 61409}]},
        {"from": 10.0, "to": 12.5, "kind": "inserted"}
    ]});
    let b = breaks(&j, 60);
    assert_eq!(b.len(), 2);
    assert_eq!((b[0].kind.as_str(), b[0].from, b[0].to, b[0].jump_seconds), ("removed", 61270, 61409, Some(0.284)));
    assert_eq!((b[1].kind.as_str(), b[1].from, b[1].to, b[1].jump_seconds), ("inserted", 600, 750, None));
    assert!(breaks(&serde_json::json!({}), 60).is_empty());
}

#[test]
fn deviation_wraps_to_within_half_a_second() {
    assert_eq!(wrap(60, 60), 0);
    assert_eq!(wrap(120, 60), 0); // value unchanged for one second: no change frame, still on the grid
    assert_eq!(wrap(41, 60), -19);
    assert_eq!(wrap(63, 60), 3);
    assert_eq!(wrap(89, 60), 29);
    assert_eq!(wrap(90, 60), 30); // half a second is +30, the same convention as the phase analysis
    assert_eq!(wrap(91, 60), -29);
    assert_eq!(wrap(-46, 60), 14);
}

#[test]
fn the_short_pair_inside_the_bracket_is_listed_with_its_exact_neighbours_and_agrees_with_jolt() {
    // phase 10, a 19-frame removal between 61330 and 61371 (spacing 41), then phase 51
    let c = changes(&[61150, 61210, 61270, 61330, 61371, 61431, 61491, 61551]);
    let b = &breaks(&serde_json::json!({"breaks": [{"kind": "removed", "jump_seconds": 0.284,
        "frame_positions": [{"number": 61280}, {"number": 61409}]}]}), 60)[0];
    let w = window(&c, b, 60);
    let rows: Vec<(u32, u32, u32, i32, bool)> = w.pairs.iter().map(|p| (p.from, p.to, p.spacing, p.deviation, p.inside)).collect();
    assert_eq!(rows, vec![
        (61210, 61270, 60, 0, false),  // context before
        (61270, 61330, 60, 0, true),   // straddles the bracket start (61280): inside
        (61330, 61371, 41, -19, true), // the cut
        (61371, 61431, 60, 0, true),   // straddles the bracket end (61409): inside
        (61431, 61491, 60, 0, false),  // context after
    ]);
    assert_eq!((w.pairs[2].before.as_str(), w.pairs[2].after.as_str()), ("103", "104"));
    assert_eq!(w.cadence_missing, Some(19));
    assert_eq!(w.jolt_missing, Some(17));
    assert_eq!(w.agree, Some(true));
}

#[test]
fn a_bracket_without_readings_has_no_cadence_answer() {
    let c = changes(&[100, 160, 220, 5000, 5060]);
    let b = &breaks(&serde_json::json!({"breaks": [{"kind": "removed", "jump_seconds": 0.25,
        "frame_positions": [{"number": 1000}, {"number": 1200}]}]}), 60)[0];
    let w = window(&c, b, 60);
    // the one pair spanning the whole hole (220 -> 5000) overlaps and is listed, but a pair longer than three seconds
    // crosses an unreadable stretch (recorder drift unknown, same rule as the jump finder), so it is not counted
    let inside: Vec<_> = w.pairs.iter().filter(|p| p.inside).collect();
    assert_eq!(inside.len(), 1);
    assert_eq!((inside[0].from, inside[0].to, inside[0].long), (220, 5000, true));
    assert_eq!((w.cadence_missing, w.agree), (None, None));
    let empty = window(&[], b, 60);
    assert!(empty.pairs.is_empty());
    assert_eq!((empty.cadence_missing, empty.jolt_missing, empty.agree), (None, Some(15), None));
}

#[test]
fn agreement_is_modulo_one_second_and_within_the_error_bar() {
    let c = changes(&[0, 60, 120, 173, 233, 293]); // spacing 53: 7 frames missing (or 67, 127, ...)
    let at = |jump: f64| {
        let j = serde_json::json!({"breaks": [{"kind": "removed", "jump_seconds": jump,
            "frame_positions": [{"number": 100}, {"number": 200}]}]});
        window(&c, &breaks(&j, 60)[0], 60)
    };
    assert_eq!(at(7.0 / 60.0).cadence_missing, Some(7));
    assert_eq!(at(7.0 / 60.0).agree, Some(true));
    assert_eq!(at(67.0 / 60.0).agree, Some(true)); // a removal longer than a second
    assert_eq!(at((7 + AGREE_FRAMES) as f64 / 60.0).agree, Some(true));
    assert_eq!(at((8 + AGREE_FRAMES) as f64 / 60.0).agree, Some(false));
    assert_eq!(at(0.5).agree, Some(false));
}

#[test]
fn several_off_pairs_inside_one_bracket_add_up() {
    // -4 then -3 (two micro cuts) and a +1 jitter: net 6 frames missing
    let c = changes(&[0, 60, 116, 173, 234, 294]);
    let j = serde_json::json!({"breaks": [{"kind": "removed", "jump_seconds": 0.1,
        "frame_positions": [{"number": 61}, {"number": 233}]}]});
    let w = window(&c, &breaks(&j, 60)[0], 60);
    let inside: Vec<i32> = w.pairs.iter().filter(|p| p.inside).map(|p| p.deviation).collect();
    assert_eq!(inside, vec![-4, -3, 1]);
    assert_eq!(w.cadence_missing, Some(6));
    assert_eq!(w.agree, Some(true));
}

#[test]
fn the_cadence_count_is_shown_as_the_whole_second_equivalent_nearest_jolts() {
    // Revival cut 2: the inside pairs sum to +13 (44 then 29 frames), i.e. 13 added or 47 missing; Jolt says 46
    let c = changes(&[171319, 171379, 171439, 171483, 171512, 171572]);
    let j = serde_json::json!({"breaks": [{"kind": "removed", "jump_seconds": 0.767,
        "frame_positions": [{"number": 171397}, {"number": 171498}]}]});
    let w = window(&c, &breaks(&j, 60)[0], 60);
    assert_eq!(w.cadence_missing, Some(-13));
    assert_eq!(w.cadence_nearest_jolt, Some(47));
    assert_eq!(w.agree, Some(true));
    // no Jolt amount: nothing to align to
    let j = serde_json::json!({"breaks": [{"kind": "removed", "frame_positions": [{"number": 171397}, {"number": 171498}]}]});
    assert_eq!(window(&c, &breaks(&j, 60)[0], 60).cadence_nearest_jolt, None);
}
