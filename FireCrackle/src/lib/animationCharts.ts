import {ANIMATION_ATLASES,atlasIntervals,soulFire,type AnimationAtlas,type TextureObservation} from './animationAtlases';
import type {PhaseChart} from './chart';
import {forwardTransitionChart} from './fireTransitions';

export const ANIMATION_CHARTS = [
 ['fire','Fire'],['soul','Soul fire'],['lava_still','Still lava'],['lava_flow','Flowing lava'],['water_still','Still water'],['water_flow','Flowing water'],
] as const;
export type AnimationChart = typeof ANIMATION_CHARTS[number][0];
export const isFluidChart=(id:AnimationChart):id is Exclude<AnimationAtlas,'soul_fire_0'|'soul_fire_1'>=>id!=='fire'&&id!=='soul';

/** Keep material provenance even though normal and soul fire share a 32-tick clock. */
export function fireMaterialChart(chart:PhaseChart|null,material:'fire'|'soul'):PhaseChart|null {
 if(!chart)return null;
 const soulFrames=new Set((chart.texture_points??[]).filter(p=>soulFire(p.atlas)).map(p=>p.frame));
 if(material==='fire'&&!soulFrames.size)return chart;
 const points=chart.points.filter(p=>soulFrames.has(p.frame)===(material==='soul'));
 // Recalculate local review events on this source; never reuse a cross-material transition.
 return forwardTransitionChart({...chart,points,runs:[],reference_phase:points[0]?.phase??null,flags:[],flag_details:[]});
}
export const modulo=(n:number,period:number)=>((n%period)+period)%period;
export function texturePhaseIntervals(atlas:AnimationAtlas,row:number,tick:number){
 const period=ANIMATION_ATLASES[atlas].period;
 return atlasIntervals(atlas,row).map(i=>({start:modulo(tick-i.start-i.duration,period),duration:i.duration}));
}
/** Maximum interval agreement, retaining both directions of ping-pong playback.
 * Sweep exact interval boundaries rather than treating a held image as an exact tick. */
export function fitTexturePhase(points:TextureObservation[],atlas:AnimationAtlas,tickAt:(time:number)=>number|null):number|null {
 const period=ANIMATION_ATLASES[atlas].period,events:{x:number;delta:number}[]=[];
 for(const p of points){
  if(p.atlas!==atlas)continue;const tick=tickAt(p.pts);if(tick===null)continue;
  for(const i of texturePhaseIntervals(atlas,p.row,tick)){
   const end=i.start+i.duration;
   events.push({x:i.start,delta:1},{x:Math.min(end,period),delta:-1});
   if(end>period)events.push({x:0,delta:1},{x:end-period,delta:-1});
  }
 }
 if(!events.length)return null;
 events.sort((a,b)=>a.x-b.x);let count=0,best=0,answer=0;
 for(let i=0;i<events.length;){const x=events[i].x;while(i<events.length&&events[i].x===x)count+=events[i++].delta;
  const end=events[i]?.x??period;if(count>best&&end>x){best=count;answer=(x+end)/2;}
 }
 return answer;
}

export interface TextureTransition {frame:number;first:number;time:number;minimum:number;available:number}
/** Track possible playback ages over consecutive labelled frames. This catches early
 * reversals as well as excessive speed, without choosing a direction from one image.
 * Missing frames/clock coverage restart the constraint chain; no joint-source inference. */
export function textureTransitions(points:TextureObservation[],atlas:AnimationAtlas,tickAt:(time:number)=>number|null):TextureTransition[]{
 const period=ANIMATION_ATLASES[atlas].period,events:TextureTransition[]=[];
 const ages=(row:number)=>atlasIntervals(atlas,row).flatMap(i=>Array.from({length:i.duration},(_,n)=>i.start+n));
 let previous:TextureObservation|undefined,previousTick:number|null=null,possible:number[]=[];
 for(const p of points.filter(p=>p.atlas===atlas).slice().sort((a,b)=>a.frame-b.frame)){
  const tick=tickAt(p.pts),observed=ages(p.row);
  if(previous&&tick!==null&&previousTick!==null&&p.frame===previous.frame+1&&tick>=previousTick&&p.pts>previous.pts){
   const available=Math.ceil(tick-previousTick)+1; // Same one-tick scheduling slack as fire.
   if(available<period){
    let minimum=Infinity;
    const next=observed.filter(b=>possible.some(a=>{const advance=modulo(b-a,period);minimum=Math.min(minimum,advance);return advance<=available;}));
    if(!next.length&&possible.length)events.push({frame:p.frame,first:previous.frame,time:p.pts,minimum,available});
    possible=next.length?next:observed;
   }else possible=observed;
  }else possible=observed;
  previous=p;previousTick=tick;
 }
 return events;
}
