import { expect, it } from "vitest";
import { denseRowRuler, phasePaintPoints } from "./phaseChartLod";
import { nearestPoint, type ChartPoint } from "./chart";

it("switches the screenshot's dense canonical ruler to an overview at actual canvas resolution", () => {
  expect(denseRowRuler(6223 / 20, 33280.64 / 20, 20, 2150)).toBe(true);
  expect(denseRowRuler(0, 10, 20, 1000)).toBe(false);
  expect(denseRowRuler(0, 320, 20, 1000)).toBe(true);
  expect(denseRowRuler(0, 320, 20, 2000)).toBe(false);
});

it("bounds overview painting while retaining row extrema, worst signed deviations and exact source evidence", () => {
  const points: ChartPoint[] = Array.from({ length: 100000 }, (_, i) => ({ frame: i, pts: i / 1000, step: 16, phase: .1 }));
  points[501].step = 0; points[502].step = 31;
  points[503].phase = 15; points[504].phase = 17; points[505].phase = 0;
  const options = { t0: 0, t1: 100, width: 100, kind: "row" as const, reference: 0, rulerPhase: 0 };
  const painted = phasePaintPoints(points, options);
  expect(painted.length).toBeLessThanOrEqual(50 * 7);
  for (const index of [0, 501, 502, 503, 504, 505, 99999]) expect(painted).toContain(points[index]);
  expect(points).toHaveLength(100000);
  expect(nearestPoint(points, points[507].pts)).toBe(points[507]);
  expect(phasePaintPoints(points, options)).toBe(painted);
  expect(phasePaintPoints(points, { ...options, t0: .5, t1: .51 })).toEqual(points.slice(500, 511));
});

it("includes both viewport boundaries and does not draw offscreen evidence", () => {
  const points = [0, 1, 2, 3].map(i => ({ frame: i, pts: i, phase: 0, step: i }));
  expect(phasePaintPoints(points, { t0: 1, t1: 2, width: 1000, kind: "phase", reference: 0 })).toEqual(points.slice(1, 3));
});

it("keeps exact flat clock holds and invalid viewports out of density mode", () => {
  expect(denseRowRuler(0, 100000, 0, 1000)).toBe(false);
  expect(denseRowRuler(1, 1, 20, 1000)).toBe(false);
  expect(denseRowRuler(0, 10, 20, 0)).toBe(false);
});
