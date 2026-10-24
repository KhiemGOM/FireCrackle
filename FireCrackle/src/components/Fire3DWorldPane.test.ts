// The 3D quad's overview pane starts collapsed every time (it is rarely needed yet); its width is still remembered.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }));
vi.mock("react", async original => ({ ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.states)) hooks.states[i] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [hooks.states[i], (v: unknown) => { hooks.states[i] = typeof v === "function" ? (v as (x: unknown) => unknown)(hooks.states[i]) : v; }]; },
}));
vi.mock("./FireWorldView", () => ({ FireWorldView: () => null }));
import { Fire3DWorldPane } from "./Fire3DWorldPane";
import type { Fire3D } from "../lib/useFire3D";

type El = ReactElement<Record<string, any>>;
let stored: Record<string, string>;
const render = () => { hooks.cursor = 0; return Fire3DWorldPane({ fire: { ready: true } as Fire3D }) as El; };
beforeEach(() => { hooks.states = []; stored = {}; vi.stubGlobal("localStorage", { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = v; } }); });
afterEach(() => vi.unstubAllGlobals());

it("starts collapsed, even when it was last left open", () => {
  stored["firecrackle.fire3d.side"] = JSON.stringify({ width: 480, collapsed: false });
  expect(render().props["aria-label"]).toBe("3D world (collapsed)");
});

it("opens with the remembered width", () => {
  stored["firecrackle.fire3d.side"] = JSON.stringify({ width: 480, collapsed: false });
  render().props.children.props.onClick();
  const open = render();
  expect(open.props["aria-label"]).toBe("3D world");
  expect(open.props.style.width).toBe(480);
});
