import {relativePhase,type PhaseChart} from './chart';
import {joltPhase,sessionOf,timeReference,type JoltState} from './jolt';
import type {Trace} from './clockComparison';
import {displayClockAt} from './reviewFlags';
import {FLAG_COLORS} from './flagAppearance';

export interface ClockMarker {time:number;end?:number;label:string;color:string;dashed?:boolean}

/** Events come from the report. Legacy projects expose section boundaries without guessing their cause. */
export function joltMarkers(state:JoltState):ClockMarker[]{
 const anchors=(state.data?.anchors??[]).filter(a=>sessionOf(a)===state.session);
 const events=(state.data?.events??[]).filter(e=>JSON.stringify([e.game,e.screen])===state.session);
 const markers:ClockMarker[]=events.map(e=>({time:e.from,end:e.to,label:e.kind==='removed'?'Reported cut':e.kind==='stalled'?'Reported clock stall':`Reported ${e.kind}`,color:FLAG_COLORS.jolt.color,dashed:true}));
 for(let i=1;i<anchors.length;i++){
  const a=anchors[i-1],b=anchors[i];
  if(a.segment!==b.segment&&!events.some(e=>e.from<=b.time&&e.to>=a.time))markers.push({time:a.time,end:b.time,label:'Clock section break · cause unspecified',color:'#e4bf59',dashed:true});
 }
 return markers;
}

/** Fixed initial offset, not a separate fit per section: genuine phase changes must remain visible. */
export function fireJoltAgreement(chart:PhaseChart|null,state:JoltState){
 const reference=timeReference({...state,clock:'jolt'});
 const paired=joltPhase(chart,reference),baseline=paired?.reference_phase??null;
 const anchors=(state.data?.anchors??[]).filter(a=>sessionOf(a)===state.session);
 const boundaries=anchors.slice(1).flatMap((a,i)=>a.segment!==anchors[i].segment||a.tick<anchors[i].tick?[a.time]:[]);
 const observed:Trace=[],estimated:Trace=[];
 let last:{time:number;value:number;estimated:boolean}|null=null;
 for(const p of paired?.points??[]){
  const value=relativePhase(p.phase,baseline??0),isEstimated=!!p.clock_estimated,trace=isEstimated?estimated:observed;
  const continuous=last&&p.pts>last.time&&p.pts-last.time<=2&&Math.abs(value-last.value)<=16&&!boundaries.some(t=>t>last!.time&&t<=p.pts)&&reference.sampleAt((last.time+p.pts)/2)!==null;
  if(!continuous||last!.estimated!==isEstimated)trace.push([]);
  trace[trace.length-1].push({time:p.pts,value});
  last={time:p.pts,value,estimated:isEstimated};
 }
 const fallback:Trace=[];
 let previous:{time:number;value:number}|null=null;
 for(const p of chart?.points??[]){
  const clock=displayClockAt(reference,p.pts,chart!.tick_rate);
  if(!clock?.fallback){previous=null;continue;}
  const value=relativePhase(clock.tick-p.step,baseline??0);
  if(!previous||p.pts<=previous.time||p.pts-previous.time>2||Math.abs(value-previous.value)>16)fallback.push([]);
  fallback[fallback.length-1].push({time:p.pts,value});previous={time:p.pts,value};
 }
 const gaps=anchors.slice(1).flatMap((b,i)=>{
  const a=anchors[i];
  if(b.time<=a.time||reference.sampleAt((a.time+b.time)/2)!==null)return [];
  const shift=b.tick-a.tick-20*(b.time-a.time);
  const leftPoints=paired?.points.filter(p=>p.pts<=a.time)??[];
  const left=leftPoints[leftPoints.length-1],right=paired?.points.find(p=>p.pts>=b.time);
  return [{from:a.time,to:b.time,shift,
   before:[{time:a.time,value:a.tick},{time:b.time,value:a.tick+20*(b.time-a.time)}],
   after:[{time:a.time,value:b.tick-20*(b.time-a.time)},{time:b.time,value:b.tick}],
   phaseBefore:left?[{time:a.time,value:relativePhase(left.phase,baseline??0)},{time:b.time,value:relativePhase(left.phase,baseline??0)}]:[],
   phaseAfter:right?[{time:a.time,value:relativePhase(right.phase-shift,baseline??0)},{time:b.time,value:relativePhase(right.phase-shift,baseline??0)}]:[],
  }];
 });
 return {observed,estimated,fallback,gaps,baseline,count:paired?.points.length??0};
}
