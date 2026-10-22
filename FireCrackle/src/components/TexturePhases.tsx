import {useMemo,useState} from 'react';
import {ANIMATION_ATLASES,atlasIntervals,type AnimationAtlas,type TextureObservation} from '../lib/animationAtlases';
import {fitTexturePhase,modulo,texturePhaseIntervals,textureTransitions} from '../lib/animationCharts';
import type {TimeReference,JoltState} from '../lib/jolt';
import {EMPTY_JOLT} from '../lib/jolt';
import {TextureJoltChart} from './TextureJoltChart';
import {clampFrame} from '../lib/frameMath';
import type {AxisRange} from '../lib/plotAxes';
import type {Trace} from '../lib/clockComparison';
import {formatTime} from '../lib/timeline';
import {ComparisonPlot} from './ComparisonPlot';
import {PlotAxes} from './PlotAxes';

/** A single animation's frame/phase workspace; held and backward frames stay ambiguous. */
export function TexturePhases({atlas,points,clock,duration,onJump,onOpenTime,fps,jolt=EMPTY_JOLT}:{atlas:AnimationAtlas;points:TextureObservation[];clock:TimeReference;duration:number;onJump:(frame:number)=>void;onOpenTime?:(time:number)=>void;fps:number;jolt?:JoltState}){
 const [mode,setMode]=useState<'phase'|'row'|'jolt'>('phase'),[range,setRange]=useState<AxisRange|null>(null),[vertical,setVertical]=useState<AxisRange|null>(null),[hover,setHover]=useState<number|null>(null);
 const [ruler,setRuler]=useState(false),[offset,setOffset]=useState(0),[opacity,setOpacity]=useState(.35);
 const a=ANIMATION_ATLASES[atlas],canonical=clock.kind==='jolt';
 const selected=useMemo(()=>points.filter(p=>p.atlas===atlas),[points,atlas]);
 const samples=useMemo(()=>selected.flatMap(p=>{const tick=clock.tickAt(p.pts);return tick===null?[]:[{...p,tick,x:canonical?tick:p.pts}];}),[selected,clock,canonical]);
 const events=useMemo(()=>textureTransitions(selected,atlas,clock.tickAt),[selected,atlas,clock]);
 const extent=useMemo<AxisRange>(()=>{
  if(!canonical)return [0,Math.max(1,duration)];
  const times=[...clock.sampleTimes,...selected.map(p=>p.pts)],ticks=times.map(clock.tickAt).filter((t):t is number=>t!==null);
  let lo=Infinity,hi=-Infinity;for(const t of ticks){lo=Math.min(lo,t);hi=Math.max(hi,t);}return Number.isFinite(lo)?[lo,Math.max(lo+1,hi)]:[0,1];
 },[canonical,clock,selected,duration]);
 const [lo,hi]=range??extent,y=vertical??(mode==='row'?[-.5,a.rows-.5]:[0,a.period]) as AxisRange;
 const traces=useMemo(()=>{
  const rows:Trace=[],phase:Trace=[],guide:Trace=[];
  for(const p of samples){
   rows.push([{time:p.x,value:p.row}]);
   for(const i of texturePhaseIntervals(atlas,p.row,p.tick)){
    const end=i.start+i.duration;
    phase.push([{time:p.x,value:i.start},{time:p.x,value:Math.min(end,a.period)}]);
    if(end>a.period)phase.push([{time:p.x,value:0},{time:p.x,value:end-a.period}]);
   }
  }
  if(ruler){
   if(mode==='phase')guide.push([{time:lo,value:offset},{time:hi,value:offset}]);
   else {
    // Use the actual metadata sequence, including still lava's descending half.
    // Bound rendering work even when zoomed out over long recordings.
    let run:{time:number;value:number}[]=[];
    for(let i=0;i<=1200;i++){
     const x=lo+(hi-lo)*i/1200,tick=canonical?x:clock.tickAt(x);if(tick===null){if(run.length)guide.push(run);run=[];continue;}
     const position=modulo(tick-offset,a.period);
     const row=Array.from({length:a.rows},(_,r)=>r).find(r=>atlasIntervals(atlas,r).some(v=>position>=v.start&&position<v.start+v.duration))??0;
     if(run.length&&Math.abs(row-run[run.length-1].value)>1){guide.push(run);run=[];}run.push({time:x,value:row});
    }
    if(run.length)guide.push(run);
   }
  }
  return {rows,phase,guide};
 },[samples,atlas,a.period,a.rows,ruler,mode,offset,lo,hi,canonical,clock]);
 const zoom=(factor:number,time:number)=>{const span=Math.max(canonical?1:.05,(hi-lo)/factor);setRange([time-(time-lo)/(hi-lo)*span,time+(hi-time)/(hi-lo)*span]);};
 const open=(x:number)=>{let nearest=samples[0];for(const p of samples)if(!nearest||Math.abs(p.x-x)<Math.abs(nearest.x-x))nearest=p;if(nearest)onJump(nearest.frame);else if(!canonical)(onOpenTime??(t=>onJump(clampFrame(t*fps,Number.MAX_SAFE_INTEGER))))(x);};
 const formatX=(x:number)=>canonical?String(Number(x.toFixed(2))):formatTime(x,.01);
 return <section aria-label={`${a.name} charts`}>
  <div className="phase-view-tabs" role="tablist" aria-label={`${a.name} views`}>{(['phase','row','jolt'] as const).map(id=><button key={id} role="tab" aria-selected={mode===id} onClick={()=>{setMode(id);setVertical(null);}}>{id==='phase'?'Timing':id==='row'?'Sprites':`Jolt + ${a.name}`}</button>)}</div>
  {mode==='jolt'?<TextureJoltChart atlas={atlas} points={selected} state={jolt} fps={fps} onJump={onJump} onOpenTime={onOpenTime}/>:<>
  <details className="phase-help"><summary>Ruler & fit</summary><div className="ruler-bar">
   <label><input type="checkbox" checked={ruler} onChange={e=>setRuler(e.target.checked)}/> Perfect-clock ruler</label>
   <button disabled={!samples.length} onClick={()=>{const fit=fitTexturePhase(selected,atlas,clock.tickAt);if(fit!==null){setOffset(fit);setRuler(true);}}}>Find best match</button>
   {ruler&&<><label>Opacity <input aria-label="Ruler opacity" type="range" min="0" max="1" step=".05" value={opacity} onChange={e=>setOpacity(e.target.valueAsNumber)}/></label><label>Offset <input aria-label="Ruler offset in ticks" type="number" min="0" max={a.period} step=".05" value={Number(offset.toFixed(2))} onChange={e=>Number.isFinite(e.target.valueAsNumber)&&setOffset(modulo(e.target.valueAsNumber,a.period))}/></label><button onClick={()=>setOffset(0)}>Reset offset</button></>}
  </div></details>
  <div className="timeline-controls"><button onClick={()=>{setRange(null);setVertical(null);}}>Full recording</button><button onClick={()=>zoom(1.5,(lo+hi)/2)}>Zoom in</button><button onClick={()=>zoom(1/1.5,(lo+hi)/2)}>Zoom out</button><span>{selected.length} labels · {a.period}-tick period{atlas==='lava_still'?' · forward / backward possibilities':''}</span></div>
  <PlotAxes x={[lo,hi]} y={y} onX={setRange} onY={setVertical} resetX={()=>setRange(null)} resetY={()=>setVertical(null)} formatX={formatX}>
   <ComparisonPlot title={`${a.name}: ${mode==='row'?'sprite frames':'phase intervals'}`} series={[...(ruler?[{name:'Perfect-clock ruler',color:`rgba(230,236,245,${opacity})`,trace:traces.guide,dashed:true}]:[]),{name:a.name,color:'#5bc9dc',trace:mode==='row'?traces.rows:traces.phase,dots:mode==='row'}]} lo={lo} hi={hi} bottom={y[0]} top={y[1]} hover={hover} onHover={setHover} onPan={(x,y)=>{setRange(x);setVertical(y);}} onZoom={zoom} showXLabels={false} markers={events.flatMap(e=>{const x=canonical?clock.tickAt(e.time):e.time;return x===null?[]:[{time:x,color:"#e6ad3d",label:"Unexpected animation transition"}];})} onOpenTime={open}/>
  </PlotAxes>
  {events.length>0&&<details><summary>{events.length} unexpected transitions</summary>{events.map(e=><button key={e.frame} onClick={event=>{if(event.ctrlKey){onJump(e.frame);return;}const x=canonical?clock.tickAt(e.time):e.time;if(x!==null)setRange([x-(canonical?20:1),x+(canonical?20:1)]);}} title="Click to locate · Ctrl+click to open video">Frame {e.frame}: needs at least {e.minimum} ticks; up to {e.available} allowed</button>)}</details>}
  {!selected.length&&<p>Choose this texture in the Label atlas and confirm a frame to add evidence.</p>}
  {selected.length>0&&!samples.length&&<p>No labels inside resolved Jolt coverage. Choose video time or import matching Jolt readings.</p>}
 </>}
 </section>;
}
