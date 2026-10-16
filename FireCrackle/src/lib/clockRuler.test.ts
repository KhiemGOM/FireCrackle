import { describe, expect, it } from "vitest";
import type { ChartPoint, PhaseChart } from "./chart";
import {
  MAX_RAMPS, bestRulerMatch, chartReference, deviation, deviationLevel, deviationStats, idealRamps, idealStep, rulerPhase,
} from "./clockRuler";

const pt = (frame: number, pts: number, phase: number, step = 0): ChartPoint => ({ frame, pts, phase, step });
const chart = (patch: Partial<PhaseChart> = {}): PhaseChart => ({ points: [], runs: [], flags: [], tick_rate: 20, window_ticks: 1, ...patch });

describe("the reference phase", () => {
  it("prefers the backend's reference, then the first run, then the first point, then 0", () => {
    expect(chartReference(chart({ reference_phase: 5, runs: [{ first_frame: 0, last_frame: 1, points: 2, center: 9, width: 1 }] }))).toBe(5);
    expect(chartReference(chart({ runs: [{ first_frame: 0, last_frame: 1, points: 2, center: 9, width: 1 }] }))).toBe(9);
    expect(chartReference(chart({ points: [pt(0, 0, 3)] }))).toBe(3);
    expect(chartReference(chart())).toBe(0);
    expect(chartReference(chart({ reference_phase: 0 }))).toBe(0);
  });
});

describe("the ruler's phase", () => {
  it("is the reference moved by the offset and wrapped onto the 32-tick circle", () => {
    expect(rulerPhase(10, 0)).toBe(10);
    expect(rulerPhase(10, 3.5)).toBe(13.5);
    expect(rulerPhase(30, 5)).toBe(3);
    expect(rulerPhase(2, -5)).toBe(29);
    expect(rulerPhase(10, 40)).toBe(rulerPhase(10, 8));
  });

  it("treats a missing or non-finite number as no offset", () => {
    expect(rulerPhase(10, NaN)).toBe(10);
    expect(rulerPhase(10, Infinity)).toBe(10);
    expect(rulerPhase(NaN, 4)).toBe(4);
  });
});

describe("deviation from the ruler", () => {
  it("is the signed shortest distance in ticks: positive when the sprite lags the ideal clock", () => {
    expect(deviation(12, 10)).toBe(2);
    expect(deviation(8, 10)).toBe(-2);
    expect(deviation(10, 10)).toBe(0);
  });

  it("wraps around the circle and puts the antipode at +16", () => {
    expect(deviation(1, 31)).toBe(2);
    expect(deviation(31, 1)).toBe(-2);
    expect(deviation(26, 10)).toBe(16);
    expect(deviation(10, 26)).toBe(16);
  });

  it("matches the sprite row: the ideal row is the observed row plus the deviation", () => {
    // step = tick_rate * pts - phase, so a point seen at row 20 with phase 12 against a ruler at 10 sits 2 rows behind it
    const p = pt(0, 1.6, 12, 20);
    const d = deviation(p.phase, 10);
    expect(idealStep(p.pts, 20, 10)).toBeCloseTo(p.step + d, 9);
  });
});

describe("the ideal row at a time", () => {
  it("advances one row per tick and wraps at 32", () => {
    expect(idealStep(0, 20, 0)).toBe(0);
    expect(idealStep(0.05, 20, 0)).toBeCloseTo(1, 9);
    expect(idealStep(1.55, 20, 0)).toBeCloseTo(31, 9);
    expect(idealStep(1.6, 20, 0)).toBeCloseTo(0, 9);
    expect(idealStep(0, 20, 4)).toBe(28);
    expect(idealStep(-0.05, 20, 0)).toBeCloseTo(31, 9);
  });
});

