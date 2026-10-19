//! Phase analysis without any sync strip. Every rule is derived in `PHASE-EVIDENCE.md` (E1-E5, E7):
//!
//! - the animation index advances once per client tick (E1, E3), equally for both sheets;
//! - executed ticks follow wall-clock time, `N(T) = floor(20 * T)`, so with the video timestamp `t` the
//!   estimated phase `phi = (tick_rate * t - s) mod 32` fits in an arc of about one tick (plus timestamp
//!   jitter) for as long as nothing resets the sprites (E7);
//! - capture holds can exceed 10 ticks; the vanilla cap is per game render, not video sample (E9).
//!
//! Policy: flag everything suspicious, excuse nothing. The user compares each flag with the footage.

use crate::label::Label;
use serde::{Deserialize, Serialize};

/// Number of animation steps (both sheets are 32 frames); also the circumference of the phase circle.
pub const STEPS: u8 = 32;

/// Simultaneous sheets must have the same animation index.
pub fn pair_consistent(row0: u8, row1: u8) -> bool {
    row0 % STEPS == row1 % STEPS
}

/// Row expected `tick_delta` ticks after `row` (same sheet; both sheets advance by the same step).
pub fn predict_row(row: u8, tick_delta: u32) -> u8 {
    ((row as u64 + tick_delta as u64) % STEPS as u64) as u8
}

/// One labelled frame as the analysis sees it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameObs {
    pub frame: u32,
    /// Presentation time of the frame in seconds (from the frame index).
    pub pts: f64,
    pub label: Label,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// A run of frames with one phase that is shorter than this, between two runs of a compatible phase,
    /// is an outlier; any other persistent phase change is a shift (soft).
    pub min_run: usize,
    /// Game ticks per second of video time (20 for real-time footage). A wrong value shows as steady drift.
    pub tick_rate: f64,
    /// Width in ticks of the arc all phases of one run must fit in: 1 tick of floor noise plus timestamp
    /// jitter room.
    pub window_ticks: f64,
    /// Historical key for the hard discrepancy threshold. It is a review priority, not a lag cap.
    pub max_lag_ticks: f64,
    /// A change of level smaller than this many ticks is inside the normal timing noise (real captures show
    /// 90% of frames within 0.7 tick of their local level) and is not flagged.
    pub min_shift_ticks: f64,
    /// A change of level that comes back to the old level within this many video seconds is a transient
    /// excursion (a lag stall), reported once; one that stays is a shift (a cut, a reload).
    pub max_excursion_seconds: f64,
}

