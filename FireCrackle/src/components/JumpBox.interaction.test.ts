import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const hooks = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], si: 0, ri: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = hooks.si++;
    if (!(i in hooks.states)) hooks.states[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
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
function text(node: Element | null): string {
  if (!node) return "";
  return [node.props.children].flat(Infinity).map((c: any) => (typeof c === "string" || typeof c === "number" ? String(c) : c && typeof c === "object" && "props" in c ? text(c) : "")).join("");
}

let onJump: ReturnType<typeof vi.fn<(frame: number) => void>>;
let locate: ReturnType<typeof vi.fn<(seconds: number) => Promise<number>>>;
function render(over: Partial<Parameters<typeof JumpBox>[0]> = {}): Element {
  hooks.si = hooks.ri = 0;
  return JumpBox({ current: 1234, frameCount: 10000, pts: 20 + 34 / 60, fps: 60, onJump, locate, ...over }) as Element;
}
const input = (t: Element) => find(t, (e) => e.type === "input");
const key = (k: string) => ({ key: k, stopPropagation: vi.fn(), preventDefault: vi.fn() });
async function settle() { for (let i = 0; i < 4; i++) await Promise.resolve(); }

beforeEach(() => {
  hooks.states = []; hooks.refs = [];
  onJump = vi.fn();
  locate = vi.fn(async () => 999);
});

it("shows the frame and the timecode as buttons, and no box", () => {
  const t = render();
  expect(text(t)).toContain("1234");
  expect(text(t)).toContain("00:20|34");
  expect(input(t)).toBeUndefined();
});

it("clicking the timecode opens the box with the timecode in it", () => {
  find(render(), (e) => e.type === "button" && text(e) === "00:20|34")!.props.onClick();
  expect(input(render())!.props.value).toBe("00:20|34");
});

it("clicking the frame opens the box with the frame number in it", () => {
  find(render(), (e) => e.type === "button" && text(e) === "1234")!.props.onClick();
  expect(input(render())!.props.value).toBe("1234");
});

it("Enter on a typed timecode jumps to the frame the backend finds, then closes", async () => {
  find(render(), (e) => e.type === "button" && text(e) === "1234")!.props.onClick();
  input(render())!.props.onChange({ target: { value: "00:00:16|39" } });
  input(render())!.props.onKeyDown(key("Enter"));
  await settle();
  expect(locate).toHaveBeenCalledWith(16 + 39 / 60);
  expect(onJump).toHaveBeenCalledWith(999);
  expect(input(render())).toBeUndefined();
});

it("Enter on a typed frame jumps there directly", async () => {
  find(render(), (e) => e.type === "button" && text(e) === "1234")!.props.onClick();
  input(render())!.props.onChange({ target: { value: "50" } });
  input(render())!.props.onKeyDown(key("Enter"));
  await settle();
  expect(onJump).toHaveBeenCalledWith(50);
  expect(locate).not.toHaveBeenCalled();
});

it("a bad entry shows why, keeps the box and the text, and does not jump", async () => {
  find(render(), (e) => e.type === "button" && text(e) === "1234")!.props.onClick();
  input(render())!.props.onChange({ target: { value: "12.5" } });
  input(render())!.props.onKeyDown(key("Enter"));
  await settle();
  const t = render();
  expect(onJump).not.toHaveBeenCalled();
  expect(input(t)!.props.value).toBe("12.5");
  expect(text(t)).toMatch(/HH:MM:SS\|FF/);
});

it("Escape closes without jumping", () => {
  find(render(), (e) => e.type === "button" && text(e) === "1234")!.props.onClick();
  input(render())!.props.onKeyDown(key("Escape"));
  expect(input(render())).toBeUndefined();
  expect(onJump).not.toHaveBeenCalled();
});

it("keys typed in the box never reach the app's shortcuts", () => {
  find(render(), (e) => e.type === "button" && text(e) === "1234")!.props.onClick();
  for (const k of ["ArrowRight", "m", " ", "1", "Enter", "Escape"]) {
    const ev = key(k);
    render();
    input(render())?.props.onKeyDown(ev);
    if (input(render()) || k === "Enter" || k === "Escape") expect(ev.stopPropagation).toHaveBeenCalled();
  }
});

it("a backend failure is shown, not swallowed", async () => {
  locate.mockImplementation(async () => { throw new Error("no such time"); });
  find(render(), (e) => e.type === "button" && text(e) === "1234")!.props.onClick();
  input(render())!.props.onChange({ target: { value: "00:00:01|00" } });
  input(render())!.props.onKeyDown(key("Enter"));
  await settle();
  expect(text(render())).toContain("no such time");
  expect(onJump).not.toHaveBeenCalled();
});

it("opened from the timecode, bare digits are a time; opened from the frame, they are a frame", async () => {
  find(render(), (e) => e.type === "button" && text(e) === "00:20|34")!.props.onClick();
  input(render())!.props.onChange({ target: { value: "1015" } });
  input(render())!.props.onKeyDown(key("Enter"));
  await settle();
  expect(locate).toHaveBeenCalledWith(10 + 15 / 60);
  expect(onJump).toHaveBeenCalledWith(999);
  onJump.mockClear(); locate.mockClear();
  hooks.states = []; hooks.refs = [];
  find(render(), (e) => e.type === "button" && text(e) === "1234")!.props.onClick();
  input(render())!.props.onChange({ target: { value: "1015" } });
  input(render())!.props.onKeyDown(key("Enter"));
  await settle();
  expect(onJump).toHaveBeenCalledWith(1015);
  expect(locate).not.toHaveBeenCalled();
});

it("the box is as wide as its text, so a timecode does not leave a gap", () => {
  find(render(), (e) => e.type === "button" && text(e) === "00:20|34")!.props.onClick();
  expect(input(render())!.props.style.width).toBe("8ch");
  input(render())!.props.onChange({ target: { value: "1015" } });
  expect(input(render())!.props.style.width).toBe("4ch");
});

it("a video of an hour or more keeps the hour part; a shorter one has none", () => {
  expect(text(render())).toContain("00:20|34");
  expect(text(render())).not.toContain("00:00:20|34");
  const long = render({ frameCount: 300000, pts: 3725.5 });
  expect(text(long)).toContain("01:02:05|30");
  find(long, (e) => e.type === "button" && text(e) === "01:02:05|30")!.props.onClick();
  expect(input(render({ frameCount: 300000, pts: 3725.5 }))!.props.value).toBe("01:02:05|30");
});

it("a short video's box is prefilled without the hour part", () => {
  find(render(), (e) => e.type === "button" && text(e) === "00:20|34")!.props.onClick();
  expect(input(render())!.props.value).toBe("00:20|34");
});
