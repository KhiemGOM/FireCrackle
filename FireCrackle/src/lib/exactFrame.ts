// The paused picture at the video's own resolution as a lossless PNG, replacing the scaled display JPEG.
// Playback keeps the JPEG frame buffer; the exact frame is asked for only after the playhead rests a moment.

import type { Backend } from "./api";
/** Wait before decoding, so stepping through frames does not queue a full-quality decode per step. */
export const EXACT_DELAY_MS = 200;
/** Wait before decoding as playback stops: the playback step already on its way when Space was pressed lands within
 * it, and moves the playhead once more (measured 17-36 ms). Decoding at once would decode the frame before it too. */
export const PAUSE_SETTLE_MS = 50;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function showsExactFrame(state: { playing: boolean; stillImage: boolean; corrected: boolean }): boolean {
  return !state.playing && !state.stillImage && !state.corrected;
}

interface ExactRequest {
  frame: number;
  load: (frame: number) => Promise<ArrayBuffer>;
  isCurrent: () => boolean;
  signal: AbortSignal;
  delayMs?: number;
}

/** An object URL of the frame's PNG, or null when it is no longer wanted or could not be decoded (keep the JPEG). */
export async function exactFrameUrl(request: ExactRequest): Promise<string | null> {
  const bytes = await exactFrameBytes(request);
  return bytes && URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}

/** The frame's PNG bytes, or null when it is no longer wanted or could not be decoded. */
export async function exactFrameBytes(request: ExactRequest): Promise<ArrayBuffer | null> {
  const { frame, load, isCurrent, signal, delayMs = EXACT_DELAY_MS } = request;
  if (!await waited(delayMs, signal)) return null;
  const bytes = await loadPng(load, frame);
  return bytes && !signal.aborted && isCurrent() ? bytes : null;
}

/** False when the request is cancelled before `ms` pass. */
function waited(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    if (signal.aborted || ms <= 0) return resolve(!signal.aborted);
    const timer = setTimeout(() => resolve(true), ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(false); }, { once: true });
  });
}

/** The loaded bytes when they are a PNG, else null (a failed decode included). */
async function loadPng(load: ExactRequest["load"], frame: number): Promise<ArrayBuffer | null> {
  let bytes: ArrayBuffer;
  try { bytes = await load(frame); } catch { return null; }
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, PNG_SIGNATURE.length));
  return head.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => head[i] !== b) ? null : bytes;
}

/**
 * The paused picture's full-quality frame across the picture effect's runs. A step to another frame waits
 * EXACT_DELAY_MS; playback stopping only settles (PAUSE_SETTLE_MS). The last frame fetched (or on its way) is kept, so a
 * re-run on the same frame (its GUI mask arriving, a setting changed) starts from it instead of the display JPEG and a
 * second load.
 */
export class PausedExact {
  /** The frame last loaded while paused; null since playback ran. */
  private rest: number | null = null;
  private held: { video: string; frame: number; png: Promise<ArrayBuffer | null> } | null = null;
  /** Playback runs: the next request is a pause. */
  playing(): void { this.rest = null; }
  /** Whether this video frame's picture is fetched or on its way (never without a video to tell pictures apart). */
  has(video: string | undefined, frame: number): boolean { return video !== undefined && this.held?.video === video && this.held.frame === frame; }
  /** Like exactFrameBytes, from the kept picture when there is one. */
  async bytes(request: ExactRequest & { video: string | undefined }): Promise<ArrayBuffer | null> {
    const { video, frame, load, isCurrent, signal } = request;
    let png = this.has(video, frame) ? this.held!.png : null;
    if (!png) {
      const wait = this.rest === null ? PAUSE_SETTLE_MS : this.rest === frame ? 0 : EXACT_DELAY_MS;
      if (!await waited(wait, signal)) return null;
      this.rest = frame;
      // the load is not cancelled with the request: a re-run takes it over
      png = loadPng(load, frame);
      if (video !== undefined) {
        const held = { video, frame, png };
        this.held = held;
        void png.then(bytes => { if (!bytes && this.held === held) this.held = null; });
      }
    }
    const bytes = await png;
    return bytes && !signal.aborted && isCurrent() ? bytes : null;
  }
}

/** Width and height from a PNG's header, or null when the bytes are not a PNG. */
export function pngSize(bytes: ArrayBuffer): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  const head = new Uint8Array(bytes, 0, 8), view = new DataView(bytes);
  if (PNG_SIGNATURE.some((b, i) => head[i] !== b)) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A frame at the video's own resolution (the exact PNG), or the scaled display JPEG when exact frames are unavailable. */
export async function nativeFrame(backend: Pick<Backend, "frame" | "exactFrame">, frame: number): Promise<Blob> {
  if (backend.exactFrame) {
    try { return new Blob([await backend.exactFrame(frame)], { type: "image/png" }); } catch { /* the display frame below */ }
  }
  return new Blob([await backend.frame(frame)], { type: "image/jpeg" });
}
