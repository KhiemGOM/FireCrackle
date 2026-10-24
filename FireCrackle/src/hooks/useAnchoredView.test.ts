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
function mount(image = { width: 2560, height: 1440 }, saved?: { w: number; h: number } | null) {
  hooks.ri = 0; hooks.effects = [];
  const box = useAnchoredView(frame, image, setView, saved);
  return Object.assign(hooks.effects.map(e => e()), { box });
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

// ---- the view is saved with the area's size: opening the app passes through other sizes (a small window first, then
// maximised; minimised is 0 × 0), and the picture's size may be known only after. The saved view must come back as it
// was, and one that shows none of the picture (saved before sizes were kept) starts fitted. Panning is never limited.

const IMAGE = { width: 2560, height: 1440 }, SAVED = { w: 1600, h: 900 };
it("a saved view comes back as it was, whatever sizes the window passes through while opening", () => {
  view = { scale: 7, x: -5000, y: -2500 };
  const saved = view;
  size = { width: 800, height: 600 };
  const m = mount(IMAGE, SAVED);
  observed!();
  size = { width: 1600, height: 900 };
  observed!();
  expect(view.scale).toBeCloseTo(saved.scale, 9);
  expect(view.x).toBeCloseTo(saved.x, 6);
  expect(view.y).toBeCloseTo(saved.y, 6);
  expect(m.box.current).toEqual({ w: 1600, h: 900 });
});
it("a picture known only after the window settled: the view is moved once, from the saved size to the area's", () => {
  view = { scale: 7, x: -5000, y: -2500 };
  const saved = view;
  size = { width: 800, height: 600 };
  mount({ width: 0, height: 0 }, SAVED);
  observed!();
  size = { width: 1200, height: 900 };
  observed!();
  expect(view).toBe(saved);
  mount(IMAGE, SAVED); // the picture's size arrives
  expect(view).toEqual(anchorView(saved, SAVED, { w: 1200, h: 900 }, { w: 2560, h: 1440 }));
});
it("a minimised window (0 × 0) is passed over: restored to another size, the view is moved from the last real one", () => {
  size = { width: 1600, height: 900 };
  mount(IMAGE, null);
  observed!();
  const before = view;
  size = { width: 0, height: 0 };
  observed!();
  size = { width: 1200, height: 900 };
  observed!();
  expect(view).toEqual(anchorView(before, { w: 1600, h: 900 }, { w: 1200, h: 900 }, { w: 2560, h: 1440 }));
});
it("a view that opens with none of the picture on screen starts fitted; panning off it later is left alone", () => {
  view = { scale: 3.9, x: 40000, y: 30000 };
  size = { width: 1600, height: 900 };
  mount(IMAGE, null);
  observed!();
  expect(view).toEqual({ scale: 1, x: 0, y: 0 });
  view = { scale: 1, x: 5000, y: 0 }; // panned away by hand
  size = { width: 1500, height: 900 };
  observed!();
  expect(view).toEqual(anchorView({ scale: 1, x: 5000, y: 0 }, { w: 1600, h: 900 }, { w: 1500, h: 900 }, { w: 2560, h: 1440 }));
});
