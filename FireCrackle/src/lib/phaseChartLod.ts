import { relativePhase, type ChartPoint } from "./chart";

/** Below six CSS pixels per 32-row cycle, dashed ramps overlap into an unreadable grid.
 * Use a light coverage band there; exact ramps return automatically on zoom-in. */
export function denseRowRuler(start: number, end: number, tickRate: number, width: number): boolean {
  if (!(end > start) || !(tickRate > 0) || !(width > 0)) return false;
  return width * 32 / ((end - start) * tickRate) < 6;
}
interface PaintWindow {
  t0: number; t1: number; width: number;
  kind: "phase" | "row"; reference: number; rulerPhase?: number;
}
const cache = new WeakMap<ChartPoint[], Map<string, ChartPoint[]>>();
const chronological = new WeakMap<ChartPoint[], boolean>();

/** Only painting is thinned. Keep endpoints, vertical extrema, and both signed worst
 * deviations (plus the closest match) in each two-pixel time column. Full evidence
 * remains available to analysis, hit testing, and the next zoom level. */
export function phasePaintPoints(points: ChartPoint[], options: PaintWindow): ChartPoint[] {
  const { t0, t1, width, kind, reference, rulerPhase } = options;
  if (!(t1 > t0) || !(width > 0)) return [];
  const key = JSON.stringify([t0, t1, width, kind, reference, rulerPhase]);
  let entries = cache.get(points);
  const previous = entries?.get(key);
  if (previous) return previous;
  let ordered = chronological.get(points);
  if (ordered === undefined) {
    ordered = points.every((p, i) => Number.isFinite(p.pts) && (i === 0 || p.pts >= points[i - 1].pts));
    chronological.set(points, ordered);
  }
  // Canonical clock jumps can reverse display time while video/frame order stays intact.
  const source = ordered ? points : points.filter(p => p.pts >= t0 && p.pts <= t1);
  function bound(time: number, after: boolean) {
    let lo = 0, hi = source.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (source[mid].pts < time || (after && source[mid].pts === time)) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  const first = ordered ? bound(t0, false) : 0, last = ordered ? bound(t1, true) : source.length;
  let result: ChartPoint[];
  if (last - first <= width * 2) {
    result = source.slice(first, last);
  } else {
    const columns = Math.max(1, Math.ceil(width / 2));
    type Bucket = { first: number; last: number; low: number; high: number; negative: number; positive: number; near: number; yLow: number; yHigh: number; dLow: number; dHigh: number; dNear: number };
    const buckets: Bucket[] = [];
    for (let i = first; i < last; i++) {
      const p = source[i];
      if (!Number.isFinite(p.phase) && rulerPhase !== undefined) continue;
      const column = Math.min(columns - 1, Math.floor((p.pts - t0) * columns / (t1 - t0)));
      const y = kind === "phase" ? relativePhase(p.phase, reference) : p.step;
      const d = rulerPhase === undefined ? 0 : relativePhase(p.phase, rulerPhase);
      const b = buckets[column];
      if (!b) buckets[column] = { first: i, last: i, low: i, high: i, negative: i, positive: i, near: i, yLow: y, yHigh: y, dLow: d, dHigh: d, dNear: Math.abs(d) };
      else {
        b.last = i;
        if (y < b.yLow) { b.low = i; b.yLow = y; }
        if (y > b.yHigh) { b.high = i; b.yHigh = y; }
        if (d < b.dLow) { b.negative = i; b.dLow = d; }
        if (d > b.dHigh) { b.positive = i; b.dHigh = d; }
        if (Math.abs(d) < b.dNear) { b.near = i; b.dNear = Math.abs(d); }
      }
    }
    result = buckets.flatMap(b => [...new Set([b.first, b.last, b.low, b.high, b.negative, b.positive, b.near])].sort((a, b) => a - b).map(i => source[i]));
  }
  if (!entries) { entries = new Map(); cache.set(points, entries); }
  if (entries.size >= 4) entries.delete(entries.keys().next().value!);
  entries.set(key, result);
  return result;
}
