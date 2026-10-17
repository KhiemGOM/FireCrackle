import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as Array<{ current: unknown }>, stateCursor: 0, refCursor: 0, effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const i = hooks.stateCursor++;
    if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === "function" ? next(hooks.states[i]) : next; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refCursor++] ??= { current: initial },
  useEffect: (setup: () => void | (() => void)) => { hooks.effects.push(setup); },
  useImperativeHandle: () => {},
}));
vi.mock("../hooks/useWheel", () => ({ useWheel: () => {} }));
import { VideoPane } from "./VideoPane";
import { OpacityControl } from "./OpacityControl";
import { createMockBackend } from "../lib/mock";
import { DEFAULT_MASK_STATE, MASK_STATE_KEY, readMaskState } from "../lib/maskState";

type Element = ReactElement<Record<string, any>>;
function viewport(node: Element): Element | undefined {
  if (node.props.className === "video-frame zoomed") return node;
  for (const child of [node.props.children].flat(Infinity)) {
    if (child && typeof child === "object" && "props" in child) {
      const match = viewport(child);
      if (match) return match;
    }
  }
}
async function pane() {
  return viewport(await tree())!;
}
async function tree() {
  hooks.stateCursor = hooks.refCursor = 0;
  hooks.effects = [];
  const backend = createMockBackend();
  return VideoPane({ backend, view: await backend.view(), onError: vi.fn() });
}
function find(node: Element, label: string): Element | undefined {
  if (node.type === OpacityControl) return find(OpacityControl(node.props as unknown as Parameters<typeof OpacityControl>[0]), label);
  if (node.props.label === label || node.props["aria-label"] === label) return node;
  for (const child of [node.props.children].flat(Infinity)) {
    if (child && typeof child === "object" && "props" in child) {
      const match = find(child, label); if (match) return match;
    }
  }
}
function pointer(x: number, y: number, button = 0) {
  return { clientX: x, clientY: y, button, pointerId: 7, preventDefault: vi.fn(), currentTarget: { setPointerCapture: vi.fn() } };
}
beforeEach(() => { hooks.states = []; hooks.refs = []; });
afterEach(() => vi.unstubAllGlobals());

it("steps exactly one frame and disables navigation at the video boundaries", async () => {
  const backend = createMockBackend();
  const view = await backend.view();
  const onStep = vi.fn();
  const render = (current: number) => {
    hooks.stateCursor = hooks.refCursor = 0;
    return VideoPane({ backend, view: { ...view, current }, onError: vi.fn(), onStep });
  };
  let root = render(1);
  find(root, "Previous frame")!.props.onClick();
  find(root, "Next frame")!.props.onClick();
  expect(onStep.mock.calls).toEqual([[-1], [1]]);
  root = render(0);
  expect(find(root, "Previous frame")!.props.disabled).toBe(true);
  expect(find(root, "Next frame")!.props.disabled).toBe(false);
  root = render(view.frame_count - 1);
  expect(find(root, "Next frame")!.props.disabled).toBe(true);
});

it("groups all tools and reveals only the enabled mask settings", async () => {
  let root = await tree();
  const toolbar = find(root, "Video tools")!;
  for (const label of ["Toggle calibrated ruler", "Toggle first-person fire", "Toggle manual fire quad mask", "Comparison proof"]) expect(find(toolbar, label)).toBeDefined();
  expect(find(toolbar, "Comparison proof")!.props.disabled).toBe(true);
  expect(find(root, "First-person fire settings")).toBeUndefined();
  expect(find(root, "Quad mask settings")).toBeUndefined();
  find(root, "Toggle first-person fire")!.props.onClick();
  root = await tree();
  expect(find(root, "Toggle first-person fire")!.props["aria-expanded"]).toBe(true);
  expect(find(root, "First-person fire settings")).toBeDefined();
  find(root, "Toggle manual fire quad mask")!.props.onClick();
  root = await tree();
  expect(find(root, "First-person fire settings")).toBeUndefined();
  expect(find(root, "Quad mask settings")).toBeDefined();
  expect(find(root, "Toggle first-person fire")!.props["aria-pressed"]).toBe(false);
  find(root, "Toggle manual fire quad mask")!.props.onClick();
  root = await tree();
  expect(find(root, "Quad mask settings")).toBeUndefined();
});

