// The perfect-clock ruler (not the calibration ruler of the video pane, see ruler.ts): what a video with no timing deviation would show, and how far the labelled points are from it.
// Pure geometry; phaseChartCanvas.ts paints it.

import { relativePhase, type ChartPoint, type PhaseChart } from "./chart";

const CIRCLE = 32;
/** A window wider than this many ramps (32 ticks each) would draw a blur, so no ramp is drawn. */
export const MAX_RAMPS = 2000;

/** The phase the chart is measured against: the backend's reference, else the first run, else the first point. */
export function chartReference(chart: PhaseChart): number {
  return chart.reference_phase ?? chart.runs[0]?.center ?? chart.points[0]?.phase ?? 0;
}

const wrap = (x: number) => ((x % CIRCLE) + CIRCLE) % CIRCLE;

/** The ruler's phase: the reference moved by the user's offset (ticks), on the 32-tick circle. */
export function rulerPhase(reference: number, offset: number): number {
  return wrap((Number.isFinite(reference) ? reference : 0) + (Number.isFinite(offset) ? offset : 0));
}

/** Signed shortest distance from the ruler to a point's phase, in (-16, 16]. Positive: the sprite lags the ideal clock. */
export function deviation(phase: number, ruler: number): number {
  return relativePhase(phase, ruler);
}

/** The row an ideal clock with this phase shows at time `pts` (seconds), in [0, 32). Phase is `(rate * pts - step) mod 32`. */
export function idealStep(pts: number, tickRate: number, ruler: number): number {
  return wrap(tickRate * pts - ruler);
}

export interface RampSegment {
  t0: number;
  step0: number;
  t1: number;
  /** Up to 32: a ramp ends one row past the top and the next one starts at 0. */
  step1: number;
}

/** The ideal sawtooth across the window [t0, t1] seconds: one ramp per 32 ticks, cut at the window edges. */
export function idealRamps(t0: number, t1: number, tickRate: number, ruler: number): RampSegment[] {
  if (![t0, t1, tickRate, ruler].every(Number.isFinite) || !(t1 > t0) || !(tickRate > 0)) return [];
  if ((t1 - t0) * tickRate / CIRCLE + 2 > MAX_RAMPS) return [];
  const out: RampSegment[] = [];
  let k = Math.ceil((tickRate * t0 - ruler) / CIRCLE);
  let start = (ruler + CIRCLE * k) / tickRate; // the first wrap at or after t0
  if (start > t0) {
    const end = Math.min(start, t1);
    out.push({ t0, step0: idealStep(t0, tickRate, ruler), t1: end, step1: end === start ? CIRCLE : idealStep(end, tickRate, ruler) });
  }
  while (start < t1) {
    k += 1;
    const wrapAt = (ruler + CIRCLE * k) / tickRate;
    const end = Math.min(wrapAt, t1);
    out.push({ t0: start, step0: 0, t1: end, step1: end === wrapAt ? CIRCLE : tickRate * (end - start) });
    start = wrapAt;
  }
  return out;
}

export type DeviationLevel = "ok" | "warn" | "bad";

/** Within the tolerance is ok, up to twice it a warning, beyond that bad. Anything unmeasurable is bad. */
export function deviationLevel(d: number, tolerance: number): DeviationLevel {
  const a = Math.abs(d);
  if (!(a >= 0)) return "bad";
  const tol = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  if (a <= tol) return "ok";
  return a <= 2 * tol ? "warn" : "bad";
}

export interface DeviationStats {
  count: number;
  within: number;
  meanAbs: number;
  maxAbs: number;
}

export function deviationStats(points: ChartPoint[], ruler: number, tolerance: number): DeviationStats {
  let count = 0;
  let within = 0;
  let sum = 0;
  let max = 0;
  for (const p of points) {
    if (!Number.isFinite(p.phase)) continue;
    const a = Math.abs(deviation(p.phase, ruler));
    count += 1;
    sum += a;
    if (a > max) max = a;
    if (deviationLevel(a, tolerance) === "ok") within += 1;
  }
  return { count, within, meanAbs: count ? sum / count : 0, maxAbs: max };
}

export interface RulerMatch {
  /** Ticks from the chart's reference phase to the fitted ruler, in (-16, 16]. */
  offset: number;
  /** Points with a usable phase. */
  count: number;
  /** Points within the outlier cut-off of the fitted ruler. */
  inliers: number;
  /** Root-mean-square deviation of the inliers, in ticks. */
  rmse: number;
}

const SCAN_STEP = 0.1;
const MIN_CAP = 0.5;

/**
 * The ruler phase that best explains the labelled frames: a mean-squared-error fit that cannot be dragged by outliers.
 * Every phase on the circle is scored by the sum of min(d², cap²), so a frame further than `cap` from the ruler costs a
 * fixed amount whatever its distance (a cut, a lag spike or a second steady stretch cannot pull the fit); the winner is
 * then refined by a plain mean over the frames inside the cap. `cap` is three times the tolerance.
 */
export function bestRulerMatch(points: ChartPoint[], reference: number, tolerance: number): RulerMatch | null {
  const phases = points.map((p) => p.phase).filter(Number.isFinite);
  if (phases.length === 0) return null;
  const cap = Math.max(MIN_CAP, 3 * (Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0));
  const cap2 = cap * cap;
  let best = 0;
  let bestCost = Infinity;
  for (let c = 0; c < CIRCLE; c += SCAN_STEP) {
    let cost = 0;
    for (const phase of phases) {
      const d = deviation(phase, c);
      cost += Math.min(d * d, cap2);
      if (cost >= bestCost) break;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  let ruler = best;
  for (let i = 0; i < 50; i++) {
    let sum = 0;
    let n = 0;
    for (const phase of phases) {
      const d = deviation(phase, ruler);
      if (Math.abs(d) <= cap) {
        sum += d;
        n += 1;
      }
    }
    if (n === 0) break;
    const shift = sum / n;
    ruler = wrap(ruler + shift);
    if (Math.abs(shift) < 1e-9) break;
  }
  let inliers = 0;
  let squares = 0;
  for (const phase of phases) {
    const d = deviation(phase, ruler);
    if (Math.abs(d) <= cap) {
      inliers += 1;
      squares += d * d;
    }
  }
  return {
    offset: relativePhase(ruler, Number.isFinite(reference) ? reference : 0),
    count: phases.length,
    inliers,
    rmse: inliers ? Math.sqrt(squares / inliers) : 0,
  };
}
