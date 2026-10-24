// The 3D quad tool's rules (lib/fireTool.ts): clicks (the first is the origin), the solve (guess + clicks, clicks
// alone as fallback), ONE fire in one of three modes (fire block, burning block, entity fire) that keeps its place when
// the mode changes and is placed by clicking the video, soul fire from the atlas, its wireframe, the ground grid.
// All geometry goes through the reversal WASM binding.
import { vi as toolTest } from "vitest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initReversal, project, type CameraPose, type Orientation } from "./reversal";
import {
  addClick, setClickWorld, removeClick, usableClicks, solveTool, groundGrid, emptyTool, newFire, setMode, placeFire,
  toggleBurnFace, fireQuads, fireOutline, planeToManualQuad, type ToolState,
} from "./fireTool";

beforeAll(async () => {
  const { readFile } = await toolTest.importActual<{ readFile(path: URL): Promise<Uint8Array<ArrayBuffer>> }>("node:fs/promises");
  await initReversal(await readFile(new URL("./reversal.wasm", import.meta.url)));
});

const W = 1920, H = 1080;
const cam: CameraPose = { x: 3.37, y: 65.62, z: -2.81, yaw: -152, pitch: 24, roll: 0.2, fov: 110 };
const guess: Orientation = { yaw: 28, pitch: 24, roll: 0.2, fov: 110, fovKnown: true, ambiguous: false, margin: 0.3, support: 0.8 };
const px = (p: [number, number, number]) => project(cam, [p], W, H)[0]!;

describe("clicks", () => {
  it("the first click is the origin, later ones wait for coordinates", () => {
    let s = addClick(emptyTool(0), [100, 200]);
    s = addClick(s, [300, 400]);
    expect(s.clicks[0].world).toEqual([0, 0, 0]);
    expect(s.clicks[1].world).toBeNull();
    expect(usableClicks(s)).toHaveLength(1);
    s = setClickWorld(s, s.clicks[1].id, [1, 0, 0]);
    expect(usableClicks(s)).toHaveLength(2);
    s = removeClick(s, s.clicks[0].id);
    expect(s.clicks).toHaveLength(1);
    expect(s.clicks[0].world).toEqual([1, 0, 0]);
  });
});

describe("solve", () => {
  const withClicks = (pts: [number, number, number][]): ToolState => {
    let s: ToolState = { ...emptyTool(0), guess };
    for (const p of pts) s = addClick(s, px(p));
    s.clicks.forEach((c, i) => { s = setClickWorld(s, c.id, pts[i]); });
    return s;
  };
  // this camera is rolled 0.2 degrees: the solve recovers it exactly once roll is free (it is held at 0 by default)
  it("the guess plus two corners gives the camera", () => {
    const s = solveTool({ ...withClicks([[6, 64, -7], [9, 64, -5]]), rollFree: true }, W, H);
    expect(s.camera).not.toBeNull();
    expect(Math.hypot(s.camera!.x - cam.x, s.camera!.y - cam.y, s.camera!.z - cam.z)).toBeLessThan(1e-2);
    expect(s.candidates.length).toBeGreaterThan(0);
  });
  it("without a guess it needs four corners", () => {
    const pts: [number, number, number][] = [[6, 64, -7], [9, 64, -5], [5, 66, -9], [4, 63, -6], [7, 65, -8], [8, 63, -7]];
    const three = solveTool({ ...withClicks(pts.slice(0, 3)), guess: null, rollFree: true }, W, H);
    expect(three.camera).toBeNull();
    const six = solveTool({ ...withClicks(pts), guess: null, rollFree: true }, W, H);
    expect(Math.hypot(six.camera!.x - cam.x, six.camera!.y - cam.y, six.camera!.z - cam.z)).toBeLessThan(1e-2);
  });
  it("nothing to solve leaves the camera as it was", () => {
    const s = { ...emptyTool(0), camera: cam };
    expect(solveTool(s, W, H).camera).toEqual(cam);
  });
});

