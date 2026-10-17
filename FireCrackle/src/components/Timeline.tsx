import { useEffect, useMemo, useRef, useState } from "react";
import type { Backend, Bucket, Flag, SettingInfo, View } from "../lib/api";
import { settingValue } from "../lib/api";
import {
  clampViewport,
  ensureVisible,
  fitViewport,
  frameToX,
  pan,
  rulerTicks,
  visibleRange,
  xToFrame,
  zoomAt,
  wheelViewport,
  type Viewport,
} from "../lib/timeline";
import { thumbSlots, uniqueFrames, type ThumbStatus } from "../lib/thumbs";
import { useWheel } from "../hooks/useWheel";
import { IconButton } from "./Icon";
import "./TimelineControls.css";
import { readTimelineView, writeTimelineView } from "../lib/viewState";
import type { PhaseChart } from "../lib/chart";
import { forwardTransitionChart } from "../lib/fireTransitions";
import { reviewChart } from "../lib/reviewFlags";
import { EMPTY_JOLT, restoreJolt } from "../lib/jolt";
import { paintTimelineFlags } from "../lib/flagAppearance";
import { AUTOMATIC_TOOLS, paintAutomaticStrips } from "../lib/labelSources";

const RULER_H = 26;
const THUMB_Y = 30;
const THUMB_H = 48;
const LANE_H = 44;

const COLORS = {
  bg: "#12151c",
  lane: "#1d2330",
  fire: "#f08a24",
  noFire: "#4a90d9",
  skip: "#7a7f8c",
  hard: "#ff4d4f",
  soft: "#f5c542",
  tick: "#5b6577",
  text: "#9aa5b8",
  playhead: "#ffffff",
};

interface Props {
  videoKey?: string;
  backend: Backend;
  view: View;
  flags: Flag[];
  version: number;
  settings: SettingInfo[];
  onSeek: (frame: number) => void;
}

