import {useMemo,useState} from 'react';
import type {PhaseChart} from '../lib/chart';
import {clockComparison,type Trace} from '../lib/clockComparison';
import {type JoltState} from '../lib/jolt';
import {formatTime} from '../lib/timeline';
import {PlotAxes} from './PlotAxes';
import {ComparisonPlot} from './ComparisonPlot';
import type {AxisRange} from '../lib/plotAxes';

/** Optional diagnostic view; every panel shares video time, independently of the main corrected-time plot. */
export function ClockComparison({chart,state,embedded=false}:{chart:PhaseChart|null;state:JoltState;embedded?:boolean}){
 const [open,setOpen]=useState(false),[straight,setStraight]=useState(true);
 const [active,setActive]=useState('all'),[yRanges,setYRanges]=useState<Record<string,AxisRange>>({});
 const [range,setRange]=useState<[number,number]|null>(null),[hover,setHover]=useState<number|null>(null);
 const traces=useMemo(()=>clockComparison(chart?.points??[],state,straight),[chart,state,straight]);
 const anchors=state.data?.anchors??[];
 const fullEnd=Math.max(1,anchors[anchors.length-1]?.time??0,chart?.points[chart.points.length-1]?.pts??0);
 const [lo,hi]=range??[0,fullEnd];
 function panel(title:string,series:{name:string;color:string;trace:Trace}[],fixed?:[number,number]){
  const visible=series.flatMap(s=>s.trace.flat().filter(p=>p.time>=lo&&p.time<=hi));
  fixed=yRanges[title]??fixed;
  const min=fixed?.[0]??visible.reduce((n,p)=>Math.min(n,p.value),0),max=fixed?.[1]??visible.reduce((n,p)=>Math.max(n,p.value),0);
  const pad=Math.max(1,(max-min)*.08),bottom=fixed?min:min-pad,top=fixed?max:max+pad;
  return <figure style={{margin:'10px 0'}}><figcaption><b>{title}</b>{series.map(s=><span key={s.name} style={{color:s.color,marginLeft:15}}>{s.name}</span>)}</figcaption>
   <PlotAxes x={[lo,hi]} y={[bottom,top]} onX={r=>{const start=Math.max(0,r[0]),end=Math.min(fullEnd,r[1]);if(end>start)setRange([start,end]);}} onY={r=>setYRanges(p=>({...p,[title]:r}))} resetX={()=>setRange(null)} resetY={()=>setYRanges(p=>{const next={...p};delete next[title];return next;})}><ComparisonPlot title={title} series={series} lo={lo} hi={hi} bottom={bottom} top={top} hover={hover} onHover={setHover}/></PlotAxes></figure>;
 }
 return <section className={`comparison-view ${active==='all'?'':'single'}`}>
  {!embedded&&<button aria-expanded={open} onClick={()=>setOpen(!open)}>Clock comparison · fire + Jolt</button>}
  {(embedded||open)&&<>
   <div className="comparison-toolbar"><div className="phase-view-tabs" role="tablist" aria-label="Comparison plots">{[['all','Together'],['gui','GUI clock'],['difference','Clock difference'],['phase','Fire phase']].map(([id,label])=><button key={id} role="tab" aria-selected={active===id} onClick={()=>setActive(id)}>{label}</button>)}</div></div><div className="comparison-toolbar"><button onClick={()=>setRange(null)}>Full recording</button><button onClick={()=>{const span=hi-lo,mid=(hi+lo)/2;setRange([Math.max(0,mid-span/4),Math.min(fullEnd,mid+span/4)]);}}>Zoom in</button><button onClick={()=>{const span=hi-lo,mid=(hi+lo)/2;setRange([Math.max(0,mid-span),Math.min(fullEnd,mid+span)]);}}>Zoom out</button><label>From <input aria-label="Clock comparison start seconds" type="number" min="0" max={hi-.1} value={Number(lo.toFixed(2))} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>=0&&n<hi)setRange([n,hi]);}} style={{width:85}}/> s</label><label>To <input aria-label="Clock comparison end seconds" type="number" min={lo+.1} value={Number(hi.toFixed(2))} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>lo)setRange([lo,Math.min(fullEnd,n)]);}} style={{width:85}}/> s</label><label><input type="checkbox" checked={straight} onChange={e=>setStraight(e.target.checked)}/> Straighten phase locally</label></div>
   {(active==='all'||active==='gui')&&panel('GUI ticks versus video time',[{name:'Recovered GUI ticks',color:'#50e1ff',trace:traces.gui},{name:'20 Hz video clock',color:'#8b96ab',trace:[[{time:lo,value:traces.origin+20*(lo-traces.start)},{time:hi,value:traces.origin+20*(hi-traces.start)}]]}])}
   {(active==='all'||active==='difference')&&panel('Clock difference (ticks)',[{name:'GUI − video clock',color:'#50e1ff',trace:traces.residual}])}
   {(active==='all'||active==='phase')&&panel(straight?'Straightened fire phase (ticks)':'Wrapped fire phase (ticks)',[{name:'Using video time',color:'#4a90d9',trace:traces.video},{name:'Using Jolt time',color:'#f08a24',trace:traces.corrected}],straight?undefined:[-16,16])}
   <details className="phase-help"><summary>How to read these plots</summary><p>Shared X axis: video time. GUI ticks are the recovered counter. Clock difference subtracts the nominal video clock.</p><p>Dashed cursor: {hover===null?'hover any panel':formatTime(hover,.01)} video time. Lines stop at missing fire stretches over 2 s and imported clock breaks. Straightening only follows local ±16-tick changes; whole rotations across gaps or between sparse labels remain unknown. Estimated Jolt timing is not a new fire observation.</p></details>
  </>}
 </section>;
}
