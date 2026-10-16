import { describe, expect, it } from "vitest";
import { phaseToY, rowToY, type PhaseChart } from "./chart";
import { DEVIATION_COLORS, drawPhaseChart, type PhaseChartCanvasOptions } from "./phaseChartCanvas";

type Call = [string, ...unknown[]];

/** A recording canvas context: every method call and every style assignment, in order. */
function fixture(patch: Partial<PhaseChartCanvasOptions> = {}, points = [{ frame: 300, pts: 5, phase: 2, step: 16 }]) {
  const log: Call[] = [];
  const context: Record<string, unknown> = {};
  for (const m of ["setTransform", "clearRect", "fillRect", "beginPath", "moveTo", "lineTo", "stroke", "fillText", "strokeRect", "setLineDash"]) {
    context[m] = (...args: unknown[]) => { log.push([m, ...args]); };
  }
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign"]) {
    Object.defineProperty(context, p, { set: (v) => { log.push([p, v]); }, get: () => undefined });
  }
  const canvas = { clientWidth: 1000, clientHeight: 320, width: 0, height: 0, getContext: () => context };
  const chart: PhaseChart = { points, runs: [], flags: [], tick_rate: 20, window_ticks: 1, reference_phase: 0 };
  const options: PhaseChartCanvasOptions = {
    chart, kind: "phase", currentFrame: 300, fps: 60, t0: 0, t1: 10, highlighted: null, pixelRatio: 1, ...patch,
  };
  const draw = () => drawPhaseChart(canvas as unknown as HTMLCanvasElement, options);
  const calls = (name: string) => log.filter(c => c[0] === name).map(c => c.slice(1));
  return { log, draw, calls, options };
}

const RULER = { offset: 0, tolerance: 0.5 };

it("uses canonical GUI ticks for the row ruler without drawing video-time ramps through breaks", () => {
  const chart:PhaseChart={reference_clock:"jolt",clock_segments:[{t0:4,t1:6,tick0:980,tick1:1020}],points:[{frame:300,pts:5,step:8,phase:0,clock_tick:1000,clock_estimated:true}],runs:[],flags:[],tick_rate:20,window_ticks:1,reference_phase:0};
  const f=fixture({kind:"row",chart,ruler:RULER});f.draw();
  expect(f.calls("lineTo")).toContainEqual([600,rowToY(28,320)]);
  expect(f.calls("lineTo")).not.toContainEqual([160,0]); // a video-clock ramp would wrap at 1.6 s
  const phase=fixture({chart});phase.draw();
  expect(phase.calls("fillText").some(([text])=>text==="Corrected clock reference")).toBe(true);
});

describe("ruler on the timing chart", () => {
  it("draws a ruler line at the offset from the reference, labelled with it", () => {
    const f = fixture({ ruler: { offset: 3, tolerance: 0.5 } });
    f.draw();
    const y = phaseToY(3, 320);
    expect(f.calls("moveTo")).toContainEqual([0, y]);
    expect(f.calls("lineTo")).toContainEqual([1000, y]);
    expect(f.calls("fillText").some(([text]) => String(text).includes("+3"))).toBe(true);
  });

  it("shades the tolerance around the ruler", () => {
    const f = fixture({ ruler: { offset: 3, tolerance: 0.5 } });
    f.draw();
    const top = phaseToY(3.5, 320);
    expect(f.calls("fillRect")).toContainEqual([0, top, 1000, phaseToY(2.5, 320) - top]);
  });

  it("wraps an offset of a whole circle plus 8 to +8", () => {
    const f = fixture({ ruler: { offset: 40, tolerance: 0.5 } });
    f.draw();
    expect(f.calls("moveTo")).toContainEqual([0, phaseToY(8, 320)]);
  });

  it("connects each point to the ruler and colours the dot by how far off it is", () => {
    const f = fixture({ ruler: { offset: 0, tolerance: 0.5 } }); // the point sits 2 ticks off: bad
    f.draw();
    const y = phaseToY(2, 320);
    expect(f.calls("moveTo")).toContainEqual([500, y]);
    expect(f.calls("lineTo")).toContainEqual([500, phaseToY(0, 320)]);
    const dot = f.log.findIndex(c => c[0] === "fillRect" && c[3] === 2.5);
    const colour = [...f.log.slice(0, dot)].reverse().find(c => c[0] === "fillStyle");
    expect(colour?.[1]).toBe(DEVIATION_COLORS.bad);
  });

  it("uses the ok colour for a point on the ruler and the warn colour just outside the tolerance", () => {
    const on = fixture({ ruler: RULER }, [{ frame: 300, pts: 5, phase: 0.2, step: 16 }]);
    on.draw();
    const warn = fixture({ ruler: RULER }, [{ frame: 300, pts: 5, phase: 0.8, step: 16 }]);
    warn.draw();
    const dotColour = (f: ReturnType<typeof fixture>) => {
      const dot = f.log.findIndex(c => c[0] === "fillRect" && c[3] === 2.5);
      return [...f.log.slice(0, dot)].reverse().find(c => c[0] === "fillStyle")?.[1];
    };
    expect(dotColour(on)).toBe(DEVIATION_COLORS.ok);
    expect(dotColour(warn)).toBe(DEVIATION_COLORS.warn);
  });

  it("measures against the ruler, not the reference", () => {
    const f = fixture({ ruler: { offset: 2, tolerance: 0.5 } }); // the point is at +2 = on the moved ruler
    f.draw();
    const dot = f.log.findIndex(c => c[0] === "fillRect" && c[3] === 2.5);
    expect([...f.log.slice(0, dot)].reverse().find(c => c[0] === "fillStyle")?.[1]).toBe(DEVIATION_COLORS.ok);
  });

  it("skips points outside the window", () => {
    const f = fixture({ ruler: RULER, t0: 20, t1: 30 });
    f.draw();
    expect(f.calls("fillRect").filter(c => c[3] === 2.5)).toEqual([]);
    expect(f.calls("lineTo").filter(c => c[0] === 500)).toEqual([]);
  });
});

