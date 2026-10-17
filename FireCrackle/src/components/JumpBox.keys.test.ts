import { expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const hooks = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], si: 0, ri: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = hooks.si++;
    if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (next: any) => { hooks.states[i] = typeof next === "function" ? next(hooks.states[i]) : next; }];
  },
  useRef: (initial: unknown) => (hooks.refs[hooks.ri++] ??= { current: initial }),
  useEffect: () => {},
}));
vi.mock("./JumpBox.css", () => ({}));
import { JumpBox } from "./JumpBox";

type Element = ReactElement<Record<string, any>>;
function find(node: Element | null, test: (e: Element) => boolean): Element | undefined {
  if (!node) return undefined;
  if (test(node)) return node;
  for (const child of [node.props.children].flat(Infinity)) if (child && typeof child === "object" && "props" in child) { const m = find(child as Element, test); if (m) return m; }
}

it("the box marks itself as owning its keys, so the app's global Enter and arrows leave it alone", () => {
  const render = () => {
    hooks.si = hooks.ri = 0;
    return JumpBox({ current: 5, frameCount: 10, pts: 5 / 60, fps: 60, onJump: () => {} }) as Element;
  };
  find(render(), (e) => e.type === "button")!.props.onClick();
  const input = find(render(), (e) => e.type === "input")!;
  expect(input.props["data-owns-keys"]).toBe(true);
});
