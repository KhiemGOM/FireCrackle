import { flagSpans, phaseToY, relativePhase, rowToY, timeToX, type ChartPoint, type PhaseChart } from "./chart";
import { chartReference, deviation, deviationLevel, idealRamps, rulerPhase, type DeviationLevel } from "./clockRuler";
import type { GapKind } from "./evidenceGaps";
import type { FrameRange } from "./timeline";
import { denseRowRuler, phasePaintPoints } from "./phaseChartLod";

const COLORS = { dot: "#4a90d9", band: "rgba(76,195,138,0.16)", grid: "#2a3142", text: "#8b96ab" };
const RULER_COLOR = "#e8eefc";

/** A short circular displacement must not become a line across the whole displayed cycle. */
function wrappedStem(start:number,delta:number,min:number):[number,number][] {
  const max=min+32,end=start+delta;
  if(end>max)return [[start,max],[min,end-32]];
  if(end<min)return [[start,min],[max,end+32]];
  return [[start,end]];
}

/** Dots and stems when the ruler is on: inside the tolerance, up to twice it, beyond. */
export const DEVIATION_COLORS: Record<DeviationLevel, string> = { ok: "#4cc38a", warn: "#f5c542", bad: "#ff4d4f" };

/** The perfect-clock ruler: `offset` ticks from the chart's reference phase, `tolerance` ticks either side counted as on time. */
export interface RulerOptions {
  offset: number;
  tolerance: number;
  /** Guide only; observed points and their deviation stems stay fully visible. */
  opacity?: number;
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
  timeOf?: (frame: number) => number;
  yRange?: [number,number];
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
  const timeOf = options.timeOf ?? ((frame: number) => frame / fps);
  const yRange=options.yRange;
  const axisY=(value:number)=>yRange ? h*(yRange[1]-value)/(yRange[1]-yRange[0]) : 0;
  const phaseY=(value:number,height:number)=>yRange?axisY(value):phaseToY(value,height);
  const rowY=(value:number,height:number)=>yRange?axisY(value):rowToY(value,height);
  if (!canvas || !chart) return;
  const dpr = pixelRatio;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const backingWidth = Math.max(1, Math.round(w * dpr)), backingHeight = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.lineWidth = 1;
  g.clearRect(0, 0, w, h);
  g.font = "11px system-ui, sans-serif";
  for(const gap of chart.clock_breaks ?? []) {
    const x0=Math.max(0,timeToX(gap.t0,t0,t1,w)),x1=Math.min(w,timeToX(gap.t1,t0,t1,w));
    if(x1<x0)continue;
    g.fillStyle="rgba(245,197,66,0.16)";
    g.fillRect(x0,0,Math.max(2,x1-x0),h);
  }
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
  const rulerOpacity=Math.max(0,Math.min(1,ruler?.opacity??0.35));
  const rp = ruler ? rulerPhase(ref, ruler.offset) : 0;
  const rulerRel = ruler ? relativePhase(rp, ref) : 0;
  const rulerText = `perfect clock ${rulerRel > 0 ? "+" : ""}${Number(rulerRel.toFixed(2))}`;
  if (kind === "phase") {
    g.strokeStyle = COLORS.grid;
    g.fillStyle = COLORS.text;
    for (const rel of yRange ? [yRange[0],(yRange[0]+yRange[1])/2,yRange[1]] : [-16, -8, 0, 8, 16]) {
      const y = phaseY(rel, h);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.fillText(`${rel > 0 ? "+" : ""}${Number(rel.toFixed(2))}`, 4, Math.min(h - 3, Math.max(11, y - 2)));
    }
    // each run's arc as a band: the stretch a steady clock would stay in
    g.fillStyle = COLORS.band;
    for (const r of chart.runs) {
      const x0 = timeToX(timeOf(r.first_frame), t0, t1, w);
      const x1 = Math.max(timeToX(timeOf(r.last_frame), t0, t1, w), x0 + 1);
      const rel = relativePhase(r.center, ref);
      const top = phaseY(rel + r.width / 2, h);
      const bottom = phaseY(rel - r.width / 2, h);
      g.fillRect(x0, top, x1 - x0, Math.max(1, bottom - top));
    }
    if (chart.reference_phase != null) {
      const y = phaseY(0, h);
      g.strokeStyle = "#4cc38a";
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#4cc38a";
      g.textAlign = "right";
      g.fillText(chart.reference_clock === "jolt" ? "Corrected clock reference" : `${chart.tick_rate} Hz reference`, w - 6, Math.max(11, y - 5));
      g.textAlign = "left";
    }
    if (ruler) {
      g.globalAlpha=rulerOpacity;
      const top = phaseY(rulerRel + ruler.tolerance, h);
      g.fillStyle = "rgba(232,238,252,0.08)";
      g.fillRect(0, top, w, phaseY(rulerRel - ruler.tolerance, h) - top);
      const y = phaseY(rulerRel, h);
      g.strokeStyle = RULER_COLOR;
      g.setLineDash([2, 3]);
      g.beginPath();
      const coverage=chart.reference_clock==="jolt" ? chart.clock_segments??[] : [{t0,t1}];
      for(const segment of coverage){
        const x0=Math.max(0,timeToX(segment.t0,t0,t1,w)),x1=Math.min(w,timeToX(segment.t1,t0,t1,w));
        if(x1>x0){g.moveTo(x0,y);g.lineTo(x1,y);}
      }
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = RULER_COLOR;
      g.textAlign = "right";
      g.fillText(rulerText, w - 6, Math.min(h - 3, y + 13));
      g.textAlign = "left";
      g.globalAlpha=1;
    }
  } else {
    g.strokeStyle = COLORS.grid;
    g.fillStyle = COLORS.text;
    for (const row of yRange ? [yRange[0],(yRange[0]+yRange[1])/2,yRange[1]] : [0, 8, 16, 24, 31]) {
      const y = rowY(row, h);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.fillText(`row ${Number(row.toFixed(2))}`, 4, Math.min(h - 3, Math.max(11, y - 2)));
    }
    if (ruler) {
      g.globalAlpha=rulerOpacity;
      // the ramps of the ideal clock: one row per tick, back to row 0 every 32 ticks
      g.strokeStyle = RULER_COLOR;
      g.setLineDash([2, 3]);
      g.beginPath();
      const densityBand = (start: number, end: number) => {
        const x0 = Math.max(0, timeToX(start, t0, t1, w)), x1 = Math.min(w, timeToX(end, t0, t1, w));
        const top = Math.max(0, rowY(32, h)), bottom = Math.min(h, rowY(0, h));
        if (x1 > x0 && bottom > top) {
          g.fillStyle = "rgba(232,238,252,0.10)";
          g.fillRect(x0, top, x1 - x0, bottom - top);
        }
      };
      const denseVideo = chart.reference_clock !== "jolt" && denseRowRuler(t0, t1, chart.tick_rate, w);
      if (denseVideo) densityBand(t0, t1);
      for (const r of chart.reference_clock === "jolt" || denseVideo ? [] : idealRamps(t0, t1, chart.tick_rate, rp)) {
        g.moveTo(timeToX(r.t0, t0, t1, w), rowY(r.step0, h));
        g.lineTo(timeToX(r.t1, t0, t1, w), rowY(r.step1, h));
      }
      if (chart.reference_clock === "jolt") for (const segment of chart.clock_segments ?? []) {
        const start = Math.max(t0, segment.t0), end = Math.min(t1, segment.t1);
        if (!(end > start)) continue;
        const rate = (segment.tick1 - segment.tick0) / (segment.t1 - segment.t0);
        if (rate === 0) {
          const y = rowY(((segment.tick0 - rp) % 32 + 32) % 32, h);
          g.moveTo(timeToX(start, t0, t1, w), y); g.lineTo(timeToX(end, t0, t1, w), y);
        } else if (denseRowRuler(t0, t1, rate, w)) {
          densityBand(start, end);
        } else for (const r of idealRamps(start - segment.t0, end - segment.t0, rate, rp - segment.tick0)) {
          g.moveTo(timeToX(r.t0 + segment.t0, t0, t1, w), rowY(r.step0, h));
          g.lineTo(timeToX(r.t1 + segment.t0, t0, t1, w), rowY(r.step1, h));
        }
      }
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = RULER_COLOR;
      g.textAlign = "right";
      g.fillText(rulerText, w - 6, 13);
      g.textAlign = "left";
      g.globalAlpha=1;
    }
  }
  const visible = phasePaintPoints(chart.points, { t0, t1, width: w, kind, reference: ref, rulerPhase: ruler ? rp : undefined })
    .filter(p => !ruler || Number.isFinite(p.phase));
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
        const start=kind === "phase" ? relativePhase(p.phase,ref) : p.step;
        const y=kind === "phase" ? phaseY : rowY;
        for(const [from,to] of wrappedStem(start,kind === "phase" ? -d : d,kind === "phase" ? -16 : 0)){
          g.moveTo(x,y(from,h));
          g.lineTo(x,y(to,h));
        }
      }
      g.stroke();
    }
    for (const k of ["ok", "warn", "bad"] as const) {
      g.fillStyle = DEVIATION_COLORS[k];
      for (const p of levels[k]) {
        const x = timeToX(p.pts, t0, t1, w);
        const y = kind === "phase" ? phaseY(relativePhase(p.phase, ref), h) : rowY(p.step, h);
        g.fillRect(x - 1, y - 1, 2.5, 2.5);
      }
    }
  } else {
    g.fillStyle = COLORS.dot;
    for (const p of visible) {
      const x = timeToX(p.pts, t0, t1, w);
      const y = kind === "phase" ? phaseY(relativePhase(p.phase, ref), h) : rowY(p.step, h);
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
