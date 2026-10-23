// The 3D fire tool's binding to fire_core (camera, reversal, fire_model) through the reversal WASM module. Every
// number comes from Rust; these tests check the binding round-trips and the tool-facing rules:
// projection (null behind the camera), the guided solve, fire block choices (floor = floor + its 4 side planes,
// soul = floor planes only, a face = its own planes), entity fire and sizes, and bad input.
import { vi as reversalTest } from "vitest";
import { beforeAll, describe, expect, it } from "vitest";
import {
  initReversal, project, solveGuided, solveCamera, fireBlockQuads, entityFireQuads, entitySize, orientation,
  type CameraPose,
} from "./reversal";

beforeAll(async () => {
  const { readFile } = await reversalTest.importActual<{ readFile(path: URL): Promise<Uint8Array<ArrayBuffer>> }>("node:fs/promises");
  await initReversal(await readFile(new URL("./reversal.wasm", import.meta.url)));
});

const W = 1920, H = 1080;
const cam: CameraPose = { x: 3.37, y: 65.62, z: -2.81, yaw: -152, pitch: 24, roll: 0.2, fov: 110 };
const corners: [number, number, number][] = [
  [6, 64, -7], [9, 64, -5], [5, 66, -9], [4, 63, -6], [7, 65, -8], [8, 63, -7], [6, 66, -5], [5, 64, -10],
];
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

describe("projection", () => {
  it("puts the look direction at the centre and returns null behind the camera", () => {
    const c: CameraPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 70 };
    const [ahead, behind] = project(c, [[0, 0, 5], [0, 0, -5]], W, H);
    expect(ahead![0]).toBeCloseTo(W / 2, 6);
    expect(ahead![1]).toBeCloseTo(H / 2, 6);
    expect(behind).toBeNull();
  });
});

describe("camera solves", () => {
  const clicks = (pts: [number, number, number][]) =>
    pts.map(world => ({ world, px: project(cam, [world], W, H)[0]! }));

  it("the guess plus two corners gives the camera", () => {
    const guess = { yaw: ((cam.yaw % 90) + 90) % 90, pitch: cam.pitch, roll: cam.roll, fov: cam.fov, yawMod90: true, fovKnown: true };
    const fits = solveGuided(clicks(corners.slice(0, 2)), W, H, guess);
    expect(fits.length).toBeGreaterThan(0);
    const f = fits[0];
    expect(Math.hypot(f.camera.x - cam.x, f.camera.y - cam.y, f.camera.z - cam.z)).toBeLessThan(1e-3);
    expect(near(((f.camera.yaw - cam.yaw) % 360 + 540) % 360 - 180, 0, 1e-3)).toBe(true);
    expect(f.rms).toBeLessThan(1e-2);
  });

  it("one corner needs the eye height, and gives every quarter turn with it", () => {
    const guess = { yaw: ((cam.yaw % 90) + 90) % 90, pitch: cam.pitch, roll: cam.roll, fov: cam.fov, yawMod90: true, fovKnown: true };
    expect(solveGuided(clicks(corners.slice(0, 1)), W, H, guess)).toEqual([]);
    const fits = solveGuided(clicks(corners.slice(0, 1)), W, H, guess, cam.y);
    expect(fits.some(f => Math.hypot(f.camera.x - cam.x, f.camera.y - cam.y, f.camera.z - cam.z) < 1e-3)).toBe(true);
  });

  it("eight corners and no guess give the camera", () => {
    const f = solveCamera(clicks(corners), W, H);
    expect(f).not.toBeNull();
    expect(Math.hypot(f!.camera.x - cam.x, f!.camera.y - cam.y, f!.camera.z - cam.z)).toBeLessThan(1e-3);
    expect(near(f!.camera.fov, cam.fov, 1e-2)).toBe(true);
  });
});

describe("fire block choices", () => {
  const pos: [number, number, number] = [6, 64, -7];
  const none = { floor: false, north: false, east: false, south: false, west: false, up: false };

  it("floor draws the floor planes plus the four side planes; soul fire only the floor planes", () => {
    const floor = fireBlockQuads(cam, W, H, pos, { ...none, floor: true }, false);
    const soul = fireBlockQuads(cam, W, H, pos, { ...none, floor: true }, true);
    const sides = ["north", "east", "south", "west"].map(k => fireBlockQuads(cam, W, H, pos, { ...none, [k]: true }, false).length);
    expect(soul.length).toBeGreaterThan(0);
    expect(floor.length).toBe(soul.length + sides.reduce((a, b) => a + b, 0));
    // floor wins: asking for floor and a face is the floor case
    expect(fireBlockQuads(cam, W, H, pos, { ...none, floor: true, up: true }, false).length).toBe(floor.length);
  });

  it("a north face hugs the north side of the cell and has no duplicate variants", () => {
    const q = fireBlockQuads(cam, W, H, pos, { ...none, north: true }, false);
    expect(q.length).toBeGreaterThan(0);
    for (const quad of q) for (const c of quad.world) expect(near(c[2], pos[2], 0.01)).toBe(true);
    const keys = new Set(q.map(x => JSON.stringify(x.world.map(c => c.map(v => v.toFixed(6))))));
    expect(keys.size).toBe(q.length);
  });

  it("several faces draw all of them; none draws nothing", () => {
    const two = fireBlockQuads(cam, W, H, pos, { ...none, north: true, up: true }, false);
    const n = fireBlockQuads(cam, W, H, pos, { ...none, north: true }, false).length;
    const u = fireBlockQuads(cam, W, H, pos, { ...none, up: true }, false).length;
    expect(two.length).toBe(n + u);
    expect(fireBlockQuads(cam, W, H, pos, none, false)).toEqual([]);
  });

  it("corners behind the camera come back as null", () => {
    const q = fireBlockQuads(cam, W, H, [0, 64, 5], { ...none, floor: true }, false);
    expect(q.every(x => x.px === null || x.px.length === 4)).toBe(true);
    expect(q.some(x => x.px === null)).toBe(true);
  });
});

describe("entity fire", () => {
  it("a blaze is five camera-facing layers and sizes come from the game", () => {
    expect(entitySize("minecraft:blaze")).toEqual([0.6, 1.8]);
    expect(entitySize("small_fireball")).toEqual([0.3125, 0.3125]);
    expect(entitySize("minecraft:nope")).toBeNull();
    const q = entityFireQuads(cam, W, H, [6.5, 64, -7.5], 0.6, 1.8);
    expect(q.length).toBe(5);
    expect(q.map(x => x.sheet)).toEqual([0, 1, 0, 1, 0]);
    expect(q[0].uv).toEqual([[0, 1], [1, 1], [1, 0], [0, 0]]);
  });
});

describe("automatic guess", () => {
  it("a flat picture has no answer and bad sizes throw", () => {
    expect(orientation(new Uint8ClampedArray(320 * 180 * 4).fill(90), 320, 180)).toBeNull();
    expect(() => orientation(new Uint8ClampedArray(10), 320, 180)).toThrow();
  });
});
