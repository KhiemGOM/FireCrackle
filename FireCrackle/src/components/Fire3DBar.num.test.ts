// The 3D quad bar's number boxes (corner and fire x y z, camera values): typed freely, applied when done.
// Typing "-" or clearing the box used to snap straight back to the old value, so negative numbers could not be typed.
import { expect, it, vi } from "vitest";
import type { ReactElement } from "react";
vi.mock("./Fire3DBar.css", () => ({}));
import { Num } from "./Fire3DBar";

type Element = ReactElement<Record<string, any>>;
function find(node: Element | null, test: (e: Element) => boolean): Element | undefined {
  if (!node) return undefined;
  if (test(node)) return node;
  for (const child of [node.props.children].flat(Infinity)) if (child && typeof child === "object" && "props" in child) { const m = find(child as Element, test); if (m) return m; }
}
function box(value: number, over: { int?: boolean; step?: number } = {}) {
  const onChange = vi.fn<(v: number) => void>();
  const el = find(Num({ label: "x", value, onChange, ...over }) as Element, e => e.type === "input")!;
  return { el, onChange };
}
/** What the browser hands the handlers: the input with what the user typed in it. */
const target = (value: string) => ({ value, blur: vi.fn() });
const key = (k: string, t: ReturnType<typeof target>) => ({ key: k, target: t, currentTarget: t, preventDefault: vi.fn() });

it("typing changes nothing until the edit is done: '-', an empty box and '1.' are allowed while typing", () => {
  const { el, onChange } = box(0, { int: true });
  expect(el.props.value).toBeUndefined(); // not held to the last good number on every key
  expect(el.props.defaultValue).toBe("0");
  for (const typed of ["-", "", "-1", "1."]) el.props.onChange?.({ target: target(typed), currentTarget: target(typed) });
  expect(onChange).not.toHaveBeenCalled();
});

it("leaving the box applies a negative whole number", () => {
  const { el, onChange } = box(0, { int: true });
  el.props.onBlur({ target: target("-12"), currentTarget: target("-12") });
  expect(onChange).toHaveBeenCalledExactlyOnceWith(-12);
});

it("Enter applies; whole-number boxes drop the fraction, others keep it", () => {
  const a = box(0, { int: true }), t = target("-3.7");
  a.el.props.onKeyDown(key("Enter", t));
  expect(t.blur).toHaveBeenCalled(); // and the blur applies it
  a.el.props.onBlur({ target: t, currentTarget: t });
  expect(a.onChange).toHaveBeenCalledExactlyOnceWith(-3);
  const b = box(0.715, { step: 0.01 });
  expect(b.el.props.defaultValue).toBe("0.715");
  b.el.props.onBlur({ target: target("-1.202"), currentTarget: target("-1.202") });
  expect(b.onChange).toHaveBeenCalledExactlyOnceWith(-1.202);
});

it("a box left with no number, or Escape, goes back to the last value without applying", () => {
  for (const typed of ["-", "", "abc"]) {
    const { el, onChange } = box(5, { int: true }), t = target(typed);
    el.props.onBlur({ target: t, currentTarget: t });
    expect(onChange).not.toHaveBeenCalled();
    expect(t.value).toBe("5");
  }
  const { el, onChange } = box(5, { int: true }), t = target("-9");
  el.props.onKeyDown(key("Escape", t));
  expect(t.value).toBe("5");
  el.props.onBlur({ target: t, currentTarget: t });
  expect(onChange).not.toHaveBeenCalled();
});

it("the same value left as it was is not applied again", () => {
  const { el, onChange } = box(7, { int: true });
  el.props.onBlur({ target: target("7"), currentTarget: target("7") });
  expect(onChange).not.toHaveBeenCalled();
});

it("arrow-key steps apply at once, so the camera and fire follow the stepping", () => {
  const { el, onChange } = box(2, { int: true }), t = target("3"); // the browser has already stepped it
  el.props.onKeyUp(key("ArrowUp", t));
  expect(onChange).toHaveBeenCalledExactlyOnceWith(3);
});

it("a new value from outside (a solve, a click) shows in the box", () => {
  expect(box(1).el.key).not.toBe(box(2).el.key);
  expect(box(NaN).el.props.defaultValue).toBe("");
});

it("the box owns Enter and the arrows, so Label's global Enter (save and advance) does not take them first", () => {
  expect(box(0).el.props["data-owns-keys"]).toBe("true");
});
