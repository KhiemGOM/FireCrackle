// The 3D quad tool's work on each frame (corners, fire, eye height, camera), per video, like the quad mask's frameQuads:
// coming back to a frame, or to the tool, shows what was there.

import type { CameraPose } from "./reversal";
import type { Fire3DShape, SavedTool, ToolClick, ToolState, Vec3 } from "./fireTool";
import { readVideoJson, videoStorageKey, writeJson } from "./videoStorage";

export type { SavedTool };
type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;
export type Fire3DMemory = ReadonlyMap<string, SavedTool>;

const KIND = "fire3d.v1";
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const vec = (v: unknown, n: number): boolean => Array.isArray(v) && v.length === n && v.every(finite);
const FACES = ["north", "east", "south", "west", "up"] as const;
const CAMERA = ["x", "y", "z", "yaw", "pitch", "roll", "fov"] as const;

function toClicks(v: unknown): ToolClick[] | null {
  if (!Array.isArray(v)) return null;
  const clicks: ToolClick[] = [];
  for (const c of v) {
    if (!c || typeof c !== "object" || !vec(c.px, 2) || !(c.world === null || vec(c.world, 3))) return null;
    clicks.push({ id: clicks.length + 1, px: [c.px[0], c.px[1]], world: c.world ? [c.world[0], c.world[1], c.world[2]] : null });
  }
  return clicks;
}
function toFire(v: unknown): Fire3DShape | null | undefined {
  if (v === null) return null;
  const f = v as Partial<Fire3DShape> | undefined;
  if (!f || typeof f !== "object" || !["block", "burning", "entity"].includes(f.mode as string) || !vec(f.cell, 3) || !vec(f.feet, 3)
    || typeof f.entity !== "string" || !finite(f.width) || !finite(f.height) || !f.faces || !FACES.every(k => typeof f.faces![k] === "boolean")) return undefined;
  return { mode: f.mode!, cell: [...f.cell!] as Vec3, faces: { ...f.faces }, feet: [...f.feet!] as Vec3, entity: f.entity, width: f.width, height: f.height };
}
function toCamera(v: unknown): CameraPose | null | undefined {
  if (v === null) return null;
  const c = v as Record<string, unknown> | undefined;
  return c && typeof c === "object" && CAMERA.every(k => finite(c[k])) ? Object.fromEntries(CAMERA.map(k => [k, c[k]])) as unknown as CameraPose : undefined;
}

export function readFire3D(video: string | undefined, storage?: Reader): Map<string, SavedTool> {
  const memory = new Map<string, SavedTool>();
  if (!video) return memory;
  try {
    const saved = readVideoJson(KIND, video, storage);
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return memory;
    for (const [frame, v] of Object.entries(saved as Record<string, Record<string, unknown>>)) {
      if (!/^\d+$/.test(frame) || !v || typeof v !== "object") continue;
      const clicks = toClicks(v.clicks), fire = toFire(v.fire), camera = toCamera(v.camera), eyeY = v.eyeY;
      if (clicks && fire !== undefined && camera !== undefined && (eyeY === null || finite(eyeY))) memory.set(frame, { clicks, fire, eyeY, camera, rollFree: v.rollFree === true });
    }
  } catch { /* Missing or unavailable storage leaves an empty memory. */ }
  return memory;
}

/** False when nothing could be saved; the memory still works for this session. */
export function writeFire3D(video: string | undefined, memory: Fire3DMemory, storage?: Writer): boolean {
  if (!video) return false;
  try {
    const flat: Record<string, unknown> = {};
    for (const [frame, s] of memory) flat[frame] = { clicks: s.clicks.map(c => ({ px: c.px, world: c.world })), fire: s.fire, eyeY: s.eyeY, camera: s.camera, rollFree: s.rollFree };
    return writeJson(videoStorageKey(KIND, video), flat, storage);
  } catch { return false; }
}

/** A copy of `memory` with this picture's work; a picture with no corners and no fire is forgotten. */
export function remember3D(memory: Fire3DMemory, key: string, state: ToolState): Map<string, SavedTool> {
  const next = new Map(memory);
  if (!state.clicks.length && !state.fire) next.delete(key);
  else next.set(key, { clicks: state.clicks, fire: state.fire, eyeY: state.eyeY, camera: state.camera, rollFree: state.rollFree });
  return next;
}