describe("one fire, three modes", () => {
  const cell: [number, number, number] = [6, 64, -7];
  it("a new fire is a fire block at the cell; burning starts with the face away from the camera", () => {
    const f = newFire(cam, cell);
    expect(f.mode).toBe("block");
    expect(f.cell).toEqual(cell);
    const burning = setMode(f, "burning", { ...cam, x: 6.5, z: 0 });
    // the camera is south of the cell (bigger z): the burning block is north of the fire cell
    expect(burning.faces).toEqual({ north: true, east: false, south: false, west: false, up: false });
  });
  it("switching modes keeps the fire where it is", () => {
    const f = newFire(cam, cell);
    const e = setMode(f, "entity", cam);
    expect(e.feet).toEqual([6.5, 64, -6.5]);
    expect(setMode({ ...e, feet: [8.7, 63.2, -2.1] }, "block", cam).cell).toEqual([8, 63, -3]);
  });
  it("a click places it: block modes on the clicked cell, entity fire at the clicked point", () => {
    const f = newFire(cam, cell);
    expect(placeFire(f, [9.3, 64, -4.6]).cell).toEqual([9, 64, -5]);
    const e = placeFire(setMode(f, "entity", cam), [9.3, 64, -4.6]);
    expect(e.feet).toEqual([9.3, 64, -4.6]);
  });
  it("burning faces toggle; none left is allowed (draws nothing)", () => {
    const none = { north: false, east: false, south: false, west: false, up: false };
    expect(toggleBurnFace({ ...none, north: true }, "up")).toEqual({ ...none, north: true, up: true });
    expect(toggleBurnFace({ ...none, north: true }, "north")).toEqual(none);
  });
  it("quads: the fire block shape, its soul version (floor only), burning faces, entity fire", () => {
    const f = newFire(cam, cell);
    const block = fireQuads(f, false, cam, W, H).length, soul = fireQuads(f, true, cam, W, H).length;
    expect(block).toBeGreaterThan(soul);
    expect(soul).toBeGreaterThan(0);
    const north = fireQuads({ ...setMode(f, "burning", cam), faces: { north: true, east: false, south: false, west: false, up: false } }, false, cam, W, H);
    expect(north.length).toBeGreaterThan(0);
    expect(north.every(q => q.world.every(c => Math.abs(c[2] - cell[2]) < 0.01))).toBe(true);
    const blaze = { ...setMode(f, "entity", cam), entity: "minecraft:blaze", width: 0.6, height: 1.8 };
    expect(fireQuads(blaze, false, cam, W, H)).toHaveLength(5);
  });
  it("the wireframe is the fire cell, or the entity's hitbox", () => {
    const f = newFire(cam, cell);
    const edges = fireOutline(f);
    expect(edges).toHaveLength(12);
    const xs = edges.flat().map(p => p[0]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([6, 7]);
    const e = { ...setMode(f, "entity", cam), width: 0.6, height: 1.8 };
    const ys = fireOutline(e).flat().map(p => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1.8, 9);
  });
  it("the ground grid is projected line segments around a point", () => {
    const lines = groundGrid(cam, W, H, cell, 3);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toHaveLength(2);
  });
});

describe("plane to Label's manual quad", () => {
  // each corner's world point is its pixel lifted to z = 7, so the corners can be told apart
  const q = (px: [number, number][], uv: [number, number][]) => ({ world: px.map(([x, y]) => [x, y, 7]), px, uv, sheet: 0 }) as unknown as import("./reversal").FireQuad;
  it("orders corners by UV (top-left, top-right, bottom-right, bottom-left) in image fractions", async () => {
    const { planeToManualQuad } = await import("./fireTool");
    // drawn order bottom-left, bottom-right, top-right, top-left (as the entity fire is), uv v=1 at the bottom
    const m = planeToManualQuad(q([[100, 500], [300, 500], [300, 100], [100, 100]], [[0, 1], [1, 1], [1, 0], [0, 0]]), 1000, 1000);
    expect(m).toMatchObject({ quad: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.5], [0.1, 0.5]], mirrored: false });
    // the plane's world corners come in the same sprite order (for each texel's depth)
    const drawn = q([[100, 500], [300, 500], [300, 100], [100, 100]], [[0, 1], [1, 1], [1, 0], [0, 0]]).world;
    expect(m!.world).toEqual([drawn[3], drawn[2], drawn[1], drawn[0]]);
    expect(m!.world[0]).toEqual([100, 100, 7]);
  });
  it("a mirrored UV lands mirrored", async () => {
    const { planeToManualQuad } = await import("./fireTool");
    const m = planeToManualQuad(q([[100, 500], [300, 500], [300, 100], [100, 100]], [[1, 1], [0, 1], [0, 0], [1, 0]]), 1000, 1000);
    // u = 0 is on the right now: the quad is laid out left to right and the sprite flagged mirrored, as the game draws it
    expect(m).toMatchObject({ quad: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.5], [0.1, 0.5]], mirrored: true });
  });
  it("a plane seen from behind still gives a valid quad; one behind the camera gives none", async () => {
    const { planeToManualQuad } = await import("./fireTool");
    const back = planeToManualQuad(q([[300, 500], [100, 500], [100, 100], [300, 100]], [[0, 1], [1, 1], [1, 0], [0, 0]]), 1000, 1000);
    const { validQuad } = await import("./quadMask");
    expect(validQuad(back!.quad)).toBe(true);
    expect(back!.mirrored).toBe(true);
    expect(planeToManualQuad({ world: [], px: null, uv: [[0, 1], [1, 1], [1, 0], [0, 0]], sheet: 0 } as never, 1000, 1000)).toBeNull();
  });
  it("block planes from the binding become valid quads", async () => {
    const { planeToManualQuad } = await import("./fireTool");
    const { validQuad } = await import("./quadMask");
    const planes = fireQuads(newFire(cam, [6, 64, -7]), false, cam, W, H).filter(p => p.px);
    expect(planes.length).toBeGreaterThan(0);
    for (const p of planes) {
      const m = planeToManualQuad(p, W, H);
      if (m) expect(validQuad(m.quad)).toBe(true);
    }
    expect(planes.some(p => planeToManualQuad(p, W, H))).toBe(true);
  });
});

