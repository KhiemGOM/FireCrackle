import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "./Icon";
import { LABEL_SOURCE_NAMES, type Backend, type View, type Flag, type LabelSource } from "../lib/api";
import {
  flagSpans,
  focusChartRange,
  hitFlag,
  nearestPoint,
  relativePhase,
  xToTime,
  type PhaseChart,
} from "../lib/chart";
import { formatTime } from "../lib/timeline";
import { formatTimecode } from "../lib/timecode";
import { messageOf } from "../hooks/useWorkspace";
import { FlagsPanel } from "./FlagsPanel";
import { PhaseSourcePicker } from "./PhaseSourcePicker";
import { JoltPanel } from "./JoltPanel";
import { EMPTY_JOLT, correctedJoltChart, joltPhase, timeReference, type JoltState } from "../lib/jolt";
import { useWheel } from "../hooks/useWheel";
import { fitViewport, pan, zoomAt, type Viewport, type FrameRange } from "../lib/timeline";
import "./TimelineControls.css";
import { readTimelineView, writeTimelineView } from "../lib/viewState";
import { drawPhaseChart, GAP_COLORS, type GapBand } from "../lib/phaseChartCanvas";
import { bridgeStatus, findEvidenceGaps, gapKind, gapText, type EvidenceGap, type GapKind } from "../lib/evidenceGaps";
import { FlagCompare } from "./FlagCompare";
import { bestRulerMatch, chartReference, deviation, deviationStats, rulerPhase } from "../lib/clockRuler";

/** Most points the backend sends: a bit more than the pixels a wide window has. */
const MAX_POINTS = 4000;
/** Stretches without fire evidence at least this long are drawn and explained. */
const MIN_GAP_SECONDS = 2;
/** Gaps beyond this many are drawn as unlabelled, so a sparse recording does not cost one request each. */
const MAX_CLASSIFIED_GAPS = 80;

interface GapInfo extends GapBand {
  gap: EvidenceGap;
  text: string;
}

interface Props {
  videoKey?: string;
  backend: Backend;
  view: View;
  /** Changes whenever labels changed. */
  version: number;
  /** Jump to a frame in the Label tab. */
  onJump: (frame: number) => void;
}

