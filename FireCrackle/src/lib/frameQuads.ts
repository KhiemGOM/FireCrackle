// Where the quad mask sat on each frame the user confirmed, per video, so checking a frame again shows it there.

import { validQuad, type ManualQuad } from "./quadMask";
import { readVideoJson, videoStorageKey, writeJson } from "./videoStorage";

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;
export type FrameQuads = ReadonlyMap<number, ManualQuad>;

const DIGITS = 1e5; // 0.00001 of the picture: far below a pixel
const round = (n: number) => Math.round(n * DIGITS) / DIGITS;

function toQuad(flat: unknown): ManualQuad | null {
  if (!Array.isArray(flat) || flat.length !== 8 || !flat.every(n => typeof n === "number" && Number.isFinite(n))) return null;
  const quad: ManualQuad = [[flat[0], flat[1]], [flat[2], flat[3]], [flat[4], flat[5]], [flat[6], flat[7]]];
  return validQuad(quad) ? quad : null;
}

export function readFrameQuads(video: string | undefined, storage?: Reader): Map<number, ManualQuad> {
  const quads = new Map<number, ManualQuad>();
  if (!video) return quads;
  try {
    const saved = readVideoJson("quads.v1", video, storage);
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return quads;
    for (const [name, flat] of Object.entries(saved)) {
      const frame = Number(name), quad = toQuad(flat);
      if (/^\d+$/.test(name) && Number.isSafeInteger(frame) && quad) quads.set(frame, quad);
    }
  } catch { /* Missing or unavailable storage leaves an empty memory. */ }
  return quads;
}

/** False when nothing could be saved; the memory still works for this session. */
export function writeFrameQuads(video: string | undefined, quads: FrameQuads, storage?: Writer): boolean {
  if (!video) return false;
  try {
    const flat: Record<string, number[]> = {};
    for (const [frame, quad] of quads) flat[frame] = quad.flat();
    return writeJson(videoStorageKey("quads.v1", video), flat, storage);
  } catch { return false; }
}

/** A copy of `quads` with this frame's quad set; a frame number or quad that cannot be right changes nothing. */
export function rememberQuad(quads: FrameQuads, frame: number, quad: ManualQuad): Map<number, ManualQuad> {
  const next = new Map(quads);
  if (!Number.isSafeInteger(frame) || frame < 0 || !validQuad(quad)) return next;
  next.set(frame, quad.map(([x, y]) => [round(x), round(y)]) as ManualQuad);
  return next;
}

export function forgetQuad(quads: FrameQuads, frame: number): Map<number, ManualQuad> {
  const next = new Map(quads);
  next.delete(frame);
  return next;
}

export function recalledQuad(quads: FrameQuads, frame: number): ManualQuad | undefined {
  return quads.get(frame);
}

/** The same mask, to well below a pixel (so recalling a frame is not mistaken for an edit). */
export function sameQuad(a: ManualQuad, b: ManualQuad): boolean {
  return a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1 / DIGITS && Math.abs(p[1] - b[i][1]) < 1 / DIGITS);
}
