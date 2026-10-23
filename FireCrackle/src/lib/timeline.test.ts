import { describe, expect, it } from "vitest";
import {
  grabsPlayhead,
  clampViewport,
  ensureVisible,
  fitViewport,
  formatTime,
  frameToX,
  pan,
  rulerTicks,
  thumbnailFrames,
  visibleRange,
  xToFrame,
  zoomAt,
  wheelViewport,
  type Viewport,
} from "./timeline";

const W = 1000;
const TOTAL = 10000;
const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("timeline wheel controls", () => {
  const vp = { start:100, pxPerFrame:2 };
  const wheel = (deltaY:number, ctrlKey=false, deltaX=0, deltaMode=0) =>
    wheelViewport(vp,{deltaY,deltaX,deltaMode,ctrlKey},200,1.25,32,W,TOTAL);
  it("scrolls forward/backward without zooming for an ordinary wheel", () => {
    expect(wheel(120)).toEqual({start:160,pxPerFrame:2});
    expect(wheel(-120)).toEqual({start:40,pxPerFrame:2});
  });
  it("supports horizontal trackpad scrolling and line/page wheel units", () => {
    expect(wheel(0,false,40).start).toBe(120);
    expect(wheel(3,false,0,1).start).toBe(124);
    expect(wheel(1,false,0,2).start).toBe(600);
  });
  it("zooms only with Ctrl and keeps the frame under the cursor fixed", () => {
    const next=wheel(-120,true);
    expect(next.pxPerFrame).toBe(2.5);
    expect(next.start+200/next.pxPerFrame).toBe(vp.start+200/vp.pxPerFrame);
    expect(wheel(120,true).pxPerFrame).toBe(1.6);
  });
  it("clamps scrolling at video edges and ignores empty wheel input", () => {
    expect(wheel(-1000)).toEqual({start:0,pxPerFrame:2});
    expect(wheel(0)).toEqual(vp);
  });
});

describe("fit and conversions", () => {
  it("fits the whole video in the width", () => {
    expect(fitViewport(TOTAL, W)).toEqual({ start: 0, pxPerFrame: 0.1 });
    const empty = fitViewport(0, W);
    expect(empty.start).toBe(0);
    expect(Number.isFinite(empty.pxPerFrame) && empty.pxPerFrame > 0).toBe(true);
  });

  it("converts frames to pixels and back", () => {
    const vp: Viewport = { start: 100, pxPerFrame: 2 };
    expect(frameToX(vp, 100)).toBe(0);
    expect(frameToX(vp, 150)).toBe(100);
    expect(frameToX(vp, 90)).toBe(-20);
    expect(xToFrame(vp, 100, TOTAL)).toBe(150);
    expect(xToFrame(vp, 101, TOTAL)).toBe(150); // inside frame 150 (x 100..102)
    expect(xToFrame(vp, 102, TOTAL)).toBe(151);
  });

  it("clamps the frame under the cursor to the video", () => {
    const vp: Viewport = { start: 0, pxPerFrame: 2 };
    expect(xToFrame(vp, -50, TOTAL)).toBe(0);
    expect(xToFrame({ start: 9990, pxPerFrame: 2 }, 5000, TOTAL)).toBe(TOTAL - 1);
    expect(xToFrame(vp, 10, 0)).toBe(0);
  });

  it("lists the frames that are on screen, inclusive and clamped", () => {
    expect(visibleRange({ start: 100, pxPerFrame: 2 }, W, TOTAL)).toEqual({ first: 100, last: 599 });
    expect(visibleRange({ start: 0, pxPerFrame: 0.1 }, W, TOTAL)).toEqual({ first: 0, last: TOTAL - 1 });
    expect(visibleRange({ start: 9900, pxPerFrame: 2 }, W, TOTAL)).toEqual({ first: 9900, last: TOTAL - 1 });
    expect(visibleRange({ start: 100.5, pxPerFrame: 2 }, W, TOTAL)).toEqual({ first: 100, last: 600 });
  });
});

