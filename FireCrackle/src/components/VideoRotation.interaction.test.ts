import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const hooks = vi.hoisted(() => ({ state: [] as any[], refs: [] as any[], cursor: 0, refCursor: 0, effects: [] as Array<() => (() => void)> }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: any) => { const i = hooks.cursor++; if (!(i in hooks.state)) hooks.state[i] = initial; return [hooks.state[i], (value: any) => { hooks.state[i] = typeof value === "function" ? value(hooks.state[i]) : value; }]; },
  useRef: (initial: any) => hooks.refs[hooks.refCursor++] ??= { current: initial },
  useEffect: (fn: any) => { hooks.effects.push(fn); },
}));
import { VideoRotation } from "./VideoRotation";
type Element = ReactElement<Record<string, any>>;
const onRotate = vi.fn();
const frameRef = { current: { getBoundingClientRect: () => ({ left: 100, top: 120, width: 800, height: 400 }) } as HTMLDivElement };
let cleanup: (() => void) | undefined;
function render() { hooks.cursor = hooks.refCursor = 0; return VideoRotation({ frameRef, onRotate }) as Element | null; }
function send(type: string, values: Record<string, unknown> = {}) { window.dispatchEvent(Object.assign(new Event(type), values)); }
function pointer(x: number, y: number) { return { clientX: x, clientY: y, button: 0, pointerId: 4, stopPropagation: vi.fn(), preventDefault: vi.fn(), currentTarget: { setPointerCapture: vi.fn() } }; }
function anchor(root: Element) { return root.props.children[1] as Element; }
function handle(root: Element) { return root.props.children[2] as Element; }
beforeEach(() => {
  hooks.state = []; hooks.refs = []; hooks.effects = []; onRotate.mockClear();
  vi.stubGlobal("window", new EventTarget()); vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
  render(); cleanup = hooks.effects[0]();
});
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });

it("anchors exactly where Shift goes down and never follows subsequent pointer movement", () => {
  send("pointermove", { clientX: 250, clientY: 190 }); send("keydown", { key: "Shift" });
  let root = render()!;
  expect([anchor(root).props.cx, anchor(root).props.cy]).toEqual([150, 70]);
  send("pointermove", { clientX: 600, clientY: 400 }); send("keydown", { key: "Shift", repeat: true });
  root = render()!;
  expect([anchor(root).props.cx, anchor(root).props.cy]).toEqual([150, 70]);
  send("keyup", { key: "Shift" }); expect(render()).toBeNull();
  send("keydown", { key: "Shift" }); root = render()!;
  expect([anchor(root).props.cx, anchor(root).props.cy]).toEqual([500, 280]);
});

it("rotates around the captured anchor and stops on Shift release and window blur", () => {
  send("pointermove", { clientX: 250, clientY: 190 }); send("keydown", { key: "Shift" });
  let root = render()!;
  const down = pointer(314, 190); handle(root).props.onPointerDown(down);
  expect(down.currentTarget.setPointerCapture).toHaveBeenCalledWith(4);
  expect(down.stopPropagation).toHaveBeenCalled();
  root.props.onPointerMove(pointer(250, 254));
  expect(onRotate).toHaveBeenLastCalledWith(90, 150, 70);
  send("keyup", { key: "Shift" }); root.props.onPointerMove(pointer(186, 190));
  expect(onRotate).toHaveBeenCalledTimes(1); expect(render()).toBeNull();
  send("keydown", { key: "Shift" }); root = render()!;
  handle(root).props.onPointerDown(pointer(314, 190)); send("blur");
  root.props.onPointerMove(pointer(250, 254));
  expect(onRotate).toHaveBeenCalledTimes(1); expect(render()).toBeNull();
});

it("does not create a pivot when Shift started outside the video", () => {
  send("pointermove", { clientX: 20, clientY: 30 }); send("keydown", { key: "Shift" });
  expect(render()).toBeNull();
  send("pointermove", { clientX: 250, clientY: 190 }); send("keydown", { key: "Shift", repeat: true });
  expect(render()).toBeNull();
});
it("ignores Shift while typing in a text field", () => {
  send("pointermove", { clientX: 250, clientY: 190 });
  const typing = Object.assign(new Event("keydown"), { key: "Shift" });
  Object.defineProperty(typing, "target", { value: { tagName: "INPUT" } });
  window.dispatchEvent(typing);
  expect(render()).toBeNull();
});
