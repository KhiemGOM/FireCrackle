import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { Backend } from "../lib/api";
import type { GuiAnswer, GuiMaskReply, GuiMaskFrame } from "../lib/guiMask";
const hooks = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], effects: [] as any[], pending: [] as Array<() => void>, si: 0, ri: 0, ei: 0, dirty: false }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => { const i = hooks.si++; if (!(i in hooks.states)) hooks.states[i] = initial; return [hooks.states[i], (next: any) => { const v = typeof next === "function" ? next(hooks.states[i]) : next; if (!Object.is(v, hooks.states[i])) { hooks.states[i] = v; hooks.dirty = true; } }]; },
  useRef: (initial: unknown) => (hooks.refs[hooks.ri++] ??= { current: initial }),
  useEffect: (setup: () => unknown, deps: unknown[]) => { const i = hooks.ei++, old = hooks.effects[i]; if (old && deps.every((d, j) => Object.is(d, old.deps[j]))) return; hooks.pending.push(() => { old?.cleanup?.(); hooks.effects[i] = { deps, cleanup: setup() }; }); },
}));
vi.mock("./GuiMaskControls.css", () => ({}));
import { GuiMaskOverlay, GuiMaskPanel, useGuiMask } from "./GuiMaskControls";

type Element = ReactElement<Record<string, any>>;
function find(node: Element | null, test: (e: Element) => boolean): Element | undefined {
  if (!node) return undefined;
  if (test(node)) return node;
  for (const child of [node.props.children].flat(Infinity)) if (child && typeof child === "object" && "props" in child) { const m = find(child as Element, test); if (m) return m; }
}
function text(node: Element | null): string {
  if (!node) return "";
  return [node.props.children].flat(Infinity).map((c: any) => (typeof c === "string" || typeof c === "number" ? String(c) : c && typeof c === "object" && "props" in c ? text(c) : "")).join("");
}
const button = (tree: Element, label: string) => find(tree, (e) => e.type === "button" && text(e) === label);

const REPLY: GuiMaskReply = { width: 2, height: 1, reliable: true, scale: 4.5, scaled_width: 427, scaled_height: 240, notes: [], pieces: [{ piece: "Hotbar", count: 1 }, { piece: "Health", count: 10 }] };
let answer: GuiAnswer | null;
let backend: Backend;
let maskState: ReturnType<typeof useGuiMask>;
function render(frame = 5, on = true, ready = true): Element {
  let root: Element;
  do {
    hooks.dirty = false; hooks.si = hooks.ri = hooks.ei = 0; hooks.pending = [];
    maskState = useGuiMask(backend, frame, ready, on);
    root = GuiMaskPanel({ state: maskState, frame }) as Element;
    hooks.pending.forEach((run) => run());
  } while (hooks.dirty);
  return root!;
}
async function settle(frame = 5, on = true): Promise<Element> {
  for (let i = 0; i < 6; i++) { render(frame, on); await Promise.resolve(); await Promise.resolve(); }
  return render(frame, on);
}
beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.pending = [];
  answer = null;
  backend = {
    mock: false,
    guiAnswerGet: vi.fn(async () => answer),
    guiAnswerSet: vi.fn(async (a: GuiAnswer) => { answer = a; }),
    guiMask: vi.fn(async () => REPLY),
    guiMaskPixels: vi.fn(async () => new Uint8Array([0x11, 0x00]).buffer),
  } as unknown as Backend;
});
afterEach(() => hooks.effects.forEach((e) => e?.cleanup?.()));

it("runs under the stated GUI assumption without asking or saving confirmation", async () => {
  const tree = await settle();
  expect(button(tree, "Yes")).toBeUndefined();
  expect(backend.guiAnswerGet).not.toHaveBeenCalled();
  expect(backend.guiAnswerSet).not.toHaveBeenCalled();
  expect(backend.guiMask).toHaveBeenCalledWith(5);
  expect(backend.guiMaskPixels).toHaveBeenCalledWith(5);
  expect(text(tree)).toContain("GUI scale 4.50");
  expect(text(tree)).toContain("10 Health");
  expect(tree.props.title).toContain("1.16.5");
  expect(tree.props.title).toContain("1.21.11");
});

it("uses one atomic request without issuing a separate pixel read", async () => {
  backend.guiMaskFrame = vi.fn(async () => ({reply:REPLY, packed:new Uint8Array([0x11,0])}));
  await settle();
  expect(backend.guiMaskFrame).toHaveBeenCalledExactlyOnceWith(5);
  expect(backend.guiMask).not.toHaveBeenCalled();
  expect(backend.guiMaskPixels).not.toHaveBeenCalled();
  expect(maskState.maskFrame).toBe(5);
  expect(maskState.pixels?.length).toBe(8);
});

