/** Opt-in empirical benchmark. Normal tests do not need local recordings or emit artifacts.
 * Prepare with scripts/jolt-benchmark.py, run native jolt_benchmark, then set JOLT_BENCHMARK=1.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { joltPhase, parseJolt, sessionOf, timeReference, type JoltState } from "../src/lib/jolt";
import { bestRulerMatch, deviation, rulerPhase } from "../src/lib/clockRuler";
import type { ChartPoint, PhaseChart } from "../src/lib/chart";

const work=resolve("../.board/jolt-bench");
const enabled=process.env.JOLT_BENCHMARK==="1"&&existsSync(resolve(work,"inputs.json"));
const quantile=(values:number[],q:number)=>{const sorted=[...values].sort((a,b)=>a-b);if(!sorted.length)return null;const position=q*(sorted.length-1),low=Math.floor(position),high=Math.ceil(position);return sorted[low]+(sorted[high]-sorted[low])*(position-low);};
function spread(points:ChartPoint[]){
  const match=bestRulerMatch(points,0,1);
  const center=match?rulerPhase(0,match.offset):0;
  const residual=points.map(p=>Math.abs(deviation(p.phase,center)));
  return {count:points.length,center,p50:quantile(residual,.5),p90:quantile(residual,.9),p99:quantile(residual,.99),max:quantile(residual,1),over_two_ticks:residual.filter(d=>d>2).length};
}
it.skipIf(!enabled)("compares actual Jolt observations and held-out clock fits with video time",()=>{
  const input=JSON.parse(readFileSync(resolve(work,"inputs.json"),"utf8"));
  const native=JSON.parse(readFileSync(resolve(work,"native.json"),"utf8"));
  const results=input.cases.map((c:any)=>{
    const data=parseJolt(JSON.stringify(c.report),c.name+".json");
    const state:JoltState={version:1,data,clock:"jolt",session:sessionOf(data.anchors[0])};
    const ref=timeReference(state);
    const points:ChartPoint[]=c.points.filter((p:any)=>p.fire).map((p:any)=>({frame:p.frame,pts:p.pts,step:p.step,phase:p.phase}));
    const chart:PhaseChart={points,runs:[],flags:[],tick_rate:20,window_ticks:2};
    const gui=joltPhase(chart,ref)!;
    expect(gui.points).toHaveLength(points.length); // verifies report PTS alignment through the shipped adapter
    const heldOut:any[]=[];
    for(const p of c.points.filter((p:any)=>p.fire)){
      const a=data.anchors.find(a=>Math.abs(a.time-p.pts)<.000002);
      if(!a)continue;
      const own=data.anchors.filter(b=>b.segment===a.segment&&sessionOf(b)===sessionOf(a));
      const index=own.indexOf(a);if(index===0||index===own.length-1)continue;
      const test=timeReference({...state,data:{...data,anchors:data.anchors.filter(b=>b!==a)}}).sampleAt(p.pts);
      if(!test)continue;
      const previous=own[index-1];
      heldOut.push({frame:p.frame,source_frame:p.source_frame,jolt_error:test.tick-p.gui_tick,video_error:previous.tick+20*(p.pts-previous.time)-p.gui_tick});
    }
    const rows=c.points.map((p:any)=>({frame:p.frame,source_frame:p.source_frame,section:p.section,client_minus_gui:p.truth_tick-p.gui_tick,gui_minus_sprite:((p.gui_tick-p.step)%32+32)%32}));
    const sectionStats=[...new Set(c.points.map((p:any)=>p.section))].map(section=>{
      const frames=new Set(c.points.filter((p:any)=>p.section===section).map((p:any)=>p.frame));
      return {section,video_phase:spread(points.filter(p=>frames.has(p.frame))),jolt_phase:spread(gui.points.filter(p=>frames.has(p.frame)))};
    });
    const breaks=c.report.breaks.map((b:any)=>Object.fromEntries(Object.entries(b).filter(([key])=>key!=="frames"&&key!=="frame_positions")));
    const found=native.find((n:any)=>n.name===c.name);
    const result:any={name:c.name,kind:c.kind,total_frames:c.frames,readable_fraction:c.report.readable,observed_gui_anchors:c.points.length,fire_visible_anchors:points.length,section_count:c.report.runs.length,video_phase:spread(points),jolt_phase:spread(gui.points),app_jolt_flags:gui.flags.length,production_video_flags:found?.flags.length??null,breaks,client_gui_offsets_by_section:[...new Set(rows.map((r:any)=>r.section))].map(section=>({section,offsets:[...new Set(rows.filter((r:any)=>r.section===section).map((r:any)=>r.client_minus_gui))]})),held_out:{count:heldOut.length,jolt_abs_p50:quantile(heldOut.map((p:any)=>Math.abs(p.jolt_error)),.5),jolt_abs_p99:quantile(heldOut.map((p:any)=>Math.abs(p.jolt_error)),.99),video_abs_p50:quantile(heldOut.map((p:any)=>Math.abs(p.video_error)),.5),video_abs_p99:quantile(heldOut.map((p:any)=>Math.abs(p.video_error)),.99)}};
    result.within_section=sectionStats;
    if(c.kind==="cut"){
      result.removed_seconds=c.removed_seconds;result.cut_time=c.cut_time;
      result.jolt_detected_cut=breaks.some((b:any)=>b.kind==="removed"&&b.from<=c.cut_time+.002&&b.to>=c.cut_time-.002);
      result.accepted_gui_readings_on_both_sides=c.points.some((p:any)=>p.pts<c.cut_time)&&c.points.some((p:any)=>p.pts>=c.cut_time);
      result.jolt_cut_brackets=breaks.filter((b:any)=>b.kind==="removed").map((b:any)=>({from:b.from,to:b.to,removed_estimate:b.jump_seconds}));
      const before=c.points.filter((p:any)=>p.fire&&p.pts<c.cut_time).slice(-1)[0];
      const after=c.points.filter((p:any)=>p.fire&&p.pts>=c.cut_time).slice(0,2);
      const near=new Set([before?.frame,...after.map((p:any)=>p.frame)]);
      const original=native.find((n:any)=>n.name===c.clip);
      const source=(frame:number)=>c.points.find((p:any)=>p.frame===frame)?.source_frame;
      const oldSource=new Set((original?.flags??[]).flatMap((f:any)=>[f.frame,f.end_frame]));
      result.video_new_flag_at_cut=(found?.flags??[]).some((f:any)=>(near.has(f.frame)||near.has(f.end_frame))&&!oldSource.has(source(f.frame))&&!oldSource.has(source(f.end_frame)));
      result.fire_phase_shift_mod32=Math.abs(deviation(-20*c.removed_seconds,0));
    }
    writeFileSync(resolve(work,c.name+"-detail.json"),JSON.stringify({heldOut,rows,videoFlags:found?.flags,joltFlags:gui.flags},null,2));
    return result;
  });
  const summary={seed:input.seed,jolt_sha256:input.jolt_sha256,scope:"Only accepted hunger/heart observations; only fire-visible observations enter phase analysis. Creative footage is not scored. Compare noise within each observed section, not across clip2's creative-mode gap. No full-video coverage claim.",clock_fit:"Production timeReference interpolation inside original Jolt runs. Held-out reading removed before fitting. No ground-truth client ticks used to fit either clock.",limitations:["Sparse bar observations: cut localisation is an interval, not an exact frame.","Video checker uses production phase_v2; current Jolt UI flags use its separate first-pair residual rule. Flag counts are not a controlled same-algorithm comparison or a false-positive rate.","Clip2's 83-tick GUI/client change crosses visible creative mode (frame at 103 s verified); excluded as a lag-performance case. Global residuals/flags retained only to document current UI behaviour.","Ground-truth client ticks identify differential clock changes; they are not assumed identical to GUI ticks.","Nine real cut windows are a small demonstration, not a generalised detection-rate estimate."],results};
  writeFileSync(resolve("jolt-benchmark-summary.json"),JSON.stringify(summary,null,2)+"\n");
  console.log(JSON.stringify(results.map((r:any)=>({name:r.name,anchors:r.fire_visible_anchors,video_p99:r.video_phase.p99,jolt_p99:r.jolt_phase.p99,heldout:r.held_out,jolt_cut:r.jolt_detected_cut,video_cut:r.video_new_flag_at_cut})),null,2));
},120000);