describe("clamping", () => {
  it("keeps the start inside the video", () => {
    expect(clampViewport({ start: -50, pxPerFrame: 2 }, W, TOTAL).start).toBe(0);
    expect(clampViewport({ start: 99999, pxPerFrame: 2 }, W, TOTAL).start).toBe(TOTAL - W / 2);
  });

  it("never zooms out beyond fit-all", () => {
    expect(clampViewport({ start: 0, pxPerFrame: 0.01 }, W, TOTAL).pxPerFrame).toBe(0.1);
  });

  it("leaves a valid viewport alone", () => {
    const vp = { start: 123.5, pxPerFrame: 3 };
    expect(clampViewport(vp, W, TOTAL)).toEqual(vp);
  });

  it("handles a video shorter than the width at fit zoom", () => {
    const vp = clampViewport({ start: 5, pxPerFrame: 1 }, W, 10);
    expect(vp.pxPerFrame).toBe(100);
    expect(vp.start).toBe(0);
  });
});

describe("zoom at the cursor", () => {
  it("keeps the frame under the cursor fixed", () => {
    const fit = fitViewport(TOTAL, W);
    const z = zoomAt(fit, 500, 2, 32, W, TOTAL);
    near(z.pxPerFrame, 0.2);
    near(z.start, 2500);
    near(frameToX(z, 5000), 500);
  });

  it("keeps the anchor fixed away from the centre too (when nothing clamps)", () => {
    const vp: Viewport = { start: 3000, pxPerFrame: 1 };
    for (const anchor of [0, 123, 777, 999]) {
      const f = vp.start + anchor / vp.pxPerFrame;
      const z = zoomAt(vp, anchor, 1.25, 32, W, TOTAL);
      near(frameToX(z, f), anchor, 1e-6);
    }
  });

  it("stops at fit-all when zooming out", () => {
    const vp: Viewport = { start: 2500, pxPerFrame: 0.2 };
    const z = zoomAt(vp, 500, 0.01, 32, W, TOTAL);
    expect(z).toEqual({ start: 0, pxPerFrame: 0.1 });
  });

  it("stops at the maximum zoom", () => {
    const vp: Viewport = { start: 100, pxPerFrame: 30 };
    const z = zoomAt(vp, 500, 4, 32, W, TOTAL);
    expect(z.pxPerFrame).toBe(32);
  });

  it("stays inside the video when zooming at the very end", () => {
    const fit = fitViewport(TOTAL, W);
    const z = zoomAt(fit, W, 2, 32, W, TOTAL);
    near(z.start, TOTAL - W / z.pxPerFrame);
    expect(visibleRange(z, W, TOTAL).last).toBe(TOTAL - 1);
  });

  it("is undone by the opposite factor", () => {
    const vp: Viewport = { start: 4000, pxPerFrame: 1 };
    const back = zoomAt(zoomAt(vp, 400, 1.25, 32, W, TOTAL), 400, 1 / 1.25, 32, W, TOTAL);
    near(back.start, vp.start, 1e-6);
    near(back.pxPerFrame, vp.pxPerFrame, 1e-9);
  });

  it("ignores a factor that is not a positive finite number", () => {
    const vp: Viewport = { start: 100, pxPerFrame: 2 };
    for (const f of [0, -1, NaN, Infinity]) {
      expect(zoomAt(vp, 500, f, 32, W, TOTAL)).toEqual(vp);
    }
  });
});

