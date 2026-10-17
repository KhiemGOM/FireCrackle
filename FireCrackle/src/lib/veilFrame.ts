// Undo the GUI veil on a frame's bytes before they are shown. The pixel maths is in veil.ts; this file is the
// decode / process / encode glue, with the browser's canvas behind an interface so it can be tested without one.

import { initVeil, applyVeil, type VeilMode, type VeilOptions } from "./veil";

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
  /** Why the original was returned although a mode asked for processing. */
  error?: string;
}

/**
 * The picture to show for a frame: the original when the mode is off, when auto finds no veil, or when anything
 * fails (the reason is in `error`); otherwise the unveiled picture. Never throws, never returns a blank picture.
 */
export async function processFrame(bytes: ArrayBuffer, original: Blob, mode: VeilMode, options: VeilOptions, io: FrameIo): Promise<ProcessedFrame> {
  if (mode === "off") return { blob: original, applied: false };
  try {
    await initVeil();
    const img = await io.decode(bytes);
    const result = applyVeil(img, mode, options);
    if (result.error) return { blob: original, applied: false, error: result.error };
    if (!result.applied) return { blob: original, applied: false };
    return { blob: await io.encode(result.data as Uint8ClampedArray, img.width, img.height), applied: true };
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
