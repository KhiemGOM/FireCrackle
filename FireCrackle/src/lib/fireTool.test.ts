// The 3D fire tool's rules (lib/fireTool.ts): clicks (the first is the origin), face choice (floor and faces exclude
// each other), the solve (guess + clicks, clicks alone as fallback), placements and their quads, the ground grid.
// All geometry goes through the reversal WASM binding.
import { vi as toolTest } from "vitest";
import { beforeAll, describe, expect, it } from "vitest";
import { initReversal, project, type CameraPose, type Orientation } from "./reversal";
import {
  addClick, setClickWorld, removeClick, usableClicks, toggleFace, solveTool, newFireBlock, newBurningFace, newEntityFire,
  placementQuads, groundGrid, emptyTool, type ToolState,
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

describe("faces", () => {
  const none = { floor: false, north: false, east: false, south: false, west: false, up: false };
  it("floor and faces exclude each other; faces combine", () => {
    expect(toggleFace({ ...none, north: true, up: true }, "floor")).toEqual({ ...none, floor: true });
    expect(toggleFace({ ...none, floor: true }, "east")).toEqual({ ...none, east: true });
    expect(toggleFace({ ...none, east: true }, "up")).toEqual({ ...none, east: true, up: true });
    expect(toggleFace({ ...none, east: true }, "east")).toEqual(none);
  });
});

describe("solve", () => {
  const withClicks = (pts: [number, number, number][]): ToolState => {
    let s: ToolState = { ...emptyTool(0), guess };
    for (const p of pts) s = addClick(s, px(p));
    s.clicks.forEach((c, i) => { s = setClickWorld(s, c.id, pts[i]); });
    return s;
  };
  it("the guess plus two corners gives the camera", () => {
    const s = solveTool(withClicks([[6, 64, -7], [9, 64, -5]]), W, H);
    expect(s.camera).not.toBeNull();
    expect(Math.hypot(s.camera!.x - cam.x, s.camera!.y - cam.y, s.camera!.z - cam.z)).toBeLessThan(1e-2);
    expect(s.candidates.length).toBeGreaterThan(0);
  });
  it("without a guess it needs four corners", () => {
    const pts: [number, number, number][] = [[6, 64, -7], [9, 64, -5], [5, 66, -9], [4, 63, -6], [7, 65, -8], [8, 63, -7]];
    const three = solveTool({ ...withClicks(pts.slice(0, 3)), guess: null }, W, H);
    expect(three.camera).toBeNull();
    const six = solveTool({ ...withClicks(pts), guess: null }, W, H);
    expect(Math.hypot(six.camera!.x - cam.x, six.camera!.y - cam.y, six.camera!.z - cam.z)).toBeLessThan(1e-2);
  });
  it("nothing to solve leaves the camera as it was", () => {
    const s = { ...emptyTool(0), camera: cam };
    expect(solveTool(s, W, H).camera).toEqual(cam);
  });
});

describe("placements", () => {
  it("a fire block is the floor shape; a burning face defaults to the side away from the camera", () => {
    expect(newFireBlock([6, 64, -7]).faces.floor).toBe(true);
    const f = newBurningFace({ ...cam, x: 10.5, z: 20 }, [10, 64, 10]);
    expect(f.faces).toMatchObject({ floor: false, north: true });
  });
  it("quads come from the binding, entity sizes from the game", () => {
    expect(placementQuads(newFireBlock([6, 64, -7]), cam, W, H).length).toBeGreaterThan(0);
    const blaze = newEntityFire([6.5, 64, -7.5], "minecraft:blaze");
    expect([blaze.width, blaze.height]).toEqual([0.6, 1.8]);
    expect(placementQuads(blaze, cam, W, H)).toHaveLength(5);
    const custom = newEntityFire([6.5, 64, -7.5], "custom");
    expect(custom.width).toBeGreaterThan(0);
  });
  it("the ground grid is projected line segments around a point", () => {
    const lines = groundGrid(cam, W, H, [6, 64, -7], 3);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toHaveLength(2);
  });
});

describe("plane to Label's manual quad", () => {
  const q = (px: [number, number][], uv: [number, number][]) => ({ world: [], px, uv, sheet: 0 }) as unknown as import("./reversal").FireQuad;
  it("orders corners by UV (top-left, top-right, bottom-right, bottom-left) in image fractions", async () => {
    const { planeToManualQuad } = await import("./fireTool");
    // drawn order bottom-left, bottom-right, top-right, top-left (as the entity fire is), uv v=1 at the bottom
    const m = planeToManualQuad(q([[100, 500], [300, 500], [300, 100], [100, 100]], [[0, 1], [1, 1], [1, 0], [0, 0]]), 1000, 1000);
    expect(m).toEqual({ quad: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.5], [0.1, 0.5]], mirrored: false });
  });
  it("a mirrored UV lands mirrored", async () => {
    const { planeToManualQuad } = await import("./fireTool");
    const m = planeToManualQuad(q([[100, 500], [300, 500], [300, 100], [100, 100]], [[1, 1], [0, 1], [0, 0], [1, 0]]), 1000, 1000);
    // u = 0 is on the right now: the quad is laid out left to right and the sprite flagged mirrored, as the game draws it
    expect(m).toEqual({ quad: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.5], [0.1, 0.5]], mirrored: true });
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
    const planes = placementQuads(newFireBlock([6, 64, -7]), cam, W, H).filter(p => p.px);
    expect(planes.length).toBeGreaterThan(0);
    for (const p of planes) {
      const m = planeToManualQuad(p, W, H);
      if (m) expect(validQuad(m.quad)).toBe(true);
    }
    expect(planes.some(p => planeToManualQuad(p, W, H))).toBe(true);
  });
});
