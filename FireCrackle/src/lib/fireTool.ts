// The 3D quad tool's state and rules: clicked block corners (the first is the origin, so no F3 coordinates are
// needed), the camera solve (automatic guess + clicks, clicks alone as the fallback), and ONE fire in one of three
// modes: a fire block, a burning block (the fire cell's planes on its burning neighbours' faces) or fire on an entity.
// Soul fire is the soul atlas, not a mode. Every camera, pixel and fire corner comes from Rust through lib/reversal.ts.
import {
  defaultFace, entityFireQuads, entitySize, fireBlockQuads, initReversal, orientation, pixelRay, project, solveCamera, solveGuided,
  type CameraFit, type CameraPose, type FireFaces, type FireQuad, type Orientation,
} from "./reversal";
import { manualTexels, validQuad, type ManualQuad, type QuadPoint } from "./quadMask";
import { canvasFrameIo, type FrameIo } from "./veilFrame";

/** The automatic camera guess of a picture at its native size (worker-safe; the hook runs it as the picture
 * worker's `orientation` task, since a 1440p frame takes over a second). */
/** Runs one request at a time; one that is passed over while waiting resolves null, so only the newest runs next
 * (stepping frames quickly must not queue a second-long guess per frame). */
export function latestOnly() {
  let busy = false, waiting: { run: () => Promise<unknown>; done: (v: Promise<unknown> | null) => void } | null = null;
  const start = <T>(run: () => Promise<T>): Promise<T> => {
    busy = true;
    const made = run();
    void made.catch(() => {}).finally(() => {
      busy = false;
      const next = waiting;
      waiting = null;
      if (next) next.done(start(next.run));
    });
    return made;
  };
  return <T>(run: () => Promise<T>): Promise<T | null> => {
    if (!busy) return start(run);
    waiting?.done(null);
    return new Promise<T | null>(resolve => { waiting = { run, done: v => resolve(v as Promise<T> | null) }; });
  };
}

export async function guessPicture(bytes: ArrayBuffer, io: Pick<FrameIo, "decode"> = canvasFrameIo): Promise<{ width: number; height: number; guess: Orientation | null }> {
  const [image] = await Promise.all([io.decode(bytes), initReversal()]);
  return { width: image.width, height: image.height, guess: orientation(image.data, image.width, image.height) };
}

export type Vec3 = [number, number, number];
export interface ToolClick { id: number; px: [number, number]; world: Vec3 | null; }
export type FireMode = "block" | "burning" | "entity";
/** The faces a burning block's fire draws on (its flammable neighbours); the floor shape is the fire block mode. */
export interface BurnFaces { north: boolean; east: boolean; south: boolean; west: boolean; up: boolean; }
export type BurnFace = keyof BurnFaces;
/** The one fire: `cell` for the block modes, `feet` + hitbox for entity fire; both kept so switching mode keeps it. */
export interface Fire3DShape {
  mode: FireMode;
  cell: Vec3;
  faces: BurnFaces;
  feet: Vec3;
  entity: string;
  width: number;
  height: number;
}
export interface ToolState {
  frame: number;
  clicks: ToolClick[];
  fire: Fire3DShape | null;
  /** The automatic guess for this frame (yaw modulo 90°). */
  guess: Orientation | null;
  /** Eye height when known (standing on the ground: floor + 1.62). */
  eyeY: number | null;
  /** The camera the quads are drawn with: solved, picked from the candidates, or typed. */
  camera: CameraPose | null;
  candidates: CameraFit[];
  /** Let the solve tilt the camera (a hurt frame); by default roll is held at 0, so a wrong assumption misses. */
  rollFree: boolean;
}

let nextId = 1;
const id = () => nextId++;
export const NO_FACES: FireFaces = { floor: false, north: false, east: false, south: false, west: false, up: false };
export const NO_BURN: BurnFaces = { north: false, east: false, south: false, west: false, up: false };
export const DEFAULT_ENTITY = "minecraft:blaze";

export function emptyTool(frame: number): ToolState {
  return { frame, clicks: [], fire: null, guess: null, eyeY: null, camera: null, candidates: [], rollFree: false };
}

