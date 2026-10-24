import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  PANEL_ZOOM,
  clampView,
  panView,
  parseZooms,
  serializeZooms,
  wheelFactor,
  zoomAt,
  zoomPanel,
  DEFAULT_ZOOMS,
  rotateView,
  rotationDelta,
} from "./zoom";

const BOX = { w: 1000, h: 500 };

describe("video rotation", () => {
  const screen = (v: { scale: number; x: number; y: number; angle?: number }, x: number, y: number) => {
    const a = (v.angle ?? 0) * Math.PI / 180;
    return [v.x + v.scale * (Math.cos(a) * x - Math.sin(a) * y), v.y + v.scale * (Math.sin(a) * x + Math.cos(a) * y)];
  };
  it("keeps the exact Shift cursor anchor fixed at arbitrary zoom, pan and angle", () => {
    const start = { scale: 3.4, x: -700, y: 230, angle: 27 };
    const [px, py] = screen(start, 125, 76);
    const next = rotateView(start, px, py, 83);
    expect(next.scale).toBe(start.scale);
    expect(next.angle).toBe(110);
    expect(screen(next, 125, 76)[0]).toBeCloseTo(px, 8);
    expect(screen(next, 125, 76)[1]).toBeCloseTo(py, 8);
    const back = rotateView(next, px, py, -83);
    expect(back.x).toBeCloseTo(start.x, 8);
    expect(back.y).toBeCloseTo(start.y, 8);
  });
  it("preserves rotation during pan and keeps cursor fixed while zooming", () => {
    const start = { scale: 2, x: 30, y: -90, angle: -54 };
    const [px, py] = screen(start, 42, 180);
    const next = zoomAt(start, px, py, 1.6, BOX);
    expect(next.angle).toBe(-54);
    expect(screen(next, 42, 180)[0]).toBeCloseTo(px, 8);
    expect(screen(next, 42, 180)[1]).toBeCloseTo(py, 8);
    expect(panView(next, 20, 30, BOX).angle).toBe(-54);
  });
  it("reset removes rotation while preserving scale and content at the pane center", () => {
    const start = { scale: 4, x: -300, y: 600, angle: 153 };
    const reset = rotateView(start, 500, 250, -start.angle);
    expect(reset.angle).toBe(0);
    expect(reset.scale).toBe(4);
    const restored = rotateView(reset, 500, 250, start.angle);
    expect(restored.x).toBeCloseTo(start.x, 8);
    expect(restored.y).toBeCloseTo(start.y, 8);
  });
  it("crosses the angular seam smoothly in either direction", () => {
    expect(rotationDelta(179 * Math.PI / 180, -179 * Math.PI / 180)).toBeCloseTo(2);
    expect(rotationDelta(-179 * Math.PI / 180, 179 * Math.PI / 180)).toBeCloseTo(-2);
    expect(rotateView(IDENTITY, NaN, 1, 4)).toBe(IDENTITY);
  });
});

describe("wheelFactor", () => {
  it("scrolling up (negative deltaY) zooms in, down zooms out", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
  });
  it("no scroll is no change", () => {
    expect(wheelFactor(0)).toBe(1);
  });
  it("opposite scrolls cancel out", () => {
    expect(wheelFactor(-120) * wheelFactor(120)).toBeCloseTo(1, 10);
  });
  it("one notch is a modest step and a huge delta is capped", () => {
    expect(wheelFactor(-100)).toBeLessThan(1.5);
    expect(wheelFactor(-1e6)).toBeLessThan(3);
    expect(wheelFactor(1e6)).toBeGreaterThan(0.3);
  });
  it("NaN is no change", () => {
    expect(wheelFactor(NaN)).toBe(1);
  });
});

describe("zoomPanel", () => {
  it("multiplies the scale and stays within the panel limits", () => {
    expect(zoomPanel(1, -100)).toBeGreaterThan(1);
    expect(zoomPanel(PANEL_ZOOM.max, -100)).toBe(PANEL_ZOOM.max);
    expect(zoomPanel(PANEL_ZOOM.min, 100)).toBe(PANEL_ZOOM.min);
  });
  it("repairs an out-of-range or NaN starting scale", () => {
    expect(zoomPanel(NaN, 0)).toBe(1);
    expect(zoomPanel(99, 0)).toBe(PANEL_ZOOM.max);
  });
});

