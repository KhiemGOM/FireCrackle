import { expect, it } from "vitest";
import { drawPhaseChart } from "./phaseChartCanvas";
import type { PhaseChart } from "./chart";

it("bounds dense ruler/point draw work and reads layout once, reusing the canvas buffer", () => {
  let heightReads = 0, widthWrites = 0, heightWrites = 0, lines = 0, dots = 0;
  let bw = 1000, bh = 500;
  const ctx = { setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() { lines++; }, stroke() {}, fillText() {}, strokeRect() {}, setLineDash() {}, fillRect(_x: number, _y: number, width: number) { if (width === 2.5) dots++; } };
  const canvas = {
    clientWidth: 1000, get clientHeight() { heightReads++; return 500; },
    get width() { return bw; }, set width(v: number) { widthWrites++; bw = v; },
    get height() { return bh; }, set height(v: number) { heightWrites++; bh = v; },
    getContext: () => ctx,
  };
  const chart: PhaseChart = {
    points: Array.from({length:100000}, (_, i) => ({frame:i,pts:i/100,step:i%32,phase:i%3})),
    runs: [], flags: [], tick_rate: 20, window_ticks: 1, reference_phase: 0, reference_clock: "jolt",
    clock_segments: [{t0:0,t1:400,tick0:0,tick1:8000},{t0:600,t1:1000,tick0:12000,tick1:20000}],
  };
  drawPhaseChart(canvas as unknown as HTMLCanvasElement, {chart,kind:"row",currentFrame:0,fps:60,t0:0,t1:1000,highlighted:null,pixelRatio:1,yRange:[-57,88],ruler:{offset:0,tolerance:.5}});
  expect(heightReads).toBe(1);
  expect(widthWrites + heightWrites).toBe(0);
  // Retain the occupied 32-row cloud, rather than only a few extrema per time column.
  expect(dots).toBeGreaterThanOrEqual(500*32);
  expect(dots).toBeLessThanOrEqual(500*(32+7));
  expect(lines).toBeLessThan(dots*2+10); // At most two wrapped pieces per retained point.
});

it("does not paint a dense guide across unknown clock intervals", () => {
  const bands: number[][] = [];
  const ctx = { setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, strokeRect() {}, setLineDash() {}, fillRect(...args: number[]) { bands.push(args); } };
  const chart: PhaseChart = {points:[],runs:[],flags:[],tick_rate:20,window_ticks:1,reference_clock:"jolt",clock_segments:[{t0:0,t1:400,tick0:0,tick1:8000},{t0:600,t1:1000,tick0:12000,tick1:20000}]};
  const canvas = {clientWidth:1000,clientHeight:320,width:1000,height:320,getContext:()=>ctx};
  drawPhaseChart(canvas as unknown as HTMLCanvasElement, {chart,kind:"row",currentFrame:0,fps:60,t0:0,t1:1000,highlighted:null,pixelRatio:1,ruler:{offset:0,tolerance:.5}});
  expect(bands.map(([x,,w])=>[x,w])).toEqual([[0,400],[600,400]]);
});
