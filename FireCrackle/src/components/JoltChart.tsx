import {useEffect,useMemo,useState} from 'react';
import {sessionOf,type JoltState} from '../lib/jolt';
import type {Trace} from '../lib/clockComparison';
import type {AxisRange} from '../lib/plotAxes';
import {formatTime} from '../lib/timeline';
import {ComparisonPlot} from './ComparisonPlot';
import {PlotAxes} from './PlotAxes';
import {IconButton} from './Icon';
import type {PhaseChart} from '../lib/chart';
import {fireJoltAgreement,joltMarkers} from '../lib/joltAgreement';
import {ChartLegend} from './ChartLegend';
import {joltCursorText} from '../lib/reviewFlags';
import {flagText} from '../lib/flagText';
import {FLAG_COLORS} from '../lib/flagAppearance';

/** The imported Jolt timeline itself, separate from the fire plots' selected clock. */
export function JoltChart({state,chart=null,focusRange=null,onOpenTime}:{state:JoltState;chart?:PhaseChart|null;focusRange?:AxisRange|null;onOpenTime?:(time:number)=>void}){
 const [range,setRange]=useState<AxisRange|null>(null),[vertical,setVertical]=useState<AxisRange|null>(null),[hover,setHover]=useState<number|null>(null);
 const anchors=useMemo(()=>(state.data?.anchors??[]).filter(a=>sessionOf(a)===state.session),[state.data,state.session]);
 const [phaseVertical,setPhaseVertical]=useState<AxisRange|null>(null);
 const [cursor,setCursor]=useState<{time:number;value:number;phase:boolean}|null>(null);
 useEffect(()=>{if(focusRange){const span=Math.max(3,(focusRange[1]-focusRange[0])*1.5),mid=(focusRange[0]+focusRange[1])/2;setRange([Math.max(0,mid-span/2),Math.max(span,mid+span/2)]);}},[focusRange]);
 const agreement=useMemo(()=>fireJoltAgreement(chart,state),[chart,state]);
 const markers=useMemo(()=>chart?.review_flags?[
  ...joltMarkers(state).filter(m=>m.label.includes('cause unspecified')),
  ...chart.flags.map((f,i)=>({time:chart.flag_positions?.[i]?.t0??f.frame/60,end:chart.flag_positions?.[i]?.t1??f.end_frame/60,label:flagText(f.kind,chart.flag_details?.[i]?.explanation).name,color:FLAG_COLORS[f.severity].color,dashed:!!chart.flag_positions?.[i]?.uncertain}))
 ]:joltMarkers(state),[state,chart]);
 const trace=useMemo(()=>{
  const runs:Trace=[];
  anchors.forEach((a,i)=>{if(!i||a.segment!==anchors[i-1].segment||a.tick<anchors[i-1].tick)runs.push([]);runs[runs.length-1].push({time:a.time,value:a.tick});});
  return runs;
 },[anchors]);
 const full:AxisRange=[0,Math.max(1,anchors[anchors.length-1]?.time??1)];
 const [lo,hi]=range??full;
 const annotations=agreement.gaps.flatMap(g=>g.to>=lo&&g.from<=hi?[{time:Math.max(lo,g.from),text:`Clock continuation Δ ${g.shift>=0?'+':''}${g.shift.toFixed(1)} ticks (${(g.shift/20).toFixed(3)} s) · estimate`}]:[]);
 const values=anchors.filter(a=>a.time>=lo&&a.time<=hi).map(a=>a.tick);
 for(const g of agreement.gaps)if(g.to>=lo&&g.from<=hi)for(const run of [g.before,g.after]){const slope=(run[1].value-run[0].value)/(g.to-g.from);for(const t of [Math.max(lo,g.from),Math.min(hi,g.to)])values.push(run[0].value+slope*(t-g.from));}
 const min=values.reduce((a,b)=>Math.min(a,b),values[0]??anchors[0]?.tick??0),max=values.reduce((a,b)=>Math.max(a,b),values[0]??anchors[anchors.length-1]?.tick??1);
 const pad=Math.max(1,(max-min)*.05),[bottom,top]=vertical??[min-pad,max+pad];
 function fit(){setRange(null);setVertical(null);setPhaseVertical(null);}
 function zoom(factor:number){const mid=(lo+hi)/2,half=(hi-lo)/2/factor;setRange([mid-half,mid+half]);}
 if(!anchors.length)return <div className="empty big-empty">Import a Jolt report to see its recovered GUI tick timeline.</div>;
 const timeLabel=(t:number)=>`${t<0?'−':''}${formatTime(Math.abs(t),.01)}`;
 const zoomAt=(factor:number,time:number)=>{const f=Math.max(.1,Math.min(10,factor));setRange([time+(lo-time)/f,time+(hi-time)/f]);};
 const phaseY=phaseVertical??[-16,16];
 return <section className="jolt-timeline" aria-label="Jolt + Fire">
  <div className="timeline-controls">
   <IconButton icon="zoomOut" label="Zoom out Jolt timeline" onClick={()=>zoom(1/1.5)}/>
   <IconButton icon="zoomIn" label="Zoom in Jolt timeline" onClick={()=>zoom(1.5)}/>
   <IconButton icon="fit" label="Fit Jolt timeline" onClick={fit}/>
   <span>{anchors.length} Jolt readings · {agreement.count.toLocaleString()} paired fire labels · shared video timeline</span>
  </div>
  <div className="chart-head"><b>Jolt timeline</b><span>Y: GUI time · lime dots = readings · blue = section fit</span></div>
  <ChartLegend kind="jolt" continuations/>
  <PlotAxes x={[lo,hi]} y={[bottom,top]} onX={setRange} onY={setVertical} resetX={()=>setRange(null)} resetY={()=>setVertical(null)} formatX={t=>`${t<0?'−':''}${formatTime(Math.abs(t),.01)}`}>
   <ComparisonPlot title="Recovered GUI time against video time" series={[{name:'Jolt reading / section fit',color:'#64a8d1',trace,dots:true},{name:'Before-side continuation',color:'#55d8ed',trace:agreement.gaps.map(g=>g.before),dashed:true},{name:'After-side continuation',color:'#f2ba79',trace:agreement.gaps.map(g=>g.after),dashed:true}]} annotations={annotations} onOpenTime={onOpenTime} lo={lo} hi={hi} bottom={bottom} top={top} hover={hover} onHover={setHover} onCursor={p=>setCursor(p?{...p,phase:false}:null)} showXLabels={false} formatY={tick=>timeLabel(tick/20)} markers={markers} onZoom={zoomAt} onPan={(x,y)=>{setRange(x);setVertical(y);}}/>
  </PlotAxes>
  <div className="jolt-cursor" role="status">{joltCursorText(state,chart,cursor&&!cursor.phase?cursor.time:null,false,cursor&&!cursor.phase?cursor.value:undefined)}</div>
  <div className="chart-head"><b>Fire–Jolt phase agreement</b><span>Y: offset from initial phase · ticks modulo 32</span></div>
  <ChartLegend kind="agreement" continuations/>
  <PlotAxes x={[lo,hi]} y={phaseY as AxisRange} onX={setRange} onY={setPhaseVertical} resetX={()=>setRange(null)} resetY={()=>setPhaseVertical(null)} formatX={timeLabel}>
   <ComparisonPlot title="Fire–Jolt phase agreement against video time" series={[{name:'Fire at a Jolt reading',color:'#50dba5',trace:agreement.observed},{name:'Fire with estimated Jolt clock',color:'#75b8ff',trace:agreement.estimated,dashed:true},{name:'Fire with steady extrapolated clock (display only)',color:'#a0a8b8',trace:agreement.fallback,dashed:true},{name:'Before-side continuation',color:'#55d8ed',trace:agreement.gaps.map(g=>g.phaseBefore),dashed:true},{name:'After-side continuation',color:'#f2ba79',trace:agreement.gaps.map(g=>g.phaseAfter),dashed:true}]} annotations={annotations} onOpenTime={onOpenTime} lo={lo} hi={hi} bottom={phaseY[0]} top={phaseY[1]} hover={hover} onHover={setHover} onCursor={p=>setCursor(p?{...p,phase:true}:null)} showXLabels={false} markers={markers} zeroLine onZoom={zoomAt} onPan={(x,y)=>{setRange(x);setPhaseVertical(y);}}/>
  </PlotAxes>
  {!agreement.count&&<p className="dim">No fire labels overlap this Jolt section for the selected label source.</p>}
  <div className="jolt-cursor" role="status">{joltCursorText(state,chart,cursor?.phase?cursor.time:null,true,cursor?.phase?cursor.value:undefined)}</div>
  <details className="phase-help"><summary>Reading these charts</summary><p>Both X axes show video time. The upper Y axis shows recovered GUI ticks as time at 20 ticks/second. Lines fit within reported continuous sections. Dashed cyan and peach lines continue the clocks on either side across a break; their full separation is labelled. Ctrl-click either plot to open that video position in Label. Drag either plot to pan both timelines; drag X or Y axes to zoom independently.</p><p>The lower chart subtracts the fire step from the Jolt clock, modulo 32, then subtracts the first paired offset{agreement.baseline===null?'':` (${agreement.baseline.toFixed(2)} ticks)`}. Zero means the initial relationship is preserved. Dashed fire traces use an estimated clock between readings. Grey fire uses a steady extrapolation through missing Jolt coverage, keeping jumps visible instead of spreading them into drift. It is display only and adds no independent evidence. A cut can preserve this relationship when both clocks advance together, and a change of 32 ticks is invisible here.</p></details>
 </section>;
}
