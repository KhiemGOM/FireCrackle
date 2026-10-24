// The 3D quad tool as the user meets it: the cursor-mode buttons light up while a click adds corners or places the fire
// (and the picture says so), the grid and the block box can be switched off, the axes say which way + is, and the 3D
// overview pans with the left button and turns with the right (no context menu). React's hooks are stand-ins by call order.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], si: 0, ri: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = hooks.si++;
    if (!(i in hooks.states)) hooks.states[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(hooks.states[i]) : next; }];
  },
  useRef: (initial: unknown) => (hooks.refs[hooks.ri++] ??= { current: initial }),
  useEffect: () => {},
  useMemo: (f: () => unknown) => f(),
}));
vi.mock("./Fire3DBar.css", () => ({}));
vi.mock("./Fire3DOverlay.css", () => ({}));
vi.mock("./FireWorldView.css", () => ({}));
const screen = vi.hoisted(() => ({ scale: 1 }));
vi.mock("../hooks/useSvgScreenScale", () => ({ useSvgScreenScale: () => screen.scale }));
vi.mock("../lib/spriteSheet", async (original) => ({ ...(await original<object>()), loadSpriteSheet: () => () => {} }));
import { initReversal, type CameraPose } from "../lib/reversal";
import { emptyTool, newFire, type ToolState } from "../lib/fireTool";
import type { Fire3D } from "../lib/useFire3D";
import { Fire3DBar } from "./Fire3DBar";
import { Fire3DOverlay, cornerKey } from "./Fire3DOverlay";
import { FireWorldView } from "./FireWorldView";

beforeAll(async () => {
  const { readFile } = await vi.importActual<{ readFile(path: URL): Promise<Uint8Array<ArrayBuffer>> }>("node:fs/promises");
  await initReversal(await readFile(new URL("../lib/reversal.wasm", import.meta.url)));
});
beforeEach(() => { hooks.states = []; hooks.refs = []; screen.scale = 1; });

type El = ReactElement<Record<string, any>>;
function all(node: unknown, test: (e: El) => boolean, out: El[] = []): El[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach(n => all(n, test, out)); return out; }
  if (!("props" in (node as El))) return out;
  const e = node as El;
  // render function components so their output is searched too
  if (typeof e.type === "function") return all((e.type as (p: unknown) => unknown)(e.props), test, out);
  if (test(e)) out.push(e);
  all(e.props.children, test, out);
  return out;
}
const text = (node: unknown): string => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const e = node as El;
  if (typeof e.type === "function") return text((e.type as (p: unknown) => unknown)(e.props));
  return text(e.props?.children);
};

const cam: CameraPose = { x: 0.5, y: 65.62, z: -4, yaw: 0, pitch: 25, roll: 0, fov: 70 };
function tool(over: Partial<Fire3D> = {}, state: Partial<ToolState> = {}): Fire3D {
  return {
    ready: true, error: "", busy: false, size: { width: 1280, height: 720 },
    state: { ...emptyTool(0), camera: cam, fire: newFire(cam, [0, 64, 1]), clicks: [{ id: 1, px: [600, 400], world: [0, 64, 0] }], ...state },
    update: vi.fn(), click: "corner", setClick: vi.fn(), selected: null, setSelected: vi.fn(), quads: [], soul: false,
    showGrid: true, showBox: true, setShowGrid: vi.fn(), setShowBox: vi.fn(), ...over,
  };
}
const sprite = { sheet: 0 as const, row: 0, mirrored: false, opacity: 1, pixelGrid: false };

