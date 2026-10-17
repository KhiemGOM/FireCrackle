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
}

/**
 * Decode once, undo veil, optionally undo portal, then encode once. If neither stage applies, preserve the
 * original blob. A portal failure preserves a successful unveil. Never throws or returns a blank picture.
 */
export async function processFrame(bytes: ArrayBuffer, original: Blob, mode: VeilMode, options: VeilOptions, io: FrameIo, portal?: (image:PortalImage)=>Promise<PortalResult>): Promise<ProcessedFrame> {
  if (mode === "off" && !portal) return { blob: original, applied: false };
  try {
    await initVeil();
    const img = await io.decode(bytes);
    const result = applyVeil(img, mode, options);
    if (result.error) return { blob: original, applied: false, error: result.error };
    let data=result.data as Uint8ClampedArray,portalApplied=false,error:string|undefined;
    if(portal){try{const p=await portal({...img,data});data=p.data;portalApplied=p.applied;}catch(e){error=String(e);}}
    if (!result.applied && !portalApplied) return { blob: original, applied: false, portalApplied, error };
    return { blob: await io.encode(data, img.width, img.height), applied: result.applied, portalApplied, error };
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
