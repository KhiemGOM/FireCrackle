/** Opt-in real survival/LAN benchmark; raw recording/labels never enter Git. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { joltPhase, parseJolt, sessionOf, timeReference, type JoltState } from "../src/lib/jolt";
import { bestRulerMatch, deviation, rulerPhase } from "../src/lib/clockRuler";
import type { ChartPoint, PhaseChart } from "../src/lib/chart";

const work=resolve("../.board/jolt-survival");
const enabled=process.env.JOLT_SURVIVAL_BENCHMARK==="1"&&existsSync(resolve(work,"input.json"));
const q=(xs:number[],level:number)=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b),p=level*(s.length-1),lo=Math.floor(p),hi=Math.ceil(p);return s[lo]+(s[hi]-s[lo])*(p-lo);};
function distribution(xs:number[]){return {count:xs.length,median:q(xs,.5),p90:q(xs,.9),p99:q(xs,.99),max:q(xs,1),over_one:xs.filter(x=>x>1).length,over_two:xs.filter(x=>x>2).length};}
function spread(points:ChartPoint[]){const m=bestRulerMatch(points,0,1),center=m?rulerPhase(0,m.offset):0;return {center,...distribution(points.map(p=>Math.abs(deviation(p.phase,center))))};}

it.skipIf(!enabled)("measures real survival clock accuracy and first-stall recovery",()=>{
  const input=JSON.parse(readFileSync(resolve(work,"input.json"),"utf8"));
  const raw=JSON.parse(readFileSync(resolve(work,"survival1.json"),"utf8"));
  const data=parseJolt(JSON.stringify(raw),"survival1.json");
  const state:JoltState={version:1,data,clock:"jolt",session:sessionOf(data.anchors[0])};
  const ref=timeReference(state);
  const fire=input.points.filter((p:any)=>p.fire);
  const chart:PhaseChart={points:fire,runs:[],flags:[],tick_rate:20,window_ticks:2};
  const gui=joltPhase(chart,ref)!;
  const pairedFrames=new Set(gui.points.map(p=>p.frame));
  const paired=fire.filter((p:any)=>pairedFrames.has(p.frame));
  const observed:any[]=[];
  for(const run of raw.runs)for(const [time,tick,index] of run.points){
    const frame=raw.jolts[index].frame,p=input.points[frame];
    expect(Math.abs(p.pts-time)).toBeLessThan(.000002);
    observed.push({time,tick,frame,fire:p.fire,offset:p.truth_tick-tick,phase:((tick-p.step)%32+32)%32});
  }
  const offsets=[...new Set(observed.map(a=>a.offset))];
  const heldOut:number[]=[],videoHeldOut:number[]=[];
  for(const a of data.anchors){
    const own=data.anchors.filter(b=>b.segment===a.segment),i=own.indexOf(a);
    if(i===0||i===own.length-1)continue;
    const sample=timeReference({...state,data:{...data,anchors:data.anchors.filter(b=>b!==a)}}).sampleAt(a.time);
    if(!sample)continue;
    heldOut.push(Math.abs(sample.tick-a.tick));
    videoHeldOut.push(Math.abs(own[i-1].tick+20*(a.time-own[i-1].time)-a.tick));
  }
  // A single measured offset is a diagnostic reference, not an input to either fitted clock.
  const offset=observed[0]?.offset;
  const guiErrors=gui.points.map(p=>Math.abs(p.clock_tick!-(input.points[p.frame].truth_tick-offset)));
  const first=observed[0];
  const videoErrors=paired.map((p:any)=>Math.abs(first.tick+20*(p.pts-first.time)-(p.truth_tick-offset)));
  const holds=input.meta.capture_holds.map((h:any)=>{
    const before=observed.filter(a=>a.time<h.start).slice(-1)[0],after=observed.find(a=>a.time>h.end);
    const window=(lo:number,hi:number)=>gui.points.filter(p=>p.pts>=lo&&p.pts<=hi);
    const pre=window(h.start-10,h.start),post=window(h.end,h.end+10);
    const nextFire=gui.points.find(p=>p.pts>h.end),nextObservedFire=observed.find(a=>a.time>h.end&&a.fire);
    return {...h,paired_fire_during_hold:gui.points.filter(p=>p.frame>=h.first_frame&&p.frame<=h.last_frame).length,bracket:before&&after?{before,after,gui_ticks:after.tick-before.tick,client_ticks:input.points[after.frame].truth_tick-input.points[before.frame].truth_tick,nominal_video_ticks:20*(after.time-before.time),phase_delta:deviation(after.phase,before.phase)}:null,first_paired_fire_after:nextFire?{frame:nextFire.frame,time:nextFire.pts,gui_phase:nextFire.phase}:null,first_observed_fire_after:nextObservedFire??null,pre_phase:spread(pre),post_phase:spread(post)};
  });
  const nativeInput={cases:[{name:"video_full",points:fire},{name:"video_paired",points:paired},{name:"jolt_paired",points:gui.points.map(p=>({...p,fire:true,pts:p.clock_tick!/20}))}]};
  writeFileSync(resolve(work,"native-input.json"),JSON.stringify(nativeInput));
  const nativePath=resolve(work,"native.json");
  const summary={meta:input.meta,scanner:{version:raw.version,readable_fraction:raw.readable,resolved_anchors:observed.length,sections:raw.runs.map((r:any)=>({readings:r.points.length,first:r.points[0][0],last:r.points[r.points.length-1][0]})),breaks:raw.breaks.map((b:any)=>Object.fromEntries(Object.entries(b).filter(([key])=>key!=="frames"&&key!=="frame_positions"))),client_minus_gui_offsets:offsets,exact_observed_phase_values:[...new Set(observed.map(a=>a.phase))]},coverage:{fire_frames:fire.length,paired_fire_frames:paired.length,paired_fraction:paired.length/fire.length,observed_fire_anchors:observed.filter(a=>a.fire).length,uncovered_fire_frames:fire.length-paired.length},phase:{video_full:spread(fire),video_paired:spread(paired),jolt_paired:spread(gui.points),current_jolt_ui_flagged_frames:gui.flags.length},unwrapped_clock_error:{video_paired:distribution(videoErrors),jolt_paired:distribution(guiErrors)},held_out_clock_error:{jolt:distribution(heldOut),video:distribution(videoHeldOut)},holds,production_same_checker:nativePath&&existsSync(nativePath)?JSON.parse(readFileSync(nativePath,"utf8")):null,limits:["Same-checker native comparison uses canonical ticks/20 as a benchmark time coordinate; it is not the current frontend Jolt per-point flag rule.","No interpolation crosses imported breaks; missing coverage during a hold is not treated as successful per-frame correction.","Counter offset measured from the first accepted reading is used only to judge errors, never to construct the clock.","This is one held-out survival/LAN recording, not a generalisation guarantee."]};
  Object.assign(summary.scanner,{unique_timestamps:data.anchors.length,unresolved_readings:raw.jolts.filter((j:any)=>j.tick==null).length});
  Object.assign(summary,{worst_interpolation:gui.points.map(p=>({frame:p.frame,time:p.pts,error:p.clock_tick!-(input.points[p.frame].truth_tick-offset)})).sort((a,b)=>Math.abs(b.error)-Math.abs(a.error)).slice(0,5)});
  expect(offsets.length).toBeGreaterThan(0);
  writeFileSync(resolve("jolt-survival-summary.json"),JSON.stringify(summary,null,2)+"\n");
  writeFileSync(resolve(work,"observed.json"),JSON.stringify(observed,null,2));
},120000);
