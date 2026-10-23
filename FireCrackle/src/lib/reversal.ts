// Thin binding to fire_core's camera, automatic guess and fire geometry (fire-detection/core/src/reversal_abi.rs).
// No projection or fire math here: every pixel and corner comes from Rust (docs/INFRASTRUCTURE.md).
import wasmUrl from "./reversal.wasm?url";

/** Minecraft camera: eye position (blocks), yaw / pitch / roll / vertical FOV (degrees). */
export interface CameraPose { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; fov: number; }
/** The automatic guess from a frame. Yaw is known only modulo 90°. */
export interface Orientation { yaw: number; pitch: number; roll: number; fov: number; fovKnown: boolean; ambiguous: boolean; margin: number; support: number; }
export interface Guess { yaw: number; pitch: number; roll: number; fov: number; yawMod90: boolean; fovKnown: boolean; }
/** A clicked block corner: its world point and where it is on the frame (pixels). */
export interface Click { world: [number, number, number]; px: [number, number]; }
export interface CameraFit { camera: CameraPose; rms: number; fovFixed: boolean; }
/** One fire quad: world corners, pixels (null when a corner is behind the camera), sprite UVs, sheet (0/1, -1 = either). */
export interface FireQuad { world: [number, number, number][]; px: [number, number][] | null; uv: [number, number][]; sheet: number; }
export interface FireFaces { floor: boolean; north: boolean; east: boolean; south: boolean; west: boolean; up: boolean; }

type Runtime = {
  memory: WebAssembly.Memory;
  rev_alloc(n: number): number; rev_free(p: number, n: number): void;
  rev_orientation(rgba: number, w: number, h: number, mask: number, out: number): number;
  rev_solve_guided(pts: number, n: number, w: number, h: number, guess: number, eyeY: number, out: number, cap: number): number;
  rev_solve(pts: number, n: number, w: number, h: number, out: number): number;
  rev_project(cam: number, pts: number, n: number, w: number, h: number, out: number): number;
  rev_block_quads(cam: number, w: number, h: number, x: number, y: number, z: number, faces: number, soul: number, out: number, cap: number): number;
  rev_entity_quads(cam: number, w: number, h: number, x: number, y: number, z: number, ew: number, eh: number, out: number, cap: number): number;
  rev_entity_count(): number; rev_entity(i: number, name: number, cap: number, dims: number): number;
};
let native: Runtime | undefined;
let pending: Promise<void> | undefined;
let sizes: Map<string, [number, number]> | undefined;

/** Tests can supply the module bytes; the browser fetches the built module once. */
export function initReversal(bytes?: BufferSource): Promise<void> {
  if (native) return Promise.resolve();
  if (!pending) pending = (async () => {
    const data = bytes ?? await (await fetch(wasmUrl)).arrayBuffer();
    native = (await WebAssembly.instantiate(data, {})).instance.exports as unknown as Runtime;
  })().catch(e => { pending = undefined; throw e; });
  return pending;
}
function rt(): Runtime { if (!native) throw new Error("Reversal runtime is not initialized"); return native; }

/** Run `f` with wasm buffers for each request (bytes), freeing them afterwards. */
function withBuffers<T>(bytes: number[], f: (n: Runtime, ptrs: number[]) => T): T {
  const n = rt();
  const ptrs = bytes.map(b => n.rev_alloc(b));
  try { return f(n, ptrs); } finally { ptrs.forEach((p, i) => n.rev_free(p, bytes[i])); }
}
const f64In = (n: Runtime, p: number, v: number[]) => new Float64Array(n.memory.buffer, p, v.length).set(v);
const f64Out = (n: Runtime, p: number, len: number) => Array.from(new Float64Array(n.memory.buffer, p, len));
const camArray = (c: CameraPose) => [c.x, c.y, c.z, c.yaw, c.pitch, c.roll, c.fov];
const fitFrom = (v: number[]): CameraFit => ({
  camera: { x: v[0], y: v[1], z: v[2], yaw: v[3], pitch: v[4], roll: v[5], fov: v[6] }, rms: v[7], fovFixed: v[8] !== 0,
});
const clickArray = (clicks: Click[]) => clicks.flatMap(c => [...c.world, ...c.px]);

/** The automatic guess (rotation + FOV) from an RGBA frame; `mask` marks pixels that are not the world (GUI). */
export function orientation(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, mask?: Uint8Array): Orientation | null {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 3 || h < 3 || rgba.length !== w * h * 4) throw new Error("Invalid RGBA dimensions");
  if (mask && mask.length !== w * h) throw new Error("Invalid mask size");
  return withBuffers([rgba.length, mask ? mask.length : 1, 64], (n, [p, m, out]) => {
    new Uint8Array(n.memory.buffer, p, rgba.length).set(rgba);
    if (mask) new Uint8Array(n.memory.buffer, m, mask.length).set(mask);
    const r = n.rev_orientation(p, w, h, mask ? m : 0, out);
    if (r < 0) throw new Error("Invalid frame");
    if (r === 0) return null;
    const v = f64Out(n, out, 8);
    return { yaw: v[0], pitch: v[1], roll: v[2], fov: v[3], fovKnown: v[4] !== 0, ambiguous: v[5] !== 0, margin: v[6], support: v[7] };
  });
}