describe("zoomAt (video)", () => {
  it("zooming in at the centre keeps the centre fixed", () => {
    const v = zoomAt(IDENTITY, 500, 250, 2, BOX);
    expect(v.scale).toBe(2);
    // the centre of the content is still at the centre of the pane
    expect(v.x).toBe(-500);
    expect(v.y).toBe(-250);
  });
  it("keeps the point under the cursor fixed (the defining property)", () => {
    const start = { scale: 2, x: -300, y: -100 };
    const px = 700;
    const py = 200;
    const cx = (px - start.x) / start.scale;
    const cy = (py - start.y) / start.scale;
    const v = zoomAt(start, px, py, 1.5, BOX);
    expect(cx * v.scale + v.x).toBeCloseTo(px, 6);
    expect(cy * v.scale + v.y).toBeCloseTo(py, 6);
  });
  it("zooms out below fit while keeping the cursor anchored", () => {
    const v = zoomAt({ scale: 1.2, x: -50, y: -20 }, 300, 100, 0.1, BOX);
    expect(v.scale).toBeCloseTo(0.12);
    expect(v.x).toBeCloseTo(265);
    expect(v.y).toBeCloseTo(88);
  });
  it("has no application zoom ceiling", () => {
    const v = zoomAt(IDENTITY, 0, 0, 1e6, BOX);
    expect(v.scale).toBe(1e6);
    expect(zoomAt(v, 0, 0, 2, BOX).scale).toBe(2e6);
  });
  it("has no application zoom-out floor", () => {
    let v = IDENTITY;
    for (let i = 0; i < 200; i++) v = zoomAt(v, 500, 250, 0.5, BOX);
    expect(v.scale).toBe(2 ** -200);
    expect(v.x).toBeCloseTo(500);
    expect(v.y).toBeCloseTo(250);
  });
  it("zooming in at the corner never exposes empty space", () => {
    const v = zoomAt(IDENTITY, 0, 0, 4, BOX);
    expect(v.x).toBeLessThanOrEqual(0);
    expect(v.x).toBeGreaterThanOrEqual(BOX.w - BOX.w * v.scale);
    const w = zoomAt(IDENTITY, BOX.w, BOX.h, 4, BOX);
    expect(w.x).toBeCloseTo(BOX.w - BOX.w * 4, 6);
    expect(w.y).toBeCloseTo(BOX.h - BOX.h * 4, 6);
  });
  it("an empty box or a NaN factor changes nothing and never produces NaN", () => {
    expect(zoomAt(IDENTITY, 0, 0, 2, { w: 0, h: 0 })).toEqual(IDENTITY);
    const v = zoomAt({ scale: 2, x: -10, y: -10 }, 5, 5, NaN, BOX);
    expect(Number.isNaN(v.scale + v.x + v.y)).toBe(false);
  });
});

describe("clampView / panView", () => {
  it("pans freely at fit and zoomed out", () => {
    expect(panView(IDENTITY, 80, -40, BOX)).toEqual({scale:1,x:80,y:-40});
    expect(panView({scale:0.25,x:0,y:0}, -80, 90, BOX)).toEqual({scale:0.25,x:-80,y:90});
  });
  it("panning moves the content with the pointer", () => {
    const v = panView({ scale: 2, x: -400, y: -100 }, 50, 20, BOX);
    expect(v).toEqual({ scale: 2, x: -350, y: -80 });
  });
  it("can pan past any video edge", () => {
    const v = panView({ scale: 2, x: -400, y: -100 }, 9999, 9999, BOX);
    expect(v.x).toBe(9599);
    expect(v.y).toBe(9899);
    const w = panView({ scale: 2, x: -400, y: -100 }, -9999, -9999, BOX);
    expect(w.x).toBe(-10399);
    expect(w.y).toBe(-10099);
  });
  it("preserves off-frame positioning after a resize", () => {
    const v = clampView({ scale: 2, x: -1800, y: -900 }, { w: 400, h: 200 });
    expect(v.x).toBe(-1800);
    expect(v.y).toBe(-900);
  });
  it("preserves any finite positive scale and repairs invalid values", () => {
    expect(clampView({ scale: 0.2, x: 5, y: 5 }, BOX)).toEqual({ scale:0.2,x:5,y:5 });
    expect(clampView({ scale: 999, x: 0, y: 0 }, BOX).scale).toBe(999);
    expect(clampView({ scale: NaN, x: Infinity, y: NaN }, BOX)).toEqual(IDENTITY);
    expect(clampView({ scale: 0, x: 0, y: 0 }, BOX)).toEqual(IDENTITY);
  });
  it("keeps finite coordinates at numeric overflow or underflow", () => {
    for (const scale of [Number.MAX_VALUE, Number.MIN_VALUE]) {
      const v = zoomAt({scale,x:0,y:0}, 200, 100, scale > 1 ? 2 : 0.5, BOX);
      expect(v.scale).toBeGreaterThan(0);
      expect([v.scale,v.x,v.y].every(Number.isFinite)).toBe(true);
    }
  });
});

describe("persisting panel zooms", () => {
  it("round-trips", () => {
    const z = { picker: 1.5, flags: 0.75 };
    expect(parseZooms(serializeZooms(z))).toEqual(z);
  });
  it("defaults when nothing or garbage is stored", () => {
    expect(parseZooms(null)).toEqual(DEFAULT_ZOOMS);
    expect(parseZooms("nope")).toEqual(DEFAULT_ZOOMS);
    expect(parseZooms("[1,2]")).toEqual(DEFAULT_ZOOMS);
  });
  it("clamps and repairs fields individually", () => {
    const z = parseZooms(JSON.stringify({ picker: 99, flags: "big" }));
    expect(z.picker).toBe(PANEL_ZOOM.max);
    expect(z.flags).toBe(DEFAULT_ZOOMS.flags);
  });
});

