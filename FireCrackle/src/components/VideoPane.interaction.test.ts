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
import * as guiControls from "./GuiMaskControls";
import * as frameProcessing from "../lib/veilFrame";
import * as portalProcessing from "../lib/portalPreview";
import { DEFAULT_POST, DEFAULT_TONE, pictureSettings, type PostSettings } from "../lib/post/settings";

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
  const root = VideoPane({ backend, view: await backend.view(), onError: vi.fn() });
  const frame = viewport(root)!;
  frame.props.ref.current ??= {offsetParent: {}, getBoundingClientRect: () => ({width: 0, height: 0})};
  return root;
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
beforeEach(() => { hooks.states = []; hooks.refs = []; vi.stubGlobal("document", {querySelector: () => null}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("makes the viewer focusable and takes focus before pan/overlay handlers can retain a field's focus", async () => {
  const frame = await pane();
  expect(frame.props.tabIndex).toBe(0);
  expect(frame.props["aria-label"]).toBe("Video viewer");
  const focus = vi.fn();
  frame.props.onPointerDownCapture({button: 0, target: {tagName: "IMG"}, currentTarget: {focus}});
  expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
  frame.props.onPointerDownCapture({button: 0, target: {tagName: "INPUT", type: "number"}, currentTarget: {focus}});
  expect(focus).toHaveBeenCalledOnce();
});

it.each([{tagName: "DIV"}, {tagName: "BUTTON"}, {tagName: "INPUT", type: "range"}, {tagName: "INPUT", type: "checkbox"}, {tagName: "INPUT", type: "radio"}])("routes Q/U/H/M from non-typing focus: %j", async target => {
  const listeners = new Map<string, (e: any) => void>();
  vi.stubGlobal("window", {addEventListener: (type: string, handler: (e: any) => void) => listeners.set(type, handler), removeEventListener: vi.fn()});
  await tree();
  const setup = hooks.effects.find(effect => effect.toString().includes("dispatchToolKey"))!;
  expect(setup).toBeDefined(); const stop = setup();
  const press = (key: string, type = "keydown", extra = {}) => {
    const event = {key, target, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra};
    listeners.get(type)!(event); return event;
  };
  expect(press("q").preventDefault).toHaveBeenCalledOnce();
  let root = await tree(); expect(find(root, "Quad mask settings")).toBeDefined();
  press("u"); root = await tree(); expect(find(root, "Ruler settings")).toBeDefined();
  press("h"); root = await tree(); expect(find(root, "First-person fire settings")).toBeDefined();
  press("m"); root = await tree(); expect(find(root, "Sprite matching settings")).toBeDefined();
  expect(press("1").preventDefault).toHaveBeenCalledOnce();
  press("m", "keyup", {target: {tagName: "INPUT", type: "number"}});
  expect(press("1").preventDefault).not.toHaveBeenCalled();
  press("m"); root = await tree();
  expect(find(root, "Sprite matching settings")).toBeUndefined();
  expect(find(root, "Quad mask settings")).toBeDefined();
  press("m", "keyup");
  press("m"); root = await tree();
  expect(find(root, "Sprite matching settings")).toBeDefined();
  stop?.();
});

it("protects typing, owned-key widgets, modifiers, repeats, composing input, hidden viewers and dialogs", async () => {
  const listeners = new Map<string, (e: any) => void>();
  vi.stubGlobal("window", {addEventListener: (type: string, handler: (e: any) => void) => listeners.set(type, handler), removeEventListener: vi.fn()});
  const frame = await pane();
  const stop = hooks.effects.find(effect => effect.toString().includes("dispatchToolKey"))!();
  const press = (extra = {}) => {
    const event = {key: "q", target: {tagName: "DIV"}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra};
    listeners.get("keydown")!(event); return event;
  };
  for (const target of [{tagName: "INPUT", type: "number"}, {tagName: "TEXTAREA"}, {tagName: "SELECT"}, {isContentEditable: true}, {dataset: {ownsKeys: "true"}}, {closest: () => ({})}]) expect(press({target}).preventDefault).not.toHaveBeenCalled();
  for (const extra of [{ctrlKey: true}, {metaKey: true}, {altKey: true}, {shiftKey: true}, {isComposing: true}, {defaultPrevented: true}]) expect(press(extra).preventDefault).not.toHaveBeenCalled();
  frame.props.ref.current.offsetParent = null;
  expect(press().preventDefault).not.toHaveBeenCalled();
  frame.props.ref.current.offsetParent = {};
  vi.stubGlobal("document", {querySelector: () => ({})});
  expect(press().preventDefault).not.toHaveBeenCalled();
  expect(find(await tree(), "Quad mask settings")).toBeUndefined();
  stop?.();
});
it("applies the same slider, field, hidden-viewer and dialog rules to E and P", async () => {
  vi.stubGlobal("localStorage", {getItem: () => JSON.stringify({...DEFAULT_MASK_STATE, manualEnabled: true, manualOpacity: 0.4}), setItem: vi.fn()});
  let handler: ((e: any) => void) | undefined;
  vi.stubGlobal("window", {addEventListener: (_: string, next: (e: any) => void) => {handler = next;}, removeEventListener: vi.fn()});
  const frame = await pane();
  const stop = hooks.effects[1]();
  const press = (key: string, target: object, extra = {}) => {
    const event = {key, target, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, preventDefault: vi.fn(), ...extra};
    handler!(event); return event;
  };
  expect(press("e", {tagName: "INPUT", type: "range"}).preventDefault).toHaveBeenCalledOnce();
  expect(find(await tree(), "Manual mask opacity")!.props.value).toBe(0);
  expect(press("p", {tagName: "INPUT", type: "checkbox"}).preventDefault).toHaveBeenCalledOnce();
  for (const key of ["p", "e"]) {
    expect(press(key, {tagName: "INPUT", type: "number"}).preventDefault).not.toHaveBeenCalled();
    expect(press(key, {dataset: {ownsKeys: "true"}}).preventDefault).not.toHaveBeenCalled();
    expect(press(key, {tagName: "DIV"}, {isComposing: true}).preventDefault).not.toHaveBeenCalled();
    vi.stubGlobal("document", {querySelector: () => ({})});
    expect(press(key, {tagName: "DIV"}).preventDefault).not.toHaveBeenCalled();
    vi.stubGlobal("document", {querySelector: () => null});
    frame.props.ref.current.offsetParent = null;
    expect(press(key, {tagName: "DIV"}).preventDefault).not.toHaveBeenCalled();
    frame.props.ref.current.offsetParent = {};
  }
  stop?.();
});

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

it("offers portal undo beside veil without opening a GUI confirmation panel", async () => {
  let root=await tree();
  const tools=find(root,"Video tools")!;
  expect(find(tools,"Undo GUI veil")).toBeDefined();
  const portal=find(tools,"Undo portal overlay")!;
  expect(portal).toBeDefined();
  portal.props.onChange({target:{value:"auto"}});
  root=await tree();
  expect(find(root,"GUI mask settings")).toBeUndefined();
  expect(find(root,"Toggle GUI mask")!.props["aria-pressed"]).toBe(false);
});
it.each(["unsupported", "missing", "unreliable", "failed", "stale", "wrong size", "reliable"])("portal Auto uses the entire frame unless the GUI mask is usable: %s", async kind => {
  const backend = createMockBackend();
  vi.spyOn(backend, "frame").mockResolvedValue(new ArrayBuffer(0));
  const view = await backend.view();
  const image = { data: new Uint8ClampedArray(8), width: 2, height: 1 };
  const pixels = new Uint8ClampedArray([255, 0, 0, 160, 0, 0, 0, 0]);
  const state = { supported: kind !== "unsupported", reply: { reliable: kind !== "unreliable", width: kind === "wrong size" ? 3 : 2, height: 1 }, maskFrame: kind === "stale" ? view.current - 1 : view.current, pixels: ["missing", "unsupported", "failed"].includes(kind) ? null : pixels, busy: false, error: kind === "failed" ? "Mask failed" : null };
  vi.spyOn(guiControls, "useGuiMask").mockReturnValue(state as guiControls.GuiMaskState);
  const portal = vi.spyOn(portalProcessing, "portalPreview").mockResolvedValue({ data: image.data, applied: true } as Awaited<ReturnType<typeof portalProcessing.portalPreview>>);
  vi.spyOn(frameProcessing, "processFrame").mockImplementation(async (_bytes, original, _mode, _options, _io, transform) => {
    expect(transform).toBeDefined();
    await transform!(image);
    return { blob: original, applied: false, portalApplied: true };
  });
  const render = () => {
    hooks.stateCursor = hooks.refCursor = 0; hooks.effects = [];
    return VideoPane({ backend, view, onError: vi.fn() });
  };
  find(render(), "Undo portal overlay")!.props.onChange({ target: { value: "auto" } });
  render();
  const load = hooks.effects.find(effect => effect.toString().includes("const mine"));
  expect(load).toBeDefined();
  const stop = load!();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(portal).toHaveBeenCalledOnce();
  expect(portal.mock.calls[0][2]).toEqual(kind === "reliable" ? new Uint8Array([0, 1]) : undefined);
  stop?.();
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

// ---------------------------------------------------------------- the post-processing settings (Enhance panel)

const postOf = (patch: Partial<PostSettings> = {}, tone: Partial<typeof DEFAULT_TONE> = {}, on = false): PostSettings => ({
  ...DEFAULT_POST, ...patch, stages: { ...DEFAULT_POST.stages, tone: { on, params: { ...DEFAULT_TONE, ...tone } } },
});

async function runLoad(post: PostSettings | undefined, extra: Record<string, unknown> = {}, mask?: guiControls.GuiMaskState) {
  // no GUI mask (its own effect would be found first), as in the portal tests above
  vi.spyOn(guiControls, "useGuiMask").mockReturnValue(mask ?? { supported: false, reply: null, maskFrame: null, pixels: null, busy: false, error: null } as unknown as guiControls.GuiMaskState);
  const backend = createMockBackend();
  vi.spyOn(backend, "frame").mockResolvedValue(new ArrayBuffer(0));
  const view = await backend.view();
  const render = () => {
    hooks.stateCursor = hooks.refCursor = 0; hooks.effects = [];
    return VideoPane({ backend, view, onError: vi.fn(), post, ...extra } as Parameters<typeof VideoPane>[0]);
  };
  render();
  const load = hooks.effects.find(effect => effect.toString().includes("const mine"));
  expect(load).toBeDefined();
  const stop = load!();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  stop?.();
  return { render, view };
}

it("takes veil and portal from the post settings and no longer shows its own selects", async () => {
  const backend = createMockBackend();
  hooks.stateCursor = hooks.refCursor = 0;
  const root = VideoPane({ backend, view: await backend.view(), onError: vi.fn(), post: postOf({ veil: "auto" }) });
  expect(find(root, "Undo GUI veil")).toBeUndefined();
  expect(find(root, "Undo portal overlay")).toBeUndefined();
});

it("keeps its own veil and portal selects when no post settings are given", async () => {
  const root = await tree();
  expect(find(root, "Undo GUI veil")).toBeDefined();
  expect(find(root, "Undo portal overlay")).toBeDefined();
});

it("processes with the veil mode from the post settings", async () => {
  const spy = vi.spyOn(frameProcessing, "processFrame").mockImplementation(async (_b, original) => ({ blob: original, applied: false }));
  await runLoad(postOf({ veil: "on" }));
  expect(spy).toHaveBeenCalled();
  expect(spy.mock.calls[0][2]).toBe("on");
});

it.each(["menu", "inventory", "hud", "stale", "unreliable"])("auto veil requests GUI analysis and only passes current known-screen evidence: %s", async kind => {
  const spy = vi.spyOn(frameProcessing, "processFrame").mockImplementation(async (_b, original) => ({ blob: original, applied: false }));
  const { current } = await createMockBackend().view();
  const state = {
    supported: true, busy: false, error: null, pixels: null,
    maskFrame: kind === "stale" ? current - 1 : current,
    reply: { reliable: kind !== "unreliable", width: 1920, height: 1080, scale: 2, scaled_width: 960, scaled_height: 540, notes: [], pieces: [{ piece: kind === "hud" ? "Hotbar" : kind === "inventory" ? "InventoryPanel" : "MenuButton", count: 1 }] },
  };
  await runLoad(postOf({ veil: "auto" }), {}, state);
  const calls = vi.mocked(guiControls.useGuiMask).mock.calls;
  expect(calls[calls.length - 1][3]).toBe(true);
  expect(spy.mock.calls[0][7]).toEqual(["menu", "inventory"].includes(kind) ? { width: 1920, height: 1080 } : undefined);
});

it("runs the portal stage when the post settings say Auto, and not otherwise", async () => {
  const spy = vi.spyOn(frameProcessing, "processFrame").mockImplementation(async (_b, original) => ({ blob: original, applied: false }));
  await runLoad(postOf({ portal: "auto" }));
  expect(spy.mock.calls[0][5]).toBeDefined();
  spy.mockClear();
  await runLoad(postOf({ veil: "auto" }));
  expect(spy.mock.calls[0][5]).toBeUndefined();
});

it("passes an enhancement stage that applies the tone settings when an effect is on", async () => {
  const spy = vi.spyOn(frameProcessing, "processFrame").mockImplementation(async (_b, original) => ({ blob: original, applied: false }));
  await runLoad(postOf({}, { gamma: 2 }, true));
  const stage = spy.mock.calls[0][6]!;
  expect(stage).toBeTypeOf("function");
  const out = stage({ data: new Uint8ClampedArray([64, 64, 64, 255]), width: 1, height: 1 });
  expect(out.applied).toBe(true);
  expect(out.data[0]).toBeGreaterThan(100);
  expect(out.data[3]).toBe(255);
});

it("runs no stage at all when every effect is off, an effect is neutral, or the master switch is off", async () => {
  // (with no frame buffer, as in this harness, the pane still calls processFrame, but with nothing to do: it returns the original)
  const spy = vi.spyOn(frameProcessing, "processFrame").mockImplementation(async (_b, original) => ({ blob: original, applied: false }));
  for (const post of [postOf(), postOf({}, {}, true), pictureSettings({ ...postOf({ veil: "auto", portal: "auto" }, { gamma: 2 }, true), enabled: false })]) { // what the app hands the pane for a master switch that is off
    spy.mockClear();
    await runLoad(post);
    for (const call of spy.mock.calls) {
      expect(call[2]).toBe("off");
      expect(call[5]).toBeUndefined();
      expect(call[6]).toBeUndefined();
    }
  }
});

it("runs the portal stage with the manual phase and opacity, and keeps the GUI mask on for it", async () => {
  const image = { data: new Uint8ClampedArray(8), width: 2, height: 1 };
  const portal = vi.spyOn(portalProcessing, "portalPreview").mockResolvedValue({ data: image.data, applied: true, phase: 7, opacity: 0.4, valid: new Uint8Array(2) } as Awaited<ReturnType<typeof portalProcessing.portalPreview>>);
  vi.spyOn(frameProcessing, "processFrame").mockImplementation(async (_b, original, _m, _o, _io, transform) => {
    await transform?.(image);
    return { blob: original, applied: false, portalApplied: true };
  });
  const mask = vi.spyOn(guiControls, "useGuiMask");
  await runLoad(postOf({ portal: "manual", portalManual: { phase: 12, opacity: 0.62 } }));
  expect(portal).toHaveBeenCalledOnce();
  expect(portal.mock.calls[0][3]).toEqual({ phase: 12, opacity: 0.62 });
  expect(mask.mock.calls[mask.mock.calls.length - 1][3]).toBe(true);
});

it("does not pass manual values to the automatic portal fit, and reports that fit so the panel can copy it", async () => {
  const image = { data: new Uint8ClampedArray(8), width: 2, height: 1 };
  const portal = vi.spyOn(portalProcessing, "portalPreview").mockResolvedValue({ data: image.data, applied: true, phase: 7, opacity: 0.4, valid: new Uint8Array(2) } as Awaited<ReturnType<typeof portalProcessing.portalPreview>>);
  vi.spyOn(frameProcessing, "processFrame").mockImplementation(async (_b, original, _m, _o, _io, transform) => {
    await transform?.(image);
    return { blob: original, applied: false, portalApplied: true };
  });
  const onPortalFit = vi.fn();
  await runLoad(postOf({ portal: "auto", portalManual: { phase: 12, opacity: 0.62 } }), { onPortalFit });
  expect(portal.mock.calls[0][3]).toBeUndefined();
  expect(onPortalFit).toHaveBeenCalledWith({ phase: 7, opacity: 0.4 });
});

it("does not report a fit for a manual portal (the values are the user's)", async () => {
  const image = { data: new Uint8ClampedArray(8), width: 2, height: 1 };
  vi.spyOn(portalProcessing, "portalPreview").mockResolvedValue({ data: image.data, applied: true, phase: 12, opacity: 0.62, valid: new Uint8Array(2) } as Awaited<ReturnType<typeof portalProcessing.portalPreview>>);
  vi.spyOn(frameProcessing, "processFrame").mockImplementation(async (_b, original, _m, _o, _io, transform) => {
    await transform?.(image);
    return { blob: original, applied: false, portalApplied: true };
  });
  const onPortalFit = vi.fn();
  await runLoad(postOf({ portal: "manual" }), { onPortalFit });
  expect(onPortalFit).not.toHaveBeenCalled();
});

it("tells the panel about the portal status instead of showing it itself", async () => {
  vi.spyOn(frameProcessing, "processFrame").mockImplementation(async (_b, original) => ({ blob: original, applied: false, portalApplied: false }));
  const onPortalStatus = vi.fn();
  await runLoad(postOf({ portal: "auto" }), { onPortalStatus });
  expect(onPortalStatus).toHaveBeenCalledWith(expect.stringContaining("Checking portal"));
  expect(onPortalStatus).toHaveBeenLastCalledWith("No confident portal fit");
});

it("marks the picture as enhanced only when a stage changed it", async () => {
  const spy = vi.spyOn(frameProcessing, "processFrame");
  spy.mockImplementation(async (_b, original) => ({ blob: original, applied: false, enhanced: true }));
  const { render } = await runLoad(postOf({}, { gamma: 2 }, true));
  expect(find(render(), "Picture enhanced")).toBeDefined();
  spy.mockImplementation(async (_b, original) => ({ blob: original, applied: false, enhanced: false }));
  hooks.states = []; hooks.refs = [];
  const second = await runLoad(postOf({}, { gamma: 2 }, true));
  expect(find(second.render(), "Picture enhanced")).toBeUndefined();
});

it("reports presentation only after the current image loads, never for a stale URL", async () => {
  vi.spyOn(frameProcessing, "processFrame").mockImplementation(async (_b, original) => ({ blob: original, applied: false }));
  const onFramePresented = vi.fn();
  const { render, view } = await runLoad(postOf({}), { onFramePresented });
  function image(node: Element): Element | undefined {
    if (node.type === "img") return node;
    for (const child of [node.props.children].flat(Infinity)) {
      if (child && typeof child === "object" && "props" in child) { const match = image(child); if (match) return match; }
    }
  }
  const img = image(render())!;
  expect(onFramePresented).not.toHaveBeenCalled();
  const currentTarget = { naturalWidth: 1920, naturalHeight: 1080, getAttribute: () => "stale-url" };
  img.props.onLoad({ currentTarget });
  expect(onFramePresented).not.toHaveBeenCalled();
  currentTarget.getAttribute = () => img.props.src;
  img.props.onLoad({ currentTarget });
  expect(onFramePresented).toHaveBeenCalledWith(view.current);
});
