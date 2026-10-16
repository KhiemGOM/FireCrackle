import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "./Icon";
import { JoltChart } from "./JoltChart";
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
import { forwardTransitionChart } from "../lib/fireTransitions";
import { reviewChart,displayClockAt } from "../lib/reviewFlags";
import { ChartLegend } from "./ChartLegend";
import { PlotAxes } from "./PlotAxes";
import type { AxisRange } from "../lib/plotAxes";
import "./PhaseWorkspace.css";
import { useWheel } from "../hooks/useWheel";
import { clampViewport, fitViewport, zoomAt, type Viewport, type FrameRange } from "../lib/timeline";
import "./TimelineControls.css";
import { readTimelineView, writeTimelineView } from "../lib/viewState";
import { drawPhaseChart, GAP_COLORS, type GapBand } from "../lib/phaseChartCanvas";
import { bridgeStatus, findEvidenceGaps, gapKind, gapText, type EvidenceGap, type GapKind } from "../lib/evidenceGaps";
import { FlagCompare } from "./FlagCompare";
import { bestRulerMatch, chartReference, deviation, deviationStats, rulerPhase } from "../lib/clockRuler";

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
  const unified = useMemo(() => reviewChart(videoChart,jolt,fps),[videoChart,jolt.data,jolt.session,fps]);
  const chart = useMemo(() => jolt.clock === "jolt" ? correctedJoltChart(joltPhase(unified, reference), reference) : unified, [unified, reference, jolt.clock]);
  const displayPoints = useMemo(()=>(chart?.display_points??chart?.points??[]).slice().sort((a,b)=>a.pts-b.pts),[chart]);
  const originTick = useMemo(()=>chart?.clock_origin_tick ?? reference.tickAt(reference.sampleTimes[0]) ?? 0,[chart,reference]);
  const axisKey = `${videoKey ?? ""}:${jolt.clock}:${jolt.session}`;
  const total = useMemo(()=>chart?.corrected_time ? Math.max(1, Math.ceil(Math.max((chart.clock_segments ?? []).reduce((end,s)=>Math.max(end,s.t1),0), displayPoints.reduce((end,p)=>Math.max(end,p.pts),0), ((displayClockAt(reference,Math.max(0,(view.frame_count-1)/fps))?.tick??originTick)-originTick)/20) * fps) + 1) : Math.max(view.frame_count, 1),[chart,displayPoints,reference,originTick,fps,view.frame_count]);
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
  const [viewMode,setViewMode]=useState<"phase"|"row"|"jolt">("phase");
  const [fullscreen,setFullscreen]=useState(false);
  const [phaseRange,setPhaseRange]=useState<AxisRange|undefined>(undefined);
  const [rowRange,setRowRange]=useState<AxisRange|undefined>(undefined);
  const [inspecting,setInspecting]=useState(false);
  const [rulerOpacity,setRulerOpacity]=useState(0.35);
  function changeClock(next:JoltState) {
    setJolt(next); setHover(null); setHoverFlag(null); setSelectedRange(null); setSelectedFlag(null); setInspecting(false); setRulerMatch(null); setPhaseRange(undefined); setRowRange(undefined);
  }
  const drag = useRef<{ x: number; viewport: Viewport; moved: boolean } | null>(null);

  const joltFocusRange = useMemo<AxisRange|null>(()=>selectedRange?[selectedRange.first/fps,selectedRange.last/fps]:null,[selectedRange,fps]);
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
      // Keep source evidence intact before clock conversion and viewport-only rendering reduction.
      .phaseChart(Math.max(1,view.frame_count),source)
      .then((c) => !cancelled && (setChart(forwardTransitionChart(c)), setError(null)))
      .catch((e) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [backend, version, source, videoKey, view.frame_count]);

  const pointTimes = useMemo(()=>new Map(displayPoints.map(p=>[p.frame,p.pts])),[displayPoints]);
  const timeOf = (frame: number) => {
    if(!chart?.corrected_time)return frame/fps;
    const known=pointTimes.get(frame);
    if(known!==undefined)return known;
    const tick=displayClockAt(reference,frame/fps)?.tick??null;
    return tick===null ? NaN : (tick-originTick)/20;
  };
  /** Points within this many ticks of the ruler count as on time: half the width of a steady run's arc. */
  const tolerance = Math.max(0.05, (chart?.window_ticks ?? 1) / 2);
  const ruler = rulerOn && chart ? { offset: rulerOffset, tolerance, opacity:rulerOpacity } : null;
  const rulerAt = chart ? rulerPhase(chartReference(chart), rulerOffset) : 0;
  const rulerStats = useMemo(()=>chart && rulerOn ? deviationStats(chart.points, rulerAt, tolerance) : null,[chart,rulerOn,rulerAt,tolerance]);


  useEffect(() => {
    const redraw = () => {
      const options = { chart, timeOf, currentFrame: view.current, fps, t0, t1, highlighted, pixelRatio: window.devicePixelRatio || 1, gaps, ruler };
      drawPhaseChart(phaseRef.current, { ...options, kind: "phase", yRange: phaseRange });
      drawPhaseChart(rowRef.current, { ...options, kind: "row", yRange: rowRange });
    };
    redraw();
    const ro = new ResizeObserver(redraw);
    if (phaseRef.current) ro.observe(phaseRef.current);
    if (rowRef.current) ro.observe(rowRef.current);
    return () => ro.disconnect();
  }, [chart, gaps, view.current, t0, t1, highlighted?.first, highlighted?.last, rulerOn, rulerOffset, rulerOpacity, tolerance, phaseRange, rowRange, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Selection never changes the clock or chart view. Missing-clock positions
    // are display estimates, identified separately from independent evidence.
    setSelectedFlag(flag);
    setInspecting(false);
    setSelectedRange(range);
    setHoverFlag(null);
    const index=flag?chart?.flags.findIndex(f=>f===flag||(f.frame===flag.frame&&f.end_frame===flag.end_frame&&f.kind===flag.kind))??-1:-1;
    const position=index>=0?chart?.flag_positions?.[index]:undefined;
    const first=position?.t0??timeOf(range.first),last=position?.t1??timeOf(range.last);
    if(Number.isFinite(first)&&Number.isFinite(last))setViewport(focusChartRange({first:first*fps,last:last*fps},total,logicalWidth,fps));
    phaseRef.current?.scrollIntoView({block:"nearest",behavior:"smooth"});
  }

  function locate(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!chart) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const spans = flagSpans(chart.flags, timeOf, t0, t1, r.width,4,chart.flag_positions);
    const flagIdx = hitFlag(spans, x);
    const t = xToTime(x, t0, t1, r.width);
    const nearest = nearestPoint(displayPoints, t);
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
        if (width > 0) setViewport({...d.viewport,start:d.viewport.start-dx/width*logicalWidth/d.viewport.pxPerFrame});
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
      setHover(`frame ${p.frame} · ${formatTimecode(p.video_pts ?? p.pts, fps)} · row ${p.step} · timing offset ${offset > 0 ? "+" : ""}${offset.toFixed(2)} ticks${p.clock_tick===undefined?"":` · corrected elapsed ${p.pts.toFixed(3)} s (${p.clock_fallback?"DISPLAY ESTIMATE · Jolt missing":p.clock_estimated?"estimated between anchors":"observed"})`}${fromRuler === null ? "" : ` · ${fromRuler > 0 ? "+" : ""}${fromRuler.toFixed(2)} from the ruler (${fromRuler > 0 ? "lagging" : fromRuler < 0 ? "ahead" : "on time"})`}${sources?` · ${sources}`:""}`);
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
    <IconButton icon="fit" label={`Fit entire ${name} timeline`} onClick={() => {setViewport(fitViewport(total, logicalWidth));setPhaseRange(undefined);setRowRange(undefined);}} />
    <span>{chart?.corrected_time ? `${Number((originTick+20*t0).toFixed(2))} – ${Number((originTick+20*t1).toFixed(2))} · canonical ticks` : `${formatTime(t0, 0.01)} – ${formatTime(t1, 0.01)} · video time`} · wheel to zoom · drag to pan · linked charts</span>
  </div>;

  useEffect(()=>{
    if(!fullscreen)return;
    const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"&&!inspecting){e.preventDefault();e.stopPropagation();setFullscreen(false);}};
    window.addEventListener("keydown",escape,true);
    return ()=>window.removeEventListener("keydown",escape,true);
  },[fullscreen,inspecting]);
  const axisX=(range:AxisRange)=>setViewport(clampViewport({start:range[0]*fps,pxPerFrame:logicalWidth/((range[1]-range[0])*fps)},logicalWidth,total));
  const resetX=()=>setViewport(fitViewport(total,logicalWidth));
  return (
    <main className={`phase-tab phase-workspace ${fullscreen?"fullscreen":""}`}>
        <header className="phase-clockbar">
        <JoltPanel backend={backend} videoKey={videoKey} state={jolt} onChange={changeClock} matched={jolt.clock === "jolt" ? chart?.points.length ?? 0 : null} t0={t0} t1={t1} onFocus={(time,openVideo)=>{
          const locateFrame = backend.joltFrame && videoKey ? backend.joltFrame(videoKey,time) : Promise.resolve(nearestPoint(chart?.points ?? [],time)?.frame ?? Math.round(time*fps));
          void locateFrame.then(frame=>openVideo ? onJump(frame) : focusRange({first:frame,last:frame})).catch(e=>setError(messageOf(e)));
        }} />
        <div className="phase-source-control"><PhaseSourcePicker value={source} onChange={value=>{setSource(value);setChart(null);setHoverFlag(null);setSelectedRange(null);setSelectedFlag(null);}} /></div>
        </header>
      <div className="phase-layout">
      <div className="phase-plots">
      <div className="phase-topbar">
        <div className="phase-view-tabs" role="tablist" aria-label="Phase views">
          {([["phase","Timing"],["row","Sprites"],["jolt","Jolt + Fire"]] as const).map(([id,label])=><button key={id} role="tab" aria-selected={viewMode===id} onClick={()=>setViewMode(id)}>{label}</button>)}
        </div>
        <span className="dim">{viewMode==="jolt"?"Jolt + Fire · shared video timeline":jolt.clock==="jolt"?"Canonical time · GUI ticks":"Video time"}</span>
        <button className="icon-button icon-only" onClick={()=>setFullscreen(!fullscreen)} aria-pressed={fullscreen} aria-label={fullscreen?"Exit fullscreen":"Fullscreen chart"} title={fullscreen?"Exit fullscreen (Esc)":"Fullscreen chart"}><svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={fullscreen?"M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5":"M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"} /></svg></button>
      </div>
      {error && <div className="banner error">{error}</div>}
      <section className="chart-area">
        <div hidden={viewMode!=="jolt"}><JoltChart key={`${videoKey}:${jolt.session}`} state={jolt} chart={unified} focusRange={joltFocusRange} onOpenTime={time=>{const frame=backend.joltFrame&&videoKey?backend.joltFrame(videoKey,time):Promise.resolve(Math.max(0,Math.min(view.frame_count-1,Math.round(time*fps))));void frame.then(onJump).catch(e=>setError(messageOf(e)));}}/></div>

        <div hidden={viewMode==="jolt"}>
        <div className="chart-head" hidden={viewMode!=="phase"}>
          <span className="panel-title">{jolt.clock === "jolt" ? "Fire timing offset (canonical time)" : "Animation timing offset (ticks)"}</span>
          <span className="dim">
            {jolt.clock === "jolt" ? "Jolt supplies canonical time. Timing offset = canonical tick − fire step, relative to the starting offset. Dashed ruler sections between readings are estimates; reported clock breaks stay disconnected." : `Zero = the reference ${chart?.tick_rate ?? 20} Hz animation clock.`} Source filter controls the evidence shown. Red/amber = review priority.
          </span>
        </div>
        {chart && displayPoints.length === 0 ? (
          <div className="empty big-empty">{jolt.clock === "jolt" ? "No fire labels within a resolved Jolt section for this game and source. Choose another source/game or label frames inside a section." : "No fire labels for this source. Choose another source, run the first-person tool, or choose a sprite and confirm it in Label. Time guesses are excluded from the default evidence."}</div>
        ) : (
          <>
            <details className="phase-help"><summary>Ruler & fit</summary>
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
                <label>Opacity <input type="range" aria-label="Ruler opacity" min={0} max={1} step={0.05} value={rulerOpacity} onChange={e=>setRulerOpacity(e.target.valueAsNumber)} /> {Math.round(rulerOpacity*100)}%</label>
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
            </details>
            <div hidden={viewMode!=="phase"}>
            {controls("timing offset")}
            <ChartLegend kind="phase" canonical={!!chart?.corrected_time} ruler={rulerOn}/>
            <PlotAxes formatX={t=>chart?.corrected_time?String(Number((originTick+20*t).toFixed(2))):`${t<0?"−":""}${formatTime(Math.abs(t),0.01)}`} x={[t0,t1]} y={phaseRange??[-16,16]} onX={axisX} onY={setPhaseRange} resetX={resetX} resetY={()=>setPhaseRange(undefined)}><canvas ref={phaseRef} className="chart phase" {...chartEvents} /></PlotAxes>
            </div>
            <div className="chart-head" hidden={viewMode!=="row"}>
              <span className="panel-title">Sprite row against time</span>
              <span className="dim">{jolt.clock === "jolt" ? "Fire rows against canonical time. The ruler continues through fire-free sections wherever the clock is known." : "the sawtooth you should see: 32 rows, one step per tick (about every 3rd frame at 60 fps)."}</span>
            </div>
            <div hidden={viewMode!=="row"}>
            {controls("sprite row")}
            <ChartLegend kind="row" canonical={!!chart?.corrected_time} ruler={rulerOn}/>
            <PlotAxes formatX={t=>chart?.corrected_time?String(Number((originTick+20*t).toFixed(2))):`${t<0?"−":""}${formatTime(Math.abs(t),0.01)}`} x={[t0,t1]} y={rowRange??[0,31]} onX={axisX} onY={setRowRange} resetX={resetX} resetY={()=>setRowRange(undefined)}><canvas ref={rowRef} className="chart row" {...chartEvents} /></PlotAxes>
            </div>
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

        </div>
      </section>
      </div>
      <aside className="phase-sidebar" aria-label="Phase flags sidebar">
      <p className="dim sidebar-hint">Click to locate · Ctrl+click to open in Label</p>
      <FlagsPanel flags={unified?.flags ?? []} details={unified?.flag_details} fps={fps} current={selectedRange?.first ?? view.current} onSeek={onJump}
        onHover={setHoverFlag} onSelect={(flag,openVideo) => openVideo ? onJump(flag.frame) : focusRange({first:flag.frame,last:flag.end_frame}, flag)} />
      {selectedFlag && <button className="inspect-video" onClick={()=>setInspecting(true)}>Inspect video around selected flag</button>}
      </aside>
      </div>
        {unified && inspecting && selectedFlag && unified.flags.some((f) => f.frame === selectedFlag.frame && f.kind === selectedFlag.kind) && (
          <FlagCompare backend={backend} chart={unified} flag={selectedFlag} fps={fps} onOpen={onJump} onClose={() => setInspecting(false)} />
        )}
    </main>
  );
}
