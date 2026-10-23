//! Cadence pairs inside JoltCracker's breaks. Jolt (hunger/heart-bar ticks) brackets a removal to a window of a few
//! seconds; every pair of consecutive FPS changes overlapping that window is listed with its spacing and deviation
//! from one second, so the short pair holding the cut stands out next to its exact neighbours, and the frames the
//! cadence says are missing can be compared with Jolt's own count.

/// A Jolt break as video frames.
#[derive(Clone, Debug, PartialEq)]
pub struct Break {
    pub kind: String,
    pub from: u32,
    pub to: u32,
    pub jump_seconds: Option<f64>,
}

/// Two consecutive FPS change frames.
#[derive(Clone, Debug, PartialEq)]
pub struct Pair {
    pub from: u32,
    pub to: u32,
    /// Readings at `from` and `to`.
    pub before: String,
    pub after: String,
    pub spacing: u32,
    /// Spacing minus whole seconds, in (−fps/2, fps/2]: negative = frames missing, positive = frames added.
    pub deviation: i32,
    /// Overlaps the Jolt bracket (else one pair of context on either side).
    pub inside: bool,
    /// Longer than `LONG_SECONDS`: crosses an unreadable stretch, recorder drift unknown, not counted.
    pub long: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Window {
    pub brk: Break,
    pub pairs: Vec<Pair>,
    /// Net frames missing per the cadence (−Σ deviation over counted inside pairs); None without such pairs.
    pub cadence_missing: Option<i32>,
    /// `cadence_missing` plus the whole seconds that bring it nearest Jolt's count (the cadence cannot see them).
    pub cadence_nearest_jolt: Option<i32>,
    /// Jolt's `jump_seconds` in frames.
    pub jolt_missing: Option<i32>,
    /// Both counts agree modulo one second within `AGREE_FRAMES`.
    pub agree: Option<bool>,
}

/// Cadence read error (±2 frames) plus Jolt's rounding (±1).
pub const AGREE_FRAMES: i32 = 3;
/// A pair longer than this crosses an unreadable stretch (the jump finder's `max_gap` too).
pub const LONG_SECONDS: u32 = 3;

/// Wraps a frame difference to (−fps/2, fps/2], the convention of the phase analysis.
pub fn wrap(frames: i64, fps: u32) -> i32 {
    let p = fps as i64;
    let d = frames.rem_euclid(p);
    (if d > p / 2 { d - p } else { d }) as i32
}

/// Breaks from a JoltCracker JSON report: `frame_positions[0..2].number`, else `from`/`to` seconds × `fps`.
pub fn breaks(jolt: &serde_json::Value, fps: u32) -> Vec<Break> {
    let Some(list) = jolt["breaks"].as_array() else { return Vec::new() };
    list.iter()
        .map(|b| {
            let pos = |i: usize, key: &str| {
                b["frame_positions"][i]["number"].as_u64().map(|n| n as u32).unwrap_or_else(|| (b[key].as_f64().unwrap_or(0.0) * fps as f64).round() as u32)
            };
            Break { kind: b["kind"].as_str().unwrap_or("?").to_string(), from: pos(0, "from"), to: pos(1, "to"), jump_seconds: b["jump_seconds"].as_f64() }
        })
        .collect()
}

/// `changes`: (change frame, reading at it), sorted.
pub fn window(changes: &[(u32, String)], brk: &Break, fps: u32) -> Window {
    let all: Vec<Pair> = changes
        .windows(2)
        .map(|w| {
            let spacing = w[1].0 - w[0].0;
            Pair {
                from: w[0].0,
                to: w[1].0,
                before: w[0].1.clone(),
                after: w[1].1.clone(),
                spacing,
                deviation: wrap(spacing as i64, fps),
                inside: w[1].0 >= brk.from && w[0].0 <= brk.to,
                long: spacing > LONG_SECONDS * fps,
            }
        })
        .collect();
    let mut pairs = Vec::new();
    if let (Some(first), Some(last)) = (all.iter().position(|p| p.inside), all.iter().rposition(|p| p.inside)) {
        pairs.extend_from_slice(&all[first.saturating_sub(1)..(last + 2).min(all.len())]);
    }
    let counted: Vec<i32> = pairs.iter().filter(|p| p.inside && !p.long).map(|p| p.deviation).collect();
    let cadence_missing = (!counted.is_empty()).then(|| -counted.iter().sum::<i32>());
    let jolt_missing = brk.jump_seconds.map(|s| (s * fps as f64).round() as i32);
    let (cadence_nearest_jolt, agree) = match (cadence_missing, jolt_missing) {
        (Some(c), Some(j)) => {
            let off = wrap((j - c) as i64, fps);
            (Some(j - off), Some(off.abs() <= AGREE_FRAMES))
        }
        _ => (None, None),
    };
    Window { brk: brk.clone(), pairs, cadence_missing, cadence_nearest_jolt, jolt_missing, agree }
}
