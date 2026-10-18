import {ANIMATION_ATLASES,type AnimationAtlas,type TextureObservation} from './animationAtlases';
import {modulo,texturePhaseIntervals} from './animationCharts';
import {sessionOf,timeReference,type JoltState} from './jolt';
import {fireJoltAgreement,joltMarkers} from './joltAgreement';
import {displayClockAt} from './reviewFlags';
import type {Trace} from './clockComparison';

/** Retain all possible animation ages; this never combines different materials. */
export function textureJoltAgreement(points:TextureObservation[],atlas:AnimationAtlas,state:JoltState){
 const period=ANIMATION_ATLASES[atlas].period,half=period/2,reference=timeReference({...state,clock:'jolt'});
 const anchors=(state.data?.anchors??[]).filter(a=>sessionOf(a)===state.session);
 const clock:Trace=[];
 anchors.forEach((a,i)=>{if(!i||a.segment!==anchors[i-1].segment||a.tick<anchors[i-1].tick)clock.push([]);clock[clock.length-1].push({time:a.time,value:a.tick});});
 const selected=points.filter(p=>p.atlas===atlas).slice().sort((a,b)=>a.pts-b.pts);
 const first=selected.find(p=>reference.sampleAt(p.pts)!==null);
 const initial=first?texturePhaseIntervals(atlas,first.row,reference.tickAt(first.pts)!)[0]:null;
 // A deterministic initial branch establishes display zero, never additional evidence.
 const baseline=initial?modulo(initial.start+initial.duration/2,period):0;
 const observed:Trace=[],estimated:Trace=[],fallback:Trace=[];let paired=0;
 for(const p of selected){
  const known=reference.sampleAt(p.pts),sample=known??displayClockAt(reference,p.pts);
  if(!sample)continue;if(known)paired++;
  const trace=!known?fallback:known.estimated?estimated:observed;
  for(const interval of texturePhaseIntervals(atlas,p.row,sample.tick)){
   const start=modulo(interval.start-baseline+half,period)-half,end=start+interval.duration;
   trace.push([{time:p.pts,value:start},{time:p.pts,value:Math.min(half,end)}]);
   if(end>half)trace.push([{time:p.pts,value:-half},{time:p.pts,value:end-period}]);
  }
 }
 return {anchors,clock,observed,estimated,fallback,paired,period,baseline:initial?baseline:null,
  gaps:fireJoltAgreement(null,state).gaps,markers:joltMarkers(state)};
}
