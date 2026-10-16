import type { ChartPoint } from './chart';
import { relativePhase } from './chart';
import { sessionOf, timeReference, type JoltState } from './jolt';

export interface TracePoint { time:number; value:number }
export type Trace = TracePoint[][];
/** Keep brief excursions as well as endpoints when reducing a long trace for display. */
export function thinTrace(points:TracePoint[],bins=1500):TracePoint[]{
  if(points.length<=bins*4)return points;
  const out:TracePoint[]=[];
  for(let start=0;start<points.length;start+=Math.ceil(points.length/bins)){
    const end=Math.min(points.length,start+Math.ceil(points.length/bins));let min=start,max=start;
    for(let i=start+1;i<end;i++){if(points[i].value<points[min].value)min=i;if(points[i].value>points[max].value)max=i;}
    for(const i of [...new Set([start,min,max,end-1])].sort((a,b)=>a-b))out.push(points[i]);
  }
  return out;
}
/** Local unwrap only: a missing interval never licenses guessing a whole number of fire cycles. */
export function straighten(points:TracePoint[],maxGap=2):Trace {
  const out:Trace=[];let previous:TracePoint|undefined,value=0;
  for(const p of points){
    if(!previous||p.time-previous.time>maxGap||p.time<=previous.time){out.push([]);value=p.value;}
    else value+=relativePhase(p.value,previous.value);
    out[out.length-1].push({...p,value});previous=p;
  }
  return out;
}
export function clockComparison(points:ChartPoint[],state:JoltState,unwrapped:boolean){
  const anchors=(state.data?.anchors??[]).filter(a=>sessionOf(a)===state.session);
  const first=anchors[0],origin=first?.tick??0,start=first?.time??0;
  const gui:Trace=[],residual:Trace=[];
  anchors.forEach((a,i)=>{
    if(!i||a.segment!==anchors[i-1].segment){gui.push([]);residual.push([]);}
    gui[gui.length-1].push({time:a.time,value:a.tick});
    residual[residual.length-1].push({time:a.time,value:a.tick-origin-20*(a.time-start)});
  });
  const reference=timeReference({...state,clock:'jolt'});
  const baseline=points[0]?.phase??0;
  const video=points.map(p=>({time:p.pts,value:relativePhase(p.phase,baseline)}));
  const paired=points.flatMap(p=>{const tick=reference.tickAt(p.pts);return tick===null?[]:[{time:p.pts,value:tick-p.step}];});
  const base=paired[0]?.value??0;
  const corrected=paired.map(p=>({...p,value:relativePhase(p.value,base)}));
  // Explicitly split canonical traces at imported breaks even when anchors are close together.
  const parts:Trace=[];
  for(const segment of new Set(anchors.map(a=>a.segment))){
    const own=anchors.filter(a=>a.segment===segment),lo=own[0].time,hi=own[own.length-1].time;
    const values=corrected.filter(p=>p.time>=lo&&p.time<=hi);
    parts.push(...straighten(values));
  }
  const splitVideo=straighten(video);
  const wrapped=(trace:Trace)=>trace.flatMap(run=>{
    const parts:Trace=[];let previous:number|undefined;
    for(const p of run){
      const value=relativePhase(p.value,0);
      if(previous===undefined||Math.abs(value-previous)>16)parts.push([]);
      parts[parts.length-1].push({...p,value});previous=value;
    }
    return parts;
  });
  return {gui,residual,video:unwrapped?splitVideo:wrapped(splitVideo),corrected:unwrapped?parts:wrapped(parts),start,origin};
}