it("offers portal undo beside veil and exposes the existing GUI gate when enabled", async () => {
  let root=await tree();
  const tools=find(root,"Video tools")!;
  expect(find(tools,"Undo GUI veil")).toBeDefined();
  const portal=find(tools,"Undo portal overlay")!;
  expect(portal).toBeDefined();
  portal.props.onChange({target:{value:"auto"}});
  root=await tree();
  expect(find(root,"GUI mask settings")).toBeDefined();
  expect(find(root,"Toggle GUI mask")!.props["aria-pressed"]).toBe(false);
});
it("keeps quad controls visible while the independent matching tool is open", async () => {
  let root=await tree();
  expect(find(root,"Sprite matching settings")).toBeUndefined();
  find(find(root,"Video tools")!,"Toggle sprite matching tool")!.props.onClick();
  root=await tree();
  expect(find(root,"Sprite matching settings")).toBeDefined();
  expect(find(root,"Quad mask settings")).toBeDefined();
  expect(find(root,"Toggle manual fire quad mask")!.props["aria-pressed"]).toBe(true);
  find(root,"Toggle sprite matching tool")!.props.onClick();
  root=await tree();
  expect(find(root,"Sprite matching settings")).toBeUndefined();
  expect(find(root,"Quad mask settings")).toBeDefined();
  find(root,"Toggle sprite matching tool")!.props.onClick();
  root=await tree();
  find(root,"Toggle first-person fire")!.props.onClick();
  root=await tree();
  expect(find(root,"Sprite matching settings")).toBeUndefined();
  expect(find(root,"First-person fire settings")).toBeDefined();
});
it("opens Animation alongside quad controls and closes it with first-person mode", async () => {
  let root=await tree();
  find(root,"Toggle sprite animation tool")!.props.onClick();root=await tree();
  expect(find(root,"Sprite animation settings")).toBeDefined();
  expect(find(root,"Quad mask settings")).toBeDefined();
  find(root,"Toggle first-person fire")!.props.onClick();root=await tree();
  expect(find(root,"Sprite animation settings")).toBeUndefined();
});

it("restores saved mask settings and persists a keyboard parallelogram edit", async () => {
  let stored = JSON.stringify({ ...DEFAULT_MASK_STATE, manualEnabled: true, hudRow: 19, hudFov: 60, manualQuad: [[0.1, 0.1], [0.8, 0.2], [0.7, 0.9], [0.2, 0.7]] });
  vi.stubGlobal("localStorage", { getItem: () => stored, setItem: (key: string, value: string) => { expect(key).toBe(MASK_STATE_KEY); stored = value; } });
  let keyHandler: ((e: KeyboardEvent) => void) | undefined;
  vi.stubGlobal("window", { addEventListener: (_: string, listener: (e: KeyboardEvent) => void) => { keyHandler = listener; }, removeEventListener: vi.fn() });
  await pane();
  hooks.effects[0](); // Save restored state without resetting either preview's choices.
  expect(readMaskState().hudRow).toBe(19);
  expect(readMaskState().hudFov).toBe(60);
  const stop = hooks.effects[1]();
  const key = { key: "p", target: { tagName: "BUTTON" }, preventDefault: vi.fn() } as unknown as KeyboardEvent;
  keyHandler!(key);
  expect(key.preventDefault).toHaveBeenCalledOnce();
  await pane(); hooks.effects[0]();
  const q = readMaskState().manualQuad;
  expect(q[0][0] + q[2][0]).toBeCloseTo(q[1][0] + q[3][0]);
  expect(q[0][1] + q[2][1]).toBeCloseTo(q[1][1] + q[3][1]);
  stop?.();
});

it("toggles mask opacity with E while leaving typing and modified shortcuts alone", async () => {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ ...DEFAULT_MASK_STATE, manualEnabled: true, manualOpacity: 0.4 }), setItem: vi.fn() });
  let keyHandler: ((e: KeyboardEvent) => void) | undefined;
  vi.stubGlobal("window", { addEventListener: (_: string, listener: (e: KeyboardEvent) => void) => { keyHandler = listener; }, removeEventListener: vi.fn() });
  let root = await tree();
  const stop = hooks.effects[1]();
  const press = (extra = {}) => {
    const event = { key: "e", target: { tagName: "BUTTON" }, preventDefault: vi.fn(), ...extra } as unknown as KeyboardEvent;
    keyHandler!(event);
    return event;
  };
  expect(press().preventDefault).toHaveBeenCalledOnce();
  root = await tree();
  expect(find(root, "Manual mask opacity")!.props.value).toBe(0);
  press({ key: "E" });
  root = await tree();
  expect(find(root, "Manual mask opacity")!.props.value).toBe(1);
  for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { repeat: true }, { target: { tagName: "INPUT" } }, { target: { isContentEditable: true } }]) {
    expect(press(extra).preventDefault).not.toHaveBeenCalled();
  }
  root = await tree();
  expect(find(root, "Manual mask opacity")!.props.value).toBe(1);
  find(root, "Toggle manual mask opacity")!.props.onClick();
  root = await tree();
  expect(find(root, "Manual mask opacity")!.props.value).toBe(0);
  stop?.();
});

