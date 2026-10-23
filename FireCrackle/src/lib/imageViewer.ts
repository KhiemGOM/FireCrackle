/** The image viewer's pure logic: fit, zoom levels against the picture's native resolution, the pixel under the
 * cursor and its keys. Pan and cursor-anchored zoom are the shared `lib/zoom.ts`. */
import { clamp } from "./frameMath";
import { zoomAt, type Box, type ViewXform } from "./zoom";

/** Zoom-button levels, in percent of native (100 % = one picture pixel per screen pixel). */
export const ZOOM_LEVELS = [5, 10, 15, 20, 25, 100 / 3, 50, 200 / 3, 100, 150, 200, 300, 400, 600, 800, 1200, 1600, 2400, 3200, 4800, 6400];
const MIN_PERCENT = 5, MAX_PERCENT = 6400;

const sized = (b: Box) => Number.isFinite(b.w) && Number.isFinite(b.h) && b.w > 0 && b.h > 0;

/** The CSS scale that shows the whole picture inside the pane, `margin` px from its edges. Small pictures grow too. */
export function fitScale(image: Box, pane: Box, margin = 24): number {
  if (!sized(image) || !sized(pane)) return 1;
  const w = Math.max(1, pane.w - 2 * margin), h = Math.max(1, pane.h - 2 * margin);
  return Math.min(w / image.w, h / image.h);
}

export function centredView(image: Box, pane: Box, scale: number): ViewXform {
  return { scale, x: (pane.w - image.w * scale) / 2, y: (pane.h - image.h * scale) / 2 };
}

/** CSS scale → percent of native: on a 150 % Windows display one picture pixel per device pixel is CSS scale 1/1.5. */
export const nativePercent = (scale: number, dpr: number) => scale * dpr * 100;
export const scaleForPercent = (percent: number, dpr: number) => percent / 100 / dpr;

/** The next round level in `dir` from `scale`, never the current one; stays at the ends. */
export function stepZoom(scale: number, dir: 1 | -1, dpr: number): number {
  const p = nativePercent(scale, dpr);
  const level = dir > 0 ? ZOOM_LEVELS.find(l => l > p * 1.001) ?? MAX_PERCENT : [...ZOOM_LEVELS].reverse().find(l => l < p * 0.999) ?? MIN_PERCENT;
  return scaleForPercent(level, dpr);
}

/** Between the fit (or 5 % when that is smaller) and 6400 % of native. */
export function limitScale(scale: number, fit: number, dpr: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return fit;
  return clamp(scale, Math.min(fit, scaleForPercent(MIN_PERCENT, dpr)), scaleForPercent(MAX_PERCENT, dpr));
}

/** Zoom by `factor` around the pane point (px, py), within the limits. */
export function zoomViewAt(v: ViewXform, px: number, py: number, factor: number, fit: number, dpr: number): ViewXform {
  if (!Number.isFinite(factor) || factor <= 0) return v;
  const scale = limitScale(v.scale * factor, fit, dpr);
  return { ...zoomAt(v, px, py, scale / v.scale, { w: 1, h: 1 }), scale };
}

/** The picture pixel under the pane point, or null off the picture. */
export function imagePixel(v: ViewXform, px: number, py: number, image: Box): { x: number; y: number } | null {
  const x = Math.floor((px - v.x) / v.scale), y = Math.floor((py - v.y) / v.scale);
  return x >= 0 && y >= 0 && x < image.w && y < image.h ? { x, y } : null;
}

export type ViewerAction = "close" | "zoomIn" | "zoomOut" | "fit" | "actual" | "previous" | "next" | "copy" | "save";

export function viewerAction(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): ViewerAction | null {
  if (e.altKey) return null;
  if (e.ctrlKey || e.metaKey) {
    if (e.shiftKey) return null;
    const k = e.key.toLowerCase();
    return k === "c" ? "copy" : k === "s" ? "save" : null;
  }
  switch (e.key) {
    case "Escape": return "close";
    case "+": case "=": return "zoomIn";
    case "-": case "_": return "zoomOut";
    case "0": return "fit";
    case "1": return "actual";
    case "ArrowLeft": return "previous";
    case "ArrowRight": return "next";
    default: return null;
  }
}

export function pictureFilename(title: string): string {
  const name = title.trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
  return `${name || "picture"}.png`;
}
