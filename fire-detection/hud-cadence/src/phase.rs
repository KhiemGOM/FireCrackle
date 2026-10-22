//! The counter updates on a fixed wall-clock grid (`nextDebugInfoUpdateTime += 1000` in MinecraftClient), so in a
//! constant-rate recording its change frames stay congruent modulo one second of frames.

#[derive(Clone, Copy, Debug)]
pub enum Period {
    Frames(u32),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    /// The phase moved by one or two frames and stayed there (dropped or duplicated capture frames).
    Drift,
    /// The phase moved by three frames or more: the video does not run continuously across this boundary.
    Jump,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Event {
    pub kind: Kind,
    /// Change frame at which the new phase was first seen.
    pub frame: u32,
    /// Signed phase shift in frames, in (-period/2, period/2].
    pub shift: i32,
}

#[derive(Clone, Debug)]
pub struct Analysis {
    pub samples: usize,
    /// Phase of the first run (frame index mod period).
    pub phase: u32,
    /// Boundaries with no visible change (same value two seconds running), estimated from gaps.
    pub missing: usize,
    /// Single samples off the run that the next sample did not confirm (a mis-timed read, not a shift).
    pub outliers: usize,
    pub events: Vec<Event>,
}

/// Frames at which the displayed value changed to a value that then persists for `min_run` readable frames.
/// Unreadable frames (`None`) are skipped. A brief misread that returns to the previous value is not a change.
pub fn change_frames(values: &[Option<String>], min_run: usize) -> Vec<u32> {
    let readable: Vec<(usize, &String)> = values.iter().enumerate().filter_map(|(i, v)| v.as_ref().map(|v| (i, v))).collect();
    let mut out = Vec::new();
    let mut current: Option<&String> = None;
    let mut k = 0;
    while k < readable.len() {
        let (frame, v) = readable[k];
        // Same value, or a value that is a prefix/suffix of it ("804" read as "80" while something covers a digit):
        // the counter did not change, a digit was hidden.
        if current.is_some_and(|c| c == v || (c.len() != v.len() && (c.starts_with(v.as_str()) || c.ends_with(v.as_str()) || v.starts_with(c.as_str()) || v.ends_with(c.as_str())))) {
            k += 1;
            continue;
        }
        let run = readable[k..].iter().take_while(|(_, w)| *w == v).count();
        if current.is_none() {
            current = Some(v);
        } else if run >= min_run {
            out.push(frame as u32);
            current = Some(v);
        }
        k += run.max(1);
    }
    out
}

fn wrapped(delta: i64, period: i64) -> i32 {
    let d = delta.rem_euclid(period);
    (if d > period / 2 { d - period } else { d }) as i32
}

/// `changes`: sorted frame indices at which the displayed value changed.
pub fn analyse(changes: &[u32], period: Period) -> Analysis {
    let Period::Frames(p) = period;
    let p64 = p as i64;
    let mut out = Analysis { samples: changes.len(), phase: changes.first().map_or(0, |f| f % p), missing: 0, outliers: 0, events: Vec::new() };
    if changes.len() < 3 {
        return out;
    }
    // Missing boundaries: a gap of k periods (±1 frame) hides k-1 changes.
    for w in changes.windows(2) {
        let gap = (w[1] as i64 - w[0] as i64 + p64 / 2) / p64;
        if gap > 1 {
            out.missing += (gap - 1) as usize;
        }
    }
    // The reference phase follows the run. A single ±1 sample is capture jitter; the same ±1 on two consecutive
    // samples is a one-frame drift (a dropped or duplicated capture frame) and moves the reference.
    // Start from the first two consecutive samples that agree within a frame; a lone first sample (a boundary
    // rendered late while the recording started) is an outlier, not the phase.
    let start = changes.windows(2).position(|w| wrapped(w[1] as i64 - w[0] as i64, p64).abs() <= 1).unwrap_or(0);
    out.outliers += start;
    out.phase = changes[start] % p;
    let mut reference = changes[start] as i64 % p64;
    let mut pending: Option<(i32, u32)> = None; // (sign, first frame seen at reference+sign)
    for (k, &f) in changes.iter().enumerate().skip(start + 1) {
        let shift = wrapped(f as i64 - reference, p64);
        match shift {
            0 => pending = None,
            1 | -1 => match pending {
                Some((sign, first)) if sign == shift => {
                    out.events.push(Event { kind: Kind::Drift, frame: first, shift });
                    reference = (reference + shift as i64).rem_euclid(p64);
                    pending = None;
                }
                _ => pending = Some((shift, f)),
            },
            _ => {
                // A shift is real only if the next sample sits at the new phase (within one frame); otherwise it
                // is one bad sample.
                let confirmed = changes.get(k + 1).is_some_and(|&n| wrapped(n as i64 - f as i64, p64).abs() <= 1);
                if confirmed {
                    let kind = if shift.abs() <= 2 { Kind::Drift } else { Kind::Jump };
                    out.events.push(Event { kind, frame: f, shift });
                    reference = f as i64 % p64;
                } else {
                    out.outliers += 1;
                }
                pending = None;
            }
        }
    }
    out
}
