// Match with first-person fire on: the production first-person labeller (the POV scan's, run on this one native
// frame by the backend) gives the row and FOV, and up to three rows to try, like the sprite matcher does for the quad.
import { beforeEach, expect, it, vi } from "vitest";
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
  useImperativeHandle: (ref: unknown, create: () => unknown) => { if (ref && typeof ref === "object") (ref as { current: unknown }).current = create(); },
}));
vi.mock("../hooks/useWheel", () => ({ useWheel: () => {} }));
import { VideoPane } from "./VideoPane";
import { createMockBackend } from "../lib/mock";
import type { Backend, FrameMatch } from "../lib/api";

type Element = ReactElement<Record<string, any>>;
let backend: Backend, onError: ReturnType<typeof vi.fn<(message: string) => void>>, current = 0;
async function tree() {
  hooks.stateCursor = hooks.refCursor = 0;
  hooks.effects = [];
  const view = await backend.view();
  current = view.current;
  return VideoPane({ backend, view, onError }) as Element;
}
function find(node: Element, label: string): Element | undefined {
  if (node.props.label === label || node.props["aria-label"] === label) return node;
  for (const child of [node.props.children].flat(Infinity)) {
    if (child && typeof child === "object" && "props" in child) { const m = find(child as Element, label); if (m) return m; }
  }
}
const text = (node: unknown): string => node === null || node === undefined || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text((node as Element).props?.children);
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const accepted: FrameMatch = { row: 12, fov: 60, candidates: [
  { row: 12, fov: 60, evidence: 0.8, accepted: true }, { row: 13, fov: 70, evidence: 0.31, accepted: false }, { row: 4, fov: 70, evidence: 0.2, accepted: false }] };
async function withFirstPerson() {
  const root = await tree();
  find(root, "Toggle first-person fire")!.props.onClick();
  return tree();
}
beforeEach(() => {
  hooks.states = []; hooks.refs = []; vi.stubGlobal("document", { querySelector: () => null });
  backend = { ...createMockBackend(), povMatch: vi.fn(async () => accepted) };
  onError = vi.fn<(message: string) => void>();
});

it("with first-person fire on, Match runs the first-person labeller on this frame and shows its row and FOV", async () => {
  let root = await withFirstPerson();
  find(root, "Toggle sprite matching tool")!.props.onClick();
  expect(backend.povMatch).toHaveBeenCalledWith(current);
  await settle();
  root = await tree();
  expect(find(root, "HUD animation index")!.props.value).toBe(12);
  expect(find(root, "HUD view")!.props.value).toBe(60);
  expect(find(root, "Toggle first-person fire")!.props["aria-pressed"]).toBe(true);
  expect(find(root, "Toggle manual fire quad mask")!.props["aria-pressed"]).toBe(false);
  expect(text(find(root, "First-person match"))).toMatch(/row 12 · 60°/);
});

it("Match is turned on, with first-person's own matching row (not in its bar); Find runs it again; Match again turns it off", async () => {
  let root = await withFirstPerson();
  expect(find(root, "First-person match settings")).toBeUndefined();
  find(root, "Toggle sprite matching tool")!.props.onClick();
  await settle();
  root = await tree();
  expect(find(root, "Toggle sprite matching tool")!.props["aria-pressed"]).toBe(true);
  const row = find(root, "First-person match settings")!;
  expect(find(row, "First-person match")).toBeDefined();
  expect(find(find(root, "First-person fire settings")!, "First-person match")).toBeUndefined();
  // the shared Match panel, tailored: details, but no sprite filter or mask changes (it matches a row and an FOV)
  expect(find(row, "Match details")).toBeDefined();
  expect(find(row, "Only filtered sprites")).toBeUndefined();
  expect(find(row, "Adjust quad while matching")).toBeUndefined();
  expect(find(row, "First-person match 1: row 12, 60°")!.props.children).toBe(1);
  find(row, "Find first-person match")!.props.onClick();
  expect(backend.povMatch).toHaveBeenCalledTimes(2);
  await settle();
  root = await tree();
  find(root, "Toggle sprite matching tool")!.props.onClick();
  root = await tree();
  expect(find(root, "Toggle sprite matching tool")!.props["aria-pressed"]).toBe(false);
  expect(find(root, "First-person match settings")).toBeUndefined();
  expect(backend.povMatch).toHaveBeenCalledTimes(2);
  expect(find(root, "Toggle first-person fire")!.props["aria-pressed"]).toBe(true);
});

it("its other rows are offered; picking one shows that row and FOV", async () => {
  let root = await withFirstPerson();
  find(root, "Toggle sprite matching tool")!.props.onClick();
  await settle();
  root = await tree();
  find(root, "First-person match 2: row 13, 70°")!.props.onClick();
  root = await tree();
  expect(find(root, "HUD animation index")!.props.value).toBe(13);
  expect(find(root, "HUD view")!.props.value).toBe(70);
});

it("when the labeller accepts nothing the row is left as it was, and the match says so", async () => {
  backend.povMatch = vi.fn(async () => ({ row: null, fov: null, candidates: accepted.candidates.map(c => ({ ...c, accepted: false })) }));
  let root = await withFirstPerson();
  const before = find(root, "HUD animation index")!.props.value;
  find(root, "Toggle sprite matching tool")!.props.onClick();
  await settle();
  root = await tree();
  expect(find(root, "HUD animation index")!.props.value).toBe(before);
  expect(text(find(root, "First-person match"))).toMatch(/No first-person fire/);
});

it("a failed match is reported", async () => {
  backend.povMatch = vi.fn(async () => { throw new Error("ffmpeg failed"); });
  const root = await withFirstPerson();
  find(root, "Toggle sprite matching tool")!.props.onClick();
  await settle();
  expect(onError).toHaveBeenCalledWith(expect.stringMatching(/First-person match.*ffmpeg failed/));
});

it("without first-person fire, Match still opens the sprite matcher on the quad mask", async () => {
  const root = await tree();
  find(root, "Toggle sprite matching tool")!.props.onClick();
  const after = await tree();
  expect(backend.povMatch).not.toHaveBeenCalled();
  expect(find(after, "Toggle manual fire quad mask")!.props["aria-pressed"]).toBe(true);
});
