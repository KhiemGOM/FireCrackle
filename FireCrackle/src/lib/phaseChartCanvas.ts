import { flagSpans, phaseToY, relativePhase, rowToY, timeToX, type ChartPoint, type PhaseChart } from "./chart";
import { chartReference, deviation, deviationLevel, idealRamps, rulerPhase, type DeviationLevel } from "./clockRuler";
import type { GapKind } from "./evidenceGaps";
import type { FrameRange } from "./timeline";

const COLORS = { dot: "#4a90d9", band: "rgba(76,195,138,0.16)", grid: "#2a3142", text: "#8b96ab" };
const RULER_COLOR = "#e8eefc";

/** Dots and stems when the ruler is on: inside the tolerance, up to twice it, beyond. */
export const DEVIATION_COLORS: Record<DeviationLevel, string> = { ok: "#4cc38a", warn: "#f5c542", bad: "#ff4d4f" };

/** The perfect-clock ruler: `offset` ticks from the chart's reference phase, `tolerance` ticks either side counted as on time. */
export interface RulerOptions {
  offset: number;
  tolerance: number;
}

export interface PhaseChartCanvasOptions {
  chart: PhaseChart | null;
  kind: "phase" | "row";
  currentFrame: number;
  fps: number;
  t0: number;
  t1: number;
  highlighted: FrameRange | null;
  pixelRatio: number;
  /** Stretches with no fire evidence, drawn behind everything else. */
  gaps?: GapBand[];
  /** A line for what a perfect clock would show, and each point's distance from it; off when absent. */
  ruler?: RulerOptions | null;
}

export interface GapBand {
  first: number;
  last: number;
  kind: GapKind;
}

/** Fill and edge colours per kind of gap: labelled no fire, unlabelled, or labelled only by an excluded source. */
export const GAP_COLORS: Record<GapKind, { fill: string; edge: string; name: string }> = {
  no_fire: { fill: "rgba(110,150,230,0.13)", edge: "rgba(110,150,230,0.55)", name: "no fire labelled · lag not ruled out" },
  unlabelled: { fill: "rgba(160,160,170,0.10)", edge: "rgba(160,160,170,0.45)", name: "unlabelled · no evidence" },
  other_source: { fill: "rgba(180,120,230,0.12)", edge: "rgba(180,120,230,0.5)", name: "excluded source only" },
};

/** Paint either linked chart without owning React state, observers or pointer gestures.
 * Coordinates use CSS pixels; the backing store alone scales with pixelRatio.
 */