describe("click or drag", () => {
  it("a press released within a few screen pixels is a click; a drag pans", async () => {
    const { isClick } = await import("./fireTool");
    expect(isClick([100, 100], [102, 101])).toBe(true);
    expect(isClick([100, 100], [100, 100])).toBe(true);
    expect(isClick([100, 100], [110, 100])).toBe(false);
    expect(isClick([100, 100], [100, 96])).toBe(false);
  });
});

// ---- the automatic guess runs off the UI thread (a 2560x1440 frame took 1.4 s of WASM on pause)

import { orientation } from "./reversal";
import { guessPicture } from "./fireTool";

/** A small picture with strong straight edges in two directions, so the guess has something to work on. */
function boxes(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = ((Math.floor((x + y * 0.3) / 24) + Math.floor((y - x * 0.2) / 20)) % 2) ? 220 : 40;
    px.set([v, v, v, 255], (y * w + x) * 4);
  }
  return px;
}

describe("guessPicture", () => {
  it("decodes the picture and returns its native size with exactly the guess orientation() gives its pixels", async () => {
    const data = boxes(320, 180);
    const io = { decode: toolTest.fn(async () => ({ data, width: 320, height: 180 })) };
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const made = await guessPicture(bytes, io);
    expect(io.decode).toHaveBeenCalledWith(bytes);
    expect(made.width).toBe(320);
    expect(made.height).toBe(180);
    expect(made.guess).toEqual(orientation(data, 320, 180));
  });
  it("a picture that cannot be decoded rejects (the tool shows the error)", async () => {
    const io = { decode: toolTest.fn(async () => { throw new Error("not a picture"); }) };
    await expect(guessPicture(new ArrayBuffer(0), io)).rejects.toThrow("not a picture");
  });
  it("a flat picture has no guess, but still its size", async () => {
    const data = new Uint8ClampedArray(64 * 48 * 4).fill(128);
    const made = await guessPicture(new ArrayBuffer(1), { decode: async () => ({ data, width: 64, height: 48 }) });
    expect(made).toEqual({ width: 64, height: 48, guess: orientation(data, 64, 48) });
  });
});

