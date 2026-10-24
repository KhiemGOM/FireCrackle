// Match for the 3D quad (M while the 3D quad is on): the fire's planes, at their solved place on the native frame, are
// matched together in the picture worker (lib/fire3dMatch.ts) and the best shared sprite is previewed; up to three
// phases can be tried (the buttons, or M then 1-3), as the quad mask's matcher does.
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { FireQuad } from "../lib/reversal";
import type { PlaneMatch, PlaneMatchCandidate } from "../lib/fire3dMatch";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", async original => ({ ...(await original<typeof import("react")>()),
  useRef: (initial: unknown) => { const i = hooks.cursor++; return hooks.values[i] ??= { current: initial }; },
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = initial; return [hooks.values[i], (v: unknown) => { hooks.values[i] = typeof v === "function" ? (v as (x: unknown) => unknown)(hooks.values[i]) : v; }]; },
  useEffect: (setup: () => void | (() => void)) => { hooks.effects.push(setup); },
}));
vi.mock("../lib/pictureWorker", () => ({ pictureTask: vi.fn() }));
vi.mock("../lib/quadRefine", () => ({ readFireAtlas: vi.fn(async () => [new Uint8ClampedArray(4), new Uint8ClampedArray(4)]) }));
import { pictureTask } from "../lib/pictureWorker";
import { readFireAtlas } from "../lib/quadRefine";
import { Fire3DMatchControls } from "./Fire3DMatchControls";

type El = ReactElement<Record<string, any>>;
const UV: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
/** Two planes in native pixels (1000 × 500): one facing the camera, one seen from behind (its corners wound the other
 * way) and drawn from the other sheet. */
const quads: FireQuad[] = [
  // a fire block's plane: the model gives no sheet of its own (-1), so it shows the chosen one
  { world: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], px: [[100, 100], [300, 100], [300, 400], [100, 400]], uv: UV, sheet: -1 },
  { world: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], px: [[700, 100], [500, 100], [500, 400], [700, 400]], uv: UV, sheet: 1 },
];
const answer: PlaneMatch = { confident: true, planes: 2, candidates: [
  { sheet: 1, row: 20, mirrored: true, phase: 4, support: 12 },
  { sheet: 0, row: 9, mirrored: false, phase: 9, support: 5 },
  { sheet: 0, row: 30, mirrored: false, phase: 30, support: 2 },
] };
const blob = { arrayBuffer: async () => new ArrayBuffer(16) } as Blob;
let onPreview: ReturnType<typeof vi.fn<(c: PlaneMatchCandidate) => void>>;
function render(props: Partial<Parameters<typeof Fire3DMatchControls>[0]> = {}) {
  hooks.cursor = 0; hooks.effects = [];
  return Fire3DMatchControls({ quads, size: { width: 1000, height: 500 }, picture: "12", load: async () => blob, material: "normal", runToken: 0, pick: null, disabled: false, onPreview, ...props }) as El;
}
function all(node: unknown): El[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as El;
  return [el, ...all(el.props.children)];
}
const button = (root: El, label: RegExp) => all(root).find(n => n.type === "button" && label.test(String(n.props["aria-label"] ?? n.props.children)));
const text = (root: El) => all(root).flatMap(n => [n.props.children].flat()).filter(c => typeof c === "string").join(" ");
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); for (let i = 0; i < 30; i++) await Promise.resolve(); }
beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.effects = []; vi.clearAllMocks(); onPreview = vi.fn<(c: PlaneMatchCandidate) => void>(); vi.mocked(pictureTask).mockResolvedValue(answer as never); });

it("matches every plane in the picture worker, with each plane's place, flip and sheet, and previews the best", async () => {
  button(render(), /find/i)!.props.onClick();
  await settle();
  expect(readFireAtlas).toHaveBeenCalledWith("normal");
  const [task, args] = vi.mocked(pictureTask).mock.calls[0] as [string, any];
  expect(task).toBe("match3d");
  expect(args.planes).toHaveLength(2);
  expect(args.planes[0]).toMatchObject({ mirrored: false, sheet: 0 });
  expect(args.planes[0].quad[0][0]).toBeCloseTo(0.1);
  expect(args.planes[1]).toMatchObject({ mirrored: true, sheet: 1 });
  expect(args.bytes.byteLength).toBe(16);
  expect(onPreview).toHaveBeenCalledWith(answer.candidates[0]);
});

it("offers the three phases as numbered buttons; one click previews that one", async () => {
  button(render(), /find/i)!.props.onClick();
  await settle();
  const root = render();
  expect(button(root, /3D match 1/)!.props["aria-pressed"]).toBe(true);
  button(root, /3D match 3/)!.props.onClick();
  expect(onPreview).toHaveBeenLastCalledWith(answer.candidates[2]);
  expect(text(render())).toMatch(/phase 30/);
});

it("M runs it (a new run token), and M then 1-3 previews that phase once it exists", async () => {
  render({ runToken: 1 });
  for (const effect of hooks.effects) effect();
  await settle();
  expect(pictureTask).toHaveBeenCalledTimes(1);
  render({ runToken: 1, pick: { index: 1, n: 1 } });
  for (const effect of hooks.effects) effect();
  expect(onPreview).toHaveBeenLastCalledWith(answer.candidates[1]);
  // the same token and pick again do nothing more
  render({ runToken: 1, pick: { index: 1, n: 1 } });
  for (const effect of hooks.effects) effect();
  await settle();
  expect(pictureTask).toHaveBeenCalledTimes(1);
  expect(onPreview).toHaveBeenCalledTimes(2);
});

it("a result belongs to its picture and planes: another frame or a moved camera hides it", async () => {
  button(render(), /find/i)!.props.onClick();
  await settle();
  expect(button(render({ picture: "13" }), /3D match 1/)).toBeUndefined();
  const moved = [{ ...quads[0], px: quads[0].px!.map(([x, y]) => [x + 40, y]) as [number, number][] }, quads[1]];
  expect(button(render({ quads: moved }), /3D match 1/)).toBeUndefined();
  expect(button(render(), /3D match 1/)).toBeDefined();
});

it("with no fire placed there is nothing to match: it says so and runs nothing", async () => {
  const root = render({ quads: [] });
  expect(button(root, /find/i)!.props.disabled).toBe(true);
  render({ quads: [], runToken: 1 });
  for (const effect of hooks.effects) effect();
  await settle();
  expect(pictureTask).not.toHaveBeenCalled();
  expect(text(render({ quads: [] }))).toMatch(/place the fire/i);
});

it("an unreadable fire (no plane the matcher can use) and a failed run are reported, not previewed", async () => {
  vi.mocked(pictureTask).mockResolvedValueOnce(null as never);
  button(render(), /find/i)!.props.onClick();
  await settle();
  expect(onPreview).not.toHaveBeenCalled();
  expect(text(render())).toMatch(/too few/i);
  vi.mocked(pictureTask).mockRejectedValueOnce(new Error("decode broke"));
  button(render(), /find/i)!.props.onClick();
  await settle();
  expect(text(render())).toMatch(/decode broke/);
});
