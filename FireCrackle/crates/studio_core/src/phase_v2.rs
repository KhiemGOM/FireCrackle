//! Combined phase evidence: retain every raw-frame finding, supplement sustained circular changes,
//! and test held-animation recovery against the clock extrapolated THROUGH the hold.
use crate::{
    config::{PhaseResearchConfig, Settings},
    label::Label,
    phase::{self, Analysis, Flag, FlagKind, FrameObs, Run, Severity},
    phase_compare::{self as circular, EventKind, Method},
};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Explanation {
    FireConflict,
    LocalDeparture,
    PersistentMismatch,
    RecoveredDeparture,
    RecoveredHold,
    HoldWithMismatch,
    HoldRecoveryUnknown,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FlagDetail {
    pub frame: u32,
    pub end_frame: u32,
    pub kind: FlagKind,
    pub explanation: Explanation,
    pub clock_delta: f64,
    pub held_ticks: Option<f64>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LagInterval {
    pub first_frame: u32,
    pub last_frame: u32,
    pub elapsed_ticks: f64,
    pub recovered: Option<bool>,
    pub recovery_phase_delta: Option<f64>,
}
fn centre(xs: &[f64]) -> f64 {
    let scale = std::f64::consts::TAU / 32.0;
    let (mut x, mut y) = (0.0, 0.0);
    for p in xs {
        x += (p * scale).cos();
        y += (p * scale).sin();
    }
    (y.atan2(x) / scale).rem_euclid(32.0)
}
fn holds(obs: &[FrameObs], phases: &[f64], s: &Settings) -> Vec<LagInterval> {
    let mut out = Vec::new();
    let c = &s.phase_v2;
    let mut lo = 0;
    while lo < obs.len() {
        let Label::Fire { row, .. } = obs[lo].label else {
            lo += 1;
            continue;
        };
        let step = row;
        let mut hi = lo + 1;
        while hi < obs.len() {
            let Label::Fire { row, .. } = obs[hi].label else {
                break;
            };
            if obs[hi].frame != obs[hi - 1].frame + 1
                || obs[hi].pts - obs[hi - 1].pts > c.held_max_gap_seconds
            {
                break;
            }
            if row != step {
                let mut returned = None;
                for j in hi + 1..(hi.saturating_add(s.phase.min_run)).min(obs.len()) {
                    if obs[j].frame != obs[j - 1].frame + 1
                        || obs[j].pts - obs[j - 1].pts > c.held_max_gap_seconds
                    {
                        break;
                    }
                    if let Label::Fire { row, .. } = obs[j].label {
                        if row == step {
                            returned = Some(j);
                            break;
                        }
                    } else {
                        break;
                    }
                }
                if let Some(j) = returned {
                    hi = j + 1;
                    continue;
                } else {
                    break;
                }
            }
            hi += 1;
        }
        let seconds = obs[hi - 1].pts - obs[lo].pts;
        if seconds >= c.held_seconds {
            let k = c.recovery_samples;
            let recovery_phase_delta = if lo >= k && obs.len() - hi >= k {
                Some(circular::delta(
                    centre(&phases[hi..hi + k]),
                    centre(&phases[lo - k..lo]),
                ))
            } else {
                None
            };
            out.push(LagInterval {
                first_frame: obs[lo].frame,
                last_frame: obs[hi - 1].frame,
                elapsed_ticks: seconds * s.phase.tick_rate,
                recovered: recovery_phase_delta.map(|d| d.abs() <= c.recovery_ticks),
                recovery_phase_delta,
            });
        }
        lo = hi;
    }
    out
}
fn validate(s: &Settings) -> Result<(), String> {
    for info in s.describe() {
        if (info.key.starts_with("phase.") || info.key.starts_with("phase_v2."))
            && (!info.value.is_finite() || info.value < info.min || info.value > info.max)
        {
            return Err(format!("invalid setting {}", info.key));
        }
    }
    Ok(())
}
pub fn analyze(obs: &[FrameObs], s: &Settings) -> Result<Analysis, String> {
    validate(s)?;
    let mut a = phase::analyze(obs, &s.phase).map_err(|e| format!("{e:?}"))?;
    let c = &s.phase_v2;
    let research = PhaseResearchConfig {
        tick_rate: s.phase.tick_rate,
        bin_seconds: c.bin_seconds,
        penalty_ticks2: c.penalty_ticks2,
        min_change_ticks: c.supplement_min_ticks.max(s.phase.min_shift_ticks),
        clock_anchor_bins: c.anchor_bins,
        recovery_ticks: c.recovery_ticks,
        recovery_seconds: s.phase.max_excursion_seconds.max(f64::EPSILON),
        held_seconds: c.held_seconds,
        held_max_gap_seconds: c.held_max_gap_seconds,
        ..Default::default()
    };
    let pelt = circular::compare(obs, Method::Pelt, &research)?;
    a.reference_phase = if a.points.is_empty() {
        None
    } else {
        Some(pelt.reference_phase)
    };
    a.clock_residuals = pelt.clock_residuals;
    let fire: Vec<FrameObs> = obs
        .iter()
        .copied()
        .filter(|o| matches!(o.label, Label::Fire { .. }))
        .collect();
    let phases: Vec<f64> = a.points.iter().map(|p| p.phase).collect();
    a.lag_intervals = holds(&fire, &phases, s);
    // The legacy excursion grouper can itself swallow an odd label inside a long stall. Inspect raw
    // neighbours independently so that recognising a hold never excuses a short contradictory row.
    for i in 1..fire.len().saturating_sub(1) {
        if fire[i - 1].frame + 1 != fire[i].frame || fire[i].frame + 1 != fire[i + 1].frame {
            continue;
        }
        if circular::delta(phases[i + 1], phases[i - 1]).abs() > s.phase.window_ticks {
            continue;
        }
        let d = circular::delta(phases[i], centre(&[phases[i - 1], phases[i + 1]]));
        if d.abs() <= s.phase.window_ticks.max(s.phase.min_shift_ticks)
            || a.flags.iter().any(|f| f.frame == fire[i].frame)
        {
            continue;
        }
        a.flags.push(Flag {
            frame: fire[i].frame,
            end_frame: fire[i].frame,
            kind: FlagKind::PhaseOutlier,
            severity: if d.abs() > s.phase.max_lag_ticks {
                Severity::Hard
            } else {
                Severity::Soft
            },
            phase_delta: d,
        });
    }
    let time = |f: u32| {
        fire.binary_search_by_key(&f, |o| o.frame)
            .ok()
            .map(|i| fire[i].pts)
    };
    // Every existing finding remains. Only duplicate supplemental endpoints are suppressed.
    for e in pelt
        .events
        .iter()
        .filter(|e| e.kind == EventKind::PhaseChange)
    {
        let t = time(e.first_frame).unwrap();
        let at = fire
            .binary_search_by_key(&e.first_frame, |o| o.frame)
            .unwrap();
        if at > 0
            && t - fire[at - 1].pts > c.held_max_gap_seconds
            && e.phase_delta.abs() <= s.phase.window_ticks
        {
            // Across missing observations, a distribution shift still inside the admitted timing arc
            // is insufficient extra evidence. This never removes an existing raw-frame finding.
            continue;
        }
        if a.flags.iter().any(|f| {
            [f.frame, f.end_frame]
                .iter()
                .any(|&n| time(n).is_some_and(|u| (u - t).abs() <= c.bin_seconds))
        }) {
            continue;
        }
        a.flags.push(Flag {
            frame: e.first_frame,
            end_frame: e.first_frame,
            kind: FlagKind::PhaseShift,
            severity: if e.phase_delta.abs() > s.phase.max_lag_ticks {
                Severity::Hard
            } else {
                Severity::Soft
            },
            phase_delta: e.phase_delta,
        });
    }
    for h in &a.lag_intervals {
        if !a
            .flags
            .iter()
            .any(|f| f.frame <= h.last_frame && f.end_frame >= h.first_frame)
        {
            a.flags.push(Flag {
                frame: h.first_frame,
                end_frame: h.last_frame,
                kind: FlagKind::PhaseExcursion,
                severity: if h.elapsed_ticks > s.phase.max_lag_ticks {
                    Severity::Hard
                } else {
                    Severity::Soft
                },
                phase_delta: 0.0,
            });
        }
    }
    a.flags.sort_by_key(|f| f.frame);
    a.flags
        .dedup_by(|x, y| x.frame == y.frame && x.end_frame == y.end_frame && x.kind == y.kind);
    for f in &mut a.flags {
        let hold = a
            .lag_intervals
            .iter()
            .filter(|h| f.frame <= h.last_frame && f.end_frame >= h.first_frame)
            .max_by(|x, y| x.elapsed_ticks.total_cmp(&y.elapsed_ticks));
        let explanation = if f.kind == FlagKind::PhaseOutlier {
            Explanation::LocalDeparture
        } else if let Some(h) = hold {
            if h.elapsed_ticks > s.phase.max_lag_ticks {
                f.severity = Severity::Hard;
            }
            match h.recovered {
                Some(true) => Explanation::RecoveredHold,
                Some(false) => Explanation::HoldWithMismatch,
                None => Explanation::HoldRecoveryUnknown,
            }
        } else {
            match f.kind {
                FlagKind::FireConflict => Explanation::FireConflict,
                FlagKind::PhaseOutlier => Explanation::LocalDeparture,
                FlagKind::PhaseShift => Explanation::PersistentMismatch,
                FlagKind::PhaseExcursion => Explanation::RecoveredDeparture,
            }
        };
        let at = fire.binary_search_by_key(&f.frame, |o| o.frame).unwrap();
        a.flag_details.push(FlagDetail {
            frame: f.frame,
            end_frame: f.end_frame,
            kind: f.kind,
            explanation,
            clock_delta: circular::delta(phases[at], pelt.reference_phase),
            held_ticks: if f.kind == FlagKind::PhaseOutlier {
                None
            } else {
                hold.map(|h| h.elapsed_ticks)
            },
        });
    }
    // Primary runs are PELT segments; individual raw-frame flags remain independently visible.
    let mut starts = vec![0usize];
    starts.extend(
        pelt.boundaries
            .iter()
            .filter_map(|f| fire.binary_search_by_key(f, |o| o.frame).ok()),
    );
    starts.sort_unstable();
    starts.dedup();
    a.runs.clear();
    if !fire.is_empty() {
        for k in 0..starts.len() {
            let l = starts[k];
            let r = starts.get(k + 1).copied().unwrap_or(fire.len());
            if r <= l {
                continue;
            }
            let center = centre(&phases[l..r]);
            let offsets: Vec<f64> = phases[l..r]
                .iter()
                .map(|&p| circular::delta(p, center))
                .collect();
            let lo = offsets.iter().copied().fold(f64::INFINITY, f64::min);
            let hi = offsets.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            a.runs.push(Run {
                first_frame: fire[l].frame,
                last_frame: fire[r - 1].frame,
                points: r - l,
                center,
                width: hi - lo,
            });
        }
    }
    Ok(a)
}