describe("the ideal sawtooth", () => {
  it("draws one ramp per 32 ticks across the window", () => {
    expect(idealRamps(0, 3.2, 20, 0)).toEqual([
      { t0: 0, step0: 0, t1: 1.6, step1: 32 },
      { t0: 1.6, step0: 0, t1: 3.2, step1: 32 },
    ]);
  });

  it("starts part-way up a ramp and ends part-way up the last one, following the offset", () => {
    const r = idealRamps(0, 2, 20, 4);
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ t0: 0, step0: 28, t1: 0.2, step1: 32 });
    expect(r[1]).toEqual({ t0: 0.2, step0: 0, t1: 1.8, step1: 32 });
    expect(r[2].t0).toBeCloseTo(1.8, 9);
    expect(r[2].step0).toBe(0);
    expect(r[2].t1).toBe(2);
    expect(r[2].step1).toBeCloseTo(4, 9);
  });

  it("stays inside the window and is continuous in time", () => {
    const r = idealRamps(12.3, 40.1, 20, 7.7);
    expect(r[0].t0).toBe(12.3);
    expect(r[r.length - 1].t1).toBe(40.1);
    for (let i = 1; i < r.length; i++) expect(r[i].t0).toBeCloseTo(r[i - 1].t1, 9);
    for (const s of r) {
      expect(s.t1).toBeGreaterThan(s.t0);
      expect(s.step0).toBeGreaterThanOrEqual(0);
      expect(s.step1).toBeLessThanOrEqual(32 + 1e-9);
      expect(s.step1 - s.step0).toBeCloseTo(20 * (s.t1 - s.t0), 9);
    }
  });

  it("gives nothing for an empty window, a bad tick rate, or a window so wide the ramps would be a blur", () => {
    expect(idealRamps(5, 5, 20, 0)).toEqual([]);
    expect(idealRamps(5, 1, 20, 0)).toEqual([]);
    expect(idealRamps(0, 10, 0, 0)).toEqual([]);
    expect(idealRamps(0, 10, -20, 0)).toEqual([]);
    expect(idealRamps(0, 10, NaN, 0)).toEqual([]);
    expect(idealRamps(NaN, 10, 20, 0)).toEqual([]);
    expect(idealRamps(0, Infinity, 20, 0)).toEqual([]);
    expect(idealRamps(0, (MAX_RAMPS + 5) * 1.6, 20, 0)).toEqual([]);
    expect(idealRamps(0, (MAX_RAMPS - 5) * 1.6, 20, 0).length).toBeGreaterThan(0);
  });

  it("does not move when the offset differs by a whole circle", () => {
    expect(idealRamps(0, 5, 20, 3)).toEqual(idealRamps(0, 5, 20, 35));
  });
});

describe("how bad a deviation is", () => {
  it("is ok inside the tolerance, a warning up to twice it, bad beyond", () => {
    expect(deviationLevel(0.4, 0.5)).toBe("ok");
    expect(deviationLevel(-0.5, 0.5)).toBe("ok");
    expect(deviationLevel(0.51, 0.5)).toBe("warn");
    expect(deviationLevel(-1, 0.5)).toBe("warn");
    expect(deviationLevel(1.01, 0.5)).toBe("bad");
    expect(deviationLevel(-9, 0.5)).toBe("bad");
  });

  it("never treats a zero or broken tolerance as everything being fine or crashing", () => {
    expect(deviationLevel(0, 0)).toBe("ok");
    expect(deviationLevel(0.1, 0)).toBe("bad");
    expect(deviationLevel(0.1, NaN)).toBe("bad");
    expect(deviationLevel(NaN, 1)).toBe("bad");
  });
});

describe("deviation summary", () => {
  it("counts the points inside the tolerance and reports the mean and largest distance", () => {
    const points = [pt(0, 0, 10), pt(1, 1, 10.4), pt(2, 2, 8), pt(3, 3, 14)];
    const s = deviationStats(points, 10, 0.5);
    expect([s.count, s.within]).toEqual([4, 2]);
    expect(s.meanAbs).toBeCloseTo((0 + 0.4 + 2 + 4) / 4, 9);
    expect(s.maxAbs).toBeCloseTo(4, 9);
  });

  it("follows the wrap at the seam", () => {
    // phases 31 and 1 are each one tick from a ruler at 0 (a naive subtraction would say 31 and 1)
    expect(deviationStats([pt(0, 0, 31), pt(1, 1, 1)], 0, 1)).toEqual({ count: 2, within: 2, meanAbs: 1, maxAbs: 1 });
  });

  it("is all zeros for no points and ignores points with a broken phase", () => {
    expect(deviationStats([], 3, 0.5)).toEqual({ count: 0, within: 0, meanAbs: 0, maxAbs: 0 });
    expect(deviationStats([pt(0, 0, NaN), pt(1, 1, 3)], 3, 0.5)).toEqual({ count: 1, within: 1, meanAbs: 0, maxAbs: 0 });
  });
});

