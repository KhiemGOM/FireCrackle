//! Research alternatives to the shipped greedy checker. See docs/PLAN-PHASE-V2.md.
//! PELT is exact on time-binned circular means. PCID follows alternating interval isolation with a
//! block-permutation adaptation and overlapping bounded windows, not a calibrated significance claim.
use crate::config::PhaseResearchConfig;
use crate::label::Label;
use crate::phase::FrameObs;
use serde::Serialize;
use std::f64::consts::TAU;

const SCALE: f64 = 32.0 / TAU;
pub fn delta(to: f64, from: f64) -> f64 {
    (to - from + 16.0).rem_euclid(32.0) - 16.0
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Method {
    Fixed,
    Pelt,
    Pcid,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum EventKind {
    PhaseChange,
    RecoveredDeparture,
    HeldAnimation,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Event {
    pub first_frame: u32,
    pub last_frame: u32,
    pub phase_delta: f64,
    pub kind: EventKind,
    pub soft: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ResultSet {
    pub reference_phase: f64,
    pub events: Vec<Event>,
    pub boundaries: Vec<u32>,
    pub bins: usize,
    pub objective: Option<f64>,
    /// Every occupied bin compared with the same nominal clock, including observations across gaps.
    pub clock_residuals: Vec<ClockResidual>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ClockResidual {
    pub first_frame: u32,
    pub last_frame: u32,
    pub phase_delta: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Partition {
    pub starts: Vec<usize>,
    pub objective: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ClockDiagnostic {
    pub estimated_rate: f64,
    pub lower_edge: f64,
    pub concentration: f64,
    pub at_search_edge: bool,
}
#[derive(Clone, Copy)]
struct Bin {
    first: u32,
    last: u32,
    phase: f64,
}
struct Prefix {
    c: Vec<f64>,
    s: Vec<f64>,
}
impl Prefix {
    fn new(xs: &[f64]) -> Self {
        let mut c = vec![0.0];
        let mut s = vec![0.0];
        for x in xs {
            let a = x / SCALE;
            c.push(c.last().unwrap() + a.cos());
            s.push(s.last().unwrap() + a.sin());
        }
        Self { c, s }
    }
    fn vector(&self, l: usize, r: usize) -> (f64, f64) {
        (self.c[r] - self.c[l], self.s[r] - self.s[l])
    }
    fn length(&self, l: usize, r: usize) -> f64 {
        let (c, s) = self.vector(l, r);
        c.hypot(s)
    }
    fn cost(&self, l: usize, r: usize) -> f64 {
        2.0 * SCALE * SCALE * ((r - l) as f64 - self.length(l, r)).max(0.0)
    }
    fn mean(&self, l: usize, r: usize) -> f64 {
        let (c, s) = self.vector(l, r);
        (s.atan2(c) * SCALE).rem_euclid(32.0)
    }
}
/// K=0 pruning is valid by triangle inequality of the segment resultant vectors.
/// Keep tied candidates: deterministic preference for fewer changes, then earliest start.
pub fn pelt(xs: &[f64], penalty: f64) -> Result<Partition, String> {
    if !penalty.is_finite() || penalty < 0.0 || xs.iter().any(|x| !x.is_finite()) {
        return Err("invalid phase or penalty".into());
    }
    let n = xs.len();
    if n == 0 {
        return Ok(Partition {
            starts: vec![],
            objective: 0.0,
        });
    }
    let p = Prefix::new(xs);
    let mut f = vec![0.0; n + 1];
    f[0] = -penalty;
    let mut prev = vec![0; n + 1];
    let mut counts = vec![0; n + 1];
    let mut active = vec![0];
    for r in 1..=n {
        let mut best = f64::INFINITY;
        let mut b = 0;
        for &l in &active {
            let v = f[l] + p.cost(l, r) + penalty;
            if v < best - 1e-10 || ((v - best).abs() <= 1e-10 && counts[l] < counts[b]) {
                best = v;
                b = l;
            }
        }
        f[r] = best;
        prev[r] = b;
        counts[r] = counts[b] + 1;
        active.retain(|&l| f[l] + p.cost(l, r) <= f[r] + 1e-10);
        active.push(r);
    }
    let mut starts = Vec::new();
    let mut r = n;
    while r > 0 {
        let l = prev[r];
        starts.push(l);
        r = l;
    }
    starts.reverse();
    Ok(Partition {
        starts,
        objective: f[n],
    })
}
fn validate(obs: &[FrameObs], c: &PhaseResearchConfig) -> Result<(), String> {
    let positive = [
        c.tick_rate,
        c.bin_seconds,
        c.recovery_seconds,
        c.held_seconds,
        c.held_max_gap_seconds,
        c.rate_search,
        c.rate_step,
    ];
    if positive.iter().any(|x| !x.is_finite() || *x <= 0.0)
        || c.rate_step > c.rate_search
        || c.rate_search >= c.tick_rate
        || !c.penalty_ticks2.is_finite()
        || c.penalty_ticks2 < 0.0
        || [c.min_change_ticks, c.recovery_ticks]
            .iter()
            .any(|x| !x.is_finite() || *x < 0.0 || *x > 16.0)
        || !c.alpha.is_finite()
        || c.alpha <= 0.0
        || c.alpha >= 1.0
        || c.permutations == 0
        || c.expansion_bins == 0
        || c.permutation_block_bins == 0
        || c.pcid_window_bins < 2
        || c.clock_anchor_bins == 0
        || !c.edge_quantile.is_finite()
        || !(0.0..=1.0).contains(&c.edge_quantile)
    {
        return Err("invalid research configuration".into());
    }
    let mut last = None;
    let mut pts = None;
    for o in obs {
        if last.is_some_and(|x| o.frame <= x) {
            return Err("frames not increasing".into());
        }
        last = Some(o.frame);
        if let Label::Fire { sheet, row, .. } = o.label {
            if sheet > 1 || row >= 32 || !o.pts.is_finite() || pts.is_some_and(|x| o.pts < x) {
                return Err("invalid fire observation".into());
            }
            pts = Some(o.pts);
        }
    }
    Ok(())
}
fn bins(obs: &[FrameObs], c: &PhaseResearchConfig) -> Vec<Bin> {
    let mut out = Vec::new();
    let mut group: Option<(f64, u32, u32, f64, f64, f64, usize)> = None;
    for o in obs {
        let Label::Fire { row, .. } = o.label else {
            continue;
        };
        let id = (o.pts / c.bin_seconds).floor();
        let a = (c.tick_rate * o.pts - row as f64) / SCALE;
        if group.as_ref().is_some_and(|g| g.0 != id) {
            let (_, first, last, _, x, y, _) = group.take().unwrap();
            out.push(Bin {
                first,
                last,
                phase: (y.atan2(x) * SCALE).rem_euclid(32.0),
            });
        }
        let g = group.get_or_insert((id, o.frame, o.frame, 0.0, 0.0, 0.0, 0));
        g.2 = o.frame;
        g.3 += o.pts;
        g.4 += a.cos();
        g.5 += a.sin();
        g.6 += 1;
    }
    if let Some((_, first, last, _, x, y, _)) = group {
        out.push(Bin {
            first,
            last,
            phase: (y.atan2(x) * SCALE).rem_euclid(32.0),
        });
    }
    out
}
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}
fn contrast(p: &Prefix, l: usize, r: usize) -> (usize, f64) {
    let mut best = (l, 0.0);
    let whole = p.length(l, r);
    for b in l + 1..r {
        let v = 2.0 * SCALE * SCALE * (p.length(l, b) + p.length(b, r) - whole).max(0.0);
        if v > best.1 {
            best = (b, v);
        }
    }
    best
}
fn significant(xs: &[f64], c: &PhaseResearchConfig, rng: &mut Rng) -> Option<usize> {
    if xs.len() < 2 {
        return None;
    }
    let p = Prefix::new(xs);
    let (b, gain) = contrast(&p, 0, xs.len());
    if gain < c.penalty_ticks2
        || delta(p.mean(0, b), p.mean(b, xs.len())).abs() < c.min_change_ticks
    {
        return None;
    }
    let blocks: Vec<&[f64]> = xs.chunks(c.permutation_block_bins).collect();
    let mut order: Vec<usize> = (0..blocks.len()).collect();
    let mut sample = Vec::with_capacity(xs.len());
    let mut exceed = 0;
    for k in 0..c.permutations {
        for i in (1..order.len()).rev() {
            let j = (rng.next() % (i + 1) as u64) as usize;
            order.swap(i, j);
        }
        sample.clear();
        for &i in &order {
            sample.extend_from_slice(blocks[i]);
        }
        if contrast(&Prefix::new(&sample), 0, sample.len()).1 >= gain - 1e-10 {
            exceed += 1;
        }
        // Exact early rejection: even zero future exceedances cannot reach alpha.
        if (exceed + 1) as f64 > c.alpha * (c.permutations + 1) as f64 {
            return None;
        }
        if k + 1 == c.permutations && (exceed + 1) as f64 / (c.permutations + 1) as f64 <= c.alpha {
            return Some(b);
        }
    }
    None
}
fn pcid_window(xs: &[f64], c: &PhaseResearchConfig, rng: &mut Rng) -> Vec<usize> {
    let mut out = Vec::new();
    let (mut s, mut e) = (0, xs.len());
    while e > s + 1 {
        let mut found = false;
        let width = e - s;
        for size in
            (1..=width.div_ceil(c.expansion_bins)).map(|j| (j * c.expansion_bins).min(width))
        {
            // Equations 7-8: alternate right expansion from s and left expansion from e.
            for right in [true, false] {
                let (l, r) = if right { (s, s + size) } else { (e - size, e) };
                if let Some(b) = significant(&xs[l..r], c, rng) {
                    let b = l + b;
                    out.push(b);
                    if right {
                        s = b;
                    } else {
                        e = b;
                    }
                    found = true;
                    break;
                }
            }
            if found {
                break;
            }
        }
        if !found {
            break;
        }
    }
    out
}
fn pcid(xs: &[f64], c: &PhaseResearchConfig) -> Vec<usize> {
    let mut rng = Rng(c.seed.wrapping_mul(0x9e3779b97f4a7c15) | 1);
    let mut out = vec![0];
    for offset in [0, c.pcid_window_bins / 2] {
        let mut l = offset;
        while l < xs.len() {
            let r = (l + c.pcid_window_bins).min(xs.len());
            out.extend(
                pcid_window(&xs[l..r], c, &mut rng)
                    .into_iter()
                    .map(|b| b + l),
            );
            l = r;
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}
fn held_events(obs: &[FrameObs], c: &PhaseResearchConfig) -> Vec<Event> {
    let mut out = Vec::new();
    let mut start: Option<(u32, f64, u8)> = None;
    let mut last: Option<(u32, f64)> = None;
    let flush = |start: Option<(u32, f64, u8)>, last: Option<(u32, f64)>, out: &mut Vec<Event>| {
        if let (Some((f, t, _)), Some((end, et))) = (start, last) {
            if et - t >= c.held_seconds {
                out.push(Event {
                    first_frame: f,
                    last_frame: end,
                    phase_delta: 0.0,
                    kind: EventKind::HeldAnimation,
                    soft: true,
                });
            }
        }
    };
    for o in obs {
        let Label::Fire { row, .. } = o.label else {
            flush(start, last, &mut out);
            start = None;
            last = None;
            continue;
        };
        let s = row;
        if start.is_some_and(|v| v.2 != s)
            || last.is_some_and(|v| o.pts - v.1 > c.held_max_gap_seconds || o.frame != v.0 + 1)
        {
            flush(start, last, &mut out);
            start = None;
        }
        start.get_or_insert((o.frame, o.pts, s));
        last = Some((o.frame, o.pts));
    }
    flush(start, last, &mut out);
    out
}
pub fn compare(
    obs: &[FrameObs],
    method: Method,
    c: &PhaseResearchConfig,
) -> Result<ResultSet, String> {
    validate(obs, c)?;
    let bs = bins(obs, c);
    let xs: Vec<f64> = bs.iter().map(|b| b.phase).collect();
    let p = Prefix::new(&xs);
    if bs.is_empty() {
        return Ok(ResultSet {
            reference_phase: 0.0,
            events: vec![],
            boundaries: vec![],
            bins: 0,
            objective: None,
            clock_residuals: vec![],
        });
    }
    let anchor = &xs[..xs.len().min(c.clock_anchor_bins)];
    let reference_phase = *anchor
        .iter()
        .min_by(|&&a, &&b| {
            let score = |v: f64| anchor.iter().map(|&x| delta(x, v).abs()).sum::<f64>();
            score(a).total_cmp(&score(b))
        })
        .unwrap();
    let clock_residuals = bs
        .iter()
        .map(|b| ClockResidual {
            first_frame: b.first,
            last_frame: b.last,
            phase_delta: delta(b.phase, reference_phase),
        })
        .collect();
    let (starts, objective) = match method {
        Method::Pelt => {
            let a = pelt(&xs, c.penalty_ticks2)?;
            (a.starts, Some(a.objective))
        }
        Method::Pcid => (pcid(&xs, c), None),
        Method::Fixed => {
            let mut starts = vec![0];
            let mut base = 0;
            for (i, &phase) in xs.iter().enumerate().skip(1) {
                if delta(phase, p.mean(base, i)).abs() >= c.min_change_ticks {
                    starts.push(i);
                    base = i;
                }
            }
            (starts, None)
        }
    };
    // Locate only already-detected changes within their neighbouring raw observations. This does not
    // change the exact binned PELT objective. Deduplicate mixed-bin departures that refine to one edge.
    let raw: Vec<&FrameObs> = obs
        .iter()
        .filter(|o| matches!(o.label, Label::Fire { .. }))
        .collect();
    let raw_phases: Vec<f64> = raw
        .iter()
        .map(|o| {
            if let Label::Fire { row, .. } = o.label {
                (c.tick_rate * o.pts - row as f64).rem_euclid(32.0)
            } else {
                unreachable!()
            }
        })
        .collect();
    let rp = Prefix::new(&raw_phases);
    let mut refined = vec![0];
    for &i in starts.iter().skip(1) {
        let lo = raw.partition_point(|o| o.frame < bs[i.saturating_sub(1)].first);
        let hi = raw.partition_point(|o| o.frame <= bs[(i + 1).min(bs.len() - 1)].last);
        if hi > lo + 1 {
            let (b, gain) = contrast(&rp, lo, hi);
            if gain > 0.0 {
                refined.push(b);
            }
        }
    }
    refined.sort_unstable();
    refined.dedup();
    let starts = refined;
    let ends: Vec<usize> = starts
        .iter()
        .skip(1)
        .copied()
        .chain(std::iter::once(raw.len()))
        .collect();
    let levels: Vec<f64> = starts
        .iter()
        .zip(&ends)
        .map(|(&l, &r)| rp.mean(l, r))
        .collect();
    let mut events = Vec::new();
    let mut k = 1;
    while k < starts.len() {
        let before = levels[k - 1];
        let d = delta(levels[k], before);
        if d.abs() < c.min_change_ticks {
            k += 1;
            continue;
        }
        let home = (k + 1..starts.len())
            .take_while(|&j| raw[starts[j]].pts - raw[starts[k]].pts <= c.recovery_seconds)
            .find(|&j| delta(levels[j], before).abs() <= c.recovery_ticks);
        if let Some(j) = home {
            let peak = (k..j)
                .map(|i| delta(levels[i], before))
                .max_by(|a, b| a.abs().total_cmp(&b.abs()))
                .unwrap();
            events.push(Event {
                first_frame: raw[starts[k]].frame,
                last_frame: raw[ends[j - 1] - 1].frame,
                phase_delta: peak,
                kind: EventKind::RecoveredDeparture,
                soft: true,
            });
            k = j + 1;
        } else {
            events.push(Event {
                first_frame: raw[starts[k]].frame,
                last_frame: raw[starts[k]].frame,
                phase_delta: d,
                kind: EventKind::PhaseChange,
                soft: false,
            });
            k += 1;
        }
    }
    events.extend(held_events(obs, c));
    events.sort_by_key(|e| e.first_frame);
    Ok(ResultSet {
        reference_phase,
        events,
        boundaries: starts.iter().skip(1).map(|&i| raw[i].frame).collect(),
        bins: bs.len(),
        objective,
        clock_residuals,
    })
}
/// Diagnostic only: maximise resultant concentration on a bounded rate grid. Lower edge is the chosen
/// quantile around that circular centre; no claim that it identifies the physical clock during edits.
pub fn clock_diagnostic(
    obs: &[FrameObs],
    c: &PhaseResearchConfig,
) -> Result<Option<ClockDiagnostic>, String> {
    validate(obs, c)?;
    let n = obs
        .iter()
        .filter(|o| matches!(o.label, Label::Fire { .. }))
        .count();
    if n < 2 {
        return Ok(None);
    }
    let mut best = (f64::NEG_INFINITY, c.tick_rate, 0.0);
    let steps = (2.0 * c.rate_search / c.rate_step).round() as usize;
    for i in 0..=steps {
        let rate = c.tick_rate - c.rate_search + i as f64 * c.rate_step;
        let mut x = 0.0;
        let mut y = 0.0;
        for o in obs {
            if let Label::Fire { row, .. } = o.label {
                let a = (rate * o.pts - row as f64) / SCALE;
                x += a.cos();
                y += a.sin();
            }
        }
        let concentration = x.hypot(y) / n as f64;
        if concentration > best.0 {
            best = (concentration, rate, (y.atan2(x) * SCALE).rem_euclid(32.0));
        }
    }
    let mut residuals: Vec<f64> = obs
        .iter()
        .filter_map(|o| {
            if let Label::Fire { row, .. } = o.label {
                Some(delta(
                    (best.1 * o.pts - row as f64).rem_euclid(32.0),
                    best.2,
                ))
            } else {
                None
            }
        })
        .collect();
    residuals.sort_by(f64::total_cmp);
    let q = residuals[((residuals.len() - 1) as f64 * c.edge_quantile).round() as usize];
    Ok(Some(ClockDiagnostic {
        estimated_rate: best.1,
        lower_edge: (best.2 + q).rem_euclid(32.0),
        concentration: best.0,
        at_search_edge: (best.1 - c.tick_rate).abs() >= c.rate_search - c.rate_step / 2.0,
    }))
}
