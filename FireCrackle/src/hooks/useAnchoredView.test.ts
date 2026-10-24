// The video area's size changes (3D overview opened / closed / dragged / collapsed, window resized): the view is
// re-anchored so the picture stays on the same screen pixels (lib/zoom.ts anchorView).
import { beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ refs: [] as { current: unknown }[], ri: 0, effects: [] as (() => void | (() => void))[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (initial: unknown) => (hooks.refs[hooks.ri++] ??= { current: initial }),
  useEffect: (setup: () => void | (() => void)) => { hooks.effects.push(setup); },
}));
import { useAnchoredView } from "./useAnchoredView";
import { anchorView, type ViewXform } from "../lib/zoom";

let observed: (() => void) | null, disconnect: ReturnType<typeof vi.fn<() => void>>, size: { width: number; height: number };
class FakeObserver { constructor(cb: () => void) { observed = cb; } observe() {} disconnect() { disconnect(); } }
const frame = { current: { getBoundingClientRect: () => size } as unknown as HTMLElement };
let view: ViewXform;
const setView = (f: (v: ViewXform) => ViewXform) => { view = f(view); };
function mount(image = { width: 2560, height: 1440 }) {
  hooks.ri = 0; hooks.effects = [];
  useAnchoredView(frame, image, setView);
  return hooks.effects.map(e => e());
}
beforeEach(() => { hooks.refs = []; observed = null; disconnect = vi.fn<() => void>(); size = { width: 1600, height: 600 }; view = { scale: 2, x: -100, y: -50 }; vi.stubGlobal("ResizeObserver", FakeObserver); });

it("the first size only records; a new size re-anchors the view so the picture stays put", () => {
  mount();
  observed!();
  expect(view).toEqual({ scale: 2, x: -100, y: -50 });
  const before = view;
  size = { width: 1100, height: 600 };
  observed!();
  expect(view).toEqual(anchorView(before, { w: 1600, h: 600 }, { w: 1100, h: 600 }, { w: 2560, h: 1440 }));
  const narrowed = view;
  size = { width: 1600, height: 600 };
  observed!();
  expect(view.scale).toBeCloseTo(before.scale, 9);
  expect(view.x).toBeCloseTo(before.x, 9);
  expect(view.y).toBeCloseTo(before.y, 9);
  expect(narrowed).not.toEqual(before);
});
it("before the picture's size is known nothing moves; unmounting stops watching", () => {
  const cleanups = mount({ width: 0, height: 0 });
  observed!(); size = { width: 900, height: 600 }; observed!();
  expect(view).toEqual({ scale: 2, x: -100, y: -50 });
  for (const c of cleanups) if (typeof c === "function") c();
  expect(disconnect).toHaveBeenCalled();
});