describe("best match for the ruler", () => {
  const at = (phases: number[]) => phases.map((phase, i) => pt(i, i / 20, phase));
  /** deterministic pseudo-random numbers in [0, 1) */
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  it("finds the phase of clean data, as an offset from the reference", () => {
    const m = bestRulerMatch(at([10, 10.1, 9.9, 10, 10.2, 9.8]), 4, 0.5)!;
    expect(rulerPhase(4, m.offset)).toBeCloseTo(10, 1);
    expect(m.offset).toBeCloseTo(6, 1);
    expect([m.count, m.inliers]).toEqual([6, 6]);
  });

  it("recovers an exact fractional phase to a hundredth of a tick", () => {
    const m = bestRulerMatch(at(Array(20).fill(12.37)), 0, 0.5)!;
    expect(rulerPhase(0, m.offset)).toBeCloseTo(12.37, 2);
    expect(m.rmse).toBeCloseTo(0, 3);
  });

  it("is not fooled by the seam: phases either side of 0 and 32 give a ruler near 0, not near 16", () => {
    const m = bestRulerMatch(at([31.8, 0.2, 0.1, 31.9, 0, 31.95]), 0, 0.5)!;
    expect(Math.abs(deviation(rulerPhase(0, m.offset), 0))).toBeLessThan(0.2);
    expect(m.inliers).toBe(6);
  });

  it("ignores outliers: a third of the frames far off do not move the fit", () => {
    const r = rng(7);
    const good = Array.from({ length: 80 }, () => 20 + (r() - 0.5) * 0.6);
    const bad = Array.from({ length: 40 }, () => r() * 32);
    const m = bestRulerMatch(at([...good, ...bad]), 0, 0.5)!;
    expect(rulerPhase(0, m.offset)).toBeCloseTo(20, 1);
    expect(m.inliers).toBeGreaterThanOrEqual(80);
    expect(m.inliers).toBeLessThan(120);
  });

  it("prefers the bigger of two steady stretches (a cut put the clock on another phase)", () => {
    const m = bestRulerMatch(at([...Array(60).fill(5), ...Array(40).fill(21)]), 0, 0.5)!;
    expect(rulerPhase(0, m.offset)).toBeCloseTo(5, 1);
    expect(m.inliers).toBe(60);
    const other = bestRulerMatch(at([...Array(40).fill(5), ...Array(60).fill(21)]), 0, 0.5)!;
    expect(rulerPhase(0, other.offset)).toBeCloseTo(21, 1);
  });

  it("is not dragged by one wild frame the way a plain average would be", () => {
    const m = bestRulerMatch(at([...Array(30).fill(8), 24]), 0, 0.5)!;
    expect(rulerPhase(0, m.offset)).toBeCloseTo(8, 1);
    expect(m.inliers).toBe(30);
  });

  it("returns an offset in (-16, 16] whatever the reference", () => {
    for (const reference of [0, 7, 16, 31.5]) {
      for (const phase of [0, 3, 16, 29.9]) {
        const m = bestRulerMatch(at(Array(5).fill(phase)), reference, 0.5)!;
        expect(m.offset).toBeGreaterThan(-16);
        expect(m.offset).toBeLessThanOrEqual(16);
        expect(rulerPhase(reference, m.offset)).toBeCloseTo(phase, 1);
      }
    }
  });

  it("works on a single frame", () => {
    const m = bestRulerMatch(at([13.3]), 0, 0.5)!;
    expect(rulerPhase(0, m.offset)).toBeCloseTo(13.3, 2);
    expect([m.count, m.inliers]).toEqual([1, 1]);
  });

  it("has nothing to match without usable points", () => {
    expect(bestRulerMatch([], 0, 0.5)).toBeNull();
    expect(bestRulerMatch(at([NaN, Infinity]), 0, 0.5)).toBeNull();
  });

  it("skips broken points but fits the rest", () => {
    const m = bestRulerMatch(at([NaN, 6, 6.1, 5.9]), 0, 0.5)!;
    expect(m.count).toBe(3);
    expect(rulerPhase(0, m.offset)).toBeCloseTo(6, 1);
  });

  it("copes with a zero or broken tolerance by using a small floor", () => {
    for (const tol of [0, NaN, -1]) {
      const m = bestRulerMatch(at([9, 9.05, 8.95, 9]), 0, tol)!;
      expect(rulerPhase(0, m.offset)).toBeCloseTo(9, 1);
    }
  });

  it("is deterministic and leaves its input alone", () => {
    const points = at([3, 3.1, 17, 3.05, 25, 2.95]);
    const before = JSON.stringify(points);
    expect(bestRulerMatch(points, 1, 0.5)).toEqual(bestRulerMatch(points, 1, 0.5));
    expect(JSON.stringify(points)).toBe(before);
  });

  it("reports how well the inliers fit", () => {
    const m = bestRulerMatch(at([10, 10.2, 9.8, 10, 25]), 0, 0.5)!;
    expect(m.inliers).toBe(4);
    expect(m.rmse).toBeGreaterThan(0);
    expect(m.rmse).toBeLessThan(0.2);
  });

  it("handles the largest chart (4000 points) quickly", () => {
    const r = rng(3);
    const pts = at(Array.from({ length: 4000 }, () => 14 + (r() - 0.5) * 0.8));
    const t = performance.now();
    const m = bestRulerMatch(pts, 0, 0.5)!;
    expect(performance.now() - t).toBeLessThan(1000);
    expect(rulerPhase(0, m.offset)).toBeCloseTo(14, 1);
  });
});