describe("cursor modes", () => {
  it("the button of the active cursor mode is marked as a cursor mode and pressed; the other is not", () => {
    for (const mode of ["corner", "fire"] as const) {
      hooks.si = hooks.ri = 0;
      const picks = all(Fire3DBar({ fire: tool({ click: mode }), sprite: null }), e => String(e.props.className ?? "").includes("f3-pick"));
      expect(picks.map(b => [text(b.props.children), b.props["aria-pressed"]])).toEqual([["Add corners", mode === "corner"], ["Place by click", mode === "fire"]]);
    }
  });
  it("the pressed cursor-mode button has its own strong highlight", async () => {
    const { readFile } = await vi.importActual<{ readFile(path: URL, enc: string): Promise<string> }>("node:fs/promises");
    const css = await readFile(new URL("./Fire3DBar.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.f3-pick\[aria-pressed="true"\][^{]*\{[^}]*background/);
  });
  it("the picture says what a click does while a cursor mode is on, and nothing when it is off", () => {
    const tag = (click: Fire3D["click"]) => { hooks.si = hooks.ri = 0; return all(Fire3DOverlay({ fire: tool({ click }), width: 1280, height: 720, zoom: 1, sprite }), e => e.props.className === "fire3d-mode").map(e => text(e.props.children)); };
    expect(tag("corner")).toEqual(["Click: add a block corner"]);
    expect(tag("fire")).toEqual(["Click: place the fire"]);
    expect(tag("none")).toEqual([]);
  });
});

describe("what the picture shows", () => {
  const overlay = (over: Partial<Fire3D>) => { hooks.si = hooks.ri = 0; return Fire3DOverlay({ fire: tool(over), width: 1280, height: 720, zoom: 1, sprite }); };
  const count = (node: unknown, cls: string) => all(node, e => e.props.className === cls).length;
  it("the grid and the block box show by default and each can be switched off", () => {
    expect(count(overlay({}), "fire3d-grid")).toBeGreaterThan(0);
    expect(count(overlay({}), "fire3d-cell")).toBeGreaterThan(0);
    expect(count(overlay({ showGrid: false }), "fire3d-grid")).toBe(0);
    expect(count(overlay({ showBox: false }), "fire3d-cell")).toBe(0);
    expect(count(overlay({ showBox: false }), "fire3d-grid")).toBeGreaterThan(0);
  });
  it("the bar's Grid and Box switches set them", () => {
    hooks.si = hooks.ri = 0;
    const f = tool();
    const boxes = all(Fire3DBar({ fire: f, sprite: null }), e => e.type === "input" && e.props.type === "checkbox" && /^(Grid|Box)$/.test(e.props["aria-label"] ?? ""));
    expect(boxes.map(b => b.props["aria-label"])).toEqual(["Grid", "Box"]);
    boxes[0].props.onChange({ target: { checked: false } });
    boxes[1].props.onChange({ target: { checked: false } });
    expect(f.setShowGrid).toHaveBeenCalledWith(false);
    expect(f.setShowBox).toHaveBeenCalledWith(false);
  });
  it("the axes are labelled on the picture and in the overview", () => {
    expect(all(overlay({}), e => e.props.className === "fire3d-axis-label").map(e => text(e.props.children))).toEqual(["+X east", "+Y up", "+Z south"]);
    hooks.states = []; hooks.refs = []; hooks.si = hooks.ri = 0; // another component: its own hooks
    expect(all(FireWorldView({ fire: tool() }), e => e.props.className === "fq-axis-label").map(e => text(e.props.children))).toEqual(["+X east", "+Y up", "+Z south"]);
  });
  it("the x y z boxes say which way is +", () => {
    hooks.si = hooks.ri = 0;
    const titles = all(Fire3DBar({ fire: tool({ selected: 1 }), sprite: null }), e => e.type === "label" && String(e.props.className).includes("f3-num")).map(e => e.props.title);
    expect(titles.slice(0, 3)).toEqual(["x: + east, − west", "y: + up, − down", "z: + south, − north"]);
  });
});

describe("the 3D overview's mouse", () => {
  const rect = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 560 }), setPointerCapture: () => {} };
  const ev = (button: number, x: number, y: number) => ({ button, clientX: x, clientY: y, pointerId: 1, currentTarget: rect, target: rect, preventDefault: vi.fn() });
  const svg = () => { hooks.si = hooks.ri = 0; return all(FireWorldView({ fire: tool() }), e => e.type === "svg")[0]; };
  const orbit = () => hooks.states.find(s => s && typeof s === "object" && "yaw" in (s as object)) as { yaw: number; pitch: number };
  const pan = () => hooks.states.find(s => Array.isArray(s) && s.length === 3) as number[];
  it("no context menu on the overview", () => {
    const e = ev(2, 0, 0);
    svg().props.onContextMenu(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });
  it("right-drag turns it (dragging right turns right) and leaves the pan", () => {
    let s = svg(); const yaw = orbit().yaw, before = [...pan()];
    s.props.onPointerDown(ev(2, 100, 100)); s = svg(); s.props.onPointerMove(ev(2, 160, 100)); s.props.onPointerUp(ev(2, 160, 100));
    expect(orbit().yaw).toBeGreaterThan(yaw);
    expect(pan()).toEqual(before);
  });
  it("left-drag pans it and leaves the turn", () => {
    let s = svg(); const { yaw, pitch } = orbit(), before = [...pan()];
    s.props.onPointerDown(ev(0, 100, 100)); s = svg(); s.props.onPointerMove(ev(0, 180, 140)); s.props.onPointerUp(ev(0, 180, 140));
    expect(orbit()).toMatchObject({ yaw, pitch });
    expect(pan()).not.toEqual(before);
  });
});