/** Camera from the guess plus clicked corners (2, or 1 with the eye height); answers best first. */
export function solveGuided(clicks: Click[], w: number, h: number, guess: Guess, eyeY?: number): CameraFit[] {
  const cap = 8, pts = clickArray(clicks);
  return withBuffers([Math.max(pts.length, 1) * 8, 48, cap * 9 * 8], (n, [p, g, out]) => {
    f64In(n, p, pts);
    f64In(n, g, [guess.yaw, guess.pitch, guess.roll, guess.fov, guess.yawMod90 ? 1 : 0, guess.fovKnown ? 1 : 0]);
    const k = n.rev_solve_guided(p, clicks.length, w, h, g, eyeY ?? NaN, out, cap);
    return Array.from({ length: Math.max(k, 0) }, (_, i) => fitFrom(f64Out(n, out + i * 72, 9)));
  });
}

/** Camera from clicks alone (4 or more corners). */
export function solveCamera(clicks: Click[], w: number, h: number): CameraFit | null {
  const pts = clickArray(clicks);
  return withBuffers([Math.max(pts.length, 1) * 8, 72], (n, [p, out]) => {
    f64In(n, p, pts);
    return n.rev_solve(p, clicks.length, w, h, out) === 1 ? fitFrom(f64Out(n, out, 9)) : null;
  });
}

/** Pixels of world points under `cam` (null behind the camera). */
export function project(cam: CameraPose, pts: [number, number, number][], w: number, h: number): ([number, number] | null)[] {
  const flat = pts.flat();
  return withBuffers([56, Math.max(flat.length, 1) * 8, Math.max(pts.length, 1) * 16], (n, [c, p, out]) => {
    f64In(n, c, camArray(cam));
    f64In(n, p, flat);
    n.rev_project(c, p, pts.length, w, h, out);
    const v = f64Out(n, out, pts.length * 2);
    return pts.map((_, i) => Number.isNaN(v[i * 2]) ? null : [v[i * 2], v[i * 2 + 1]] as [number, number]);
  });
}

const QUAD = 29, CAP = 64;
function quads(v: number[], k: number): FireQuad[] {
  return Array.from({ length: Math.max(k, 0) }, (_, i) => {
    const q = v.slice(i * QUAD, (i + 1) * QUAD);
    const world = [0, 1, 2, 3].map(c => [q[c * 3], q[c * 3 + 1], q[c * 3 + 2]] as [number, number, number]);
    const px = [0, 1, 2, 3].map(c => [q[12 + c * 2], q[13 + c * 2]] as [number, number]);
    const uv = [0, 1, 2, 3].map(c => [q[20 + c * 2], q[21 + c * 2]] as [number, number]);
    return { world, px: px.some(p => Number.isNaN(p[0])) ? null : px, uv, sheet: q[28] };
  });
}

/** The planes a fire block draws for the chosen faces (floor wins; soul fire draws only floor planes). */
export function fireBlockQuads(cam: CameraPose, w: number, h: number, pos: [number, number, number], faces: FireFaces, soul: boolean): FireQuad[] {
  const bits = (faces.floor ? 1 : 0) | (faces.north ? 2 : 0) | (faces.east ? 4 : 0) | (faces.south ? 8 : 0) | (faces.west ? 16 : 0) | (faces.up ? 32 : 0);
  return withBuffers([56, CAP * QUAD * 8], (n, [c, out]) => {
    f64In(n, c, camArray(cam));
    const k = n.rev_block_quads(c, w, h, pos[0], pos[1], pos[2], bits, soul ? 1 : 0, out, CAP);
    return quads(f64Out(n, out, Math.max(k, 0) * QUAD), k);
  });
}

/** The fire on an entity with feet at `feet` and hitbox `width` × `height`, facing `cam`. */
export function entityFireQuads(cam: CameraPose, w: number, h: number, feet: [number, number, number], width: number, height: number): FireQuad[] {
  return withBuffers([56, CAP * QUAD * 8], (n, [c, out]) => {
    f64In(n, c, camArray(cam));
    const k = n.rev_entity_quads(c, w, h, feet[0], feet[1], feet[2], width, height, out, CAP);
    return quads(f64Out(n, out, Math.max(k, 0) * QUAD), k);
  });
}

/** Every entity type's hitbox (1.16.5), read once from Rust. */
export function entitySizes(): Map<string, [number, number]> {
  if (sizes) return sizes;
  const n = rt(), count = n.rev_entity_count();
  const m = new Map<string, [number, number]>();
  withBuffers([64, 16], (n, [name, dims]) => {
    for (let i = 0; i < count; i++) {
      const len = n.rev_entity(i, name, 64, dims);
      const label = new TextDecoder().decode(new Uint8Array(n.memory.buffer, name, len));
      const d = f64Out(n, dims, 2);
      m.set(label, [d[0], d[1]]);
    }
  });
  sizes = m;
  return m;
}

/** Hitbox of an entity type (`minecraft:` optional). */
export function entitySize(kind: string): [number, number] | null {
  return entitySizes().get(kind.replace(/^minecraft:/, "")) ?? null;
}