/** What is kept of a frame's work (fire3dMemory): the corners, the fire, the eye height and the camera. */
export type SavedTool = Pick<ToolState, "clicks" | "fire" | "eyeY" | "camera" | "rollFree">;

/** The state for a newly shown picture: its own saved work when there is some; otherwise the last fire and camera to
 * line up from, without the last picture's corners. The same picture again only takes the new guess. */
export function pictureState(s: ToolState, samePicture: boolean, guess: Orientation | null, saved: SavedTool | undefined): ToolState {
  if (samePicture) return { ...s, guess };
  if (saved) {
    // a camera kept before cameras were checked (or edited by hand into nonsense) is dropped; the corners solve again
    const near = [...saved.clicks.flatMap(c => c.world ? [c.world] : []), ...(saved.fire ? [saved.fire.mode === "entity" ? saved.fire.feet : saved.fire.cell] : [])];
    const camera = saved.camera && plausibleCamera(saved.camera, near) ? saved.camera : null;
    return { ...emptyTool(0), ...saved, camera, clicks: saved.clicks.map(c => ({ ...c, id: id() })), guess };
  }
  return { ...emptyTool(0), fire: s.fire, eyeY: s.eyeY, camera: s.camera, guess };
}

/** Minecraft's axes from `origin`, one block long, for the legend: which way + is on each (null ends are left out). */
export function axisLines(cam: CameraPose, origin: Vec3, w: number, h: number, length = 1): { axis: "x" | "y" | "z"; label: string; from: [number, number]; to: [number, number] }[] {
  const ends: Vec3[] = [[length, 0, 0], [0, length, 0], [0, 0, length]].map(d => [origin[0] + d[0], origin[1] + d[1], origin[2] + d[2]]);
  const [o, ...px] = project(cam, [origin, ...ends], w, h);
  if (!o) return [];
  return (["x", "y", "z"] as const).flatMap((axis, i) => px[i] ? [{ axis, label: AXIS_LABELS[i], from: o, to: px[i]! }] : []);
}
const AXIS_LABELS = ["+X east", "+Y up", "+Z south"];

/** The overview turned by a right-drag of `dx`, `dy` screen pixels: dragging right turns right. */
export function orbitDrag(o: { yaw: number; pitch: number }, dx: number, dy: number): { yaw: number; pitch: number } {
  return { yaw: o.yaw + dx * 0.4, pitch: Math.max(-85, Math.min(89, o.pitch + dy * 0.4)) };
}

/** The overview's target after a left-drag from pixel `from` to `to` (of a `w` × `h` view): the point under the cursor
 * at the target's depth stays under the cursor (rays from Rust's Camera::pixel_ray). */
export function panTarget(view: CameraPose, target: Vec3, from: [number, number], to: [number, number], w: number, h: number): Vec3 {
  if (from[0] === to[0] && from[1] === to[1]) return target;
  const eye: Vec3 = [view.x, view.y, view.z], fwd = pixelRay(view, w, h, w / 2, h / 2);
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const depth = dot([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]], fwd);
  const at = (p: [number, number]) => { const r = pixelRay(view, w, h, p[0], p[1]), t = depth / dot(r, fwd); return r.map(v => v * t) as Vec3; };
  const a = at(from), b = at(to);
  return [target[0] + a[0] - b[0], target[1] + a[1] - b[1], target[2] + a[2] - b[2]];
}

/** A click on the frame: the first one is the origin (0, 0, 0); later ones wait for their coordinates. */
export function addClick(s: ToolState, px: [number, number]): ToolState {
  return { ...s, clicks: [...s.clicks, { id: id(), px, world: s.clicks.length === 0 ? [0, 0, 0] : null }] };
}
export function setClickWorld(s: ToolState, clickId: number, world: Vec3 | null): ToolState {
  return { ...s, clicks: s.clicks.map(c => c.id === clickId ? { ...c, world } : c) };
}
export function moveClick(s: ToolState, clickId: number, px: [number, number]): ToolState {
  return { ...s, clicks: s.clicks.map(c => c.id === clickId ? { ...c, px } : c) };
}
export function removeClick(s: ToolState, clickId: number): ToolState {
  return { ...s, clicks: s.clicks.filter(c => c.id !== clickId) };
}
export function usableClicks(s: ToolState) {
  return s.clicks.filter((c): c is ToolClick & { world: Vec3 } => c.world !== null).map(c => ({ world: c.world, px: c.px }));
}