it("does not read legacy pixels after the frame changes or the tool turns off", async () => {
  let resolve!: (reply:GuiMaskReply) => void;
  backend.guiMask = vi.fn(() => new Promise<GuiMaskReply>(yes => {resolve=yes;}));
  render(5);
  render(6,false);
  resolve(REPLY);
  await settle(6,false);
  expect(backend.guiMaskPixels).not.toHaveBeenCalled();
  expect(maskState.busy).toBe(false);
});

it("abandons unmounted requests before fetching legacy pixels", async () => {
  let resolve!: (reply:GuiMaskReply) => void;
  backend.guiMask = vi.fn(() => new Promise<GuiMaskReply>(yes => {resolve=yes;}));
  render();
  hooks.effects.forEach(effect => effect.cleanup?.());
  resolve(REPLY);
  for(let i=0;i<6;i++)await Promise.resolve();
  expect(backend.guiMaskPixels).not.toHaveBeenCalled();
});

it("keeps the current atomic result when an older frame completes later", async () => {
  let old!: (result:{reply:GuiMaskReply;packed:Uint8Array}) => void;
  backend.guiMaskFrame = vi.fn(frame => frame===5
    ? new Promise<GuiMaskFrame>(resolve => {old=resolve;})
    : Promise.resolve({reply:REPLY,packed:new Uint8Array([0x22,0])}));
  render(5); await settle(6);
  const currentPixels=maskState.pixels;
  old({reply:REPLY,packed:new Uint8Array([0x11,0])});
  await settle(6);
  expect(maskState.maskFrame).toBe(6);
  expect(maskState.pixels).toBe(currentPixels);
});

it("loads an independent neutral panel mask without claiming a reliable HUD", async () => {
  (backend.guiMask as any).mockResolvedValue({...REPLY,reliable:false,mask_available:true,scale:null,pieces:[{piece:'InventoryPanel',count:1}]});
  const tree=await settle();
  expect(backend.guiMaskPixels).toHaveBeenCalledWith(5);
  expect(maskState.pixels).toBeDefined();
  expect(text(tree)).toContain('neutral mask');
});

it("legacy negative answers no longer gate the mask or get overwritten", async () => {
  for (const a of ["no", "not_sure"] as const) {
    hooks.states = []; hooks.refs = []; hooks.effects = [];
    answer = a;
    (backend.guiMask as any).mockClear();
    const tree = await settle();
    expect(backend.guiMask).toHaveBeenCalledWith(5);
    expect(text(tree)).toContain("GUI scale");
    expect(button(tree, "Change answer")).toBeUndefined();
    expect(backend.guiAnswerSet).not.toHaveBeenCalled();
  }
});

it("works when the backend only provides masking, without legacy answer methods", async () => {
  delete backend.guiAnswerGet;
  delete backend.guiAnswerSet;
  expect(text(await settle())).toContain("GUI scale");
  expect(backend.guiMask).toHaveBeenCalledWith(5);
});

it("keeps an unreliable frame unmasked", async () => {
  (backend.guiMask as any).mockResolvedValue({ ...REPLY, reliable: false, scale: null, notes: ["No reliable HUD fit"] });
  expect(text(await settle())).toContain("No reliable HUD fit");
  expect(backend.guiMaskPixels).not.toHaveBeenCalled();
  expect(GuiMaskOverlay({ state: maskState, frame: 5 })).toBeNull();
});

it("does nothing at all while the tool is off", async () => {
  await settle(5, false);
  expect(backend.guiAnswerGet).not.toHaveBeenCalled();
  expect(backend.guiMask).not.toHaveBeenCalled();
});

it("never draws a mask over another frame", async () => {
  answer = "yes";
  await settle(5);
  expect(GuiMaskOverlay({ state: maskState, frame: 5 })).not.toBeNull();
  render(6); // the frame changed: the old mask must not be shown while the new one is computed
  expect(GuiMaskOverlay({ state: maskState, frame: 6 })).toBeNull();
  await settle(6);
  expect(backend.guiMask).toHaveBeenLastCalledWith(6);
  expect(GuiMaskOverlay({ state: maskState, frame: 6 })).not.toBeNull();
});

it("a failure is reported, not hidden", async () => {
  answer = "yes";
  (backend.guiMask as any).mockImplementation(async () => { throw new Error("The GUI mask is off: boom"); });
  expect(text(await settle())).toContain("GUI mask failed");
});

it("says the tool needs the desktop app when the backend cannot do it", async () => {
  backend = { mock: true } as unknown as Backend;
  expect(text(await settle())).toContain("desktop app");
});