/** The Phase tab: phase against time, the sprite row against time, and every flag, clickable. */
export function PhaseTab({ backend, view, version, onJump, videoKey }: Props) {
  const [videoChart, setChart] = useState<PhaseChart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverFlag, setHoverFlag] = useState<Flag | null>(null);
  const [selectedRange, setSelectedRange] = useState<FrameRange | null>(null);
  const phaseRef = useRef<HTMLCanvasElement>(null);
  const rowRef = useRef<HTMLCanvasElement>(null);
  const fps = view.fps || 1;
  const [jolt, setJolt] = useState<JoltState>(() => ({...EMPTY_JOLT}));
  const reference = useMemo(() => timeReference(jolt), [jolt]);
  const chart = useMemo(() => jolt.clock === "jolt" ? correctedJoltChart(joltPhase(videoChart, reference), reference) : videoChart, [videoChart, reference, jolt.clock]);
  const originTick = reference.tickAt(reference.sampleTimes[0]) ?? 0;
  const axisKey = `${videoKey ?? ""}:${jolt.clock}:${jolt.session}`;
  const total = chart?.corrected_time ? Math.max(1, Math.ceil(Math.max((chart.clock_segments ?? []).reduce((end,s)=>Math.max(end,s.t1),0), chart.points.reduce((end,p)=>Math.max(end,p.pts),0)) * fps) + 1) : Math.max(view.frame_count, 1);
  // A fixed logical width keeps the two charts on exactly the same time range.
  const logicalWidth = 1000;
  const [viewport, setViewport] = useState(() => readTimelineView(axisKey, "phase", total, logicalWidth));
  const [source,setSource]=useState<"independent"|LabelSource>("independent");
  const [selectedFlag, setSelectedFlag] = useState<Flag | null>(null);
  const [gaps, setGaps] = useState<GapInfo[]>([]);
  // the perfect-clock ruler: what a video with no timing deviation would show, moved by `rulerOffset` ticks
  const [rulerOn, setRulerOn] = useState(false);
  const [rulerOffset, setRulerOffset] = useState(0);
  const [rulerMatch, setRulerMatch] = useState<{ offset: number; text: string } | null>(null);
  function changeClock(next:JoltState) {
    setJolt(next); setHover(null); setHoverFlag(null); setSelectedRange(null); setSelectedFlag(null); setRulerMatch(null);
  }
  const drag = useRef<{ x: number; viewport: Viewport; moved: boolean } | null>(null);
  const highlighted = hoverFlag ? { first: hoverFlag.frame, last: hoverFlag.end_frame } : selectedRange;
  const t0 = viewport.start / fps;
  const t1 = (viewport.start + logicalWidth / viewport.pxPerFrame) / fps;
  useEffect(() => setViewport(readTimelineView(axisKey, "phase", total, logicalWidth)), [axisKey, total]);
  useEffect(() => { writeTimelineView(axisKey, "phase", total, logicalWidth, viewport); }, [axisKey, total, viewport]);
  const zoomChart = (factor: number, anchor = logicalWidth / 2) =>
    setViewport((v) => zoomAt(v, anchor, factor, 32, logicalWidth, total));
  const wheelChart = (e: WheelEvent) => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    if (!r.width || !e.deltaY) return false;
    zoomChart(e.deltaY < 0 ? 1.5 : 1 / 1.5, (e.clientX - r.left) / r.width * logicalWidth);
    return true;
  };
  useWheel(phaseRef, wheelChart);
  useWheel(rowRef, wheelChart);

  useEffect(() => {
    let cancelled = false;
    backend
      .phaseChart(MAX_POINTS,source)
      .then((c) => !cancelled && (setChart(c), setError(null)))
      .catch((e) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [backend, version, source, videoKey]);

  const pointTimes = useMemo(()=>new Map(chart?.points.map(p=>[p.frame,p.pts]) ?? []),[chart]);
  const timeOf = (frame: number) => {
    if(!chart?.corrected_time)return frame/fps;
    const known=pointTimes.get(frame);
    if(known!==undefined)return known;
    const tick=reference.tickAt(frame/fps);
    return tick===null ? NaN : (tick-originTick)/20;
  };
  /** Points within this many ticks of the ruler count as on time: half the width of a steady run's arc. */
  const tolerance = Math.max(0.05, (chart?.window_ticks ?? 1) / 2);
  const ruler = rulerOn && chart ? { offset: rulerOffset, tolerance } : null;
  const rulerAt = chart ? rulerPhase(chartReference(chart), rulerOffset) : 0;
  const rulerStats = chart && rulerOn ? deviationStats(chart.points, rulerAt, tolerance) : null; // at most MAX_POINTS points


  useEffect(() => {
    const redraw = () => {
      const options = { chart, timeOf, currentFrame: view.current, fps, t0, t1, highlighted, pixelRatio: window.devicePixelRatio || 1, gaps, ruler };
      drawPhaseChart(phaseRef.current, { ...options, kind: "phase" });
      drawPhaseChart(rowRef.current, { ...options, kind: "row" });
    };
    redraw();
    const ro = new ResizeObserver(redraw);
    if (phaseRef.current) ro.observe(phaseRef.current);
    return () => ro.disconnect();
  }, [chart, gaps, view.current, t0, t1, highlighted?.first, highlighted?.last, rulerOn, rulerOffset, tolerance]); // eslint-disable-line react-hooks/exhaustive-deps

  // stretches with no fire evidence: found from the frames that have evidence, classified by their labels
  useEffect(() => {
    if (!chart || chart.reference_clock === "jolt") {
      setGaps([]);
      return;
    }
    let cancelled = false;
    const frames = chart.label_sources ? Object.keys(chart.label_sources).map(Number) : chart.points.map((p) => p.frame);
    const found = findEvidenceGaps(frames, view.frame_count, fps, MIN_GAP_SECONDS);
    const build = (g: EvidenceGap, kind: GapKind): GapInfo => ({ first: g.first, last: g.last, kind, gap: g, text: gapText(g, kind, bridgeStatus(g, chart.points)) });
    setGaps(found.map((g) => build(g, "unlabelled")));
    void Promise.all(
      found.map((g, i) => (i < MAX_CLASSIFIED_GAPS ? backend.timeline(g.first, g.last + 1, 1).then((b) => gapKind(b[0] ?? null)).catch(() => "unlabelled" as GapKind) : Promise.resolve("unlabelled" as GapKind))),
    ).then((kinds) => !cancelled && setGaps(found.map((g, i) => build(g, kinds[i]))));
    return () => {
      cancelled = true;
    };
  }, [chart, backend, fps, view.frame_count]);

  function focusRange(range: FrameRange, flag: Flag | null = null) {
    setSelectedFlag(flag);
    setSelectedRange(range);
    setHoverFlag(null);
    const first=timeOf(range.first),last=timeOf(range.last);
    if(Number.isFinite(first)&&Number.isFinite(last))setViewport(focusChartRange({first:first*fps,last:last*fps},total,logicalWidth,fps));
    phaseRef.current?.scrollIntoView({block:"nearest",behavior:"smooth"});
  }

  function locate(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!chart) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const spans = flagSpans(chart.flags, timeOf, t0, t1, r.width);
    const flagIdx = hitFlag(spans, x);
    const t = xToTime(x, t0, t1, r.width);
    const nearest = nearestPoint(chart.points, t);
    const point = nearest && nearest.pts >= t0 && nearest.pts <= t1 ? nearest : null;
    return { flagIdx, point, t };
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 4) d.moved = true;
      if (d.moved) {
        const width = e.currentTarget.getBoundingClientRect().width;
        if (width > 0) setViewport(pan(d.viewport, dx / width * logicalWidth, logicalWidth, total));
        setHover(null);
        return;
      }
    }
    const hit = locate(e);
    if (!hit) return;
    if (hit.flagIdx !== null) {
      const f = chart!.flags[hit.flagIdx];
      setHover(`${f.severity} flag · frame ${f.frame}${f.end_frame > f.frame ? `–${f.end_frame}` : ""} · Δ ${f.phase_delta.toFixed(1)} ticks · click to focus · Ctrl+click to open video`);
    } else if (hit.point) {
      const p = hit.point;
      const reference = chart!.reference_phase ?? chart!.runs[0]?.center ?? chart!.points[0]?.phase ?? 0;
      const offset = relativePhase(p.phase, reference);
      const sources=(chart!.label_sources?.[p.frame]??[]).map(s=>LABEL_SOURCE_NAMES[s]).join(" + ");
      const fromRuler = rulerOn ? deviation(p.phase, rulerAt) : null;
      setHover(`frame ${p.frame} · ${formatTimecode(p.video_pts ?? p.pts, fps)} · row ${p.step} · timing offset ${offset > 0 ? "+" : ""}${offset.toFixed(2)} ticks${p.clock_tick===undefined?"":` · corrected elapsed ${p.pts.toFixed(3)} s (${p.clock_estimated?"estimated between anchors":"observed"})`}${fromRuler === null ? "" : ` · ${fromRuler > 0 ? "+" : ""}${fromRuler.toFixed(2)} from the ruler (${fromRuler > 0 ? "lagging" : fromRuler < 0 ? "ahead" : "on time"})`}${sources?` · ${sources}`:""}`);
    } else {
      const frame = Math.round(hit.t * fps);
      const inGap = gaps.find((g) => frame >= g.first && frame <= g.last);
      setHover(inGap ? inGap.text : null);
    }
  }

  function onClick(e: React.PointerEvent<HTMLCanvasElement>) {
    const hit = locate(e);
    if (!hit) return;
    const flag = hit.flagIdx !== null ? chart!.flags[hit.flagIdx] : null;
    const frame = flag?.frame ?? hit.point?.frame;
    if (frame === undefined) return;
    if (e.ctrlKey) onJump(frame);
    else focusRange({first:frame,last:flag?.end_frame ?? frame}, flag);
  }

  const chartEvents = {
    draggable: false,
    onDragStart: (e: React.DragEvent<HTMLCanvasElement>) => e.preventDefault(),
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      e.preventDefault(); // Native text/selection dragging otherwise cancels pointer panning in WebView2.
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, viewport, moved: false };
    },
    onPointerMove: onMove,
    onPointerLeave: () => setHover(null),
    onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => {
      const d = drag.current;
      drag.current = null;
      if (d && !d.moved) onClick(e);
    },
    onPointerCancel: () => { drag.current = null; },
    onLostPointerCapture: () => { drag.current = null; },
  };

  const controls = (name: string) => <div className="timeline-controls" aria-label={`${name} timeline zoom`}>
    <IconButton icon="zoomOut" label={`Zoom out ${name} timeline`} onClick={() => zoomChart(1 / 1.5)} />
    <IconButton icon="zoomIn" label={`Zoom in ${name} timeline`} onClick={() => zoomChart(1.5)} />
    <IconButton icon="fit" label={`Fit entire ${name} timeline`} onClick={() => setViewport(fitViewport(total, logicalWidth))} />
    <span>{formatTime(t0, 0.01)} – {formatTime(t1, 0.01)}{chart?.corrected_time ? " · corrected elapsed time" : " · video time"} · wheel to zoom · drag to pan · linked charts</span>
  </div>;

  return (
    <main className="phase-tab">
      {error && <div className="banner error">{error}</div>}
      <section className="chart-area">
        <JoltPanel backend={backend} videoKey={videoKey} state={jolt} onChange={changeClock} matched={jolt.clock === "jolt" ? chart?.points.length ?? 0 : null} t0={t0} t1={t1} onFocus={(time,openVideo)=>{
          const locateFrame = backend.joltFrame && videoKey ? backend.joltFrame(videoKey,time) : Promise.resolve(nearestPoint(chart?.points ?? [],time)?.frame ?? Math.round(time*fps));
          void locateFrame.then(frame=>openVideo ? onJump(frame) : focusRange({first:frame,last:frame})).catch(e=>setError(messageOf(e)));
        }} />
        <PhaseSourcePicker value={source} onChange={value=>{setSource(value);setChart(null);setHoverFlag(null);setSelectedRange(null);setSelectedFlag(null);}} />
        <span className="dim">Tool labels have not been human checked unless both sources are shown. Inspect the timing chart for anything unusual. Time guesses are excluded from the default phase evidence.</span>
        <div className="chart-head">
          <span className="panel-title">{jolt.clock === "jolt" ? "Fire timing offset (corrected time)" : "Animation timing offset (ticks)"}</span>
          <span className="dim">
            {jolt.clock === "jolt" ? "Jolt supplies elapsed time. Timing offset = GUI tick − fire step, relative to the starting offset. Dashed ruler sections between readings are estimates; reported clock breaks stay disconnected." : `Zero = the reference ${chart?.tick_rate ?? 20} Hz animation clock.`} Source filter controls the evidence shown. Red/amber = review priority.
          </span>
        </div>
        {chart && chart.points.length === 0 ? (
          <div className="empty big-empty">{jolt.clock === "jolt" ? "No fire labels within a resolved Jolt section for this game and source. Choose another source/game or label frames inside a section." : "No fire labels for this source. Choose another source, run the first-person tool, or choose a sprite and confirm it in Label. Time guesses are excluded from the default evidence."}</div>
        ) : (
          <>
            <div className="ruler-bar" aria-label="Perfect clock ruler">
              <label><input type="checkbox" checked={rulerOn} onChange={(e) => setRulerOn(e.target.checked)} /> Perfect-clock ruler</label>
              <button title="Fit the ruler to the labelled frames: least squares, with frames far from the fit ignored (cuts, lag, other steady stretches)" disabled={!chart || chart.points.length === 0} onClick={() => {
                if (!chart) return;
                const m = bestRulerMatch(chart.points, chartReference(chart), tolerance);
                if (!m) { setRulerMatch(null); return; }
                const offset = Number(m.offset.toFixed(2));
                setRulerOn(true);
                setRulerOffset(offset);
                setRulerMatch({ offset, text: `Best match: ${offset > 0 ? "+" : ""}${offset} ticks · ${m.inliers} of ${m.count} frames fit (rms ${m.rmse.toFixed(2)}); the rest are treated as outliers` });
              }}>Find best match</button>
              {rulerOn && <>
                <label>Offset <input type="range" aria-label="Ruler offset slider" min={-16} max={16} step={0.05} value={rulerOffset} onChange={(e) => setRulerOffset(e.target.valueAsNumber)} />
                  <input type="number" aria-label="Ruler offset in ticks" min={-16} max={16} step={0.05} value={Number(rulerOffset.toFixed(2))} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setRulerOffset(Math.max(-16, Math.min(16, e.target.valueAsNumber)))} /> ticks</label>
                <IconButton icon="reset" label="Reset ruler offset to the reference clock" disabled={rulerOffset === 0} onClick={() => setRulerOffset(0)} />
                {rulerMatch && rulerMatch.offset === rulerOffset && <span role="status" className="ruler-match">{rulerMatch.text}</span>}
                {rulerStats && rulerStats.count > 0 && <span role="status" className="ruler-stats">
                  {rulerStats.within} of {rulerStats.count} labelled frames within ±{Number(tolerance.toFixed(2))} ticks · average {rulerStats.meanAbs.toFixed(2)} · worst {rulerStats.maxAbs.toFixed(2)}
                </span>}
                <span className="ruler-key"><i className="ok" />on time <i className="warn" />off by up to 2× <i className="bad" />further · stems join each frame to the ruler · + = sprite lags the ideal clock</span>
              </>}
            </div>
            {controls("timing offset")}
            <canvas ref={phaseRef} className="chart phase" {...chartEvents} />
            <div className="chart-head">
              <span className="panel-title">Sprite row against time</span>
              <span className="dim">{jolt.clock === "jolt" ? "Fire rows against corrected elapsed time. The ruler continues through fire-free sections wherever the clock is known." : "the sawtooth you should see: 32 rows, one step per tick (about every 3rd frame at 60 fps)."}</span>
            </div>
            {controls("sprite row")}
            <canvas ref={rowRef} className="chart row" {...chartEvents} />
          </>
        )}
        <div className="chart-hover">{hoverFlag ? `Flag frame ${hoverFlag.frame}${hoverFlag.end_frame > hoverFlag.frame ? `–${hoverFlag.end_frame}` : ""} · ${formatTimecode(hoverFlag.frame/fps, fps)} · click to focus · Ctrl+click to open video` : hover ?? " "}</div>
        {gaps.length > 0 && (
          <details className="gap-legend">
            <summary>
              {gaps.length} stretch{gaps.length > 1 ? "es" : ""} with no fire evidence (shaded): lag, freezes and cuts inside them cannot be ruled out
            </summary>
            <div className="gap-keys">
              {(Object.keys(GAP_COLORS) as GapKind[]).map((k) => (
                <span key={k}><i style={{ background: GAP_COLORS[k].edge }} />{GAP_COLORS[k].name}</span>
              ))}
            </div>
            <ul>
              {gaps.map((g) => (
                <li key={g.first}>
                  <button className="gap-row" onClick={() => focusRange({ first: g.first, last: g.last })} title={g.text}>
                    <span className="where">frame {g.first}–{g.last} · {formatTimecode(g.first / fps, fps)}</span>
                    <span className="dim">{g.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {chart && selectedFlag && chart.flags.some((f) => f.frame === selectedFlag.frame && f.kind === selectedFlag.kind) && (
          <FlagCompare backend={backend} chart={chart} flag={selectedFlag} fps={fps} onOpen={onJump} onClose={() => setSelectedFlag(null)} />
        )}
      </section>
      <FlagsPanel flags={chart?.flags ?? []} details={chart?.flag_details} fps={fps} current={selectedRange?.first ?? view.current} onSeek={onJump}
        onHover={setHoverFlag} onSelect={(flag,openVideo) => openVideo ? onJump(flag.frame) : focusRange({first:flag.frame,last:flag.end_frame}, flag)} />
    </main>
  );
}