// ---- the picture stays where it is on screen when the video area changes size (the 3D overview opening, closing,
// being dragged or collapsed, or the window resizing): it was re-fitted and re-centred, so it jumped

import { anchorView } from "./zoom";

describe("anchorView", () => {
  const image = { w: 2560, h: 1440 };
  /** Screen point (relative to the video area's top-left) of native pixel (u, v) under view `v` in a `box`-sized area. */
  function screen(v: { scale: number; x: number; y: number; angle?: number }, box: { w: number; h: number }, u: number, w: number) {
    const fit = Math.min(box.w / image.w, box.h / image.h);
    const px = (box.w - image.w * fit) / 2 + u * fit, py = (box.h - image.h * fit) / 2 + w * fit;
    const a = ((v.angle ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return [v.x + v.scale * (c * px - s * py), v.y + v.scale * (s * px + c * py)];
  }
  const points: [number, number][] = [[0, 0], [2560, 1440], [1280, 300], [100, 1400]];
  const cases = [
    { from: { w: 1600, h: 600 }, to: { w: 1100, h: 600 }, view: { scale: 2.4, x: -300, y: -120 } },
    { from: { w: 1100, h: 600 }, to: { w: 1600, h: 600 }, view: { scale: 1, x: 0, y: 0 } },
    { from: { w: 1600, h: 600 }, to: { w: 900, h: 700 }, view: { scale: 5.2, x: -2400, y: -900, angle: 12 } },
  ];
  it("every picture pixel stays on the same screen point when the area is narrowed, widened or resized", () => {
    for (const { from, to, view } of cases) {
      const next = anchorView(view, from, to, image);
      for (const [u, w] of points) {
        const [a, b] = screen(view, from, u, w), [c, d] = screen(next, to, u, w);
        expect(c).toBeCloseTo(a, 6);
        expect(d).toBeCloseTo(b, 6);
      }
      expect(next.angle ?? 0).toBe(view.angle ?? 0);
    }
  });
  it("the same size, an empty area or an unknown picture changes nothing", () => {
    const v = { scale: 2, x: 10, y: 20 };
    expect(anchorView(v, { w: 800, h: 400 }, { w: 800, h: 400 }, image)).toEqual(v);
    expect(anchorView(v, { w: 0, h: 400 }, { w: 800, h: 400 }, image)).toEqual(v);
    expect(anchorView(v, { w: 800, h: 400 }, { w: 0, h: 0 }, image)).toEqual(v);
    expect(anchorView(v, { w: 800, h: 400 }, { w: 600, h: 400 }, { w: 0, h: 0 })).toEqual(v);
  });
});

// ---- whether any of the picture is on screen (a view restored at launch that shows none of it starts fitted)
import { pictureOnScreen } from "./zoom";
describe("pictureOnScreen", () => {
  const box = { w: 1600, h: 900 }, image = { w: 2560, h: 1440 };
  it("the fitted picture is; one panned wholly off any side is not", () => {
    expect(pictureOnScreen({ scale: 1, x: 0, y: 0 }, box, image)).toBe(true);
    expect(pictureOnScreen({ scale: 1, x: 1700, y: 0 }, box, image)).toBe(false);
    expect(pictureOnScreen({ scale: 1, x: -1700, y: 0 }, box, image)).toBe(false);
    expect(pictureOnScreen({ scale: 1, x: 0, y: 1000 }, box, image)).toBe(false);
    expect(pictureOnScreen({ scale: 1, x: 0, y: -1000 }, box, image)).toBe(false);
  });
  it("zoomed in with only a corner showing still is; zoomed in on empty space beyond it is not", () => {
    // 4×: the picture spans 0..6400 × 0..3600 on screen; panned so its bottom-right 100 px show
    expect(pictureOnScreen({ scale: 4, x: -6300, y: -3500 }, box, image)).toBe(true);
    expect(pictureOnScreen({ scale: 4, x: -6500, y: -3500 }, box, image)).toBe(false);
  });
  it("rotated, the turned picture is checked", () => {
    // turned 90° about the pane's top-left: the picture lies left of the pane unless moved back
    expect(pictureOnScreen({ scale: 1, x: 0, y: 0, angle: 90 }, box, image)).toBe(false);
    expect(pictureOnScreen({ scale: 1, x: 900, y: 0, angle: 90 }, box, image)).toBe(true);
  });
  it("an unknown picture or area counts as on screen (nothing to correct)", () => {
    expect(pictureOnScreen({ scale: 1, x: 99999, y: 0 }, { w: 0, h: 0 }, image)).toBe(true);
    expect(pictureOnScreen({ scale: 1, x: 99999, y: 0 }, box, { w: 0, h: 0 })).toBe(true);
  });
});
