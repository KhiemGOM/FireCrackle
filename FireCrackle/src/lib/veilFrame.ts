// Decode / correction / encode glue. Pixel math lives only in canonical Rust, reached through WASM bindings.

import { initVeil, applyVeil, type VeilMode, type VeilOptions } from "./veil";
import type {PortalImage,PortalResult} from './portal';

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
export async function processFrame(bytes: ArrayBuffer, original: Blob, mode: VeilMode, options: VeilOptions, io: FrameIo, portal?: (image:PortalImage)=>Promise<PortalResult>, enhanceStage?: EnhanceStage, screen?: { width: number; height: number }): Promise<ProcessedFrame> {
  if (mode === "off" && !portal && !enhanceStage) return { blob: original, applied: false };
  try {
    await initVeil();
    const img = await io.decode(bytes);
    // A confirmed open screen is independent evidence of the game's veil.
    // Its mask must match the decoded picture; Off still wins. Pixel math
    // remains in applyVeil's canonical Rust/WASM inverse.
    const screenMatches = screen?.width === img.width && screen?.height === img.height;
    const result = applyVeil(img, mode === "auto" && screenMatches ? "on" : mode, options);
    if (result.error) return { blob: original, applied: false, error: result.error };
    let data=result.data as Uint8ClampedArray,portalApplied=false,error:string|undefined;
    if(portal){try{const p=await portal({...img,data});data=p.data;portalApplied=p.applied;}catch(e){error=String(e);}}
    let enhanced = false;
    if (enhanceStage) {
      try { const e = enhanceStage({ ...img, data }); if (e.applied) { data = e.data; enhanced = true; } } catch (e) { error = error ? `${error}; ${String(e)}` : String(e); }
    }
    if (!result.applied && !portalApplied && !enhanced) return { blob: original, applied: false, portalApplied, enhanced: false, error };
    return { blob: await io.encode(data, img.width, img.height), applied: result.applied, portalApplied, enhanced, error };
  } catch (e) {
    return { blob: original, applied: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The real canvas-backed implementation (the desktop webview and any browser). */
export const canvasFrameIo: FrameIo = {
  async decode(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      if (!g) throw new Error("no 2D canvas");
      g.drawImage(bitmap, 0, 0);
      const { data, width, height } = g.getImageData(0, 0, bitmap.width, bitmap.height);
      return { data, width, height };
    } finally {
      bitmap.close();
    }
  },
  async encode(data, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no 2D canvas");
    g.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the picture"))), "image/jpeg", 0.95));
  },
};
