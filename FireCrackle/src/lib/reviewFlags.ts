import type { Flag } from "./api";
import {relativePhase,type PhaseChart,type FlagDetail} from "./chart";
import {sessionOf, type JoltState, type TimeReference} from "./jolt";

/** One review list: local fire events plus imported Jolt events, regardless of display clock.
 * A report locates a bounded interval, not necessarily the exact changed frame.
 */
export function reviewChart(chart:PhaseChart|null,state:JoltState,fps:number):PhaseChart|null {
  if(!chart)return null;
  const times=new Map(chart.points.map(p=>[p.frame,p.video_pts??p.pts]));
  const entries=chart.flags.map((flag,i)=>({flag,detail:chart.flag_details?.[i],position:{t0:times.get(flag.frame)??flag.frame/fps,t1:times.get(flag.end_frame)??flag.end_frame/fps,uncertain:false}}));
  for(const event of state.data?.events??[]){
    if(JSON.stringify([event.game,event.screen])!==state.session||!['removed','stalled'].includes(event.kind))continue;
    const frame=Math.max(0,Math.round(event.from*fps)),end_frame=Math.max(frame,Math.round(event.to*fps));
    const flag:Flag={frame,end_frame,kind:'jolt_report',severity:'jolt',phase_delta:(event.jump_seconds??0)*20};
    const detail:FlagDetail={...flag,clock_delta:flag.phase_delta,held_ticks:null,explanation:`jolt_${event.kind}: Jolt reports ${event.kind==='removed'?'missing footage':'a clock stall'} between video ${event.from.toFixed(3)} and ${event.to.toFixed(3)} seconds. The interval is bounded by readings; it does not establish the exact frame or the cause.`};
    entries.push({flag,detail,position:{t0:event.from,t1:event.to,uncertain:true}});
  }
  entries.sort((a,b)=>a.position.t0-b.position.t0||a.position.t1-b.position.t1);
  return {...chart,review_flags:true,flags:entries.map(e=>e.flag),flag_details:entries.map(e=>e.detail??({...e.flag,clock_delta:e.flag.phase_delta,held_ticks:null,explanation:''})),flag_positions:entries.map(e=>e.position)};
}

/** Display-only clock placement. This never changes TimeReference.sampleAt or
 * supplies evidence to flagging, agreement statistics or clock fitting. */
export function displayClockAt(reference:TimeReference,time:number,rate=20):{tick:number;estimated:boolean;fallback:boolean}|null {
  const known=reference.sampleAt(time);
  if(known)return {...known,fallback:false};
  if(!Number.isFinite(time)||!reference.sampleTimes.length)return null;
  const times=reference.sampleTimes;
  let lo=0,hi=times.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(times[mid]<time)lo=mid+1;else hi=mid;}
  const before=lo>0?reference.sampleAt(times[lo-1]):null,after=lo<times.length?reference.sampleAt(times[lo]):null;
  let tick:number;
  if(before&&after&&after.tick>=before.tick&&times[lo]>times[lo-1])tick=before.tick+(time-times[lo-1])/(times[lo]-times[lo-1])*(after.tick-before.tick);
  else if(before)tick=before.tick+(time-times[lo-1])*rate;
  else if(after)tick=after.tick+(time-times[lo])*rate;
  else return null;
  return {tick,estimated:true,fallback:true};
}

/** Estimated display positions retain the known video location of a fire event,
 * instead of expanding a one-frame jump over the entire unresolved clock span. */
export function canonicalFlagPositions(positions:NonNullable<PhaseChart['flag_positions']>,reference:TimeReference,origin:number):NonNullable<PhaseChart['flag_positions']> {
  return positions.map(p=>{const a=displayClockAt(reference,p.t0),b=displayClockAt(reference,p.t1);return {t0:((a?.tick??origin)-origin)/20,t1:((b?.tick??origin)-origin)/20,uncertain:!!p.uncertain||!!a?.fallback||!!b?.fallback};});
}

/** Two continuations, never a fit across the break. Their full clock separation
 * is retained even when the phase drawing wraps modulo 32. */
export function clockGapGuides(chart:PhaseChart,reference:TimeReference,origin:number):NonNullable<PhaseChart['gap_guides']> {
 const out:NonNullable<PhaseChart['gap_guides']>=[],points=chart.points;
 const baseline=chart.reference_phase??points[0]?.phase??0,rate=chart.tick_rate;
 for(let i=1;i<reference.sampleTimes.length;i++){
  const from=reference.sampleTimes[i-1],to=reference.sampleTimes[i];
  if(!(to>from)||reference.sampleAt((from+to)/2)!==null)continue;
  const a=reference.sampleAt(from),b=reference.sampleAt(to);
  if(!a||!b)continue;
  let lo=0,hi=points.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid].pts<=from)lo=mid+1;else hi=mid;}
  const left=points[lo-1];lo=0;hi=points.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid].pts<to)lo=mid+1;else hi=mid;}
  const right=points[lo];
  if(!left||!right)continue;
  const before:{time:number;value:number}[]=[],after:{time:number;value:number}[]=[];
  for(let j=0;j<=64;j++){
   const t=from+(to-from)*j/64,tick=a.tick+(b.tick-a.tick)*j/64,time=(tick-origin)/20;
   before.push({time,value:relativePhase(tick-(a.tick+rate*(t-from))+left.phase,baseline)});
   after.push({time,value:relativePhase(tick-(b.tick+rate*(t-to))+right.phase,baseline)});
  }
  out.push({t0:(a.tick-origin)/20,t1:(b.tick-origin)/20,shift_ticks:b.tick-a.tick-rate*(to-from),before,after});
 }
 return out;
}

export function joltCursorText(state:JoltState,chart:PhaseChart|null,time:number|null,phasePlot:boolean,value?:number):string {
  if(time===null)return 'Hover a plot to see video time and values.';
  const anchors=(state.data?.anchors??[]).filter(a=>sessionOf(a)===state.session);
  let closest=anchors[0];
  for(const a of anchors)if(!closest||Math.abs(a.time-time)<Math.abs(closest.time-time))closest=a;
  let point:PhaseChart['points'][number]|undefined;
  for(const p of chart?.points??[])if(!point||Math.abs(p.pts-time)<Math.abs(point.pts-time))point=p;
  const timeText=`Video ${time.toFixed(3)} s${value===undefined?'':phasePlot?` · cursor phase ${value>=0?'+':''}${value.toFixed(2)} ticks`:` · cursor GUI ${value.toFixed(2)} ticks (${(value/20).toFixed(3)} s)`}`;
  if(!phasePlot)return closest?`${timeText} · nearest Jolt reading: ${closest.tick} GUI ticks at ${closest.time.toFixed(3)} s`:`${timeText} · no Jolt reading`;
  return point?`${timeText} · nearest fire: frame ${point.frame}, row ${point.step} at ${point.pts.toFixed(3)} s`:`${timeText} · no fire evidence`;
}