describe("ruler on the sprite-row chart", () => {
  it("draws the ideal sawtooth, one ramp per 32 ticks", () => {
    const f = fixture({ kind: "row", ruler: RULER });
    f.draw();
    expect(f.calls("moveTo")).toContainEqual([0, rowToY(0, 320)]);
    expect(f.calls("lineTo")).toContainEqual([160, rowToY(32, 320)]); // 1.6 s of a 10 s window across 1000 px
    expect(f.calls("moveTo")).toContainEqual([160, rowToY(0, 320)]); // the next ramp starts back at row 0
  });

  it("moves the sawtooth with the offset", () => {
    const f = fixture({ kind: "row", ruler: { offset: 4, tolerance: 0.5 } });
    f.draw();
    expect(f.calls("moveTo")).toContainEqual([0, rowToY(28, 320)]); // the window opens 28 rows up a ramp
    expect(f.calls("lineTo")).toContainEqual([20, rowToY(32, 320)]); // and it wraps at 0.2 s
  });

  it("joins each point to the row the ideal clock shows at that moment", () => {
    const f = fixture({ kind: "row", ruler: RULER }); // row 16, phase 2: the ideal clock is at row 18
    f.draw();
    expect(f.calls("moveTo")).toContainEqual([500, rowToY(16, 320)]);
    expect(f.calls("lineTo")).toContainEqual([500, rowToY(18, 320)]);
  });

  it("colours the dot by the same deviation as the timing chart", () => {
    const f = fixture({ kind: "row", ruler: RULER });
    f.draw();
    const dot = f.log.findIndex(c => c[0] === "fillRect" && c[3] === 2.5);
    expect([...f.log.slice(0, dot)].reverse().find(c => c[0] === "fillStyle")?.[1]).toBe(DEVIATION_COLORS.bad);
  });

  it("draws no ramps for a window too wide to read, but still connects the points", () => {
    const off = fixture({ kind: "row", t1: 100000 });
    off.draw();
    const on = fixture({ kind: "row", t1: 100000, ruler: RULER });
    on.draw();
    expect(on.calls("lineTo").length).toBe(off.calls("lineTo").length + 1); // the one stem
  });
});

describe("ruler off", () => {
  it("paints exactly what it painted before: no ruler line, stems or deviation colours", () => {
    for (const kind of ["phase", "row"] as const) {
      const f = fixture({ kind });
      f.draw();
      // (the ok green is also the reference line's green, so look for the ruler's own dash pattern and label)
      expect(f.calls("setLineDash").filter(c => JSON.stringify(c[0]) === "[2,3]")).toEqual([]);
      expect(f.calls("fillText").filter(c => String(c[0]).includes("perfect clock"))).toEqual([]);
      const g = fixture({ kind, ruler: null });
      g.draw();
      expect(g.log).toEqual(f.log);
    }
  });
});

describe("ruler without data", () => {
  it("still draws the ruler when there are no points, and does nothing before the chart exists", () => {
    const f = fixture({ ruler: RULER }, []);
    expect(() => f.draw()).not.toThrow();
    expect(f.calls("moveTo")).toContainEqual([0, phaseToY(0, 320)]);
    expect(() => fixture({ ruler: RULER, chart: null }).draw()).not.toThrow();
  });

  it("ignores points whose phase is not a number", () => {
    const f = fixture({ ruler: RULER }, [{ frame: 1, pts: 4, phase: NaN, step: 3 }]); // x = 400, clear of the playhead at 500
    expect(() => f.draw()).not.toThrow();
    expect(f.calls("lineTo").filter(c => c[0] === 400)).toEqual([]);
    expect(f.calls("fillRect").filter(c => c[3] === 2.5)).toEqual([]);
  });
});
