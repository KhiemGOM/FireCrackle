import {useMemo,useState} from 'react';
import type {PhaseChart} from '../lib/chart';
import {clockComparison,thinTrace,type Trace} from '../lib/clockComparison';
import {type JoltState} from '../lib/jolt';
import {formatTime} from '../lib/timeline';

/** Optional diagnostic view; every panel shares video time, independently of the main corrected-time plot. */
export function ClockComparison({chart,state}:{chart:PhaseChart|null;state:JoltState}){
 const [open,setOpen]=useState(false),[straight,setStraight]=useState(true);
 const [range,setRange]=useState<[number,number]|null>(null),[hover,setHover]=useState<number|null>(null);
 const traces=useMemo(()=>clockComparison(chart?.points??[],state,straight),[chart,state,straight]);
 const anchors=state.data?.anchors??[];
 const fullEnd=Math.max(1,anchors[anchors.length-1]?.time??0,chart?.points[chart.points.length-1]?.pts??0);
 const [lo,hi]=range??[0,fullEnd];
 const x=(t:number)=>65+(t-lo)/(hi-lo)*920;
 function panel(title:string,series:{name:string;color:string;trace:Trace}[],fixed?:[number,number]){
  const visible=series.flatMap(s=>s.trace.flat().filter(p=>p.time>=lo&&p.time<=hi));
  const min=fixed?.[0]??visible.reduce((n,p)=>Math.min(n,p.value),0),max=fixed?.[1]??visible.reduce((n,p)=>Math.max(n,p.value),0);
  const pad=Math.max(1,(max-min)*.08),bottom=fixed?min:min-pad,top=fixed?max:max+pad;
  const y=(v:number)=>145-(v-bottom)/Math.max(1,top-bottom)*120;
  return <figure style={{margin:'10px 0'}}><figcaption><b>{title}</b>{series.map(s=><span key={s.name} style={{color:s.color,marginLeft:15}}>{s.name}</span>)}</figcaption>
   <svg role="img" aria-label={title} viewBox="0 0 1000 175" style={{width:'100%',background:'#10141c',border:'1px solid #2a3142',borderRadius:6}} onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect();setHover(lo+Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*1000-65)/920))*(hi-lo));}} onPointerLeave={()=>setHover(null)}>
    {[bottom,(top+bottom)/2,top].map((v,i)=><g key={i}><line x1="65" x2="985" y1={y(v)} y2={y(v)} stroke="#2a3142"/><text x="3" y={y(v)+4} fill="#8b96ab" fontSize="11">{v.toFixed(1)}</text></g>)}
    {series.map(s=>s.trace.map((run,i)=>{const ps=run.filter(p=>p.time>=lo&&p.time<=hi);if(!ps.length)return null;const kept=thinTrace(ps);return <path key={s.name+i} d={kept.map((p,i)=>`${i?'L':'M'}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="1.4"/>;}))}
    {hover!==null&&<line x1={x(hover)} x2={x(hover)} y1="15" y2="150" stroke="#fff" strokeDasharray="3 3"/>}
    {[lo,(lo+hi)/2,hi].map((t,i)=><text key={i} x={x(t)} y="169" textAnchor={i===0?'start':i===2?'end':'middle'} fontSize="11" fill="#8b96ab">{formatTime(t,.01)}</text>)}
   </svg></figure>;
 }
 return <section style={{margin:'12px 0',padding:12,border:'1px solid #2a3142',borderRadius:8}}>
  <button aria-expanded={open} onClick={()=>setOpen(!open)}>Clock comparison · fire + Jolt</button>
  {open&&<><p>All panels share <b>video time</b>. GUI ticks are the recovered clock; the lower plots show what subtracting it changes.</p>
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={()=>setRange(null)}>Full recording</button><button onClick={()=>{const span=hi-lo,mid=(hi+lo)/2;setRange([Math.max(0,mid-span/4),Math.min(fullEnd,mid+span/4)]);}}>Zoom in</button><button onClick={()=>{const span=hi-lo,mid=(hi+lo)/2;setRange([Math.max(0,mid-span),Math.min(fullEnd,mid+span)]);}}>Zoom out</button><label>From <input aria-label="Clock comparison start seconds" type="number" min="0" max={hi-.1} value={Number(lo.toFixed(2))} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>=0&&n<hi)setRange([n,hi]);}} style={{width:85}}/> s</label><label>To <input aria-label="Clock comparison end seconds" type="number" min={lo+.1} value={Number(hi.toFixed(2))} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>lo)setRange([lo,Math.min(fullEnd,n)]);}} style={{width:85}}/> s</label><label><input type="checkbox" checked={straight} onChange={e=>setStraight(e.target.checked)}/> Straighten phase locally</label></div>
   {panel('GUI ticks versus video time',[{name:'Recovered GUI ticks',color:'#50e1ff',trace:traces.gui},{name:'20 Hz video clock',color:'#8b96ab',trace:[[{time:lo,value:traces.origin+20*(lo-traces.start)},{time:hi,value:traces.origin+20*(hi-traces.start)}]]}])}
   {panel('Clock difference (ticks)',[{name:'GUI − video clock',color:'#50e1ff',trace:traces.residual}])}
   {panel(straight?'Straightened fire phase (ticks)':'Wrapped fire phase (ticks)',[{name:'Using video time',color:'#4a90d9',trace:traces.video},{name:'Using Jolt time',color:'#f08a24',trace:traces.corrected}],straight?undefined:[-16,16])}
   <p style={{color:'#8b96ab'}}>Dashed cursor: {hover===null?'hover any panel':formatTime(hover,.01)} video time. Lines stop at missing fire stretches over 2 s and imported clock breaks. Straightening only follows local ±16-tick changes; whole rotations across gaps or between sparse labels remain unknown. Estimated Jolt timing is not a new fire observation.</p>
  </>}
 </section>;
}