describe("the 3D quad hook", () => {
  it("runs the guess as a picture-worker task, never orientation() on the UI thread", async () => {
    const { readFile } = await toolTest.importActual<{ readFile(path: URL, enc: string): Promise<string> }>("node:fs/promises");
    const hook = await readFile(new URL("./useFire3D.ts", import.meta.url), "utf8");
    const tasks = await readFile(new URL("./pictureTasks.ts", import.meta.url), "utf8");
    expect(hook).toMatch(/pictureTask\(\s*["']orientation["']/);
    expect(hook).not.toMatch(/\borientation\(/);
    expect(hook).not.toMatch(/canvasFrameIo\.decode/);
    expect(tasks).toMatch(/case\s*'orientation'.*guessPicture/);
  });
});

// ---- stepping frames quickly runs only the newest picture's guess (a held arrow key queued 15 s of stale guesses)

import { latestOnly } from "./fireTool";

describe("latestOnly", () => {
  it("runs one at a time; requests passed over while waiting are skipped (null) and the newest runs", async () => {
    const queue = latestOnly();
    const started: number[] = [];
    let finishFirst!: () => void;
    const first = queue(() => { started.push(1); return new Promise<number>(r => { finishFirst = () => r(1); }); });
    const second = queue(async () => { started.push(2); return 2; });
    const third = queue(async () => { started.push(3); return 3; });
    await Promise.resolve();
    expect(started).toEqual([1]);
    finishFirst();
    expect(await first).toBe(1);
    expect(await second).toBeNull();
    expect(await third).toBe(3);
    expect(started).toEqual([1, 3]);
  });
  it("an idle queue runs a request at once, and a failure reaches its caller without blocking the next", async () => {
    const queue = latestOnly();
    expect(await queue(async () => "a")).toBe("a");
    await expect(queue(async () => { throw new Error("worker failed"); })).rejects.toThrow("worker failed");
    expect(await queue(async () => "b")).toBe("b");
  });
});

it("the hook's guesses go through one latestOnly queue", async () => {
  const { readFile } = await toolTest.importActual<{ readFile(path: URL, enc: string): Promise<string> }>("node:fs/promises");
  const hook = await readFile(new URL("./useFire3D.ts", import.meta.url), "utf8");
  expect(hook).toMatch(/latestOnly\(\)/);
  expect(hook).toMatch(/if \(made === null\) return/);
});

// ---- the overview's mouse, the axes legend, and what a new picture shows

import { axisLines, orbitDrag, panTarget, pictureState, type Vec3 } from "./fireTool";
import { pixelRay } from "./reversal";

describe("axes legend (which way is + on each axis)", () => {
  const south: CameraPose = { x: 0.5, y: 65.62, z: -4, yaw: 0, pitch: 20, roll: 0, fov: 70 };
  it("Minecraft's axes: facing south, +X (east) points left, +Y up, +Z (south) away from the camera", () => {
    const lines = axisLines(south, [0.5, 64, 0.5], W, H);
    const by = Object.fromEntries(lines.map(l => [l.axis, l]));
    expect(lines.map(l => l.label)).toEqual(["+X east", "+Y up", "+Z south"]);
    expect(by.x.to[0]).toBeLessThan(by.x.from[0]);
    expect(by.y.to[1]).toBeLessThan(by.y.from[1]);
    expect(by.z.to[1]).toBeLessThan(by.z.from[1]); // further away is higher on the screen when looking down
    expect(Math.abs(by.z.to[0] - by.z.from[0])).toBeLessThan(1);
  });
  it("an origin behind the camera draws nothing", () => {
    expect(axisLines(south, [0.5, 64, -10], W, H)).toEqual([]);
  });
});

describe("the 3D overview's mouse", () => {
  it("right-drag turns with the mouse: dragging right turns right (yaw up); pitch stays in range", () => {
    expect(orbitDrag({ yaw: -135, pitch: 30 }, 50, 0).yaw).toBeGreaterThan(-135);
    expect(orbitDrag({ yaw: -135, pitch: 30 }, -50, 0).yaw).toBeLessThan(-135);
    expect(orbitDrag({ yaw: 0, pitch: 30 }, 0, 10000).pitch).toBe(89);
    expect(orbitDrag({ yaw: 0, pitch: 30 }, 0, -10000).pitch).toBe(-85);
  });
  it("left-drag pans: the point under the cursor at the target's depth stays under the cursor", () => {
    const view: CameraPose = { x: 6, y: 72, z: -9, yaw: 30, pitch: 35, roll: 0, fov: 60 };
    const target: Vec3 = [2, 64, -2], from: [number, number] = [300, 350], to: [number, number] = [520, 230];
    const eye: Vec3 = [view.x, view.y, view.z], dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const fwd = pixelRay(view, 800, 560, 400, 280), ray = pixelRay(view, 800, 560, ...from);
    const depth = dot(target.map((v, i) => v - eye[i]), fwd);
    const grabbed = eye.map((v, i) => v + ray[i] * depth / dot(ray, fwd)) as Vec3;
    const moved = panTarget(view, target, from, to, 800, 560), shift = moved.map((v, i) => v - target[i]);
    // the view moves with its target, so the grabbed point must now project under `to`
    const px = project({ ...view, x: eye[0] + shift[0], y: eye[1] + shift[1], z: eye[2] + shift[2] }, [grabbed], 800, 560)[0]!;
    expect(px[0]).toBeCloseTo(to[0], 6);
    expect(px[1]).toBeCloseTo(to[1], 6);
  });
  it("no movement, no pan", () => {
    const view: CameraPose = { x: 6, y: 72, z: -9, yaw: 30, pitch: 35, roll: 0, fov: 60 };
    expect(panTarget(view, [2, 64, -2], [10, 10], [10, 10], 800, 560)).toEqual([2, 64, -2]);
  });
});

describe("a new picture", () => {
  // made in each test: the Rust runtime is ready only once the tests run
  let solved: ToolState;
  beforeEach(() => { solved = { ...emptyTool(0), camera: cam, fire: newFire(cam, [1, 64, 2]), clicks: [{ id: 1, px: [5, 6], world: [0, 64, 0] }], eyeY: 65.62 }; });
  it("a frame with its own saved work shows exactly that, with the new guess", () => {
    const saved = { clicks: [{ id: 9, px: [1, 2] as [number, number], world: [3, 64, 4] as Vec3 }], fire: null, eyeY: null, camera: { ...cam, yaw: 10 }, rollFree: false };
    const next = pictureState(solved, false, guess, saved);
    expect(next.camera).toEqual(saved.camera);
    expect(next.fire).toBeNull();
    expect(next.eyeY).toBeNull();
    expect(next.clicks.map(c => [c.px, c.world])).toEqual([[[1, 2], [3, 64, 4]]]);
    expect(next.guess).toEqual(guess);
  });
  it("an unsaved frame keeps the last fire and camera to line up from, without the last frame's corners", () => {
    const next = pictureState(solved, false, guess, undefined);
    expect(next.fire).toEqual(solved.fire);
    expect(next.camera).toEqual(solved.camera);
    expect(next.eyeY).toBe(65.62);
    expect(next.clicks).toEqual([]);
  });
  it("the same picture again only updates the guess", () => {
    expect(pictureState(solved, true, guess, undefined)).toEqual({ ...solved, guess });
  });
});

// ---- an impossible camera must never take the app down (frame 448432 froze it: a solve put the eye 56 million
// blocks away, the overview sized its grid by that distance and ran out of memory, and the memory kept it)

import { plausibleCamera, solveTool as solveForTest } from "./fireTool";

const absurd: CameraPose = { x: 2488704.35, y: 1.62, z: 56765829.14, yaw: 118.82, pitch: 14.66, roll: -35.73, fov: 134.98 };
const userCorners = [
  { id: 1, px: [1633.62, 918.15] as [number, number], world: [0, 0, 0] as Vec3 },
  { id: 2, px: [1838.64, 985.97] as [number, number], world: [-1, 0, 1] as Vec3 },
  { id: 3, px: [1861.42, 933.74] as [number, number], world: null },
];

describe("impossible cameras", () => {
  it("the grid stays small whatever radius it is asked for, and an ordinary one is unchanged", () => {
    const t = performance.now();
    const huge = groundGrid(cam, W, H, [0, 64, 0], 28_000_000);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(huge.length).toBeLessThanOrEqual(groundGrid(cam, W, H, [0, 64, 0], 64).length);
    expect(groundGrid(cam, W, H, [0, 64, 0], Number.NaN)).toEqual(groundGrid(cam, W, H, [0, 64, 0], 0));
    expect(groundGrid(cam, W, H, [0, 64, 0], 8).length).toBeGreaterThan(0);
  });
  it("a camera far from its corners, rolled over, with an impossible FOV or not finite is not plausible", () => {
    const near: Vec3[] = [[0, 0, 0], [-1, 0, 1]];
    expect(plausibleCamera({ x: 2, y: 1.62, z: -3, yaw: 120, pitch: 15, roll: 0.5, fov: 90 }, near)).toBe(true);
    expect(plausibleCamera(absurd, near)).toBe(false);
    expect(plausibleCamera({ x: 2, y: 1.62, z: -3, yaw: 120, pitch: 15, roll: -35, fov: 90 }, near)).toBe(false);
    expect(plausibleCamera({ x: 2, y: 1.62, z: -3, yaw: 120, pitch: 15, roll: 0, fov: 175 }, near)).toBe(false);
    expect(plausibleCamera({ x: 600, y: 1.62, z: 0, yaw: 120, pitch: 15, roll: 0, fov: 90 }, near)).toBe(false);
    expect(plausibleCamera({ x: Number.NaN, y: 1.62, z: 0, yaw: 120, pitch: 15, roll: 0, fov: 90 }, near)).toBe(false);
  });
  it("the solve never answers with an impossible camera (the frame's own corners and On ground)", () => {
    for (const g of [guess, { ...guess, yaw: absurd.yaw, pitch: absurd.pitch, fov: absurd.fov, fovKnown: false }]) {
      const s: ToolState = { ...emptyTool(0), clicks: userCorners, eyeY: 1.62, guess: g };
      const out = solveForTest(s, 2560, 1440);
      for (const c of out.candidates) expect(plausibleCamera(c.camera, [[0, 0, 0], [-1, 0, 1]])).toBe(true);
      if (out.camera) expect(plausibleCamera(out.camera, [[0, 0, 0], [-1, 0, 1]])).toBe(true);
    }
  });
  it("a frame saved with an impossible camera comes back without it, corners and fire kept", () => {
    const fireNear = newFire(cam, [0, 0, 0]);
    const next = pictureState(emptyTool(0), false, guess, { clicks: userCorners, fire: fireNear, eyeY: 1.62, camera: absurd, rollFree: false });
    expect(next.camera).toBeNull();
    expect(next.clicks.map(c => c.world)).toEqual(userCorners.map(c => c.world));
    expect(next.fire).toEqual(fireNear);
  });
});

// ---- roll held at 0 by default, the floor the player stands on, and an honest word for a camera from few corners

import { cameraQuality, solveKey } from "./fireTool";

describe("roll, floor and how sure the camera is", () => {
  const level: CameraPose = { x: 3, y: 68.62, z: 1, yaw: -150, pitch: 30, roll: 0, fov: 90 };
  const tilted: CameraPose = { ...level, roll: 6 };
  const worlds: Vec3[] = [[5, 64, -2], [6, 64, -3], [4, 65, -3], [7, 64, -1]];
  const at = (c: CameraPose, ws: Vec3[]) => ws.map((world, i) => ({ id: i + 1, px: project(c, [world], W, H)[0]!, world }));
  const g = (c: CameraPose) => ({ yaw: ((c.yaw % 90) + 90) % 90, pitch: c.pitch, roll: c.roll, fov: c.fov, fovKnown: true, ambiguous: false, margin: 0.3, support: 0.8 });
  it("a new tool holds roll at 0, and its solve answers only level cameras", () => {
    expect(emptyTool(0).rollFree).toBe(false);
    const out = solveTool({ ...emptyTool(0), clicks: at(tilted, worlds), guess: g(tilted) }, W, H);
    expect(out.candidates.length).toBeGreaterThan(0);
    for (const c of out.candidates) expect(Math.abs(c.camera.roll)).toBeLessThan(1e-9);
  });
  it("Free roll lets the solve find a tilted (hurt) camera", () => {
    const out = solveTool({ ...emptyTool(0), rollFree: true, clicks: at(tilted, worlds), guess: g(tilted) }, W, H);
    expect(out.camera!.roll).toBeCloseTo(6, 2);
  });
  it("with no automatic guess, four corners still give a level camera while roll is held", () => {
    const out = solveTool({ ...emptyTool(0), clicks: at(level, worlds) }, W, H);
    expect(out.camera).not.toBeNull();
    expect(Math.abs(out.camera!.roll)).toBeLessThan(1e-9);
    expect(Math.hypot(out.camera!.x - level.x, out.camera!.y - level.y, out.camera!.z - level.z)).toBeLessThan(0.05);
  });
  it("a camera from fewer than 4 corners is rough, and says how many more are needed", () => {
    const with_ = (n: number) => cameraQuality({ ...emptyTool(0), clicks: [...at(level, worlds.slice(0, n)), { id: 99, px: [1, 1], world: null }] });
    expect(with_(1)).toEqual({ rough: true, need: 3 });
    expect(with_(2)).toEqual({ rough: true, need: 2 });
    expect(with_(3)).toEqual({ rough: true, need: 1 });
    expect(with_(4)).toEqual({ rough: false, need: 0 });
  });
  it("changing the eye height, the roll switch, the corners or the guess solves again; moving the fire does not", () => {
    const s: ToolState = { ...emptyTool(0), clicks: at(level, worlds.slice(0, 2)), eyeY: 65.62, guess: g(level) };
    expect(solveKey({ ...s, eyeY: 66.62 })).not.toBe(solveKey(s));
    expect(solveKey({ ...s, rollFree: true })).not.toBe(solveKey(s));
    expect(solveKey({ ...s, clicks: at(level, worlds.slice(0, 3)) })).not.toBe(solveKey(s));
    expect(solveKey({ ...s, guess: null })).not.toBe(solveKey(s));
    expect(solveKey({ ...s, fire: newFire(level, [5, 64, -2]) })).toBe(solveKey(s));
  });
});

// ---- layering: the game draws fire as cut-out pixels with a depth buffer, so at every point the nearest opaque
// texel shows. The planes of a fire block cross each other, so drawing them plane by plane in list order is wrong;
// every texel of every plane is drawn far to near by its own 3D distance.

import { fireTexels } from "./fireTool";
import { manualTexels } from "./quadMask";

describe("fire texels in depth order", () => {
  const side = 16, rows = 1;
  // an opaque sprite with a distinct colour per texel
  const sheet = new Uint8ClampedArray(side * side * rows * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251));
  const view: CameraPose = { x: 2.5, y: 1.8, z: -2.5, yaw: -30, pitch: 25, roll: 0, fov: 80 };
  const eye: Vec3 = [view.x, view.y, view.z];
  const quads = () => fireQuads(newFire(view, [0, 0, 0]), false, view, 1280, 720);
  it("every texel of every visible plane is drawn, ordered far to near by its real distance", () => {
    const out = fireTexels(quads(), sheet, 0, false, 1280, 720, eye, side, rows);
    const visible = quads().filter(q => planeToManualQuad(q, 1280, 720));
    expect(out.length).toBe(visible.length * side * side);
    for (let i = 1; i < out.length; i++) expect(out[i].depth).toBeLessThanOrEqual(out[i - 1].depth);
  });
  it("a texel's depth is the distance from the eye to that texel's centre on its plane", () => {
    const q = quads()[0], m = planeToManualQuad(q, 1280, 720)!;
    const out = fireTexels([q], sheet, 0, false, 1280, 720, eye, side, rows);
    // the texel nearest the plane's first corner in sprite order (top-left) sits a half texel in from it
    const tl = m.world[0], tr = m.world[1], bl = m.world[3];
    const centre = [0, 1, 2].map(k => tl[k] + (tr[k] - tl[k]) / 32 + (bl[k] - tl[k]) / 32);
    const want = Math.hypot(centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]);
    expect(out.some(t => Math.abs(t.depth - want) < 1e-9)).toBe(true);
  });
  it("one plane alone draws exactly the quad mask's texels, only reordered", () => {
    const q = quads()[0], m = planeToManualQuad(q, 1280, 720)!;
    const mask = manualTexels(sheet, 0, m.mirrored, m.quad, side, rows);
    const out = fireTexels([q], sheet, 0, false, 1280, 720, eye, side, rows);
    const key = (t: { points: [number, number][]; colour: string }) => t.colour + JSON.stringify(t.points);
    expect(out.map(key).sort()).toEqual(mask.map(key).sort());
  });
  it("transparent texels and planes behind the camera draw nothing", () => {
    const clear = new Uint8ClampedArray(side * side * rows * 4);
    expect(fireTexels(quads(), clear, 0, false, 1280, 720, eye, side, rows)).toEqual([]);
    const behind: CameraPose = { ...view, yaw: view.yaw + 180, pitch: -view.pitch };
    expect(fireTexels(fireQuads(newFire(view, [0, 0, 0]), false, behind, 1280, 720), sheet, 0, false, 1280, 720, [behind.x, behind.y, behind.z], side, rows)).toEqual([]);
  });
});
