// The 3D quad tool's work on each frame (corners, fire, camera), per video, like the quad mask's frameQuads.
import { describe, expect, it } from "vitest";
import { readFire3D, remember3D, writeFire3D, type SavedTool } from "./fire3dMemory";
import { emptyTool, type ToolState } from "./fireTool";

const cam = { x: 3.37, y: 65.62, z: -2.81, yaw: -152, pitch: 24, roll: 0.2, fov: 110 };
const fire = { mode: "block" as const, cell: [1, 64, 2] as [number, number, number], faces: { north: false, east: false, south: true, west: false, up: false }, feet: [1.5, 64, 2.5] as [number, number, number], entity: "minecraft:blaze", width: 0.6, height: 1.8 };
const work: ToolState = { ...emptyTool(0), camera: cam, fire, eyeY: 65.62, clicks: [{ id: 4, px: [100.5, 200.25], world: [0, 64, 0] }, { id: 5, px: [300, 220], world: null }] };
function memoryStorage() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; }

describe("fire3d memory", () => {
  it("a frame's corners, fire, eye height and camera come back from storage as they were", () => {
    const store = memoryStorage();
    const saved = remember3D(new Map(), "120", work);
    expect(writeFire3D("v.mkv", saved, store)).toBe(true);
    const back = readFire3D("v.mkv", store).get("120")!;
    expect(back.camera).toEqual(cam);
    expect(back.fire).toEqual(fire);
    expect(back.eyeY).toBe(65.62);
    expect(back.clicks.map(c => [c.px, c.world])).toEqual([[[100.5, 200.25], [0, 64, 0]], [[300, 220], null]]);
    expect(new Set(back.clicks.map(c => c.id)).size).toBe(2);
  });
  it("each video has its own memory; nothing saved is an empty memory", () => {
    const store = memoryStorage();
    writeFire3D("a.mkv", remember3D(new Map(), "1", work), store);
    expect(readFire3D("b.mkv", store).size).toBe(0);
    expect(readFire3D(undefined, store).size).toBe(0);
  });
  it("a frame with nothing on it is forgotten", () => {
    const one = remember3D(new Map(), "7", work);
    expect(remember3D(one, "7", emptyTool(0)).has("7")).toBe(false);
  });
  it("damaged entries are skipped, the rest still load", () => {
    const store = memoryStorage();
    writeFire3D("v.mkv", new Map<string, SavedTool>([["3", { clicks: [], fire, eyeY: null, camera: cam, rollFree: false }]]), store);
    const key = [...store.m.keys()][0];
    const raw = JSON.parse(store.m.get(key)!);
    raw["4"] = { clicks: "nope", camera: { x: "a" } };
    raw["5"] = { clicks: [{ px: [1], world: [0, 0, 0] }], fire: null, eyeY: null, camera: null };
    raw["6"] = { clicks: [], fire: { mode: "lava" }, eyeY: null, camera: cam };
    raw["six"] = raw["3"];
    store.m.set(key, JSON.stringify(raw));
    expect([...readFire3D("v.mkv", store).keys()]).toEqual(["3"]);
  });
  it("storage that fails leaves an empty memory and reports nothing saved", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } };
    expect(readFire3D("v.mkv", broken).size).toBe(0);
    expect(writeFire3D("v.mkv", remember3D(new Map(), "1", work), broken)).toBe(false);
  });
});

it("the roll switch is kept with the frame; frames saved before it had one hold roll", () => {
  const store = memoryStorage();
  writeFire3D("v.mkv", remember3D(new Map(), "9", { ...work, rollFree: true }), store);
  expect(readFire3D("v.mkv", store).get("9")?.rollFree).toBe(true);
  const key = [...store.m.keys()][0], raw = JSON.parse(store.m.get(key)!);
  delete raw["9"].rollFree;
  store.m.set(key, JSON.stringify(raw));
  expect(readFire3D("v.mkv", store).get("9")?.rollFree).toBe(false);
});
