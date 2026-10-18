import {useMemo,useState} from 'react';
import {ANIMATION_ATLASES,type AnimationAtlas,type TextureObservation} from '../lib/animationAtlases';
import type {JoltState} from '../lib/jolt';
import {textureJoltAgreement} from '../lib/textureJolt';
import type {AxisRange} from '../lib/plotAxes';
import {formatTime} from '../lib/timeline';
import {createFrameCursor} from './ChartCursor';
import {ComparisonPlot} from './ComparisonPlot';
import {PlotAxes} from './PlotAxes';

export function TextureJoltChart({atlas,points,state,fps,onJump}:{atlas:AnimationAtlas;points:TextureObservation[];state:JoltState;fps:number;onJump:(frame:number)=>void}){
 const data=useMemo(()=>textureJoltAgreement(points,atlas,state),[points,atlas,state]);
 const [range,setRange]=useState<AxisRange|null>(null),[vertical,setVertical]=useState<AxisRange|null>(null),[phaseVertical,setPhaseVertical]=useState<AxisRange|null>(null),[hover,setHover]=useState<number|null>(null);
 const name=ANIMATION_ATLASES[atlas].name;
 if(!data.anchors.length)return <div className="empty big-empty">Import a Jolt report to see Jolt + {name.toLowerCase()}.</div>;
 const [lo,hi]=range??[0,Math.max(1,data.anchors[data.anchors.length-1].time)];
 const visible=data.anchors.filter(p=>p.time>=lo&&p.time<=hi),values=(visible.length?visible:data.anchors).map(p=>p.tick);
 let min=Infinity,max=-Infinity;for(const v of values){min=Math.min(min,v);max=Math.max(max,v);}const pad=Math.max(1,(max-min)*.05);
 const y=vertical??[min-pad,max+pad] as AxisRange,phaseY=phaseVertical??[-data.period/2,data.period/2] as AxisRange;
 const formatX=(t:number)=>formatTime(t,.01),cursor=createFrameCursor(fps);
 const zoom=(factor:number,time=(lo+hi)/2)=>setRange([time+(lo-time)/factor,time+(hi-time)/factor]);
 const open=(time:number)=>onJump(Math.max(0,Math.round(time*fps)));
 return <section aria-label={`Jolt + ${name}`}>
  <div className="timeline-controls"><button onClick={()=>{setRange(null);setVertical(null);setPhaseVertical(null);}}>Full recording</button><button onClick={()=>zoom(1.5)}>Zoom in</button><button onClick={()=>zoom(1/1.5)}>Zoom out</button><span>{data.anchors.length} Jolt readings · {data.paired} paired labels</span></div>
  <div className="chart-head"><b>Jolt timeline</b><span>GUI time versus video time</span></div>
  <PlotAxes x={[lo,hi]} y={y} onX={setRange} onY={setVertical} resetX={()=>setRange(null)} resetY={()=>setVertical(null)} formatX={formatX}>
   <ComparisonPlot title={`${name}: Jolt timeline`} series={[{name:'Jolt reading / section fit',color:'#64a8d1',trace:data.clock,dots:true},{name:'Before-side continuation',color:'#55d8ed',trace:data.gaps.map(g=>g.before),dashed:true},{name:'After-side continuation',color:'#f2ba79',trace:data.gaps.map(g=>g.after),dashed:true}]} lo={lo} hi={hi} bottom={y[0]} top={y[1]} hover={hover} onHover={setHover} onPan={(x,y)=>{setRange(x);setVertical(y);}} onZoom={zoom} showXLabels={false} formatY={tick=>formatTime(tick/20,.01)} markers={data.markers} onOpenTime={open} snapTime={t=>cursor(t).time} cursorLabel={t=>cursor(t).label}/>
  </PlotAxes>
  <div className="chart-head"><b>{name}–Jolt phase agreement</b><span>Possible offsets · modulo {data.period}</span></div>
  <PlotAxes x={[lo,hi]} y={phaseY} onX={setRange} onY={setPhaseVertical} resetX={()=>setRange(null)} resetY={()=>setPhaseVertical(null)} formatX={formatX}>
   <ComparisonPlot title={`${name}: Jolt phase agreement`} series={[{name:'At a Jolt reading',color:'#50dba5',trace:data.observed},{name:'Estimated between readings',color:'#75b8ff',trace:data.estimated,dashed:true},{name:'Steady extrapolation (display only)',color:'#a0a8b8',trace:data.fallback,dashed:true}]} lo={lo} hi={hi} bottom={phaseY[0]} top={phaseY[1]} hover={hover} onHover={setHover} onPan={(x,y)=>{setRange(x);setPhaseVertical(y);}} onZoom={zoom} showXLabels={false} zeroLine markers={data.markers} onOpenTime={open} snapTime={t=>cursor(t).time} cursorLabel={t=>cursor(t).label}/>
  </PlotAxes>
  <details className="phase-help"><summary>Reading this chart</summary><p>Both plots use video time. The lower plot subtracts this animation’s possible playback ages from the GUI clock. Zero is the initial relationship; frame holds remain intervals. Still lava retains both possible directions. Grey intervals use display-only extrapolation across missing Jolt coverage. Ctrl-click opens the video; drag either plot to pan both timelines.</p></details>
 </section>;
}