describe("panning", () => {
  it("moves the content with the drag", () => {
    expect(pan({ start: 1000, pxPerFrame: 2 }, 100, W, TOTAL).start).toBe(950);
    expect(pan({ start: 1000, pxPerFrame: 2 }, -100, W, TOTAL).start).toBe(1050);
  });

  it("stops at both ends", () => {
    expect(pan({ start: 10, pxPerFrame: 2 }, 1000, W, TOTAL).start).toBe(0);
    expect(pan({ start: 9400, pxPerFrame: 2 }, -1000, W, TOTAL).start).toBe(TOTAL - W / 2);
  });

  it("does nothing when everything is visible", () => {
    const fit = fitViewport(TOTAL, W);
    expect(pan(fit, 300, W, TOTAL)).toEqual(fit);
  });
});

describe("following the playhead", () => {
  const vp: Viewport = { start: 0, pxPerFrame: 2 };

  it("scrolls right just enough to keep the margin", () => {
    const z = ensureVisible(vp, 600, W, TOTAL, 50);
    near(z.start, 125);
    near(frameToX(z, 600), 950);
  });

  it("scrolls left just enough", () => {
    const z = ensureVisible({ start: 500, pxPerFrame: 2 }, 400, W, TOTAL, 50);
    near(z.start, 375);
    near(frameToX(z, 400), 50);
  });

  it("leaves the viewport alone while the playhead is inside the margins", () => {
    const v = { start: 100, pxPerFrame: 2 };
    expect(ensureVisible(v, 300, W, TOTAL, 50)).toEqual(v);
  });

  it("clamps at the start and end of the video", () => {
    expect(ensureVisible({ start: 300, pxPerFrame: 2 }, 0, W, TOTAL, 50).start).toBe(0);
    expect(ensureVisible(vp, TOTAL - 1, W, TOTAL, 50).start).toBe(TOTAL - W / 2);
  });

  it("centres the frame when the margin is half the width or more", () => {
    const z = ensureVisible(vp, 700, W, TOTAL, 600);
    near(frameToX(z, 700), 500);
  });
});

describe("time formatting", () => {
  it("formats minutes and seconds", () => {
    expect(formatTime(0, 1)).toBe("0:00");
    expect(formatTime(65, 1)).toBe("1:05");
    expect(formatTime(600, 60)).toBe("10:00");
  });

  it("formats hours", () => {
    expect(formatTime(3600, 60)).toBe("1:00:00");
    expect(formatTime(3725, 1)).toBe("1:02:05");
  });

  it("adds decimals for sub-second steps", () => {
    expect(formatTime(1.5, 0.5)).toBe("0:01.5");
    expect(formatTime(1.05, 0.05)).toBe("0:01.05");
    expect(formatTime(0.2, 0.1)).toBe("0:00.2");
  });
});

describe("ruler", () => {
  it("picks the smallest nice step that keeps the labels apart", () => {
    // 10 minutes at 60 fps in 1200 px: 2 px per second, 80 px spacing needs >= 40 s -> 60 s
    const vp = fitViewport(36000, 1200);
    const t = rulerTicks(vp, 1200, 60, 80);
    expect(t.slice(0, 3).map((x) => x.label)).toEqual(["0:00", "1:00", "2:00"]);
    near(t[1].x, 120, 1e-6);
    expect(t.every((x) => x.x >= 0 && x.x <= 1200)).toBe(true);
  });

  it("zooms down to fractions of a second", () => {
    // 32 px per frame at 60 fps = 1920 px/s: 80 px spacing needs 0.05 s
    const vp: Viewport = { start: 0, pxPerFrame: 32 };
    const t = rulerTicks(vp, 1000, 60, 80);
    expect(t[0].label).toBe("0:00.00");
    expect(t[1].label).toBe("0:00.05");
    near(t[1].x - t[0].x, 96, 1e-6);
  });

  it("starts at the first multiple of the step inside the view", () => {
    const vp: Viewport = { start: 1234, pxPerFrame: 2 };
    const t = rulerTicks(vp, W, 60, 80);
    expect(t.length).toBeGreaterThan(2);
    expect(t.every((x) => x.x >= 0 && x.x <= W)).toBe(true);
    for (let i = 1; i < t.length; i++) expect(t[i].x).toBeGreaterThan(t[i - 1].x);
    const gaps = t.slice(1).map((x, i) => x.x - t[i].x);
    for (const g of gaps) near(g, gaps[0], 1e-6);
    expect(gaps[0]).toBeGreaterThanOrEqual(80 - 1e-6);
  });

  it("marks every fifth tick as major", () => {
    const t = rulerTicks(fitViewport(36000, 1200), 1200, 60, 40);
    expect(t.filter((x) => x.major).length).toBe(Math.ceil(t.length / 5));
    expect(t[0].major).toBe(true);
    expect(t[1].major).toBe(false);
  });

  it("is empty for a degenerate request", () => {
    const vp: Viewport = { start: 0, pxPerFrame: 1 };
    expect(rulerTicks(vp, 0, 60, 80)).toEqual([]);
    expect(rulerTicks(vp, 1000, 0, 80)).toEqual([]);
    expect(rulerTicks(vp, 1000, NaN, 80)).toEqual([]);
  });

  it("never produces more ticks than fit", () => {
    for (const px of [0.001, 0.1, 1, 32, 200]) {
      const t = rulerTicks({ start: 0, pxPerFrame: px }, 1000, 60, 80);
      expect(t.length).toBeLessThanOrEqual(Math.floor(1000 / 80) + 2);
    }
  });
});