/** Solve the camera from the guess and the clicks (clicks alone once there are 4 or more and no guess fits). Keeps
 * the camera as it was when the clicks do not fix it. */
const MAX_GRID_RADIUS = 64;

/** A camera Minecraft can have: finite, rolled no more than the hurt tilt, a FOV the game can reach, and its eye within
 * 512 blocks of every `near` point (the corners clicked on the picture, or the fire). A solve from too few corners
 * can fit them with an eye millions of blocks away; such a camera is never used or kept. */
export function plausibleCamera(cam: CameraPose, near: Vec3[]): boolean {
  if (![cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.roll, cam.fov].every(Number.isFinite)) return false;
  if (Math.abs(cam.roll) > 20 || cam.fov < 20 || cam.fov > 150) return false;
  return near.every(p => Math.hypot(p[0] - cam.x, p[1] - cam.y, p[2] - cam.z) <= 512);
}

export function solveTool(s: ToolState, w: number, h: number): ToolState {
  const clicks = usableClicks(s);
  let candidates: CameraFit[] = [];
  if (s.guess) {
    const g = s.guess;
    candidates = solveGuided(clicks, w, h, { yaw: g.yaw, pitch: g.pitch, roll: g.roll, fov: g.fov, yawMod90: true, fovKnown: g.fovKnown, rollFixed: !s.rollFree }, s.eyeY ?? undefined);
  }
  const worlds = clicks.map(c => c.world);
  candidates = candidates.filter(c => plausibleCamera(c.camera, worlds));
  if (candidates.length === 0 && clicks.length >= 4) {
    let alone = solveCamera(clicks, w, h);
    // the clicks alone may tilt the camera: held, it is fitted again level from where they put it
    if (alone && !s.rollFree) {
      const a = alone.camera;
      alone = solveGuided(clicks, w, h, { yaw: a.yaw, pitch: a.pitch, roll: 0, fov: a.fov, yawMod90: false, fovKnown: false, rollFixed: true }, s.eyeY ?? undefined)[0] ?? null;
    }
    if (alone && plausibleCamera(alone.camera, worlds)) candidates = [alone];
  }
  return candidates.length ? { ...s, candidates, camera: candidates[0].camera } : { ...s, candidates };
}

/** RMS pixel distance between where `cam` puts the typed corners and where they were clicked (`w` × `h` pixels); null
 * with no typed corner or one behind the camera. For a camera that was kept rather than solved just now. */
export function cornerFit(cam: CameraPose, clicks: ToolClick[], w: number, h: number): number | null {
  const typed = clicks.filter((c): c is ToolClick & { world: Vec3 } => c.world !== null);
  if (!typed.length) return null;
  const px = project(cam, typed.map(c => c.world), w, h);
  if (px.some(p => !p)) return null;
  return Math.sqrt(typed.reduce((sum, c, i) => sum + (px[i]![0] - c.px[0]) ** 2 + (px[i]![1] - c.px[1]) ** 2, 0) / typed.length);
}

/** Corners a camera needs to be pinned down (each gives 2 numbers; a camera has 7): fewer, and many cameras fit them,
 * so the one shown leans on the automatic guess and the eye height. */
const SURE_CORNERS = 4;
export function cameraQuality(s: ToolState): { rough: boolean; need: number } {
  const need = Math.max(0, SURE_CORNERS - usableClicks(s).length);
  return { rough: need > 0, need };
}
/** What the camera is solved from: a change here solves again (moving the fire does not). */
export function solveKey(s: ToolState): string {
  return JSON.stringify([usableClicks(s), s.eyeY, s.guess, s.rollFree]);
}

