// Decode / correction / encode glue. Pixel math lives only in canonical Rust, reached through WASM bindings.

import { initVeil, applyVeil, type VeilMode, type VeilOptions } from "./veil";
import type {PortalImage,PortalResult} from './portal';
import {fitCoverage,sameShape,type WorldCoverage} from './portalPreview';
import { bmpFromRgba } from "./bmp";
import { failureMessage } from "./appErrors";
import { canvasBlob } from "./canvas";

export interface FrameIo {
  /** RGBA pixels of an encoded picture. */
  decode(bytes: ArrayBuffer): Promise<{ data: Uint8ClampedArray; width: number; height: number }>;
  /** A picture of RGBA pixels (JPEG at quality 0.95: the frames shown are JPEGs already, and a lossless PNG takes about a second per 720p frame). */
  encode(data: Uint8ClampedArray, width: number, height: number): Promise<Blob>;
}

export interface ProcessedFrame {
  blob: Blob;
  /** True when the blob holds the unveiled picture. */
  applied: boolean;
  /** Why a requested stage failed; successful earlier stages can still be shown. */
  error?: string;
  portalApplied?: boolean;
  /** True when an enhancement stage (tone and the like) changed the picture. */
  enhanced?: boolean;
}

/** An enhancement stage run after veil and portal: pure pixels in, pixels out, `applied` false when nothing changed. */
export type EnhanceStage = (image: PortalImage) => { data: Uint8ClampedArray; applied: boolean };

/**
 * Decode once, undo veil, optionally undo portal, optionally enhance, then encode once. If no stage applies, preserve
 * the original blob. A portal or enhancement failure preserves the earlier stages. Never throws or returns a blank picture.
 */
export async function processFrame(bytes: ArrayBuffer, original: Blob, mode: VeilMode, options: VeilOptions, io: FrameIo, portal?: (image:PortalImage)=>Promise<PortalResult>, enhanceStage?: EnhanceStage, screen?: { width: number; height: number }, coverage?:WorldCoverage): Promise<ProcessedFrame> {
  // Auto decides from the GUI detector alone: no detected open screen, no veil (colour statistics never decide;
  // a dark colourless world looks exactly like the veil). The colour detector in veil.rs stays for On and research.
  const veiling = mode === "on" || (mode === "auto" && !!screen);
  if (!veiling && !portal && !enhanceStage) return { blob: original, applied: false };
  try {
    await initVeil();
    const img = await io.decode(bytes);
    // A confirmed open screen is independent evidence of the game's veil.
    // Its mask must match the decoded picture; Off still wins. Pixel math
    // remains in applyVeil's canonical Rust/WASM inverse.
    // the screen was found on any size of this picture (the native frame): same shape is enough
    const screenMatches = !!screen && sameShape(screen, img);
    const result = applyVeil(img, mode === "on" || (mode === "auto" && screenMatches) ? "on" : "off", options);
    if (result.error) return { blob: original, applied: false, error: result.error };
    let data=result.data as Uint8ClampedArray,portalApplied=false,error:string|undefined;
    // Screen's veil is behind foreground GUI pieces (Screen.renderTransparentBackground,
    // Java 1.21.11; 0xC0101010 -> 0xD0101010). Keep supplied GUI coverage untouched in Auto: callers pass the open
    // screen only (the hotbar and HUD sit on the veil too and are unveiled with the world).
    // Always undo deliberately bypasses this exclusion. Inverse/rounding stay in Rust.
    const kept=mode==="auto"&&result.applied?fitCoverage(coverage,img.width,img.height):undefined;
    if(kept&&kept.world.length===img.width*img.height){
      data=new Uint8ClampedArray(data);
      for(let i=0;i<kept.world.length;i++)if(!kept.world[i])data.set(img.data.subarray(i*4,i*4+4),i*4);
    }
    if(portal){try{const p=await portal({...img,data});data=p.data;portalApplied=p.applied;}catch(e){error=failureMessage(e);}}
    let enhanced = false;
    if (enhanceStage) {
      try { const e = enhanceStage({ ...img, data }); if (e.applied) { data = e.data; enhanced = true; } } catch (e) { error = error ? `${error}; ${failureMessage(e)}` : failureMessage(e); }
    }
    if (!result.applied && !portalApplied && !enhanced) return { blob: original, applied: false, portalApplied, enhanced: false, error };
    return { blob: await io.encode(data, img.width, img.height), applied: result.applied, portalApplied, enhanced, error };
  } catch (e) {
    return { blob: original, applied: false, error: failureMessage(e) };
  }
}

/** A drawing surface: OffscreenCanvas where there is one (also inside web workers), else a page canvas. */
function surface(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The real canvas-backed implementation (the desktop webview, any browser, and web workers). */
export const canvasFrameIo: FrameIo = {
  async decode(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    try {
      const canvas = surface(bitmap.width, bitmap.height);
      const g = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!g) throw new Error("no 2D canvas");
      g.drawImage(bitmap, 0, 0);
      const { data, width, height } = g.getImageData(0, 0, bitmap.width, bitmap.height);
      return { data, width, height };
    } finally {
      bitmap.close();
    }
  },
  async encode(data, width, height) {
    const canvas = surface(width, height);
    const g = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!g) throw new Error("no 2D canvas");
    g.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    if ("convertToBlob" in canvas) return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    return await canvasBlob(canvas, "image/jpeg", 0.95, "could not encode the picture");
  },
};

/** Lossless output for corrected full-resolution frames: an uncompressed BMP, instead of the display JPEG encode. */
export const losslessFrameIo: FrameIo = {
  decode: bytes => canvasFrameIo.decode(bytes),
  async encode(data, width, height) { return new Blob([bmpFromRgba(data, width, height)], { type: "image/bmp" }); },
};
