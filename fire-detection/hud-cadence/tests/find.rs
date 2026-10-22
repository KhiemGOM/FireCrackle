//! The one-shot `find` report: every cadence jump in a video, ranked by how much the displayed FPS value changed at
//! that boundary. Ways this breaks: the phase reference must not carry across a stretch where the overlay was
//! unreadable for seconds (F3, menus) because drift there is unknown, so runs are analysed separately and the gap
//! itself is listed, not scored; a jump's "before/after" values are the readings on either side of the change frame;
//! ranking is by |ΔFPS| descending with ties by time; a run too short to analyse produces nothing.
use hud_cadence::find::{findings, runs_split_at_gaps, Finding, Kind};

#[test]
fn changes_are_split_into_runs_wherever_consecutive_changes_are_more_than_max_gap_apart() {
    // 60-frame cadence, a 400-frame hole (overlay hidden) between 190 and 590
    let changes = [10, 70, 130, 190, 590, 650, 710];
    assert_eq!(runs_split_at_gaps(&changes, 180), vec![vec![10, 70, 130, 190], vec![590, 650, 710]]);
    assert_eq!(runs_split_at_gaps(&[], 180), Vec::<Vec<u32>>::new());
}

fn values(frames: usize, pairs: &[(usize, &str)]) -> Vec<Option<String>> {
    // readings: value v from frame f onwards
    let mut out = vec![None; frames];
    for (k, &(f, v)) in pairs.iter().enumerate() {
        let end = pairs.get(k + 1).map_or(frames, |p| p.0);
        for i in f..end {
            out[i] = Some(v.to_string());
        }
    }
    out
}

#[test]
fn a_cadence_jump_is_reported_with_the_values_on_both_sides_and_ranked_by_delta() {
    // phase 10 for four seconds, then a cut: next changes land at phase 40; values differ by 5 at the first
    // boundary after the cut and by 120 at a later ordinary boundary (large natural swing, still only a "value" item)
    let v = values(700, &[(0, "100"), (10, "101"), (70, "102"), (130, "103"), (190, "104"), (280, "109"), (340, "110"), (400, "230"), (460, "231"), (520, "232"), (580, "233"), (640, "234")]);
    let f = findings(&v, 60, 180, 20);
    let jumps: Vec<&Finding> = f.iter().filter(|x| x.kind == Kind::Jump).collect();
    assert_eq!(jumps.len(), 1);
    assert_eq!((jumps[0].frame, jumps[0].shift, jumps[0].before.as_deref(), jumps[0].after.as_deref(), jumps[0].delta), (280, 30, Some("104"), Some("109"), 5));
    // ranking: the 120 swing (a Value item) comes before the jump with delta 5
    assert_eq!(f[0].kind, Kind::Value);
    assert_eq!((f[0].frame, f[0].delta), (400, 120));
    assert!(f.iter().position(|x| x.kind == Kind::Jump).unwrap() > 0);
}

#[test]
fn covered_digit_flips_produce_no_finding_and_a_one_digit_reading_against_three_is_partial() {
    // "948" read as "48" while something covers the first digit, then back: not a change at all now
    let v = values(400, &[(0, "948"), (10, "948"), (70, "48"), (130, "948"), (190, "950"), (250, "951"), (310, "952")]);
    let f = findings(&v, 60, 180, 20);
    assert!(f.iter().all(|x| x.delta < 900), "{f:?}");
    // a boss bar leaving a lone digit: "822" -> "4" is not a prefix/suffix pair, but a one-digit reading next to a
    // three-digit one is still a covered read, not a swing of 818
    let v = values(400, &[(0, "822"), (10, "822"), (70, "4"), (130, "830"), (190, "835"), (250, "840"), (310, "845")]);
    let f = findings(&v, 60, 180, 20);
    let big: Vec<&Finding> = f.iter().filter(|x| x.delta >= 800).collect();
    assert!(big.iter().all(|x| x.partial), "{big:?}");
}

#[test]
fn an_unreadable_stretch_is_listed_as_a_gap_and_does_not_create_a_jump() {
    // phase 10, then 400 unreadable frames, then phase 25: the phase difference across the gap is not a jump
    let mut v = values(1000, &[(0, "100"), (10, "101"), (70, "102"), (130, "103"), (190, "104")]);
    for i in 200..600 {
        v[i] = None;
    }
    for (k, f) in [625usize, 685, 745, 805, 865, 925].iter().enumerate() {
        for i in *f..(f + 60).min(1000) {
            v[i] = Some(format!("{}", 200 + k));
        }
    }
    let f = findings(&v, 60, 180, 20);
    assert!(f.iter().all(|x| x.kind != Kind::Jump), "{f:?}");
    let gaps: Vec<&Finding> = f.iter().filter(|x| x.kind == Kind::Gap).collect();
    assert_eq!(gaps.len(), 1);
    assert_eq!((gaps[0].frame, gaps[0].length), (200, 400));
}

// A region where the reading flickers (a HUD element over the digits, a 3/8 confusion at the edge of the template
// margin) produces runs that occasionally pass the persistence filter and look like phase jumps. Findings inside
// such a region must carry `unstable` so they are not read as cuts; a prefix-truncated reading ("367" vs "36") is a
// partial read as much as a suffix one.
#[test]
fn findings_inside_a_flickering_region_are_marked_unstable_and_prefix_truncation_is_partial() {
    let mut v = values(2000, &[(0, "300"), (10, "301"), (70, "302"), (130, "303"), (190, "304"), (250, "305"), (310, "306")]);
    // flicker from 400: alternate 367/36 every 7 frames, with one 25-frame run of "36" that passes min_run
    let mut x = 400;
    while x < 900 {
        for i in x..(x + 7).min(900) { v[i] = Some("367".into()); }
        for i in (x + 7)..(x + 14).min(900) { v[i] = Some("36".into()); }
        x += 14;
    }
    for i in 700..725 { v[i] = Some("36".into()); }
    for i in 725..760 { v[i] = Some("367".into()); }
    for (k, f) in [1000usize, 1060, 1120, 1180, 1240, 1300].iter().enumerate() {
        for i in *f..(f + 60).min(2000) { v[i] = Some(format!("{}", 400 + k)); }
    }
    let f = findings(&v, 60, 180, 20);
    let early: Vec<&Finding> = f.iter().filter(|x| x.frame < 400).collect();
    assert!(early.iter().all(|x| !x.unstable), "clean region must not be marked unstable: {early:?}");
    let flicker: Vec<&Finding> = f.iter().filter(|x| x.frame >= 400 && x.frame < 900 && x.kind != Kind::Gap).collect();
    assert!(!flicker.is_empty(), "the flicker region should produce findings to be flagged");
    assert!(flicker.iter().all(|x| x.unstable), "{flicker:?}");
    assert!(flicker.iter().filter(|x| x.kind == Kind::Value).all(|x| x.partial), "367 vs 36 is a partial read: {flicker:?}");
}
