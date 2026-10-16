import { describe, expect, it, vi } from "vitest";
import type { PhaseChart } from "./chart";
import { drawPhaseChart, type PhaseChartCanvasOptions } from "./phaseChartCanvas";

function fixture(patch: Partial<PhaseChartCanvasOptions> = {}) {
  const context = {
    setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    fillText: vi.fn(), strokeRect: vi.fn(), setLineDash: vi.fn(),
  };
  const canvas = {
    clientWidth: 1000, clientHeight: 320, width: 0, height: 0,
    getContext: vi.fn(() => context),
  };
  const chart: PhaseChart = {
    points: [{ frame: 300, pts: 5, phase: 2, step: 16 }],
    runs: [], flags: [], tick_rate: 20, window_ticks: 1, reference_phase: 0,
  };
  const options: PhaseChartCanvasOptions = {
    chart, kind: "phase", currentFrame: 300, fps: 60, t0: 0, t1: 10,
    highlighted: null, pixelRatio: 1, ...patch,
  };
  return { context, canvas, options, draw: () => drawPhaseChart(canvas as unknown as HTMLCanvasElement, options) };
}

describe("phase chart canvas", () => {
  it("zooms the vertical scale without moving the point along time",()=>{
    const {context,draw}=fixture({yRange:[-4,4]});draw();
    expect(context.fillRect).toHaveBeenCalledWith(499,79,2.5,2.5);
    expect(context.moveTo).toHaveBeenLastCalledWith(500,0);
  });
  it("draws canonical sawtooth through fire-free intervals without connecting clock breaks",()=>{
    const {context,options,draw}=fixture({kind:"row",ruler:{offset:0,tolerance:1}});
    options.chart={points:[],runs:[],flags:[],tick_rate:20,window_ticks:2,reference_phase:0,reference_clock:"jolt",
      clock_segments:[{t0:1,t1:3,tick0:0,tick1:40},{t0:7,t1:9,tick0:64,tick1:64}]};
    draw();
    expect(context.moveTo).toHaveBeenCalledWith(100,320);
    expect(context.lineTo).toHaveBeenCalledWith(260,320-32/31*320);
    expect(context.moveTo).toHaveBeenCalledWith(260,320);
    expect(context.lineTo).toHaveBeenCalledWith(300,320-8/31*320);
    expect(context.moveTo).toHaveBeenCalledWith(700,320);
    expect(context.lineTo).toHaveBeenCalledWith(900,320);
    // Exclude the final playhead stroke; it is independent of ruler continuity.
    expect(context.lineTo.mock.calls.slice(5,-1).some(([x])=>x>300.001&&x<700)).toBe(false);
  });
  it("scales the backing store while keeping points and playhead in CSS pixels", () => {
    const { canvas, context, draw } = fixture({ pixelRatio: 2 });
    draw();
    expect([canvas.width, canvas.height]).toEqual([2000, 640]);
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(context.fillRect).toHaveBeenCalledExactlyOnceWith(499, 139, 2.5, 2.5);
    expect(context.moveTo).toHaveBeenLastCalledWith(500, 0);
    expect(context.lineTo).toHaveBeenLastCalledWith(500, 320);
    expect(context.setLineDash.mock.calls).toEqual([[[6, 4]], [[]]]);
  });

  it("uses sprite rows for the lower chart and culls offscreen points", () => {
    const { context, options, draw } = fixture({ kind: "row" });
    options.chart!.points.push({ frame: 900, pts: 15, phase: 3, step: 5 });
    draw();
    expect(context.fillRect).toHaveBeenCalledOnce();
    expect(context.fillRect.mock.calls[0]).toEqual([499, 320 - 16 / 31 * 320 - 1, 2.5, 2.5]);
    expect(context.setLineDash).not.toHaveBeenCalled();
    expect(context.fillText.mock.calls.map(([label]) => label)).toEqual(["row 0", "row 8", "row 16", "row 24", "row 31"]);
  });

  it("paints flags behind points and clips the linked highlight to the chart", () => {
    const { context, options, draw } = fixture({ highlighted: { first: -60, last: 60 } });
    options.chart!.flags.push({ frame: 0, end_frame: 120, severity: "hard", kind: "phase_shift", phase_delta: 3 });
    draw();
    expect(context.fillRect.mock.calls[0]).toEqual([0, 0, 200, 320]);
    expect(context.fillRect.mock.calls[1]).toEqual([499, 139, 2.5, 2.5]);
    expect(context.strokeRect).toHaveBeenCalledWith(1, 1, 98, 318);
  });

  it("keeps a single-frame selection visible and ignores offscreen highlights", () => {
    const single = fixture({ highlighted: { first: 300, last: 300 } });
    single.draw();
    expect(single.context.strokeRect).toHaveBeenCalledWith(501, 1, 2, 318);
    const offscreen = fixture({ highlighted: { first: 900, last: 950 } });
    offscreen.draw();
    expect(offscreen.context.strokeRect).not.toHaveBeenCalled();
  });

  it("does nothing before chart data or a canvas is available", () => {
    const { canvas, options } = fixture({ chart: null });
    drawPhaseChart(canvas as unknown as HTMLCanvasElement, options);
    drawPhaseChart(null, options);
    expect(canvas.getContext).not.toHaveBeenCalled();
  });
});
