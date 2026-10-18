import {ANIMATION_ATLASES,atlasIntervals,soulFire} from './animationAtlases';
import type {PhaseChart} from './chart';
import type {TimeReference} from './jolt';

export const JOINT_MODULI=[32,64,96,608,1216,3648] as const;
export const JOINT_MATERIALS={
 fire:{name:'Fire',color:'#4a90d9'},soul:{name:'Soul fire',color:'#63e4e0'},
 lava_still:{name:'Still lava',color:'#ff707b'},lava_flow:{name:'Flowing lava',color:'#dc91ff'},
 water_still:{name:'Still water',color:'#6da7ff'},water_flow:{name:'Flowing water',color:'#b9da66'},
} as const;
export type JointMaterial=keyof typeof JOINT_MATERIALS;
export interface Interval {start:number;end:number}
export interface JointSample {
 frame:number;pts:number;tick:number;estimated:boolean;material:JointMaterial;period:number;
 ages:{start:number;duration:number}[];
}
const mod=(n:number,p:number)=>((n%p)+p)%p;
function gcd(a:number,b:number):number {while(b){const r=a%b;a=b;b=r;}return a;}
export function mergeIntervals(intervals:Interval[]):Interval[]{
 const sorted=intervals.slice().sort((a,b)=>a.start-b.start||a.end-b.end),out:Interval[]=[];
 for(const i of sorted){const last=out[out.length-1];if(last&&i.start<=last.end)last.end=Math.max(last.end,i.end);else out.push({...i});}
 return out;
}
/** Project ALL integer wraps of each native period onto the requested circle.
 * Reachable translations are multiples of gcd(native period, display modulus),
 * not just one selected/nearest wrap. Endpoints conservatively include tick boundaries. */
export function projectOffsets(sample:JointSample,modulus:number,origin=0):Interval[]{
 if(!Number.isSafeInteger(modulus)||modulus<=0||!Number.isSafeInteger(sample.period)||sample.period<=0||!Number.isFinite(sample.tick)||!Number.isFinite(origin))return [];
 const spacing=gcd(sample.period,modulus),out:Interval[]=[];
 for(const age of sample.ages){
  if(!Number.isFinite(age.start)||!Number.isFinite(age.duration)||age.duration<=0)continue;
  if(age.duration>=spacing)return [{start:0,end:modulus}];
  const base=mod(sample.tick-origin-age.start-age.duration,spacing);
  for(let start=base;start<modulus;start+=spacing){const end=start+age.duration;out.push({start,end:Math.min(end,modulus)});if(end>modulus)out.push({start:0,end:end-modulus});}
 }
 // Zero and modulus are the same boundary of this closed uncertainty circle.
 if(out.some(i=>i.end===modulus))out.push({start:0,end:0});
 if(out.some(i=>i.start===0))out.push({start:modulus,end:modulus});
 return mergeIntervals(out);
}
/** The familiar signed Timing view. Keep exact possibilities for inspection, but
 * show one explicitly provisional wrap nearest the SAME reference for all materials.
 * This display selection never enters a detector or changes another material's origin. */
export function timingOffset(sample:JointSample,modulus:number,origin=0){
 const intervals=projectOffsets(sample,modulus,origin+modulus/2).map(i=>({start:i.start-modulus/2,end:i.end-modulus/2}));
 if(intervals.length===1&&intervals[0].end-intervals[0].start>=modulus)return {value:null,intervals,ambiguous:true};
 let value:number|null=null;
 for(const i of intervals){const v=i.end;if(value===null||Math.abs(v)<Math.abs(value)||Math.abs(v)===Math.abs(value)&&v>value)value=v;}
 return {value,intervals,ambiguous:sample.ages.length>1||sample.period%modulus!==0};
}
/** Existing fire step and soul row are already metadata sequence indices, not physical tiles. */
export function jointSamples(chart:PhaseChart|null,clock:TimeReference):JointSample[]{
 if(!chart)return [];
 const out:JointSample[]=[],textures=chart.texture_points??[],soulFrames=new Set(textures.filter(p=>soulFire(p.atlas)).map(p=>p.frame));
 const add=(frame:number,pts:number,material:JointMaterial,period:number,ages:JointSample['ages'])=>{
  const s=clock.sampleAt(pts);if(s&&Number.isFinite(s.tick)&&ages.length)out.push({frame,pts,material,period,ages,tick:s.tick,estimated:s.estimated});
 };
 for(const p of chart.points)if(!soulFrames.has(p.frame)&&Number.isInteger(p.step)&&p.step>=0&&p.step<32)add(p.frame,p.pts,'fire',32,[{start:p.step,duration:1}]);
 for(const p of textures){const a=ANIMATION_ATLASES[p.atlas];if(a)add(p.frame,p.pts,soulFire(p.atlas)?'soul':p.atlas as JointMaterial,a.period,atlasIntervals(p.atlas,p.row));}
 return out.sort((a,b)=>a.frame-b.frame||a.pts-b.pts);
}
/** Same captured frame only. No interpolation or propagation between different labels.
 * This is projected agreement, NOT a full-period hard-flag certificate. */
export function sharedOffsets(samples:JointSample[],modulus:number,origin=0){
 const frames=new Map<number,JointSample[]>();
 for(const p of samples){const group=frames.get(p.frame)??[];group.push(p);frames.set(p.frame,group);}
 return [...frames.values()].filter(group=>new Set(group.map(p=>p.material)).size>1).map(group=>{
  let intervals=projectOffsets(group[0],modulus,origin);
  for(const p of group.slice(1)){
   const next=projectOffsets(p,modulus,origin),intersection:Interval[]=[];let a=0,b=0;
   while(a<intervals.length&&b<next.length){const start=Math.max(intervals[a].start,next[b].start),end=Math.min(intervals[a].end,next[b].end);if(start<=end)intersection.push({start,end});if(intervals[a].end<next[b].end)a++;else b++;}
   intervals=mergeIntervals(intersection);
  }
  return {frame:group[0].frame,pts:group[0].pts,tick:group[0].tick,intervals};
 });
}
