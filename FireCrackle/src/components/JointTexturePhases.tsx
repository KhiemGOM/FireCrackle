import {useEffect,useMemo,useRef,useState} from 'react';
import {JOINT_MATERIALS,JOINT_MODULI,jointSamples,timingOffset,type JointMaterial,type JointSample} from '../lib/jointTexturePhase';
import {chartReference} from '../lib/clockRuler';
import type {PhaseChart} from '../lib/chart';
import type {TimeReference} from '../lib/jolt';
import type {AxisRange} from '../lib/plotAxes';
import {formatTime} from '../lib/timeline';
import {useWheel} from '../hooks/useWheel';
import {PlotAxes} from './PlotAxes';

const MATERIALS=Object.keys(JOINT_MATERIALS) as JointMaterial[];
const LEFT=56,RIGHT=12,TOP=16,BOTTOM=24;

/** Batched canvas strokes: repeated evidence in a screen pixel is unioned, never averaged.
 * Hover has a separate overlay, so moving the pointer does not repaint long recordings. */
export function paintJointOffsets(canvas:HTMLCanvasElement,samples:JointSample[],clock:TimeReference,modulus:number,origin:number,xRange:AxisRange,yRange:AxisRange,showPossibilities=false){
 const width=Math.max(200,canvas.clientWidth||1000),height=Math.max(180,canvas.clientHeight||360),ratio=globalThis.devicePixelRatio||1;
 canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
 const c=canvas.getContext('2d');if(!c)return;
 c.scale(ratio,ratio);c.fillStyle='#10141c';c.fillRect(0,0,width,height);
 const x=(t:number)=>LEFT+(t-xRange[0])/(xRange[1]-xRange[0])*(width-LEFT-RIGHT);
 const y=(v:number)=>height-BOTTOM-(v-yRange[0])/(yRange[1]-yRange[0])*(height-TOP-BOTTOM);
 c.font='11px sans-serif';c.fillStyle='#aab6ca';c.strokeStyle='#2a3142';c.lineWidth=1;
 for(let i=0;i<=4;i++){const value=yRange[0]+(yRange[1]-yRange[0])*i/4,py=y(value);c.beginPath();c.moveTo(LEFT,py);c.lineTo(width-RIGHT,py);c.stroke();c.fillText(`${value>0?'+':''}${Number(value.toFixed(2))}`,3,py+4);}
 c.save();c.beginPath();c.rect(LEFT,TOP,width-LEFT-RIGHT,height-TOP-BOTTOM);c.clip();
 c.strokeStyle='#4cc38a';c.setLineDash([6,4]);c.beginPath();c.moveTo(LEFT,y(0));c.lineTo(width-RIGHT,y(0));c.stroke();c.setLineDash([]);
 const drawn=new Map<JointMaterial,{dots:Set<string>;bands:Set<string>}>();
 for(const p of samples){
  const time=clock.kind==='jolt'?p.tick:p.pts;if(time<xRange[0]||time>xRange[1])continue;
  let marks=drawn.get(p.material);if(!marks){marks={dots:new Set(),bands:new Set()};drawn.set(p.material,marks);}
  const px=Math.round(x(time));
  const timing=timingOffset(p,modulus,origin);
  if(timing.value!==null&&timing.value>=yRange[0]&&timing.value<=yRange[1])marks.dots.add(`${px},${Math.round(y(timing.value))},${timing.ambiguous?1:0}`);
  if(showPossibilities)for(const i of timing.intervals){
   if(i.end<yRange[0]||i.start>yRange[1])continue;
   const a=Math.round(y(Math.max(yRange[0],i.start))),b=Math.round(y(Math.min(yRange[1],i.end)));
   marks.bands.add(`${px},${a},${b}`);
  }
 }
 for(const [material,marks] of drawn){
  c.strokeStyle=c.fillStyle=JOINT_MATERIALS[material].color;
  if(showPossibilities){c.globalAlpha=.12;c.lineWidth=1;c.beginPath();for(const mark of marks.bands){const [px,a,b]=mark.split(',').map(Number);c.moveTo(px,a);c.lineTo(px,a===b?b-1:b);}c.stroke();}
  c.globalAlpha=.95;c.lineWidth=1.3;
  for(const ambiguous of [0,1]){c.beginPath();for(const mark of marks.dots){const [px,py,kind]=mark.split(',').map(Number);if(kind!==ambiguous)continue;c.moveTo(px+2,py);c.arc(px,py,2,0,2*Math.PI);}if(ambiguous)c.stroke();else c.fill();}
 }
 c.restore();
}

