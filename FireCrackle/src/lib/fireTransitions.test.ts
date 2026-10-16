import { expect, it } from "vitest";
import type { ChartPoint } from "./chart";
import { fireTransitions, forwardTransitionChart } from "./fireTransitions";

const point = (frame: number, step: number, pts = frame / 60): ChartPoint => ({ frame, pts, step, phase: 0 });
it("replaces baseline review flags while preserving phase evidence and run information",()=>{
  const chart={points:[point(0,3),point(1,1)],runs:[],flags:[],tick_rate:20,window_ticks:2,reference_phase:9};
  const result=forwardTransitionChart(chart);
  expect(result.points).toBe(chart.points);
  expect(result.reference_phase).toBe(9);
  expect(result.flags).toHaveLength(1);
  expect(chart.flags).toEqual([]);
});
it("accepts a normal forward wrap, repeated captured frames and boundary jitter", () => {
  expect(fireTransitions([point(0,31),point(1,0),point(2,0),point(3,2)],20).flags).toEqual([]);
});
it("marks row 3 to 1 in a single frame red using +30, not shortest circular -2", () => {
  const result = fireTransitions([point(14129,3),point(14130,1),point(14131,1)],20);
  expect(result.flags).toEqual([{frame:14130,end_frame:14130,kind:"phase_shift",severity:"hard",phase_delta:28}]);
  expect(result.details[0].explanation).toContain("at least 30 forward ticks");
  expect(result.details[0].explanation).toContain("at most 2");
});
it("accounts for actual frame duration and refuses comparisons across missing/no-fire labels", () => {
  expect(fireTransitions([point(0,3,0),point(1,1,1.5)],20).flags).toEqual([]);
  expect(fireTransitions([point(0,3,0),point(2,1,2/60)],20).flags).toEqual([]);
  expect(fireTransitions([point(0,3,1),point(1,1,1)],20).flags).toEqual([]);
  expect(fireTransitions([point(0,3,1),point(1,1,.5)],20).flags).toEqual([]);
});
it("uses original video time even on a corrected axis", () => {
  expect(fireTransitions([{...point(0,3,0),video_pts:1},{...point(1,1,1.5),video_pts:1+1/60}],20).flags).toHaveLength(1);
});
it("groups consecutive bad transitions into one event, keeping the strongest explanation", () => {
  const result = fireTransitions([point(0,3),point(1,7),point(2,3),point(3,3),point(4,2)],20);
  expect(result.flags.map(f=>[f.frame,f.end_frame,f.phase_delta])).toEqual([[1,2,26],[4,4,29]]);
  expect(result.details[0].end_frame).toBe(2);
  expect(result.details[0].explanation).toContain("at least 28 forward ticks");
});
it("does not emit thousands of flags after a persistent offset or alter source points", () => {
  const points = Array.from({length:100000},(_,i)=>point(i,(Math.floor(i/3)+(i>=300?5:0))%32));
  const saved = {...points[300]};
  expect(fireTransitions(points,20).flags).toHaveLength(1);
  expect(points[300]).toEqual(saved);
});
it("rejects malformed input instead of manufacturing jumps", () => {
  expect(fireTransitions([point(0,NaN),point(1,1)],20).flags).toEqual([]);
  expect(fireTransitions([point(0,3),point(1,1)],NaN).flags).toEqual([]);
});
