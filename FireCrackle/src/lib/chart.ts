// Pure geometry for the Phase tab's charts; canvas painting lives in phaseChartCanvas.ts.

import type { Flag, LabelSource } from "./api";
import { clampViewport, type FrameRange, type Viewport } from "./timeline";

/** Center a flagged interval with context, including single-frame flags and video edges. */
export function focusChartRange(range: FrameRange, total: number, width: number, fps: number): Viewport {
  const span = Math.min(Math.max(total, 1), Math.max(fps * 3, (range.last - range.first + 1) * 1.5));
  return clampViewport({ start: (range.first + range.last) / 2 - span / 2, pxPerFrame: width / span }, width, total);
}

const CIRCLE = 32;
const HALF = CIRCLE / 2;

export interface ChartPoint {
  /** Original video timestamp when the display axis uses corrected elapsed time. */
  video_pts?: number;
  /** Observed canonical clock tick, present only at resolved Jolt anchors. */
  clock_tick?: number;
  clock_estimated?: boolean;
  /** Display-only projection where the independent Jolt clock is unavailable. */
  clock_fallback?: boolean;
  frame: number;
  pts: number;
  /** The animation index, shared by both sheets. */
  step: number;
  /** `(tick_rate * pts - step) mod 32`, in [0, 32). */
  phase: number;
}

export interface ChartRun {
  first_frame: number;
  last_frame: number;
  points: number;
  center: number;
  width: number;
}

export interface PhaseChart {
  texture_points?: import("./animationAtlases").TextureObservation[];
  /** Includes display-only estimates. Never use for detection, fitting or agreement statistics. */
  display_points?: ChartPoint[];
  clock_origin_tick?: number;
  gap_guides?: {t0:number;t1:number;shift_ticks:number;before:{time:number;value:number}[];after:{time:number;value:number}[]}[];
  /** Review events shared by every chart clock/view, rather than re-detected on paired points. */
  review_flags?: boolean;
  /** Display bounds per flag. Uncertain bounds locate an unresolved clock interval, not an inferred tick. */
  flag_positions?: {t0:number;t1:number;uncertain?:boolean}[];
  corrected_time?: boolean;
  clock_breaks?: { t0: number; t1: number }[];
  /** Independent clock coverage, including intervals without visible fire. Never crosses a reported break. */
  clock_segments?: { t0: number; t1: number; tick0: number; tick1: number }[];
  reference_clock?: "video" | "jolt";
  label_sources?:Record<number,LabelSource[]>;
  points: ChartPoint[];
  runs: ChartRun[];
  flags: Flag[];
  tick_rate: number;
  window_ticks: number;
  reference_phase?: number | null;
  flag_details?: FlagDetail[];
  clock_residuals?: {first_frame:number;last_frame:number;phase_delta:number}[];
  lag_intervals?: {first_frame:number;last_frame:number;elapsed_ticks:number;recovered:boolean|null;recovery_phase_delta:number|null}[];
}

export interface FlagDetail {
  frame:number;
  end_frame:number;
  kind:Flag["kind"];
  explanation:string;
  clock_delta:number;
  held_ticks:number|null;
}

/** Signed shortest offset from `reference` to `phase` on the 32-tick circle, in (-16, 16]. */
export function relativePhase(phase: number, reference: number): number {
  const r = (((phase - reference + HALF) % CIRCLE) + CIRCLE) % CIRCLE - HALF;
  return r === -HALF ? HALF : r;
}

/** x pixel of time `t` when [t0, t1] spans `width` pixels (the middle when there is no time span). */
export function timeToX(t: number, t0: number, t1: number, width: number): number {
  if (!(t1 > t0)) return width / 2;
  return ((t - t0) / (t1 - t0)) * width;
}

export function xToTime(x: number, t0: number, t1: number, width: number): number {
  if (!(t1 > t0) || !(width > 0)) return t0;
  return t0 + (x / width) * (t1 - t0);
}

/** y pixel of a phase offset in [-16, 16] ticks: 0 in the middle, +16 at the top. */
export function phaseToY(rel: number, height: number): number {
  return height / 2 - (rel / HALF) * (height / 2);
}

/** y pixel of a sprite step 0..31: row 0 at the bottom, row 31 at the top. */
export function rowToY(step: number, height: number): number {
  return height - (step / (CIRCLE - 1)) * height;
}

/** The point closest in time to `t` (the earlier one on an exact tie); null for an empty series. */
export function nearestPoint(points: ChartPoint[], t: number): ChartPoint | null {
  if (points.length === 0) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].pts < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return points[0];
  const before = points[lo - 1];
  const after = points[lo];
  return t - before.pts <= after.pts - t ? before : after;
}

export interface FlagSpan {
  /** Index into the flag list. */
  index: number;
  x0: number;
  x1: number;
}

/** Pixel spans of the flags; a span is at least `minWidth` wide so a one-frame flag can be seen and clicked. */
export function flagSpans(
  flags: Flag[],
  timeOf: (frame: number) => number,
  t0: number,
  t1: number,
  width: number,
  minWidth = 4,
  positions?: PhaseChart["flag_positions"],
): FlagSpan[] {
  return flags.map((f, index) => {
    const a = timeToX(positions?.[index]?.t0 ?? timeOf(f.frame), t0, t1, width);
    const b = timeToX(positions?.[index]?.t1 ?? timeOf(f.end_frame), t0, t1, width);
    const x0 = Math.min(a, b);
    const x1 = Math.max(a, b, x0 + minWidth);
    return { index, x0, x1 };
  });
}

/** The flag under `x` (within `slop` pixels); where several overlap, the narrowest wins. */
export function hitFlag(spans: FlagSpan[], x: number, slop = 3): number | null {
  let best: FlagSpan | null = null;
  for (const s of spans) {
    if (x >= s.x0 - slop && x <= s.x1 + slop) {
      if (!best || s.x1 - s.x0 < best.x1 - best.x0) best = s;
    }
  }
  return best ? best.index : null;
}
