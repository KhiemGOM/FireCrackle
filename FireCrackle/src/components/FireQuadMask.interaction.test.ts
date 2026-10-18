import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactElement } from "react";
import { DEFAULT_QUAD } from "../lib/quadMask";

// Run the component's event handlers without operating a browser or desktop.
const hooks = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>, states: [] as unknown[],
  refCursor: 0, stateCursor: 0, effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useId: () => "mask",
  useRef: (initial: unknown) => hooks.refs[hooks.refCursor++] ??= { current: initial },
  useState: (initial: unknown) => {
    const i = hooks.stateCursor++;
    if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (value: unknown) => { hooks.states[i] = value; }];
  },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (setup: () => void | (() => void)) => { hooks.effects.push(setup); },
}));
import { FireQuadMask } from "./FireQuadMask";

type Element = ReactElement<Record<string, any>>;
function find(node: Element, type: string): Element[] {
  const children = [node.props.children].flat(Infinity).filter((child): child is Element => !!child && typeof child === "object" && "props" in child);
  return [...(node.type === type ? [node] : []), ...children.flatMap((child) => find(child, type))];
}
let cleanup: void | (() => void);
const onQuad = vi.fn();
function render(zoom = 1, matrixScale = 2) {
  cleanup?.();
  hooks.refCursor = hooks.stateCursor = 0;
  hooks.effects = [];
  const tree = FireQuadMask({ width: 100, height: 100, sheet: 0, row: 0, mirrored: false, opacity: 1, quad: DEFAULT_QUAD, onQuad, zoom });
  Object.assign(hooks.refs[0].current ??= {}, { getScreenCTM: () => ({ a: matrixScale, b: 0, c: 0, d: matrixScale, e: 100, f: 50 }) });
  // Texture decoding is independent; execute only interaction listener setup.
  cleanup = hooks.effects[1]();
  return { svg: find(tree, "svg")[0], corners: find(tree, "circle").filter(p => p.props.className?.startsWith("fire-quad-handle")), edge: find(tree, "polygon")[0], handles: find(tree, "rect").filter(p => p.props.className === "quad-transform-handle"), rotation: find(tree, "g").find(p => p.props.className === "quad-rotate-handle") };
}
function pointer(clientX: number, clientY: number, ctrlKey = false) {
  return { button: 0, pointerId: 1, clientX, clientY, ctrlKey, preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { setPointerCapture: vi.fn() } };
}
function dispatch(type: string, fields: Record<string, unknown>) {
  const event = Object.assign(new Event(type, { cancelable: true }), fields);
  window.dispatchEvent(event);
  return event;
}
beforeEach(() => {
  hooks.refs = []; hooks.states = []; onQuad.mockClear();
  const target = new EventTarget();
  // Node's boolean capture handling differs from browser removeEventListener.
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: EventListener, capture = false) => target.addEventListener(type, listener, { capture }),
    removeEventListener: (type: string, listener: EventListener, capture = false) => target.removeEventListener(type, listener, { capture }),
    dispatchEvent: (event: Event) => target.dispatchEvent(event),
  });
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); });

it('does not project stale pixels with a different atlas size before its load effect runs',()=>{
 hooks.states[1]={source:'/animation-atlases/soul_fire_0.png',rgba:new Uint8ClampedArray(16*16*32*4)};
 hooks.refCursor=hooks.stateCursor=0;hooks.effects=[];
 expect(()=>FireQuadMask({atlas:'lava_still',width:100,height:100,sheet:0,row:19,mirrored:false,opacity:1,quad:DEFAULT_QUAD,onQuad})).not.toThrow();
 hooks.refCursor=hooks.stateCursor=0;hooks.effects=[];
 hooks.states[1]={source:'/animation-atlases/lava_still.png',rgba:new Uint8ClampedArray(16*16*20*4)};
 expect(()=>FireQuadMask({atlas:'lava_flow',width:100,height:100,sheet:1,row:15,mirrored:false,opacity:1,quad:DEFAULT_QUAD,onQuad})).not.toThrow();
});