describe("thumbnails", () => {
  it("picks one frame per slot at the slot centre", () => {
    const f = thumbnailFrames(fitViewport(TOTAL, 960), 960, 96, TOTAL);
    expect(f).toHaveLength(10);
    expect(f[0]).toBe(Math.floor(48 / 0.096));
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
  });

  it("stays inside the video and ascending when zoomed in", () => {
    const f = thumbnailFrames({ start: 5000, pxPerFrame: 32 }, 960, 96, TOTAL);
    expect(f).toHaveLength(10);
    expect(f.every((x) => x >= 5000 && x < TOTAL)).toBe(true);
    expect(f[1] - f[0]).toBe(3);
  });

  it("drops duplicate frames when a frame is wider than a thumbnail slot", () => {
    const f = thumbnailFrames({ start: 100, pxPerFrame: 200 }, 960, 96, TOTAL);
    expect(new Set(f).size).toBe(f.length);
    expect(f.length).toBeLessThan(10);
    expect(f.length).toBeGreaterThan(0);
  });

  it("is empty for an empty video and has at least one slot for a narrow view", () => {
    expect(thumbnailFrames({ start: 0, pxPerFrame: 1 }, 960, 96, 0)).toEqual([]);
    expect(thumbnailFrames(fitViewport(TOTAL, 50), 50, 96, TOTAL)).toHaveLength(1);
  });

  it("clamps frames at the end of a short video", () => {
    const f = thumbnailFrames({ start: 0, pxPerFrame: 100 }, 1000, 100, 3);
    expect(f.every((x) => x >= 0 && x <= 2)).toBe(true);
  });
});

describe("grabbing the playhead", () => {
  const vp = { start: 100, pxPerFrame: 2 }; // frame 150 is drawn at x = 100..102, centre 101
  it("a press on or near the playhead line grabs it", () => {
    expect(grabsPlayhead(vp, 150, 101, 6)).toBe(true);
    expect(grabsPlayhead(vp, 150, 106, 6)).toBe(true);
    expect(grabsPlayhead(vp, 150, 96, 6)).toBe(true);
  });
  it("a press further away pans or seeks as before", () => {
    expect(grabsPlayhead(vp, 150, 108, 6)).toBe(false);
    expect(grabsPlayhead(vp, 150, 20, 6)).toBe(false);
  });
  it("a playhead outside the visible part cannot be grabbed by a press at the edge", () => {
    expect(grabsPlayhead(vp, 10, 0, 6)).toBe(false);
  });
});