const floorCell = (p: Vec3): Vec3 => [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];

/** A new fire: a fire block at `cell`. */
export function newFire(cam: CameraPose, cell: Vec3): Fire3DShape {
  const c = floorCell(cell);
  const [width, height] = entitySize(DEFAULT_ENTITY) ?? [0.6, 1.8];
  return { mode: "block", cell: c, faces: burnFacesAway(cam, c), feet: [c[0] + 0.5, c[1], c[2] + 0.5], entity: DEFAULT_ENTITY, width, height };
}
/** The face of the fire cell pointing away from the camera: the first guess of which neighbour burns. */
function burnFacesAway(cam: CameraPose, cell: Vec3): BurnFaces {
  const f = defaultFace(cam, cell);
  return { ...NO_BURN, ...(f !== "floor" ? { [f]: true } : { north: true }) };
}
/** Switch mode keeping the fire in place: the entity stands at the cell's centre, a block takes the cell under the
 * feet; entering burning mode starts with the face away from the camera when none is set. */
export function setMode(f: Fire3DShape, mode: FireMode, cam: CameraPose): Fire3DShape {
  if (mode === f.mode) return f;
  if (mode === "entity") return { ...f, mode, feet: f.mode === "entity" ? f.feet : [f.cell[0] + 0.5, f.cell[1], f.cell[2] + 0.5] };
  const cell = f.mode === "entity" ? floorCell(f.feet) : f.cell;
  const faces = mode === "burning" ? burnFacesAway(cam, cell) : f.faces;
  return { ...f, mode, cell, faces };
}
/** Put the fire where a click landed (a point on the floor plane): the cell there, or the entity's feet. */
export function placeFire(f: Fire3DShape, at: Vec3): Fire3DShape {
  return f.mode === "entity" ? { ...f, feet: at } : { ...f, cell: floorCell(at) };
}
export function toggleBurnFace(faces: BurnFaces, face: BurnFace): BurnFaces {
  return { ...faces, [face]: !faces[face] };
}
export function setEntity(f: Fire3DShape, entity: string): Fire3DShape {
  const size = entitySize(entity);
  return size ? { ...f, entity, width: size[0], height: size[1] } : { ...f, entity };
}
/** The fire's planes under `cam`: the fire block shape (floor planes only for soul fire), the burning faces, or the
 * entity's fire (always normal fire). */
export function fireQuads(f: Fire3DShape, soul: boolean, cam: CameraPose, w: number, h: number): FireQuad[] {
  if (f.mode === "entity") return entityFireQuads(cam, w, h, f.feet, f.width, f.height);
  const faces: FireFaces = f.mode === "block" ? { ...NO_FACES, floor: true } : { ...NO_FACES, ...f.faces };
  return fireBlockQuads(cam, w, h, f.cell, faces, soul && f.mode === "block");
}
/** The wireframe that shows where the fire is: its cell, or the entity's hitbox (12 edges). */
export function fireOutline(f: Fire3DShape): [Vec3, Vec3][] {
  const [x0, y0, z0, x1, y1, z1] = f.mode === "entity"
    ? [f.feet[0] - f.width / 2, f.feet[1], f.feet[2] - f.width / 2, f.feet[0] + f.width / 2, f.feet[1] + f.height, f.feet[2] + f.width / 2]
    : [f.cell[0], f.cell[1], f.cell[2], f.cell[0] + 1, f.cell[1] + 1, f.cell[2] + 1];
  const c: Vec3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  return [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].map(([a, b]) => [c[a], c[b]]);
}

/** Block-edge lines of the plane y = `centre[1]` within `radius` blocks of `centre`, as projected segments. Lines are
 * cut into one-block pieces so the parts behind the camera drop out. */