impl Default for Config {
    fn default() -> Config {
        Config {
            min_run: 3,
            tick_rate: 20.0,
            window_ticks: 2.0,
            max_lag_ticks: 10.0,
            min_shift_ticks: 1.0,
            max_excursion_seconds: 30.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// Large discrepancy worth inspecting; lag or capture holds may cause it. No cause is proved.
    Hard,
    /// Possible (lag, reload, leaving the world, a cut, drift) but suspicious: confirm by eye.
    Soft,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FlagKind {
    /// Simultaneous normal/soul readings disagree on their shared vanilla animation row.
    FireConflict,
    /// A short run whose phase differs from compatible phase on both sides.
    PhaseOutlier,
    /// The phase changes and stays changed (a cut, a resource reload, leaving the world, a lag drop).
    PhaseShift,
    /// The phase leaves its level and comes back within `max_excursion_seconds` (a lag stall).
    PhaseExcursion,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub struct Flag {
    /// First frame of what is flagged.
    pub frame: u32,
    /// Last frame of what is flagged (== `frame` for a shift or a single outlier frame; for an excursion the
    /// last frame before the phase returns).
    pub end_frame: u32,
    pub kind: FlagKind,
    pub severity: Severity,
    /// Signed phase change in ticks, in (-16, 16]: the run's phase minus the phase it is compared with
    /// (the neighbouring runs for an outlier, the previous level for a shift; for an excursion the largest
    /// departure from the level it returns to).
    pub phase_delta: f64,
}

/// One chart point.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub struct Point {
    pub frame: u32,
    pub pts: f64,
    pub step: u8,
    /// `(tick_rate * pts - step) mod 32`, in [0, 32).
    pub phase: f64,
}

/// A stretch of frames whose phases fit one arc.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub struct Run {
    pub first_frame: u32,
    pub last_frame: u32,
    pub points: usize,
    /// Middle of the arc, in [0, 32).
    pub center: f64,
    /// Width of the arc in ticks.
    pub width: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Analysis {
    pub points: Vec<Point>,
    pub flags: Vec<Flag>,
    pub runs: Vec<Run>,
    pub reference_phase: Option<f64>,
    pub flag_details: Vec<crate::phase_v2::FlagDetail>,
    pub clock_residuals: Vec<crate::phase_compare::ClockResidual>,
    pub lag_intervals: Vec<crate::phase_v2::LagInterval>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PhaseError {
    /// `obs` must be in strictly increasing frame order.
    FramesNotIncreasing { frame: u32 },
    /// A fire label with sheet >= 2 or row >= 32.
    InvalidLabel { frame: u32 },
    /// A fire frame whose pts is NaN or infinite.
    InvalidPts { frame: u32 },
    /// Fire frames must have non-decreasing pts.
    PtsDecreasing { frame: u32 },
}

/// Floating-point slack when comparing arc widths against the window.
const EPS: f64 = 1e-9;
const CIRCLE: f64 = STEPS as f64;

/// Signed shortest offset from `reference` to `phase` on the circle, in [-16, 16).
fn offset(phase: f64, reference: f64) -> f64 {
    (phase - reference + CIRCLE / 2.0).rem_euclid(CIRCLE) - CIRCLE / 2.0
}

/// Like `offset` but in (-16, 16], the range reported to the user.
fn signed_delta(to: f64, from: f64) -> f64 {
    let d = offset(to, from);
    if d == -CIRCLE / 2.0 {
        CIRCLE / 2.0
    } else {
        d
    }
}

/// A run while it is being built: its phases relative to the first one (`reference`), as an arc [min, max].
#[derive(Clone, Copy)]
struct Arc {
    first: usize, // index into the points
    last: usize,
    reference: f64,
    min: f64,
    max: f64,
}

impl Arc {
    fn start(i: usize, phase: f64) -> Arc {
        Arc {
            first: i,
            last: i,
            reference: phase,
            min: 0.0,
            max: 0.0,
        }
    }

    fn center(&self) -> f64 {
        (self.reference + (self.min + self.max) / 2.0).rem_euclid(CIRCLE)
    }

    fn len(&self) -> usize {
        self.last - self.first + 1
    }

    /// Can the two arcs together still fit in `window` ticks?
    fn compatible(&self, other: &Arc, window: f64) -> bool {
        let d = offset(other.reference, self.reference);
        let lo = self.min.min(d + other.min);
        let hi = self.max.max(d + other.max);
        hi - lo <= window + EPS
    }
}

/// Analyse labelled frames. Non-fire labels are ignored.
///
/// Each fire frame gets `phi = (tick_rate * pts - step) mod 32`. Within a steady stretch all `phi` fit in an arc
/// of `window_ticks` (E7), so frames are grouped greedily into runs whose arc stays within the window. A short
/// run between two compatible runs is an outlier, any other change of arc is a shift.
pub fn analyze(obs: &[FrameObs], cfg: &Config) -> Result<Analysis, PhaseError> {
    // validity of everything the caller gave us
    let mut prev_frame: Option<u32> = None;
    let mut prev_pts: Option<f64> = None;
    for o in obs {
        if prev_frame.is_some_and(|p| o.frame <= p) {
            return Err(PhaseError::FramesNotIncreasing { frame: o.frame });
        }
        prev_frame = Some(o.frame);
        if let Label::Fire { sheet, row, .. } = o.label {
            if sheet >= 2 || row >= STEPS {
                return Err(PhaseError::InvalidLabel { frame: o.frame });
            }
            if !o.pts.is_finite() {
                return Err(PhaseError::InvalidPts { frame: o.frame });
            }
            if prev_pts.is_some_and(|p| o.pts < p) {
                return Err(PhaseError::PtsDecreasing { frame: o.frame });
            }
            prev_pts = Some(o.pts);
        }
    }

    let points: Vec<Point> = obs
        .iter()
        .filter_map(|o| match o.label {
            Label::Fire { row, .. } => {
                let s = row;
                let mut phase = (cfg.tick_rate * o.pts - s as f64).rem_euclid(CIRCLE);
                if phase >= CIRCLE {
                    phase -= CIRCLE; // rem_euclid can round a tiny negative up to exactly 32
                }
                Some(Point {
                    frame: o.frame,
                    pts: o.pts,
                    step: s,
                    phase,
                })
            }
            _ => None,
        })
        .collect();

    // greedy arcs
    let mut arcs: Vec<Arc> = Vec::new();
    for (i, p) in points.iter().enumerate() {
        if let Some(cur) = arcs.last_mut() {
            let off = offset(p.phase, cur.reference);
            let (lo, hi) = (cur.min.min(off), cur.max.max(off));
            if hi - lo <= cfg.window_ticks + EPS {
                cur.min = lo;
                cur.max = hi;
                cur.last = i;
                continue;
            }
        }
        arcs.push(Arc::start(i, p.phase));
    }

    let outlier: Vec<bool> = (0..arcs.len())
        .map(|k| {
            k > 0
                && k + 1 < arcs.len()
                && arcs[k].len() < cfg.min_run
                && arcs[k - 1].compatible(&arcs[k + 1], cfg.window_ticks)
        })
        .collect();

    // two runs are the same level when they fit one window together, or their centres differ by less than the
    // noise floor
    let same_level = |a: &Arc, b: &Arc| {
        a.compatible(b, cfg.window_ticks)
            || signed_delta(b.center(), a.center()).abs() < cfg.min_shift_ticks
    };
    let severity_of = |delta: f64| {
        if delta.abs() > cfg.max_lag_ticks {
            Severity::Hard
        } else {
            Severity::Soft
        }
    };

    let mut flags: Vec<Flag> = Vec::new();
    let mut base: Option<usize> = None; // the run that defines the current level
    let mut k = 0;
    while k < arcs.len() {
        let arc = &arcs[k];
        if outlier[k] {
            let b = base.expect("the first run is never an outlier");
            let delta = signed_delta(arc.center(), arcs[b].center());
            if delta.abs() >= cfg.min_shift_ticks {
                for p in &points[arc.first..=arc.last] {
                    flags.push(Flag {
                        frame: p.frame,
                        end_frame: p.frame,
                        kind: FlagKind::PhaseOutlier,
                        severity: severity_of(delta),
                        phase_delta: delta,
                    });
                }
            }
            k += 1;
            continue;
        }
        let Some(b) = base else {
            base = Some(k);
            k += 1;
            continue;
        };
        if same_level(&arcs[b], arc) {
            base = Some(k);
            k += 1;
            continue;
        }

        // a different level: does it come back to the old one soon (an excursion) or stay (a shift)?
        let departed_at = points[arc.first].pts;
        let mut peak = signed_delta(arc.center(), arcs[b].center());
        let mut returned: Option<usize> = None;
        for m in k + 1..arcs.len() {
            if points[arcs[m].first].pts - departed_at > cfg.max_excursion_seconds {
                break;
            }
            if outlier[m] {
                continue;
            }
            if same_level(&arcs[b], &arcs[m]) {
                returned = Some(m);
                break;
            }
            let d = signed_delta(arcs[m].center(), arcs[b].center());
            if d.abs() > peak.abs() {
                peak = d;
            }
        }
        match returned {
            Some(m) => {
                flags.push(Flag {
                    frame: points[arc.first].frame,
                    end_frame: points[arcs[m - 1].last].frame,
                    kind: FlagKind::PhaseExcursion,
                    severity: severity_of(peak),
                    phase_delta: peak,
                });
                base = Some(m);
                k = m + 1;
            }
            None => {
                flags.push(Flag {
                    frame: points[arc.first].frame,
                    end_frame: points[arc.first].frame,
                    kind: FlagKind::PhaseShift,
                    severity: Severity::Soft,
                    phase_delta: signed_delta(arc.center(), arcs[b].center()),
                });
                base = Some(k);
                k += 1;
            }
        }
    }
    flags.sort_by_key(|f| f.frame);

    let runs = arcs
        .iter()
        .map(|a| Run {
            first_frame: points[a.first].frame,
            last_frame: points[a.last].frame,
            points: a.len(),
            center: a.center(),
            width: a.max - a.min,
        })
        .collect();
    Ok(Analysis {
        points,
        flags,
        runs,
        reference_phase: None,
        flag_details: vec![],
        clock_residuals: vec![],
        lag_intervals: vec![],
    })
}
