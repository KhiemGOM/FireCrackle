//! The one-shot report: everything odd about the FPS counter's cadence in a video, ranked by how much the
//! displayed value changed at that boundary, so each item can be checked by other means (FireCrackle, eye).

use crate::phase::{analyse, change_frames, Kind as PhaseKind, Period};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    /// The 1-second phase moved by three frames or more and stayed there: the video is not continuous here.
    Jump,
    /// Phase moved by one or two frames and stayed: recorder drift, or a cut within two frames of a whole second.
    Drift,
    /// The displayed value changed by an unusually large amount at an ordinary boundary (no phase change).
    Value,
    /// The overlay was unreadable for a while: the phase cannot be followed across it.
    Gap,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finding {
    pub kind: Kind,
    /// Video frame (change frame, or first unreadable frame for a gap).
    pub frame: u32,
    /// Phase shift in frames (Jump/Drift), else 0.
    pub shift: i32,
    /// Readings just before and at the change frame.
    pub before: Option<String>,
    pub after: Option<String>,
    /// |after − before| as integers, 0 when either is missing.
    pub delta: u32,
    /// Gap length in frames (Gap), else 0.
    pub length: u32,
    /// One reading is a proper suffix of the other ("48" vs "948"): most likely a digit was covered, not a swing.
    pub partial: bool,
}

/// Splits sorted change frames into runs wherever two consecutive changes are more than `max_gap` frames apart.
pub fn runs_split_at_gaps(changes: &[u32], max_gap: u32) -> Vec<Vec<u32>> {
    let mut runs: Vec<Vec<u32>> = Vec::new();
    for &c in changes {
        match runs.last_mut() {
            Some(run) if c - *run.last().unwrap() <= max_gap => run.push(c),
            _ => runs.push(vec![c]),
        }
    }
    runs
}

fn reading_before(values: &[Option<String>], frame: usize) -> Option<String> {
    values[..frame].iter().rev().find_map(|v| v.clone())
}

/// `values`: per-frame readings (None = unreadable). `fps`: frames per second. `max_gap`: longest distance between
/// consecutive changes that still counts as one continuous run. `min_run`: frames a new value must persist.
/// Returns findings sorted by |ΔFPS| descending, then by frame.
pub fn findings(values: &[Option<String>], fps: u32, max_gap: u32, min_run: usize) -> Vec<Finding> {
    let changes = change_frames(values, min_run);
    let mut out = Vec::new();
    // Gaps: unreadable stretches longer than a second.
    let mut start: Option<usize> = None;
    for i in 0..=values.len() {
        let unreadable = i < values.len() && values[i].is_none();
        match (unreadable, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                if i - s > fps as usize {
                    out.push(Finding { kind: Kind::Gap, frame: s as u32, shift: 0, before: None, after: None, delta: 0, length: (i - s) as u32, partial: false });
                }
                start = None;
            }
            _ => {}
        }
    }
    let describe = |frame: u32| {
        let before = reading_before(values, frame as usize);
        let after = values[frame as usize].clone();
        let delta = match (&before, &after) {
            (Some(b), Some(a)) => (a.parse::<i64>().unwrap_or(0) - b.parse::<i64>().unwrap_or(0)).unsigned_abs() as u32,
            _ => 0,
        };
        let partial = match (&before, &after) {
            (Some(b), Some(a)) => b != a && (a.ends_with(b.as_str()) || b.ends_with(a.as_str())),
            _ => false,
        };
        (before, after, delta, partial)
    };
    // Value swings: the largest 1 % of |Δ| at ordinary boundaries, so a hidden whole-second cut that joined very
    // different scenes still surfaces, ranked with everything else.
    let mut deltas: Vec<(u32, u32)> = changes.iter().map(|&c| (describe(c).2, c)).collect();
    deltas.sort_unstable_by(|a, b| b.cmp(a));
    let value_cutoff = deltas.get(deltas.len() / 100).map_or(u32::MAX, |d| d.0.max(1));
    for run in runs_split_at_gaps(&changes, max_gap) {
        let analysis = analyse(&run, Period::Frames(fps));
        for e in &analysis.events {
            let (before, after, delta, partial) = describe(e.frame);
            let kind = if e.kind == PhaseKind::Jump { Kind::Jump } else { Kind::Drift };
            out.push(Finding { kind, frame: e.frame, shift: e.shift, before, after, delta, length: 0, partial });
        }
    }
    for &(delta, frame) in &deltas {
        if delta >= value_cutoff && deltas.len() >= 100 && !out.iter().any(|f| f.frame == frame) {
            let (before, after, delta, partial) = describe(frame);
            out.push(Finding { kind: Kind::Value, frame, shift: 0, before, after, delta, length: 0, partial });
        }
    }
    // The test fixtures are short: with fewer than 100 boundaries, still surface the single largest swing.
    if deltas.len() < 100 {
        if let Some(&(delta, frame)) = deltas.first() {
            if delta > 0 && !out.iter().any(|f| f.frame == frame) {
                let (before, after, delta, partial) = describe(frame);
                out.push(Finding { kind: Kind::Value, frame, shift: 0, before, after, delta, length: 0, partial });
            }
        }
    }
    out.sort_by(|a, b| b.delta.cmp(&a.delta).then(a.frame.cmp(&b.frame)));
    out
}