/** Editor-style timeline: wheel scrolls, Ctrl+wheel zooms, drag pans. */
export function Timeline({ backend, view, flags, version, settings, onSeek, videoKey }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(900);
  const total = view.frame_count;
  const [vp, setVp] = useState<Viewport>(() => readTimelineView(videoKey, "timeline", total, 900));
  const [buckets, setBuckets] = useState<{ first: number; len: number; list: Bucket[] }>({ first: 0, len: 1, list: [] });
  const drag = useRef<{ x0: number; start0: number; moved: boolean } | null>(null);
  const [thumbStatus, setThumbStatus] = useState<ThumbStatus>({ state: "idle", count: 0, error: null });
  const [nearest, setNearest] = useState<{ key: string; frames: Array<number | null> }>({ key: "", frames: [] });
  const images = useRef(new Map<number, HTMLImageElement | "loading" | "failed">());
  const [imageTick, setImageTick] = useState(0);
  const [review, setReview] = useState<PhaseChart|null>(null);

  const zoomFactor = settingValue(settings, "timeline.zoom_factor", 1.25);
  const maxPx = settingValue(settings, "timeline.max_px_per_frame", 32);
  const margin = settingValue(settings, "timeline.follow_margin_px", 80);
  const spacing = settingValue(settings, "timeline.ruler_spacing_px", 90);
  const dragThreshold = settingValue(settings, "timeline.drag_threshold_px", 4);
  const thumbW = settingValue(settings, "timeline.thumb_width_px", 96);
  const thumbKey = [
    thumbW,
    settingValue(settings, "timeline.thumb_quality", 5),
    settingValue(settings, "timeline.thumb_max_count", 600),
    settingValue(settings, "timeline.thumbs_enabled", 1),
  ].join("|");
  const showThumbs = thumbStatus.state !== "disabled";
  const laneY = showThumbs ? THUMB_Y + THUMB_H + 4 : 32;
  const flagY = laneY + LANE_H + 4;
  const height = flagY + 16;

  // track the width of the container
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(200, Math.floor(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Restore this video's view; width changes keep the viewport valid.
  useEffect(() => setVp(readTimelineView(videoKey, "timeline", total, width)), [videoKey, total]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setVp((v) => clampViewport(v, width, total)), [width, total]);
  useEffect(() => { writeTimelineView(videoKey, "timeline", total, width, vp); }, [videoKey, total, width, vp]);

  // follow the playhead (not while the user is dragging the timeline)
  useEffect(() => {
    if (drag.current?.moved) return;
    setVp((v) => ensureVisible(v, view.current, width, total, Math.min(margin, width / 4)));
  }, [view.current, width, total, margin]);

  // lane data for the visible frames, one bucket per pixel column
  useEffect(() => {
    const { first, last } = visibleRange(vp, width, total);
    const n = Math.max(1, Math.floor(width));
    let cancelled = false;
    const timer = setTimeout(() => {
      backend
        .timeline(first, last + 1, n)
        .then((list) => !cancelled && setBuckets({ first, len: last + 1 - first, list }))
        .catch(() => undefined);
    }, 40);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [backend, vp, width, total, version]);

  // thumbnails: start the background pass (a no-op when already made), poll while it runs; a new video or changed
  // thumbnail settings start over
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    images.current.clear();
    setNearest({ key: "", frames: [] });
    const poll = (s: ThumbStatus) => {
      if (cancelled) return;
      setThumbStatus(s);
      if (s.state === "running") timer = setTimeout(() => backend.thumbsStatus().then(poll).catch(() => undefined), 1000);
    };
    backend.thumbsStart().then(poll).catch(() => undefined);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [backend, total, thumbKey]);

  const slots = useMemo(() => thumbSlots(vp, width, thumbW, total), [vp, width, thumbW, total]);

  // which stored thumbnail is nearest to each slot (only once they exist)
  useEffect(() => {
    if (thumbStatus.state !== "ready" || slots.length === 0) return;
    let cancelled = false;
    const key = slots.map((s) => s.frame).join(",");
    const timer = setTimeout(() => {
      backend
        .thumbNearest(slots.map((s) => s.frame))
        .then((frames) => !cancelled && setNearest({ key, frames }))
        .catch(() => undefined);
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [backend, thumbStatus.state, slots]);

  // load the pictures that are needed and not loaded yet
  useEffect(() => {
    let cancelled = false;
    for (const f of uniqueFrames(nearest.frames)) {
      if (images.current.has(f)) continue;
      images.current.set(f, "loading");
      backend
        .thumb(f)
        .then((bytes) => {
          const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            images.current.set(f, img);
            if (!cancelled) setImageTick((t) => t + 1);
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            images.current.set(f, "failed");
          };
          img.src = url;
        })
        .catch(() => images.current.set(f, "failed"));
    }
    return () => {
      cancelled = true;
    };
  }, [backend, nearest]);

  // Use the same independent fire evidence and imported report as the chart tab.
  // Refresh after labels change, not on every pan or zoom.
  useEffect(() => {
    let cancelled=false;
    setReview(null);
    const timer=setTimeout(()=>{
      Promise.all([backend.phaseChart(Math.max(1,total),"independent"),videoKey&&backend.joltRead?backend.joltRead(videoKey):Promise.resolve(null)])
        .then(([chart,text])=>{if(!cancelled)setReview(reviewChart(forwardTransitionChart(chart),text?restoreJolt(text):{...EMPTY_JOLT},view.fps||1));})
        .catch(()=>undefined);
    },80);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[backend,videoKey,total,version,view.fps]);

  // draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COLORS.bg;
    g.fillRect(0, 0, width, height);

    // ruler
    g.font = "11px system-ui, sans-serif";
    g.textBaseline = "top";
    for (const t of rulerTicks(vp, width, view.fps, spacing)) {
      g.strokeStyle = COLORS.tick;
      g.beginPath();
      g.moveTo(Math.round(t.x) + 0.5, t.major ? 4 : 12);
      g.lineTo(Math.round(t.x) + 0.5, RULER_H);
      g.stroke();
      if (t.major || spacing >= 40) {
        g.fillStyle = COLORS.text;
        g.fillText(t.label, t.x + 3, 2);
      }
    }

    // thumbnails
    if (showThumbs) {
      const videoLeft = frameToX(vp, 0);
      const videoRight = frameToX(vp, total);
      g.fillStyle = COLORS.lane;
      g.fillRect(Math.max(0, videoLeft), THUMB_Y, Math.min(width, videoRight) - Math.max(0, videoLeft), THUMB_H);
      const wanted = nearest.key === slots.map((s) => s.frame).join(",") ? nearest.frames : [];
      slots.forEach((slot, i) => {
        const f = wanted[i];
        const img = f == null ? undefined : images.current.get(f);
        if (!(img instanceof HTMLImageElement)) return;
        g.save();
        g.beginPath();
        g.rect(slot.x, THUMB_Y, slot.w, THUMB_H);
        g.clip();
        // fill the slot (cover): scale to the slot height-or-width, centre
        const scale = Math.max(thumbW / img.naturalWidth, THUMB_H / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        g.drawImage(img, slot.x + (thumbW - dw) / 2, THUMB_Y + (THUMB_H - dh) / 2, dw, dh);
        g.restore();
        g.fillStyle = "rgba(0,0,0,0.45)";
        g.fillRect(slot.x + slot.w - 1, THUMB_Y, 1, THUMB_H); // a hairline between pictures
      });
      if (thumbStatus.state !== "ready") {
        g.font = "11px system-ui, sans-serif";
        g.fillStyle = thumbStatus.state === "failed" ? COLORS.hard : COLORS.text;
        g.textBaseline = "middle";
        const msg =
          thumbStatus.state === "running"
            ? "making thumbnails…"
            : thumbStatus.state === "failed"
              ? `thumbnails failed: ${thumbStatus.error ?? "unknown error"}`
              : "thumbnails not made yet";
        g.fillText(msg, Math.max(8, videoLeft + 8), THUMB_Y + THUMB_H / 2);
        g.textBaseline = "top";
      }
    }

    // label lane
    g.fillStyle = COLORS.lane;
    g.fillRect(frameToX(vp, 0), laneY, Math.max(1, total * vp.pxPerFrame), LANE_H);
    const { first, len, list } = buckets;
    const n = list.length;
    list.forEach((b, i) => {
      if (b.frames === 0) return;
      const x0 = frameToX(vp, first + (i * len) / n);
      const w = Math.max(1, (len / n) * vp.pxPerFrame);
      const labelled = b.fire + b.no_fire + b.skip;
      if (labelled > 0) {
        g.globalAlpha = 0.35 + 0.65 * (labelled / b.frames);
        g.fillStyle = b.fire >= b.no_fire && b.fire >= b.skip ? COLORS.fire : b.no_fire >= b.skip ? COLORS.noFire : COLORS.skip;
        g.fillRect(x0, laneY, w, LANE_H);
        g.globalAlpha = 1;
      }
      paintAutomaticStrips(g, b, x0, laneY, w, LANE_H);
      if (!review && b.flag) {
        g.fillStyle = b.flag === "hard" ? COLORS.hard : COLORS.soft;
        g.fillRect(x0, flagY, w, 8);
      }
    });

    if(review)paintTimelineFlags(g,review.flags,frame=>frameToX(vp,frame),flagY);

    // playhead
    const px = frameToX(vp, view.current) + vp.pxPerFrame / 2;
    g.fillStyle = COLORS.playhead;
    g.fillRect(Math.round(px) - 1, 0, 2, height);
    g.beginPath();
    g.moveTo(px - 6, 0);
    g.lineTo(px + 6, 0);
    g.lineTo(px, 9);
    g.closePath();
    g.fill();
  }, [vp, width, buckets, flags, review, view.current, view.fps, total, spacing, slots, nearest, imageTick, thumbStatus, showThumbs, thumbW, laneY, flagY, height]);

  // Consume timeline scrolling and Ctrl+zoom so neither scrolls/zooms the page.
  useWheel(canvasRef, (e) => {
    const canvas = canvasRef.current;
    if (!canvas || (!e.deltaY && !e.deltaX)) return false;
    const x = e.clientX - canvas.getBoundingClientRect().left;
    e.stopPropagation();
    setVp((v) => wheelViewport(v, e, x, zoomFactor, maxPx, width, total));
    return true;
  });

  const localX = (e: React.PointerEvent) => e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;

  return (
    <div className="timeline" ref={wrapRef}>
      <div className="timeline-controls" aria-label="Video timeline zoom">
        <IconButton icon="zoomOut" label="Zoom out video timeline" onClick={() => setVp((v) => zoomAt(v, width / 2, 1 / zoomFactor, maxPx, width, total))} />
        <IconButton icon="zoomIn" label="Zoom in video timeline" onClick={() => setVp((v) => zoomAt(v, width / 2, zoomFactor, maxPx, width, total))} />
        <IconButton icon="fit" label="Fit entire video timeline" onClick={() => setVp(fitViewport(total, width))} />
        <span>{(vp.pxPerFrame / fitViewport(total, width).pxPerFrame).toFixed(1)}×</span>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x0: localX(e), start0: vp.start, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = localX(e) - d.x0;
          if (!d.moved && Math.abs(dx) < dragThreshold) return;
          d.moved = true;
          setVp(pan({ start: d.start0, pxPerFrame: vp.pxPerFrame }, dx, width, total));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) onSeek(xToFrame(vp, localX(e), total));
        }}
        onDoubleClick={() => setVp(fitViewport(total, width))}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
      />
      <div className="timeline-flag-key" aria-label="Timeline legend and controls" style={{display:"flex",flexWrap:"wrap",alignItems:"center",columnGap:12,rowGap:2}}>
        <span style={{color:COLORS.hard,whiteSpace:"nowrap"}}>━ Hard fire flag</span>
        <span style={{color:"#bd8bff",whiteSpace:"nowrap"}}>━ Jolt report flag</span>
        <span style={{whiteSpace:"nowrap"}}><i aria-hidden="true" style={{display:"inline-block",width:16,height:12,marginRight:4,background:COLORS.fire}} />Fire</span>
        <span style={{whiteSpace:"nowrap"}}><i aria-hidden="true" style={{display:"inline-block",width:16,height:12,marginRight:4,background:COLORS.noFire}} />No fire</span>
        {AUTOMATIC_TOOLS.map(tool=><span key={tool.source} style={{whiteSpace:"nowrap"}}><i aria-hidden="true" style={{display:"inline-block",boxSizing:"border-box",width:24,height:16,marginRight:4,backgroundColor:tool.source==="no_fire"?COLORS.noFire:COLORS.fire,borderTop:`3px solid ${tool.color}`,borderBottom:`3px solid ${tool.color}`}} />{tool.name}</span>)}
        <span style={{whiteSpace:"nowrap"}}>Human checked: plain colour</span>
        <span className="timeline-hint" style={{margin:0}}>scroll: move timeline · Ctrl+scroll: zoom · drag: pan · click: seek · double-click: show all · {vp.pxPerFrame.toFixed(3)} px/frame</span>
      </div>
    </div>
  );
}
