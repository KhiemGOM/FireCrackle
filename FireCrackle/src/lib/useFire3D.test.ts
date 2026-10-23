// The 3D quad hook: every edit is undoable (Label's shared undo) and kept for its frame (fire3d memory), and the
// grid / box toggles are undoable too. React's hooks are stand-ins run by call order, as in the other hook tests.
import { beforeEach, expect, it, vi } from "vitest";
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
}));
vi.mock("./pictureWorker", () => ({ pictureTask: vi.fn() }));
import { useFire3D } from "./useFire3D";
import { LabelUndo } from "./labelUndo";
import { readFire3D } from "./fire3dMemory";

function memoryStorage() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; }
let history: LabelUndo, storage: ReturnType<typeof memoryStorage>;
const render = (key = "120") => { hooks.si = hooks.ri = 0; return useFire3D(key, async () => new Blob(), true, false, { history, video: "v.mkv", storage }); };

beforeEach(() => { hooks.states = []; hooks.refs = []; history = new LabelUndo(); storage = memoryStorage(); });

it("an edit can be undone", async () => {
  render().update(s => ({ ...s, eyeY: 70 }));
  expect(render().state.eyeY).toBe(70);
  expect(history.size).toBe(1);
  await history.undo();
  expect(render().state.eyeY).toBeNull();
});

it("an edit is kept for its frame, so leaving the tool or the frame does not lose it", () => {
  render("120").update(s => ({ ...s, eyeY: 70, clicks: [{ id: 1, px: [10, 20], world: [0, 64, 0] }] }));
  const saved = readFire3D("v.mkv", storage).get("120");
  expect(saved?.eyeY).toBe(70);
  expect(saved?.clicks.map(c => c.world)).toEqual([[0, 64, 0]]);
});

it("the grid and the block box on the picture can be switched off and back, with undo", async () => {
  expect(render().showGrid).toBe(true);
  expect(render().showBox).toBe(true);
  render().setShowGrid(false);
  render().setShowBox(false);
  expect([render().showGrid, render().showBox]).toEqual([false, false]);
  await history.undo();
  expect([render().showGrid, render().showBox]).toEqual([true, true]);
});
