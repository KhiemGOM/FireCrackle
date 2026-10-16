// What to show when a flag is clicked: the evidence frames before and after the change, with the sprite on each.

import type { Flag } from "./api";
import { relativePhase, type ChartPoint } from "./chart";
import { formatTimecode } from "./timecode";

export interface FlagComparison {
  before: ChartPoint | null;
  /** A point inside the flag's span, for flags that return to the old level. */
  during: ChartPoint | null;
  after: ChartPoint | null;
}

/** The first point at or after `frame`, in a list ordered by frame. */
function firstAtOrAfter(points: ChartPoint[], frame: number): ChartPoint | null {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].frame < frame) lo = mid + 1;
    else hi = mid;
  }
  return lo < points.length ? points[lo] : null;
}

/** The last point strictly before `frame`. */
function lastBefore(points: ChartPoint[], frame: number): ChartPoint | null {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].frame < frame) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? points[lo - 1] : null;
}

export function compareFrames(points: ChartPoint[], flag: Flag): FlagComparison {
  const before = lastBefore(points, flag.frame);
  if (flag.kind === "phase_shift") {
    return { before, during: null, after: firstAtOrAfter(points, flag.frame) };
  }
  const inside = firstAtOrAfter(points, flag.frame);
  const during = inside && inside.frame <= flag.end_frame ? inside : null;
  return { before, during, after: firstAtOrAfter(points, flag.end_frame + 1) };
}

/** The row on sheet 1 that shows animation index `step` (sheet 1 displays row = step). */
export function spriteRowOf(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return ((Math.round(step) % 32) + 32) % 32;
}

const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

export function describePoint(p: ChartPoint | null, reference: number, fps: number): string {
  if (!p) return "No fire evidence on this side.";
  const offset = relativePhase(p.phase, reference);
  return `frame ${p.frame} · ${formatTimecode(p.video_pts ?? p.pts, fps)} · animation index ${p.step} · timing offset ${signed(offset)} ticks`;
}