describe("zoomed in", () => {
  // the viewer zooms with a CSS transform, which vector-effect: non-scaling-stroke does not see: strokes grew with the
  // zoom (white blobs for markers at 15x). Like the quad mask and the ruler, widths are screen pixels / screenScale.
  it("every stroke on the picture is sized in screen pixels, so it stays thin at any zoom", () => {
    screen.scale = 4;
    hooks.si = hooks.ri = 0;
    const out = Fire3DOverlay({ fire: tool(), width: 1280, height: 720, zoom: 4, sprite });
    const width = (cls: string) => all(out, e => e.props.className === cls).map(e => e.props.strokeWidth);
    expect(new Set(width("fire3d-grid"))).toEqual(new Set([1 / 4]));
    expect(new Set(width("fire3d-cell"))).toEqual(new Set([1.5 / 4]));
    expect(all(out, e => e.type === "circle").map(e => e.props.strokeWidth)).toEqual([1.5 / 4]);
    expect(all(out, e => e.type === "circle").map(e => e.props.r)).toEqual([6 / 4]);
    expect(new Set(all(out, e => String(e.props.className).startsWith("fire3d-axis ")).flatMap(g => all(g.props.children, c => c.type === "line")).map(l => l.props.strokeWidth))).toEqual(new Set([2.5 / 4]));
  });
  it("no stylesheet width or non-scaling rule overrides them (a CSS stroke-width beats the attribute)", async () => {
    const { readFile } = await vi.importActual<{ readFile(path: URL, enc: string): Promise<string> }>("node:fs/promises");
    const css = await readFile(new URL("./Fire3DOverlay.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/non-scaling-stroke/);
    expect(css).not.toMatch(/stroke-width/);
  });
});

describe("deleting a corner", () => {
  it("right-clicking a corner marker removes that corner, with no context menu", () => {
    hooks.si = hooks.ri = 0;
    const f = tool({ selected: 1 });
    const marker = all(Fire3DOverlay({ fire: f, width: 1280, height: 720, zoom: 1, sprite }), e => String(e.props.className ?? "").startsWith("fire3d-click"))[0];
    const e = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    marker.props.onContextMenu(e);
    expect(e.preventDefault).toHaveBeenCalled();
    const change = (f.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as (s: ToolState) => ToolState;
    expect(change(f.state).clicks).toEqual([]);
    expect(f.setSelected).toHaveBeenCalledWith(null);
  });
  it("Delete removes the selected corner; not while typing, not with a modifier, not with none selected", () => {
    const key = (over: object = {}) => ({ key: "Delete", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: { tagName: "DIV" }, preventDefault: vi.fn(), ...over });
    const f = tool({ selected: 1 });
    expect(cornerKey(key(), f)).toBe(true);
    const change = (f.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as (s: ToolState) => ToolState;
    expect(change(f.state).clicks).toEqual([]);
    expect(f.setSelected).toHaveBeenCalledWith(null);
    for (const over of [{ target: { tagName: "INPUT", type: "number" } }, { ctrlKey: true }, { key: "Backspace" }, { key: "x" }]) expect(cornerKey(key(over), tool({ selected: 1 }))).toBe(false);
    expect(cornerKey(key(), tool({ selected: null }))).toBe(false);
  });
});
