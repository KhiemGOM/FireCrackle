// The 3D fire tool's state and rules: clicked block corners (the first is the origin, so no F3 coordinates are
// needed), the camera solve (automatic guess + clicks, clicks alone as the fallback), fire placements and their quads.
// Every camera, pixel and fire corner comes from Rust through lib/reversal.ts.
import {
  defaultFace, entityFireQuads, entitySize, fireBlockQuads, project, solveCamera, solveGuided,
  type CameraFit, type CameraPose, type Face, type FireFaces, type FireQuad, type Orientation,
} from "./reversal";

export type Vec3 = [number, number, number];
export interface ToolClick { id: number; px: [number, number]; world: Vec3 | null; }
export interface BlockFire { id: number; kind: "block"; pos: Vec3; faces: FireFaces; soul: boolean; }
export interface EntityFire { id: number; kind: "entity"; feet: Vec3; entity: string; width: number; height: number; }
export type Placement = BlockFire | EntityFire;
export interface ToolState {
  frame: number;
  clicks: ToolClick[];
  placements: Placement[];
  /** The automatic guess for this frame (yaw modulo 90°). */
  guess: Orientation | null;
  /** Eye height when known (standing on the ground: floor + 1.62). */
  eyeY: number | null;
  /** The camera the quads are drawn with: solved, picked from the candidates, or typed. */
  camera: CameraPose | null;
  candidates: CameraFit[];
}

let nextId = 1;
const id = () => nextId++;
export const NO_FACES: FireFaces = { floor: false, north: false, east: false, south: false, west: false, up: false };
/** Entity size when the type is "custom" (a player's hitbox). */
export const CUSTOM_ENTITY: [number, number] = [0.6, 1.8];

export function emptyTool(frame: number): ToolState {
  return { frame, clicks: [], placements: [], guess: null, eyeY: null, camera: null, candidates: [] };
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

/** Floor (the fire block shape) and the five faces exclude each other; faces combine. */
export function toggleFace(faces: FireFaces, face: Face): FireFaces {
  if (face === "floor") return faces.floor ? { ...NO_FACES } : { ...NO_FACES, floor: true };
  return { ...faces, floor: false, [face]: !faces[face] };
}

/** Solve the camera from the guess and the clicks (clicks alone once there are 4 or more and no guess fits). Keeps
 * the camera as it was when the clicks do not fix it. */
export function solveTool(s: ToolState, w: number, h: number): ToolState {
  const clicks = usableClicks(s);
  let candidates: CameraFit[] = [];
  if (s.guess) {
    const g = s.guess;
    candidates = solveGuided(clicks, w, h, { yaw: g.yaw, pitch: g.pitch, roll: g.roll, fov: g.fov, yawMod90: true, fovKnown: g.fovKnown }, s.eyeY ?? undefined);
  }
  if (candidates.length === 0 && clicks.length >= 4) {
    const alone = solveCamera(clicks, w, h);
    if (alone) candidates = [alone];
  }
  return candidates.length ? { ...s, candidates, camera: candidates[0].camera } : { ...s, candidates };
}

export function newFireBlock(pos: Vec3, soul = false): BlockFire {
  return { id: id(), kind: "block", pos: pos.map(Math.floor) as Vec3, faces: { ...NO_FACES, floor: true }, soul };
}
/** A burning block's face: the fire cell `pos`, with the side pointing away from the camera chosen. */
export function newBurningFace(cam: CameraPose, pos: Vec3): BlockFire {
  const cell = pos.map(Math.floor) as Vec3;
  return { id: id(), kind: "block", pos: cell, faces: { ...NO_FACES, [defaultFace(cam, cell)]: true }, soul: false };
}
export function newEntityFire(feet: Vec3, entity: string): EntityFire {
  const [width, height] = entity === "custom" ? CUSTOM_ENTITY : entitySize(entity) ?? CUSTOM_ENTITY;
  return { id: id(), kind: "entity", feet, entity, width, height };
}

export function placementQuads(p: Placement, cam: CameraPose, w: number, h: number): FireQuad[] {
  return p.kind === "block"
    ? fireBlockQuads(cam, w, h, p.pos, p.faces, p.soul)
    : entityFireQuads(cam, w, h, p.feet, p.width, p.height);
}

/** Block-edge lines of the plane y = `centre[1]` within `radius` blocks of `centre`, as projected segments. Lines are
 * cut into one-block pieces so the parts behind the camera drop out. */
export function groundGrid(cam: CameraPose, w: number, h: number, centre: Vec3, radius: number): [number, number][][] {
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
