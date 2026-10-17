import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { Backend } from "../lib/api";
import type { GuiAnswer, GuiMaskReply } from "../lib/guiMask";
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

it("asks first and runs nothing until the user answers yes", async () => {
  const tree = await settle();
  expect(text(tree)).toContain("vanilla Minecraft 1.16.5 GUI");
  expect(backend.guiMask).not.toHaveBeenCalled();
  await button(tree, "Yes")!.props.onClick();
  const after = await settle();
  expect(backend.guiAnswerSet).toHaveBeenCalledWith("yes");
  expect(backend.guiMask).toHaveBeenCalledWith(5);
  expect(backend.guiMaskPixels).toHaveBeenCalledWith(5);
  expect(text(after)).toContain("GUI scale 4.50");
  expect(text(after)).toContain("10 Health");
});

it("an answer of no or not sure keeps the mask off and can be changed", async () => {
  for (const a of ["no", "not_sure"] as const) {
    hooks.states = []; hooks.refs = []; hooks.effects = [];
    answer = a;
    (backend.guiMask as any).mockClear();
    const tree = await settle();
    expect(backend.guiMask).not.toHaveBeenCalled();
    expect(text(tree)).toContain("GUI mask off");
    button(tree, "Change answer")!.props.onClick();
    expect(text(render())).toContain("vanilla Minecraft 1.16.5 GUI");
  }
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