/** The update's one joint view: common phase offset with a selectable final modulus. */
export function JointTexturePhases({chart,clock,duration,onJump}:{chart:PhaseChart|null;clock:TimeReference;duration:number;onJump:(frame:number)=>void}){
 const [modulus,setModulus]=useState<number>(32),[origin,setOrigin]=useState(0);
 const [enabled,setEnabled]=useState<JointMaterial[]>(MATERIALS),[range,setRange]=useState<AxisRange|null>(null),[vertical,setVertical]=useState<AxisRange|null>(null),[hover,setHover]=useState<number|null>(null);
 const [showPossibilities,setShowPossibilities]=useState(false);
 const canvas=useRef<HTMLCanvasElement>(null),drag=useRef<{clientX:number;range:AxisRange}|null>(null);
 const all=useMemo(()=>jointSamples(chart,clock),[chart,clock]),samples=useMemo(()=>all.filter(p=>enabled.includes(p.material)),[all,enabled]);
 const canonical=clock.kind==='jolt';
 // One existing-chart reference, never a separate fitted zero for each texture.
 const baseline=useMemo(()=>{if(!canonical)return chart?chartReference(chart):0;const first=all.find(p=>p.material==='fire'||p.material==='soul')??all[0];return first?((first.tick-first.ages[0].start)%first.period+first.period)%first.period:0;},[canonical,chart,all]);
 const sharedOrigin=baseline+origin;
 const extent=useMemo<AxisRange>(()=>{
  if(!canonical)return [0,Math.max(1,duration)];
  let lo=Infinity,hi=-Infinity;for(const t of clock.sampleTimes){const tick=clock.tickAt(t);if(tick!==null){lo=Math.min(lo,tick);hi=Math.max(hi,tick);}}
  for(const p of all){lo=Math.min(lo,p.tick);hi=Math.max(hi,p.tick);}
  return Number.isFinite(lo)?[lo,Math.max(lo+1,hi)]:[0,1];
 },[all,clock,canonical,duration]);
 const xr=range??extent,yr=vertical??[-modulus/2,modulus/2] as AxisRange;
 useEffect(()=>{const el=canvas.current;if(!el)return;const draw=()=>paintJointOffsets(el,samples,clock,modulus,sharedOrigin,xr,yr,showPossibilities);draw();const observer=new ResizeObserver(draw);observer.observe(el);return()=>observer.disconnect();},[samples,clock,modulus,sharedOrigin,showPossibilities,xr[0],xr[1],yr[0],yr[1]]);
 const zoom=(factor:number,time:number)=>{const span=Math.max(canonical?1:.05,Math.min((extent[1]-extent[0])*10,(xr[1]-xr[0])/factor)),fraction=(time-xr[0])/(xr[1]-xr[0]);setRange([time-span*fraction,time+span*(1-fraction)]);};
 const at=(clientX:number)=>{const r=canvas.current?.getBoundingClientRect();if(!r)return xr[0];return xr[0]+Math.max(0,Math.min(1,(clientX-r.left-LEFT)/(r.width-LEFT-RIGHT)))*(xr[1]-xr[0]);};
 useWheel(canvas,e=>{zoom(Math.exp(-e.deltaY*.002),at(e.clientX));return true;});
 let nearest:JointSample|undefined;
 if(hover!==null)for(const p of samples)if(!nearest||Math.abs((canonical?p.tick:p.pts)-hover)<Math.abs((canonical?nearest.tick:nearest.pts)-hover))nearest=p;
 const timing=nearest?timingOffset(nearest,modulus,sharedOrigin):null;
 const readout=nearest&&timing?`Frame ${nearest.frame} · ${JOINT_MATERIALS[nearest.material].name} · ${formatTime(nearest.pts,.01)} · ${timing.value===null?'any offset possible at this modulo':`${timing.value>0?'+':''}${timing.value.toFixed(2)} ticks${timing.ambiguous?' · wrap/direction estimate':''}`}${nearest.estimated?' · estimated Jolt time':''} · Ctrl+click to open video`:'Hover to inspect · wheel to zoom · drag to pan · Ctrl+click to open video';
 const formatX=(x:number)=>canonical?String(Number(x.toFixed(2))):formatTime(x,.01);
 return <section aria-label="All textures phase offset">
  <div className="chart-head"><span className="panel-title">Animation timing offset · all textures</span></div>
  <div className="comparison-toolbar" data-owns-keys="true">
   <label>Modulo <select aria-label="Joint phase modulo" value={modulus} onChange={e=>{setModulus(Number(e.target.value));setVertical(null);}}>{JOINT_MODULI.map(m=><option key={m} value={m}>{m} ticks</option>)}</select></label>
   <button onClick={()=>{setRange(null);setVertical(null);}}>Full recording</button><button onClick={()=>zoom(1.5,(xr[0]+xr[1])/2)}>Zoom in</button><button onClick={()=>zoom(1/1.5,(xr[0]+xr[1])/2)}>Zoom out</button>
  </div>
  <div className="jolt-chart-key" aria-label="Joint texture legend" data-owns-keys="true">{MATERIALS.map(m=><label key={m} style={{color:JOINT_MATERIALS[m].color}}><input type="checkbox" checked={enabled.includes(m)} onChange={e=>setEnabled(previous=>e.target.checked?[...previous,m]:previous.filter(v=>v!==m))}/> {JOINT_MATERIALS[m].name} ({all.filter(p=>p.material===m).length})</label>)}</div>
  <p className="dim">Same timing offset view, overlaid by texture. Zero is the shared clock reference. Hollow points have unresolved wraps or playback direction.</p>
  <PlotAxes x={xr} y={yr} onX={setRange} onY={setVertical} resetX={()=>setRange(null)} resetY={()=>setVertical(null)} formatX={formatX}>
   <div style={{position:'relative',height:'100%'}}>
    <canvas ref={canvas} aria-label="Combined texture phase-offset plot" role="img" style={{display:'block',width:'100%',height:'100%',touchAction:'none',cursor:'grab'}}
     onPointerDown={e=>{if(e.button!==0||e.ctrlKey)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={clientX:e.clientX,range:xr};}}
     onPointerMove={e=>{const d=drag.current;if(d){const width=e.currentTarget.clientWidth-LEFT-RIGHT,delta=(d.clientX-e.clientX)/Math.max(1,width)*(d.range[1]-d.range[0]);setRange([d.range[0]+delta,d.range[1]+delta]);setHover(null);}else setHover(at(e.clientX));}}
     onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}} onPointerLeave={()=>setHover(null)}
     onClick={e=>{if(!e.ctrlKey)return;const t=at(e.clientX);let p:JointSample|undefined;for(const s of samples)if(!p||Math.abs((canonical?s.tick:s.pts)-t)<Math.abs((canonical?p.tick:p.pts)-t))p=s;if(p)onJump(p.frame);}}/>
    {hover!==null&&<div aria-hidden="true" style={{position:'absolute',top:TOP,bottom:BOTTOM,left:LEFT+(hover-xr[0])/(xr[1]-xr[0])*((canvas.current?.clientWidth??1000)-LEFT-RIGHT),borderLeft:'1px dashed white',pointerEvents:'none'}}/>}
   </div>
  </PlotAxes>
  <div className="chart-hover" role="status">{readout}</div>
  {!all.length&&<p>{canonical?'No texture labels inside resolved Jolt coverage. Choose video time or import matching Jolt readings.':'Confirm fire, lava or water labels to add evidence to this chart.'}</p>}
  <details className="phase-help"><summary>Reference & uncertainty</summary><div className="ruler-bar" data-owns-keys="true"><label>Reference adjustment <input aria-label="Joint phase shared origin" type="number" step=".05" value={origin} onChange={e=>Number.isFinite(e.target.valueAsNumber)&&setOrigin(e.target.valueAsNumber)}/> ticks</label><button onClick={()=>setOrigin(0)}>Reset reference</button><label><input aria-label="Show all phase possibilities" type="checkbox" checked={showPossibilities} onChange={e=>setShowPossibilities(e.target.checked)}/> Show all possibilities</label></div><p className="dim">All textures use the same reference ({sharedOrigin.toFixed(2)} ticks). Hollow points show the possible wrap nearest that reference; they do not prove a unique clock or agreement. Held rows retain their uncertainty. Unconstrained rows have no dot. Enable possibilities to inspect every wrap and both lava directions. Atlas reloads start a new animation epoch.</p></details>
  <p className="dim">{canonical?'Canonical time · GUI ticks':'Video time · 20 Hz reference'} · signed offset modulo {modulus} ticks · + means the animation lags the reference.</p>
 </section>;
}
