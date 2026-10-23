// Timeline geometry: frames <-> pixels, zoom anchored at the cursor, panning, a time ruler and thumbnail picks.
// Pure functions; every tunable number (zoom factor, max zoom, thumbnail width, label spacing) is a parameter,
// supplied from the settings table (`timeline.*`), never a constant here.
import { clamp } from "./frameMath";

export interface Viewport {
  /** The (fractional) frame at the left edge of the timeline. */
  start: number;
  /** Screen pixels per video frame. */
  pxPerFrame: number;
}

export interface FrameRange {
  first: number;
  last: number;
}

export interface RulerTick {
  x: number;
  label: string;
  /** Every fifth tick is major (drawn taller). */
  major: boolean;
}


/** Pixels per frame at which the whole video just fits the width. */
function fitPx(total: number, width: number): number {
  return width / Math.max(total, 1);
}

/** The viewport that shows the whole video. */
export function fitViewport(total: number, width: number): Viewport {
  return { start: 0, pxPerFrame: fitPx(total, width) };
}

export function frameToX(vp: Viewport, frame: number): number {
  return (frame - vp.start) * vp.pxPerFrame;
}

/** The frame under pixel `x`, clamped to `0..total-1`. */
export function xToFrame(vp: Viewport, x: number, total: number): number {
  if (total <= 0) return 0;
  return clamp(Math.floor(vp.start + x / vp.pxPerFrame), 0, total - 1);
}

/** Frames that have any part on screen, inclusive, clamped to the video. */
export function visibleRange(vp: Viewport, width: number, total: number): FrameRange {
  if (total <= 0) return { first: 0, last: 0 };
  const first = clamp(Math.floor(vp.start), 0, total - 1);
  const last = clamp(Math.ceil(vp.start + width / vp.pxPerFrame) - 1, first, total - 1);
  return { first, last };
}

/** Keep the viewport inside the video and no more zoomed out than "fit". */
export function clampViewport(vp: Viewport, width: number, total: number): Viewport {
  const px = Math.max(vp.pxPerFrame, fitPx(total, width));
  const maxStart = Math.max(0, total - width / px);
  return { start: clamp(vp.start, 0, maxStart), pxPerFrame: px };
}

/**
 * Zoom by `factor` (>1 in, <1 out) keeping the frame under `anchorX` where it is. Zoom stops at "fit all" and at
 * `maxPxPerFrame`. A non-positive or non-finite factor changes nothing.
 */
export function zoomAt(
  vp: Viewport,
  anchorX: number,
  factor: number,
  maxPxPerFrame: number,
  width: number,
  total: number,
): Viewport {
  if (!(factor > 0) || !Number.isFinite(factor)) return vp;
  const minPx = fitPx(total, width);
  const px = clamp(vp.pxPerFrame * factor, minPx, Math.max(maxPxPerFrame, minPx));
  const anchorFrame = vp.start + anchorX / vp.pxPerFrame;
  return clampViewport({ start: anchorFrame - anchorX / px, pxPerFrame: px }, width, total);
}

/** Drag the timeline by `dxPx` pixels (positive = content moves right). */
export function pan(vp: Viewport, dxPx: number, width: number, total: number): Viewport {
  return clampViewport({ start: vp.start - dxPx / vp.pxPerFrame, pxPerFrame: vp.pxPerFrame }, width, total);
}

/** Ordinary wheel scrolls along time; Ctrl+wheel zooms around the cursor. */
export function wheelViewport(
  vp: Viewport,
  event: Pick<WheelEvent, "ctrlKey" | "deltaX" | "deltaY" | "deltaMode">,
  anchorX: number, zoomFactor: number, maxPx: number, width: number, total: number,
): Viewport {
  if (event.ctrlKey) {
    return event.deltaY ? zoomAt(vp, anchorX, event.deltaY < 0 ? zoomFactor : 1 / zoomFactor, maxPx, width, total) : vp;
  }
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
  return delta ? pan(vp, -delta * unit, width, total) : vp;
}

/**
 * Scroll just enough that `frame` is at least `marginPx` from both edges (follow the playhead). With a margin of
 * half the width or more the frame is centred.
 */
export function ensureVisible(vp: Viewport, frame: number, width: number, total: number, marginPx: number): Viewport {
  const px = vp.pxPerFrame;
  const x = frameToX(vp, frame);
  let start: number;
  if (marginPx * 2 >= width) {
    start = frame - width / 2 / px;
  } else if (x < marginPx) {
    start = frame - marginPx / px;
  } else if (x > width - marginPx) {
    start = frame - (width - marginPx) / px;
  } else {
    return vp;
  }
  return clampViewport({ start, pxPerFrame: px }, width, total);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `m:ss`, `h:mm:ss` or with decimals when `step` is below a second. */
export function formatTime(seconds: number, step: number): string {
  const decimals = step < 1 ? Math.ceil(-Math.log10(step) - 1e-9) : 0;
  const scale = 10 ** decimals;
  const units = Math.round(Math.max(0, seconds) * scale);
  const whole = Math.floor(units / scale);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const base = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  return decimals > 0 ? `${base}.${String(units % scale).padStart(decimals, "0")}` : base;
}

/** Nice ruler steps in seconds: the smallest one that keeps ticks apart is used. */
const RULER_STEPS = [
  0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400,
];

/**
 * Ruler ticks at nice time steps (0.05 s ... 1 day) so that neighbouring ticks are at least `minSpacingPx` apart.
 * Frame times are approximated as `frame / fps`.
 */
export function rulerTicks(vp: Viewport, width: number, fps: number, minSpacingPx: number): RulerTick[] {
  if (!(width > 0) || !(fps > 0) || !Number.isFinite(fps) || !(vp.pxPerFrame > 0)) return [];
  const pxPerSecond = vp.pxPerFrame * fps;
  const step = RULER_STEPS.find((s) => s * pxPerSecond >= minSpacingPx) ?? RULER_STEPS[RULER_STEPS.length - 1];
  const t0 = vp.start / fps;
  const t1 = (vp.start + width / vp.pxPerFrame) / fps;
  const k0 = Math.ceil(t0 / step - 1e-9);
  const k1 = Math.floor(t1 / step + 1e-9);
  const ticks: RulerTick[] = [];
  for (let k = k0; k <= k1 && ticks.length < 10000; k++) {
    const t = k * step;
    const x = frameToX(vp, t * fps);
    if (x < -1e-6 || x > width + 1e-6) continue;
    ticks.push({ x, label: formatTime(t, step), major: k % 5 === 0 });
  }
  return ticks;
}

/** Frames to show thumbnails of: one per `thumbWidthPx` slot, ascending, without duplicates. */
export function thumbnailFrames(vp: Viewport, width: number, thumbWidthPx: number, total: number): number[] {
  if (total <= 0 || !(width > 0) || !(thumbWidthPx > 0)) return [];
  const slots = Math.max(1, Math.floor(width / thumbWidthPx));
  const slotWidth = width / slots;
  const frames: number[] = [];
  for (let i = 0; i < slots; i++) {
    const f = xToFrame(vp, (i + 0.5) * slotWidth, total);
    if (frames.length === 0 || f > frames[frames.length - 1]) frames.push(f);
  }
  return frames;
}

/** Whether a press at `x` grabs the playhead of frame `current` (drawn at the middle of its frame) to drag it. */
export function grabsPlayhead(vp: Viewport, current: number, x: number, tolerancePx: number): boolean {
  const centre = frameToX(vp, current) + vp.pxPerFrame / 2;
  return Math.abs(x - centre) <= tolerancePx;
}
