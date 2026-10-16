import { expect, it } from "vitest";
import { EMPTY_JOLT, correctedJoltChart, joltPhase, localJoltKey, parseJolt, plotAnchors, restoreJolt, sessionOf, timeReference, type JoltAnchor, type JoltState } from "./jolt";
import type { PhaseChart } from "./chart";

const report={version:"2.3",source:"same.mp4",games:[{number:1,screen:1},{number:2,screen:2}],jolts:[{tick:999}, {}, {}, {}, {}],runs:[{game:1,points:[[1,100,0],[3,140,1]]},{game:1,points:[[5,300,2],[7,340,3]]},{game:2,points:[[4,50,4]]}],breaks:[{kind:"removed"},{kind:"screen"}]};
const state=(data=parseJolt(JSON.stringify(report),"jolt.json")):JoltState=>({version:1,data,clock:"jolt",session:sessionOf(data.anchors[0])});
it("keeps fire-only jump events even where Jolt cannot provide a canonical time",()=>{
  const chart:PhaseChart={points:[{frame:240,pts:4,step:3,phase:0},{frame:241,pts:4+1/60,step:1,phase:0}],runs:[],flags:[],tick_rate:20,window_ticks:2};
  const result=joltPhase(chart,timeReference(state()))!;
  expect(result.points).toEqual([]);
  expect(result.flags).toMatchObject([{frame:241,severity:"hard"}]);
});
it("detects a local +30 jump despite a smooth interpolated Jolt clock, without per-frame offset spam",()=>{
  const ref=timeReference(state(parseJolt(JSON.stringify({anchors:[{time:0,tick:0},{time:20,tick:400}]}),"sparse")));
  const chart:PhaseChart={points:Array.from({length:600},(_,frame)=>({frame,pts:frame/60,step:(3+Math.floor(frame/3)+(frame>=1?30:0))%32,phase:0})),runs:[],flags:[],tick_rate:20,window_ticks:2};
  const result=joltPhase(chart,ref)!;
  expect(result.flags).toHaveLength(1);
  expect(result.flags[0]).toMatchObject({frame:1,end_frame:1,severity:"hard",phase_delta:28});
  expect(result.points[1].clock_estimated).toBe(true);
  expect(result.reference_phase).toBe(29);
});
it("retains independent ruler coverage without fire and never bridges a clock break",()=>{
  const chart:PhaseChart={points:[],runs:[],flags:[],tick_rate:20,window_ticks:2};
  expect(joltPhase(chart,timeReference(state()))!.clock_segments).toEqual([
    {t0:1,t1:3,tick0:100,tick1:140},
    {t0:5,t1:7,tick0:300,tick1:340},
  ]);
});
it("imports accepted run readings and section identities, never raw candidate ticks",()=>{
  const data=state().data!;
  expect(data.anchors.map(a=>a.tick)).toEqual([100,140,50,300,340]);
  expect(data.anchors[0].segment).toBe("0");expect(data.anchors[3].segment).toBe("1");
  expect(timeReference(state()).tickAt(4)).toBeNull(); // known removed span, not another player's anchor
});
it("reads embedded report JSON as data without executing report scripts",()=>{
  const data=parseJolt(`<html><script>throw Error('do not run')</script><script type="application/json" id="data">${JSON.stringify(report)}</script></html>`,"report.html");
  expect(data.anchors).toHaveLength(5);
  expect(()=>parseJolt("<html>no data</html>","x")).toThrow("embedded JSON");
});
it("fits between readings within a run, preserving observations and refusing cross-break/outside fits",()=>{
  const ref=timeReference(state());
  expect(ref.sampleAt(1)).toEqual({tick:100,estimated:false});
  expect(ref.sampleAt(2)).toEqual({tick:120,estimated:true});
  expect(ref.tickAt(0.5)).toBeNull();expect(ref.tickAt(4)).toBeNull();expect(ref.tickAt(8)).toBeNull();
  expect(ref.tickAt(6)).toBe(320);
  expect(timeReference({...state(),session:JSON.stringify(["2","2"])}).tickAt(4)).toBe(50);
});
it("does not force nominal FPS or add a sheet-specific half-cycle to sprite steps",()=>{
  const data=parseJolt(JSON.stringify({anchors:[{time:0.123457,tick:100},{time:1.123457,tick:120}]}),"x");
  const ref=timeReference(state(data));
  const chart:PhaseChart={points:[{frame:3,pts:0.123456789,step:4,phase:7},{frame:30,pts:0.623457,step:14,phase:8},{frame:40,pts:0.9,step:0,phase:9}],runs:[],flags:[],tick_rate:20,window_ticks:2};
  const result=joltPhase(chart,ref)!;
  expect(result.points[0].phase).toBe(0);expect(result.points[0].clock_estimated).toBe(false);
  expect(result.points[1].phase).toBe(0);expect(result.points[1].clock_estimated).toBe(true);
  expect(result.flags).toHaveLength(0);expect(result.points[2].phase).not.toBe(0);expect(chart.points[0].phase).toBe(7);
});
it("keeps fire/Jolt steady through a joint clock jump but splits the unknown break",()=>{
  const chart:PhaseChart={points:[{frame:60,pts:1,step:4,phase:16},{frame:180,pts:3,step:12,phase:16},{frame:240,pts:4,step:0,phase:16},{frame:300,pts:5,step:12,phase:24}],runs:[],flags:[],tick_rate:20,window_ticks:2};
  const result=joltPhase(chart,timeReference(state()))!;
  expect(result.points.map(p=>p.phase)).toEqual([0,0,0]);expect(result.flags).toEqual([]);
  expect(result.points.map(p=>p.frame)).not.toContain(240);
});
it("rejects malformed ticks, excludes unresolved and conflicting readings",()=>{
  expect(()=>parseJolt('{"anchors":[{"time":1,"tick":1.2}]}',"x")).toThrow("integer");
  const data=parseJolt(JSON.stringify({anchors:[{time:1,tick:100},{time:1,tick:200},{time:2,tick:null},{time:3,tick:300}]}),"x");
  expect(data.anchors.map(a=>a.time)).toEqual([3]);expect(data.unresolved).toBe(2);
  expect(()=>parseJolt('{"anchors":[{"time":-1,"tick":3}]}',"x")).toThrow();
});
it("round trips the selected game/clock without mixing video projects",()=>{
  const original={...state(),session:JSON.stringify(["2","2"])};
  expect(restoreJolt(JSON.stringify(original))).toEqual(original);
  expect(restoreJolt(null)).toEqual(EMPTY_JOLT);
  expect(localJoltKey("a/video.mp4")).not.toBe(localJoltKey("b/video.mp4"));
  expect(timeReference(EMPTY_JOLT).tickAt(1.5)).toBe(30);
});
it("bounds plotted SVG samples while retaining local extrema and exact canonical readings",()=>{
  const anchors:JoltAnchor[]=Array.from({length:200000},(_,i)=>({time:i,tick:i*20+(i===12345?500:0),game:"1",screen:"1"}));
  const plotted=plotAnchors(anchors);
  expect(plotted.length).toBeLessThanOrEqual(4000);expect(plotted).toContain(anchors[12345]);
  expect(plotted[0]).toBe(anchors[0]);expect(plotted[plotted.length-1]).toBe(anchors[anchors.length-1]);
});

it("subtracts the GUI origin for corrected elapsed time without losing video timestamps",()=>{
  const ref=timeReference(state());
  const base:PhaseChart={points:[{frame:120,pts:2,step:23,phase:0},{frame:360,pts:6,step:31,phase:0}],runs:[],flags:[],tick_rate:20,window_ticks:2};
  const measured=joltPhase(base,ref)!;
  const result=correctedJoltChart(measured,ref)!;
  expect(result.points.map(p=>[p.frame,p.pts,p.video_pts,p.phase])).toEqual([[120,1,2,1],[360,11,6,1]]);
  expect(result.clock_segments).toEqual([{t0:0,t1:2,tick0:100,tick1:140},{t0:10,t1:12,tick0:300,tick1:340}]);
  expect(base.points[0].pts).toBe(2);
});
