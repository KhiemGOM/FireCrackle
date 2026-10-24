/** Zoom and pan: the pure logic behind wheel zoom on the video and ctrl+wheel zoom on panels. */
import { clamp } from "./frameMath";

export interface Limits {
  min: number;
  max: number;
}

/** Screen = rotate(content * scale, angle) + (x, y), around the pane's top-left. */
export interface ViewXform {
  scale: number;
  x: number;
  y: number;
  angle?: number;
}

export interface Box {
  w: number;
  h: number;
}

export const PANEL_ZOOM: Limits = { min: 0.5, max: 3 };

export const IDENTITY: ViewXform = { scale: 1, x: 0, y: 0 };

export interface PanelZooms {
  picker: number;
  flags: number;
}

export const DEFAULT_ZOOMS: PanelZooms = { picker: 1, flags: 1 };
export const ZOOM_STORAGE_KEY = "firecrackle.zoom.v1";

const WHEEL_RATE = 0.0015; // per wheel-delta unit; a 100-unit notch is about 16 %
const MAX_STEP = 1.6; // one wheel event never changes the scale by more than this factor


/** Scale factor for one wheel event: up (negative deltaY) zooms in. */
export function wheelFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  return clamp(Math.exp(-deltaY * WHEEL_RATE), 1 / MAX_STEP, MAX_STEP);
}

/** A panel's zoom after one wheel event. */
export function zoomPanel(scale: number, deltaY: number): number {
  const start = Number.isFinite(scale) ? scale : 1;
  return clamp(start * wheelFactor(deltaY), PANEL_ZOOM.min, PANEL_ZOOM.max);
}

/** Repair invalid numeric values without limiting zoom or off-frame navigation. */
export function clampView(v: ViewXform, _box: Box): ViewXform {
  const scale = Number.isFinite(v.scale) && v.scale > 0 ? v.scale : 1;
  const x = Number.isFinite(v.x) ? v.x : 0;
  const y = Number.isFinite(v.y) ? v.y : 0;
  return {
    scale,
    x,
    y,
    ...(v.angle !== undefined ? { angle: Number.isFinite(v.angle) ? v.angle : 0 } : {}),
  };
}

/** Zoom by `factor` around the pane point (px, py): the content under it stays under it. */
export function zoomAt(v: ViewXform, px: number, py: number, factor: number, box: Box): ViewXform {
  if (!(box.w > 0) || !(box.h > 0)) return clampView(v, box);
  const start = clampView(v, box);
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  // Only numeric representation has limits: prevent zero/Infinity at underflow/overflow.
  const next = Math.min(Number.MAX_VALUE, Math.max(Number.MIN_VALUE, start.scale * f));
  const ratio = next / start.scale;
  return clampView({ ...start, scale: next, x: px - (px - start.x) * ratio, y: py - (py - start.y) * ratio }, box);
}

/** Move the content with the pointer by (dx, dy). */
export function panView(v: ViewXform, dx: number, dy: number, box: Box): ViewXform {
  return clampView({ ...v, x: v.x + dx, y: v.y + dy }, box);
}

/** Rotate around a screen-space pivot, preserving the content beneath it. */
export function rotateView(v: ViewXform, px: number, py: number, degrees: number): ViewXform {
  if (![px, py, degrees].every(Number.isFinite)) return v;
  const radians = degrees * Math.PI / 180;
  const c = Math.cos(radians), s = Math.sin(radians);
  const dx = v.x - px, dy = v.y - py;
  return { ...v, x: px + c * dx - s * dy, y: py + s * dx + c * dy, angle: ((v.angle ?? 0) + degrees) % 360 };
}

/** Short angular movement, including crossing the -180/180 degree seam. */
export function rotationDelta(previous: number, current: number): number {
  return Math.atan2(Math.sin(current - previous), Math.cos(current - previous)) * 180 / Math.PI;
}

function zoomField(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return clamp(raw, PANEL_ZOOM.min, PANEL_ZOOM.max);
}

export function parseZooms(raw: string | null): PanelZooms {
  let obj: unknown = null;
  if (raw) {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
  }
  const o = obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
  return { picker: zoomField(o.picker, DEFAULT_ZOOMS.picker), flags: zoomField(o.flags, DEFAULT_ZOOMS.flags) };
}

export function serializeZooms(z: PanelZooms): string {
  return JSON.stringify(z);
}

/**
 * The view that keeps the picture where it is on screen when the video area changes from `from` to `to` (the area's
 * top-left stays put). The picture is fitted ("contain") and centred in the area, so a new size re-fits and re-centres
 * it: the zoom takes back the change of fit and the offset the change of centring, through any rotation. A zero-sized
 * area or an unknown picture leaves the view as it is.
 */
export function anchorView(v: ViewXform, from: Box, to: Box, image: Box): ViewXform {
  if (![from.w, from.h, to.w, to.h, image.w, image.h].every(n => Number.isFinite(n) && n > 0)) return v;
  if (from.w === to.w && from.h === to.h) return v;
  const place = (box: Box) => {
    const fit = Math.min(box.w / image.w, box.h / image.h);
    return { fit, left: (box.w - image.w * fit) / 2, top: (box.h - image.h * fit) / 2 };
  };
  const a = place(from), b = place(to), scale = v.scale * a.fit / b.fit;
  const angle = ((v.angle ?? 0) * Math.PI) / 180, c = Math.cos(angle), s = Math.sin(angle);
  const dx = v.scale * a.left - scale * b.left, dy = v.scale * a.top - scale * b.top;
  return { ...v, scale, x: v.x + c * dx - s * dy, y: v.y + s * dx + c * dy };
}