export function groundGrid(cam: CameraPose, w: number, h: number, centre: Vec3, size: number): [number, number][][] {
  // its cost grows with the square of the radius: never more than a 129-block square, whatever is asked
  const radius = Number.isFinite(size) ? Math.max(0, Math.min(Math.floor(size), MAX_GRID_RADIUS)) : 0;
  const y = Math.floor(centre[1]), cx = Math.floor(centre[0]), cz = Math.floor(centre[2]);
  const pieces: [Vec3, Vec3][] = [];
  for (let i = -radius; i <= radius + 1; i++) for (let j = -radius; j <= radius; j++) {
    pieces.push([[cx + i, y, cz + j], [cx + i, y, cz + j + 1]]);
    pieces.push([[cx + j, y, cz + i], [cx + j + 1, y, cz + i]]);
  }
  const px = project(cam, pieces.flat(), w, h);
  const out: [number, number][][] = [];
  for (let k = 0; k < pieces.length; k++) {
    const a = px[2 * k], b = px[2 * k + 1];
    if (a && b) out.push([a, b]);
  }
  return out;
}

/** A fire plane as Label's manual quad: corners in image fractions in sprite order (top-left, top-right,
 * bottom-right, bottom-left, by UV) and whether the sprite shows mirrored. Seen from behind (or with a mirrored UV)
 * the corners are swapped left to right so the quad stays valid, and `mirrored` says the sprite is drawn flipped, as
 * the game draws that side. None when a corner is behind the camera. */
export function planeToManualQuad(q: FireQuad, w: number, h: number): { quad: ManualQuad; mirrored: boolean; world: [Vec3, Vec3, Vec3, Vec3] } | null {
  if (!q.px || w <= 0 || h <= 0) return null;
  const slot = (uv: [number, number]) => (uv[1] < 0.5 ? (uv[0] < 0.5 ? 0 : 1) : (uv[0] < 0.5 ? 3 : 2));
  const ordered: QuadPoint[] = new Array(4), world: Vec3[] = new Array(4);
  q.uv.forEach((uv, i) => { ordered[slot(uv)] = [q.px![i][0] / w, q.px![i][1] / h]; world[slot(uv)] = q.world[i]; });
  if (ordered.some(p => !p)) return null;
  const quad = ordered as ManualQuad, corners = world as [Vec3, Vec3, Vec3, Vec3];
  if (validQuad(quad)) return { quad, mirrored: false, world: corners };
  const swapped: ManualQuad = [quad[1], quad[0], quad[3], quad[2]];
  return validQuad(swapped) ? { quad: swapped, mirrored: true, world: [corners[1], corners[0], corners[3], corners[2]] } : null;
}

/** All planes' sprite texels (as the quad mask draws one plane, lib/quadMask.ts manualTexels) in the order to draw
 * them: far to near by each texel's own distance from the eye. The game draws fire as cut-out pixels with a depth
 * buffer, so the nearest opaque texel shows at every point; a fire block's planes cross each other, so ordering whole
 * planes cannot be right. `mirrored`: the sprite choice's flip, on top of each plane's own. */
export function fireTexels(quads: FireQuad[], rgba: Uint8ClampedArray, row: number, mirrored: boolean, w: number, h: number, eye: Vec3, side = 16, rows = 32) {
  const out: { points: QuadPoint[]; colour: string; alpha: number; depth: number }[] = [];
  for (const q of quads) {
    const m = planeToManualQuad(q, w, h);
    if (!m) continue;
    const [tl, tr, br, bl] = m.world;
    for (const t of manualTexels(rgba, row, m.mirrored !== mirrored, m.quad, side, rows)) {
      const [u, v] = t.centre, a = (1 - u) * (1 - v), b = u * (1 - v), c = u * v, d = (1 - u) * v;
      const p = [0, 1, 2].map(k => a * tl[k] + b * tr[k] + c * br[k] + d * bl[k]);
      out.push({ points: t.points, colour: t.colour, alpha: t.alpha, depth: Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) });
    }
  }
  return out.sort((x, y) => y.depth - x.depth);
}

/** A press released within this many screen pixels of where it started is a click (adds a corner or places the
 * fire); anything longer is a drag that pans the picture. */
export const CLICK_SLOP = 4;
export function isClick(down: [number, number], up: [number, number]): boolean {
  return Math.hypot(up[0] - down[0], up[1] - down[1]) < CLICK_SLOP;
}