describe("manual quad controls", () => {
  it("keeps an off-centre grab still on press and preserves its offset while dragging", () => {
    const mask = render();
    // Corner centre is (160, 90), but the pointer hits its eight-pixel handle edge.
    mask.corners[0].props.onPointerDown(pointer(166, 94));
    mask.svg.props.onPointerMove(pointer(166, 94));
    expect(onQuad).not.toHaveBeenCalled();
    mask.svg.props.onPointerMove(pointer(176, 104));
    const moved = onQuad.mock.calls[0][0];
    expect(moved[0][0]).toBeCloseTo(0.35);
    expect(moved[0][1]).toBeCloseTo(0.25);
    expect(moved.slice(1)).toEqual(DEFAULT_QUAD.slice(1));
  });

  it("freezes the screen transform through capture and layout changes", () => {
    const mask = render();
    mask.corners[0].props.onPointerDown(pointer(160, 90));
    // A WebView layout/scroll update must not change this gesture's coordinate frame.
    Object.assign(hooks.refs[0].current as object, { getScreenCTM: () => ({a:4,b:0,c:0,d:4,e:500,f:600}) });
    mask.svg.props.onPointerMove(pointer(170, 100));
    expect(onQuad.mock.calls[0][0][0][0]).toBeCloseTo(0.35);
    expect(onQuad.mock.calls[0][0][0][1]).toBeCloseTo(0.25);
  });

  it("ignores another pointer and ends the drag when capture is lost", () => {
    const mask = render();
    mask.corners[0].props.onPointerDown(pointer(160, 90));
    mask.svg.props.onPointerMove({...pointer(220, 130),pointerId:2});
    mask.svg.props.onPointerUp({...pointer(220, 130),pointerId:2});
    expect(onQuad).not.toHaveBeenCalled();
    mask.svg.props.onPointerMove(pointer(170, 100));
    expect(onQuad).toHaveBeenCalledTimes(1);
    mask.svg.props.onLostPointerCapture(pointer(170, 100));
    mask.svg.props.onPointerMove(pointer(180, 110));
    expect(onQuad).toHaveBeenCalledTimes(1);
  });

  it("captures Shift before focused toolbar controls can stop bubbling", () => {
    const bind = vi.spyOn(window, "addEventListener");
    render();
    expect(bind).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    expect(bind).toHaveBeenCalledWith("keyup", expect.any(Function), true);
    dispatch("keydown", { key: "Shift", shiftKey: true });
    expect(render().handles).toHaveLength(8);
    dispatch("keyup", { key: "Shift", shiftKey: false });
    expect(render().corners).toHaveLength(4);
  });

  it("recovers a held Shift after overlay mount without receiving the keydown", () => {
    render();
    dispatch("pointermove", { shiftKey: true });
    let mask = render();
    expect(mask.handles).toHaveLength(8);
    expect(mask.corners).toHaveLength(0);
    dispatch("pointermove", { shiftKey: false });
    mask = render();
    expect(mask.handles).toHaveLength(0);
    expect(mask.corners).toHaveLength(4);
  });

  it("routes edge resize and rotation handles separately from vertex edits", () => {
    render(); dispatch("keydown", { key: "Shift", shiftKey: true });
    let mask = render();
    mask.handles[3].props.onPointerDown(pointer(240, 150));
    mask.svg.props.onPointerMove(pointer(280, 150));
    DEFAULT_QUAD.forEach(([x, y], i) => {
      expect(onQuad.mock.calls[0][0][i][0]).toBeCloseTo(0.3 + (x - 0.3) * 1.5);
      expect(onQuad.mock.calls[0][0][i][1]).toBe(y);
    });
    mask.svg.props.onPointerUp(pointer(280, 150));
    mask = render(); onQuad.mockClear();
    mask.rotation!.props.onPointerDown(pointer(200, 50));
    mask.svg.props.onPointerMove(pointer(100, 150));
    expect(onQuad.mock.calls[0][0][0][0]).toBeCloseTo(0.2);
    expect(onQuad.mock.calls[0][0][0][1]).toBeCloseTo(0.7);
  });

  it("Shift replaces vertices with box controls and a corner scales the entire quad", () => {
    render();
    dispatch("keydown", { key: "Shift", shiftKey: true });
    let mask = render();
    expect(mask.corners).toHaveLength(0);
    expect(mask.handles).toHaveLength(8);
    mask.handles[4].props.onPointerDown(pointer(240, 210));
    mask.svg.props.onPointerMove(pointer(280, 270));
    const next = onQuad.mock.calls[0][0];
    expect(next[0]).toEqual(DEFAULT_QUAD[0]);
    DEFAULT_QUAD.forEach(([x, y], i) => {
      expect(next[i][0]).toBeCloseTo(0.3 + (x - 0.3) * 1.5);
      expect(next[i][1]).toBeCloseTo(0.2 + (y - 0.2) * 1.5);
    });
    dispatch("keyup", { key: "Shift", shiftKey: false });
    mask = render();
    expect(mask.handles).toHaveLength(8); // Finish an in-flight drag even after releasing Shift.
    mask.svg.props.onPointerUp(pointer(280, 270));
    mask = render();
    expect(mask.handles).toHaveLength(0);
    expect(mask.corners).toHaveLength(4);
  });

  it("keeps handles at eight screen pixels through zoom and fitted-image resizing", () => {
    let resized = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
      disconnect = disconnect;
    });
    for (const [zoom, fit] of [[1, 0.5], [2.46, 0.5], [0.1, 0.25], [10, 1]]) {
      const scale = zoom * fit;
      render(zoom, scale);
      const stop = hooks.effects[2]();
      let mask = render(zoom, scale);
      expect(mask.corners[0].props.r * scale).toBeCloseTo(8);
      expect(mask.corners[0].props.strokeWidth * scale).toBeCloseTo(2);
      expect(mask.edge.props.strokeWidth * scale).toBeCloseTo(2);
      render(zoom, scale / 2);
      resized();
      mask = render(zoom, scale / 2);
      expect(mask.corners[0].props.r * scale / 2).toBeCloseTo(8);
      expect(mask.edge.props.strokeWidth * scale / 2).toBeCloseTo(2);
      stop?.();
    }
    expect(disconnect).toHaveBeenCalledTimes(4);
  });

  it("places a selected corner only on Alt+click, including outside the image", () => {
    let mask = render();
    mask.corners[0].props.onPointerDown(pointer(160, 90));
    mask.svg.props.onPointerUp(pointer(160, 90));
    mask = render();
    dispatch("keydown", { key: "Alt", altKey: true });
    dispatch("pointermove", { clientX: 60, clientY: 30, altKey: true });
    dispatch("mousemove", { clientX: 60, clientY: 30, altKey: true });
    expect(onQuad).not.toHaveBeenCalled();
    expect(dispatch("click", { button: 0, clientX: 60, clientY: 30, altKey: true }).defaultPrevented).toBe(true);
    expect(onQuad).toHaveBeenCalledExactlyOnceWith([[-0.2, -0.1], ...DEFAULT_QUAD.slice(1)]);
    dispatch("mousemove", { clientX: 0, clientY: 0, altKey: true });
    expect(onQuad).toHaveBeenCalledTimes(1);
    dispatch("keydown", { key: "Escape" });
    render();
    dispatch("click", { button: 0, clientX: 0, clientY: 0, altKey: true });
    expect(onQuad).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+drag translates every corner using the video transform", () => {
    const mask = render();
    mask.corners[0].props.onPointerDown(pointer(160, 90, true));
    mask.svg.props.onPointerMove(pointer(360, 290, true));
    const moved = onQuad.mock.calls[0][0];
    DEFAULT_QUAD.forEach(([x, y], i) => {
      expect(moved[i][0]).toBeCloseTo(x + 1);
      expect(moved[i][1]).toBeCloseTo(y + 1);
    });
  });
});