it("toggles and persists first-person opacity with E and the button, independently of quad opacity", async () => {
  let saved = JSON.stringify({...DEFAULT_MASK_STATE, hudEnabled: true, hudOpacity: 0.3, manualOpacity: 0.45});
  vi.stubGlobal("localStorage", {getItem: (key: string) => key === MASK_STATE_KEY ? saved : null, setItem: (key: string, value: string) => {if (key === MASK_STATE_KEY) saved = value;}});
  let handler: ((e: KeyboardEvent) => void) | undefined;
  vi.stubGlobal("window", {addEventListener: (_: string, callback: (e: KeyboardEvent) => void) => {handler = callback;}, removeEventListener: vi.fn()});
  let root = await tree();
  hooks.effects[1]();
  const press = (key = "e") => {
    const event = {key, target: {tagName: "BUTTON"}, preventDefault: vi.fn()} as unknown as KeyboardEvent;
    handler!(event); return event;
  };
  press(); root = await tree();
  expect(find(root, "First-person fire opacity")!.props.value).toBe(0);
  hooks.effects[0]();
  expect(readMaskState()).toMatchObject({hudOpacity: 0, manualOpacity: 0.45});
  press(); root = await tree();
  expect(find(root, "First-person fire opacity")!.props.value).toBe(1);
  find(root, "Toggle first-person opacity")!.props.onClick(); root = await tree();
  expect(find(root, "First-person fire opacity")!.props.value).toBe(0);
  find(root, "First-person fire opacity")!.props.onChange({target:{valueAsNumber:0.55}}); root = await tree(); hooks.effects[0]();
  expect(readMaskState()).toMatchObject({hudOpacity:0.55, manualOpacity:0.45});
  expect(press("p").preventDefault).not.toHaveBeenCalled();
});

it("suppresses native dragging and pans with captured pointer movement", async () => {
  const frame = await pane();
  const down = pointer(100, 150);
  frame.props.onPointerDown(down);
  expect(down.preventDefault).toHaveBeenCalledOnce();
  expect(down.currentTarget.setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);
  frame.props.onPointerMove(pointer(140, 130));
  expect(hooks.states).toContainEqual({ scale: 1, x: 40, y: -20 });
  frame.props.onPointerUp();
  frame.props.onPointerMove(pointer(250, 250));
  expect(hooks.states).toContainEqual({ scale: 1, x: 40, y: -20 });
  const drag = { preventDefault: vi.fn() };
  frame.props.onDragStart(drag);
  expect(drag.preventDefault).toHaveBeenCalledOnce();
  expect(frame.props.draggable).toBe(false);
});

it("leaves non-primary buttons alone", async () => {
  const frame = await pane();
  const down = pointer(10, 10, 2);
  frame.props.onPointerDown(down);
  frame.props.onPointerMove(pointer(50, 50));
  expect(down.preventDefault).not.toHaveBeenCalled();
  expect(down.currentTarget.setPointerCapture).not.toHaveBeenCalled();
  expect(hooks.states).toContainEqual({ scale: 1, x: 0, y: 0 });
});

it("image mode shares every viewer tool without decoding or labelling a video frame", async () => {
  const backend = createMockBackend();
  const frame = vi.spyOn(backend, "frame");
  const view = { ...await backend.view(), suggestion: null, label: "unset" as const };
  const props = { backend, view, stillImage: { name: "screenshot.png", url: "blob:photo" }, onError: vi.fn(), onStep: vi.fn() };
  hooks.stateCursor = hooks.refCursor = 0; hooks.effects = [];
  let root = VideoPane(props);
  const load = hooks.effects.find(effect => effect.toString().includes("const mine"));
  expect(load).toBeDefined(); load!();
  expect(frame).not.toHaveBeenCalled();
  hooks.stateCursor = hooks.refCursor = 0; hooks.effects = []; root = VideoPane(props);
  const tools = find(root, "Image tools")!;
  for (const label of ["Toggle calibrated ruler", "Toggle first-person fire", "Toggle manual fire quad mask", "Toggle sprite matching tool", "Toggle sprite animation tool", "Comparison proof"]) expect(find(tools, label)).toBeDefined();
  expect(find(root, "Previous photo")).toBeDefined();
  expect(find(root, "Frame navigation")).toBeUndefined();
});
