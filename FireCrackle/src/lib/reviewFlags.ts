import type { Flag } from "./api";
import type { PhaseChart, FlagDetail } from "./chart";
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

/** Project review intervals using observed bounds only. A missing sample is shown
 * across its bracketing clock interval; it must never become an interpolated fact.
 */
export function canonicalFlagPositions(positions:NonNullable<PhaseChart['flag_positions']>,reference:TimeReference,origin:number):NonNullable<PhaseChart['flag_positions']> {
  const times=reference.sampleTimes;
  function bounds(time:number):{lo:number;hi:number;uncertain:boolean} {
    const sample=reference.sampleAt(time);
    if(sample)return {lo:sample.tick,hi:sample.tick,uncertain:false};
    let lo=0,hi=times.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(times[mid]<time)lo=mid+1;else hi=mid;}
    const before=reference.sampleAt(times[Math.max(0,lo-1)]),after=reference.sampleAt(times[Math.min(times.length-1,lo)]);
    const a=before?.tick??after?.tick??origin,b=after?.tick??before?.tick??origin;
    return {lo:Math.min(a,b),hi:Math.max(a,b),uncertain:true};
  }
  return positions.map(p=>{const a=bounds(p.t0),b=bounds(p.t1);return {t0:(Math.min(a.lo,b.lo)-origin)/20,t1:(Math.max(a.hi,b.hi)-origin)/20,uncertain:!!p.uncertain||a.uncertain||b.uncertain};});
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
