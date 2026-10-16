import {useMemo,useState} from 'react';
import {sessionOf,type JoltState} from '../lib/jolt';
import type {Trace} from '../lib/clockComparison';
import type {AxisRange} from '../lib/plotAxes';
import {formatTime} from '../lib/timeline';
import {ComparisonPlot} from './ComparisonPlot';
import {PlotAxes} from './PlotAxes';
import {IconButton} from './Icon';

/** The imported Jolt timeline itself, separate from the fire plots' selected clock. */
export function JoltChart({state}:{state:JoltState}){
 const [range,setRange]=useState<AxisRange|null>(null),[vertical,setVertical]=useState<AxisRange|null>(null),[hover,setHover]=useState<number|null>(null);
 const anchors=useMemo(()=>(state.data?.anchors??[]).filter(a=>sessionOf(a)===state.session),[state.data,state.session]);
 const trace=useMemo(()=>{
  const runs:Trace=[];
  anchors.forEach((a,i)=>{if(!i||a.segment!==anchors[i-1].segment)runs.push([]);runs[runs.length-1].push({time:a.time,value:a.tick});});
  return runs;
 },[anchors]);
 const full:AxisRange=[0,Math.max(1,anchors[anchors.length-1]?.time??1)];
 const [lo,hi]=range??full;
 const values=anchors.filter(a=>a.time>=lo&&a.time<=hi).map(a=>a.tick);
 const min=values.reduce((a,b)=>Math.min(a,b),values[0]??anchors[0]?.tick??0),max=values.reduce((a,b)=>Math.max(a,b),values[0]??anchors[anchors.length-1]?.tick??1);
 const pad=Math.max(1,(max-min)*.05),[bottom,top]=vertical??[min-pad,max+pad];
 function fit(){setRange(null);setVertical(null);}
 function zoom(factor:number){const mid=(lo+hi)/2,half=(hi-lo)/2/factor;setRange([mid-half,mid+half]);}
 if(!anchors.length)return <div className="empty big-empty">Import a Jolt report to see its recovered GUI tick timeline.</div>;
 return <section className="jolt-timeline" aria-label="Jolt timeline">
  <div className="chart-head"><b>Jolt timeline</b><span>X: video time · Y: recovered GUI ticks</span></div>
  <div className="timeline-controls">
   <IconButton icon="zoomOut" label="Zoom out Jolt timeline" onClick={()=>zoom(1/1.5)}/>
   <IconButton icon="zoomIn" label="Zoom in Jolt timeline" onClick={()=>zoom(1.5)}/>
   <IconButton icon="fit" label="Fit Jolt timeline" onClick={fit}/>
   <span>{anchors.length} readings · gaps between reported sections stay disconnected</span>
  </div>
  <PlotAxes x={[lo,hi]} y={[bottom,top]} onX={setRange} onY={setVertical} resetX={()=>setRange(null)} resetY={()=>setVertical(null)} formatX={t=>`${t<0?'−':''}${formatTime(Math.abs(t),.01)}`}>
   <ComparisonPlot title="Recovered GUI ticks against video time" series={[{name:'Recovered GUI ticks',color:'#50e1ff',trace}]} lo={lo} hi={hi} bottom={bottom} top={top} hover={hover} onHover={setHover} showXLabels={false} onPan={(x,y)=>{setRange(x);setVertical(y);}}/>
  </PlotAxes>
 </section>;
}
