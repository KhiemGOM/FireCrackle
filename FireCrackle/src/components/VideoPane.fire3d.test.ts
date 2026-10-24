// The 3D quad draws with the quad mask's sprite, so the sprite picker drives it the same way; and it is one of the
// picture overlays: switching on another (matcher, animation, first-person) switches it off, as Q already does.
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
import { ANIMATION_ATLASES } from "../lib/animationAtlases";
import type { PreviewSprite } from "../lib/firePreview";

type Element = ReactElement<Record<string, any>>;
const ref: { current: { selectSprite(s: PreviewSprite): boolean } | null } = { current: null };
async function tree() {
  hooks.stateCursor = hooks.refCursor = 0;
  hooks.effects = [];
  const backend = createMockBackend();
  return VideoPane({ backend, view: await backend.view(), onError: vi.fn(), previewRef: ref as never }) as Element;
}
function find(node: Element, label: string): Element | undefined {
  if (node.props.label === label || node.props["aria-label"] === label) return node;
  // the 3D bar gets the sprite controls as its `sprite` prop
  for (const child of [node.props.children, node.props.sprite].flat(Infinity)) {
    if (child && typeof child === "object" && "props" in child) { const m = find(child as Element, label); if (m) return m; }
  }
}
const pressed = (root: Element, label: string) => find(root, label)!.props["aria-pressed"];
async function with3D() { let root = await tree(); find(root, "Toggle 3D quad")!.props.onClick(); root = await tree(); expect(pressed(root, "Toggle 3D quad")).toBe(true); return root; }
beforeEach(() => { hooks.states = []; hooks.refs = []; ref.current = null; vi.stubGlobal("document", { querySelector: () => null }); });

it("a sprite picked in the atlas becomes the 3D quad's sprite, as it does the quad mask's", async () => {
  await with3D();
  expect(ref.current!.selectSprite({ sheet: 0, row: 9, mirrored: true })).toBe(true);
  const root = await tree();
  expect(find(root, "Manual mask row")!.props.value).toBe(9);
  expect(find(root, "Manual mask sheet")!.props.value).toBe(0);
  expect(pressed(root, "Toggle 3D quad")).toBe(true);
  expect(pressed(root, "Toggle manual fire quad mask")).toBe(false);
});

it("an animation-atlas sprite picked while the 3D quad is on stays in the 3D quad (the quad mask is not switched on)", async () => {
  await with3D();
  const atlas = Object.keys(ANIMATION_ATLASES)[0] as PreviewSprite["atlas"];
  expect(ref.current!.selectSprite({ atlas, sheet: 0, row: 0, mirrored: false })).toBe(true);
  const root = await tree();
  expect(pressed(root, "Toggle 3D quad")).toBe(true);
  expect(pressed(root, "Toggle manual fire quad mask")).toBe(false);
});

it("with no sprite overlay on, a picked sprite still changes nothing (as before)", async () => {
  await tree();
  expect(ref.current!.selectSprite({ sheet: 0, row: 9, mirrored: true })).toBe(false);
});

for (const other of ["Toggle sprite matching tool", "Toggle sprite animation tool", "Toggle first-person fire"]) {
  it(`switching on another picture overlay (${other}) switches the 3D quad off`, async () => {
    const root = await with3D();
    find(root, other)!.props.onClick();
    expect(pressed(await tree(), "Toggle 3D quad")).toBe(false);
  });
}

it("while the 3D quad is on, the picker is told its sprite (not 'mask off'), and follows a new pick", async () => {
  const onPreviewChange = vi.fn();
  const render = async () => {
    hooks.stateCursor = hooks.refCursor = 0; hooks.effects = [];
    const backend = createMockBackend();
    const root = VideoPane({ backend, view: await backend.view(), onError: vi.fn(), previewRef: ref as never, onPreviewChange }) as Element;
    // only the effects that tell the picker its preview (the others need a browser)
    for (const effect of hooks.effects) if (String(effect).includes("onPreviewChange")) effect();
    return root;
  };
  let root = await render();
  find(root, "Toggle 3D quad")!.props.onClick();
  await render();
  ref.current!.selectSprite({ sheet: 1, row: 12, mirrored: false });
  await render();
  expect(onPreviewChange.mock.calls[onPreviewChange.mock.calls.length - 1][0]).toMatchObject({ sheet: 1, row: 12, mirrored: false });
});
