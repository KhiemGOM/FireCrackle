// The paused picture at the video's own resolution as a lossless PNG, replacing the scaled display JPEG.
// Playback keeps the JPEG frame buffer; the exact frame is asked for only after the playhead rests a moment.

/** Wait before decoding, so stepping through frames does not queue a full-quality decode per step. */
export const EXACT_DELAY_MS = 200;
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
  const waited = await new Promise<boolean>(resolve => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => resolve(true), delayMs);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(false); }, { once: true });
  });
  if (!waited) return null;
  let bytes: ArrayBuffer;
  try { bytes = await load(frame); } catch { return null; }
  if (signal.aborted || !isCurrent()) return null;
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, PNG_SIGNATURE.length));
  if (head.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => head[i] !== b)) return null;
  return bytes;
}

/** Width and height from a PNG's header, or null when the bytes are not a PNG. */
export function pngSize(bytes: ArrayBuffer): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  const head = new Uint8Array(bytes, 0, 8), view = new DataView(bytes);
  if (PNG_SIGNATURE.some((b, i) => head[i] !== b)) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