export function drawPhaseChart(canvas: HTMLCanvasElement | null, options: PhaseChartCanvasOptions): void {
  const { chart, kind, currentFrame, fps, t0, t1, highlighted, pixelRatio } = options;
  const timeOf = (frame: number) => frame / fps;
  if (!canvas || !chart) return;
  const dpr = pixelRatio;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = "11px system-ui, sans-serif";
  // stretches with no evidence: the furthest back, so everything else reads on top of them
  for (const gap of options.gaps ?? []) {
    const x0 = Math.max(0, timeToX(timeOf(gap.first), t0, t1, w));
    const x1 = Math.min(w, timeToX(timeOf(gap.last + 1), t0, t1, w));
    if (!(x1 > x0)) continue;
    const c = GAP_COLORS[gap.kind];
    g.fillStyle = c.fill;
    g.fillRect(x0, 0, x1 - x0, h);
    g.strokeStyle = c.edge;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(x0 + 0.5, 0);
    g.lineTo(x0 + 0.5, h);
    g.moveTo(x1 - 0.5, 0);
    g.lineTo(x1 - 0.5, h);
    g.stroke();
    g.setLineDash([]);
    if (kind === "phase" && x1 - x0 > 150) {
      g.fillStyle = c.edge;
      g.textAlign = "center";
      g.fillText(c.name, (x0 + x1) / 2, h - 6);
      g.textAlign = "left";
    }
  }
  // flags next, behind the dots
  for (const [i, s] of flagSpans(chart.flags, timeOf, t0, t1, w).entries()) {
    g.fillStyle = chart.flags[i].severity === "hard" ? "rgba(255,77,79,0.28)" : "rgba(245,197,66,0.22)";
    g.fillRect(s.x0, 0, s.x1 - s.x0, h);
  }
  const ref = chartReference(chart);
  const ruler = options.ruler ?? null;
  const rp = ruler ? rulerPhase(ref, ruler.offset) : 0;
  const rulerRel = ruler ? relativePhase(rp, ref) : 0;
  const rulerText = `perfect clock ${rulerRel > 0 ? "+" : ""}${Number(rulerRel.toFixed(2))}`;
  if (kind === "phase") {
    g.strokeStyle = COLORS.grid;
    g.fillStyle = COLORS.text;
    for (const rel of [-16, -8, 0, 8, 16]) {
      const y = phaseToY(rel, h);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.fillText(`${rel > 0 ? "+" : ""}${rel}`, 4, Math.min(h - 3, Math.max(11, y - 2)));
    }
    // each run's arc as a band: the stretch a steady clock would stay in
    g.fillStyle = COLORS.band;
    for (const r of chart.runs) {
      const x0 = timeToX(timeOf(r.first_frame), t0, t1, w);
      const x1 = Math.max(timeToX(timeOf(r.last_frame), t0, t1, w), x0 + 1);
      const rel = relativePhase(r.center, ref);
      const top = phaseToY(rel + r.width / 2, h);
      const bottom = phaseToY(rel - r.width / 2, h);
      g.fillRect(x0, top, x1 - x0, Math.max(1, bottom - top));
    }
    if (chart.reference_phase != null) {
      const y = phaseToY(0, h);
      g.strokeStyle = "#4cc38a";
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#4cc38a";
      g.textAlign = "right";
      g.fillText(chart.reference_clock === "jolt" ? "Jolt reference" : `${chart.tick_rate} Hz reference`, w - 6, Math.max(11, y - 5));
      g.textAlign = "left";
    }
    if (ruler) {
      const top = phaseToY(rulerRel + ruler.tolerance, h);
      g.fillStyle = "rgba(232,238,252,0.08)";
      g.fillRect(0, top, w, phaseToY(rulerRel - ruler.tolerance, h) - top);
      const y = phaseToY(rulerRel, h);
      g.strokeStyle = RULER_COLOR;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = RULER_COLOR;
      g.textAlign = "right";
      g.fillText(rulerText, w - 6, Math.min(h - 3, y + 13));
      g.textAlign = "left";
    }
  } else {
    g.strokeStyle = COLORS.grid;
    g.fillStyle = COLORS.text;
    for (const row of [0, 8, 16, 24, 31]) {
      const y = rowToY(row, h);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.fillText(`row ${row}`, 4, Math.min(h - 3, Math.max(11, y - 2)));
    }
    if (ruler) {
      // the ramps of the ideal clock: one row per tick, back to row 0 every 32 ticks
      g.strokeStyle = RULER_COLOR;
      g.setLineDash([2, 3]);
      g.beginPath();
      for (const r of chart.reference_clock === "jolt" ? [] : idealRamps(t0, t1, chart.tick_rate, rp)) {
        g.moveTo(timeToX(r.t0, t0, t1, w), rowToY(r.step0, h));
        g.lineTo(timeToX(r.t1, t0, t1, w), rowToY(r.step1, h));
      }
      if (chart.reference_clock === "jolt") for (const p of chart.points) {
        if (p.clock_tick === undefined || p.pts < t0 || p.pts > t1) continue;
        const x = timeToX(p.pts, t0, t1, w), y = rowToY(((p.clock_tick - rp) % 32 + 32) % 32, h);
        g.moveTo(x - 2, y); g.lineTo(x + 2, y);
      }
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = RULER_COLOR;
      g.textAlign = "right";
      g.fillText(rulerText, w - 6, 13);
      g.textAlign = "left";
    }
  }
  const visible = chart.points.filter((p) => p.pts >= t0 && p.pts <= t1 && (!ruler || Number.isFinite(p.phase)));
  if (ruler) {
    // each point's distance from the ruler, as a stem to it, shaded by how far off it is
    const levels: Record<DeviationLevel, ChartPoint[]> = { ok: [], warn: [], bad: [] };
    const level = new Map<ChartPoint, number>();
    for (const p of visible) {
      const d = deviation(p.phase, rp);
      level.set(p, d);
      levels[deviationLevel(d, ruler.tolerance)].push(p);
    }
    g.lineWidth = 1;
    for (const k of ["ok", "warn", "bad"] as const) {
      g.strokeStyle = DEVIATION_COLORS[k];
      g.beginPath();
      for (const p of levels[k]) {
        const x = timeToX(p.pts, t0, t1, w);
        const d = level.get(p) ?? 0;
        g.moveTo(x, kind === "phase" ? phaseToY(relativePhase(p.phase, ref), h) : rowToY(p.step, h));
        g.lineTo(x, kind === "phase" ? phaseToY(rulerRel, h) : rowToY(chart.reference_clock === "jolt" ? ((p.step + d) % 32 + 32) % 32 : p.step + d, h));
      }
      g.stroke();
    }
    for (const k of ["ok", "warn", "bad"] as const) {
      g.fillStyle = DEVIATION_COLORS[k];
      for (const p of levels[k]) {
        const x = timeToX(p.pts, t0, t1, w);
        const y = kind === "phase" ? phaseToY(relativePhase(p.phase, ref), h) : rowToY(p.step, h);
        g.fillRect(x - 1, y - 1, 2.5, 2.5);
      }
    }
  } else {
    g.fillStyle = COLORS.dot;
    for (const p of visible) {
      const x = timeToX(p.pts, t0, t1, w);
      const y = kind === "phase" ? phaseToY(relativePhase(p.phase, ref), h) : rowToY(p.step, h);
      g.fillRect(x - 1, y - 1, 2.5, 2.5);
    }
  }
  // where the Label tab currently is
  const cx = timeToX(timeOf(currentFrame), t0, t1, w);
  g.strokeStyle = "#f08a24";
  g.beginPath();
  g.moveTo(cx, 0);
  g.lineTo(cx, h);
  g.stroke();
  if (highlighted) {
    const startX = timeToX(timeOf(highlighted.first), t0, t1, w);
    const endX = Math.max(startX + 4, timeToX(timeOf(highlighted.last), t0, t1, w));
    const x0 = Math.max(0, startX);
    const x1 = Math.min(w, endX);
    if (x1 > x0) {
      g.fillStyle = "rgba(80,225,255,0.15)";
      g.fillRect(x0, 0, x1 - x0, h);
      g.strokeStyle = "#50e1ff";
      g.lineWidth = 2;
      g.strokeRect(x0 + 1, 1, Math.max(1, x1 - x0 - 2), h - 2);
    }
  }
}
