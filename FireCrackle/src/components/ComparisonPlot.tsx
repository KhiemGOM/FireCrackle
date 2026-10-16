import {useEffect,useRef,useState} from 'react';
import {thinTrace,type Trace} from '../lib/clockComparison';
import {formatTime} from '../lib/timeline';
import type {AxisRange} from '../lib/plotAxes';

export function ComparisonPlot({title,series,lo,hi,bottom,top,hover,onHover,onPan,showXLabels=true}:{title:string;series:{name:string;color:string;trace:Trace}[];lo:number;hi:number;bottom:number;top:number;hover:number|null;onHover:(time:number|null)=>void;onPan?:(x:AxisRange,y:AxisRange)=>void;showXLabels?:boolean}){
 const ref=useRef<SVGSVGElement>(null),[size,setSize]=useState<[number,number]>([1000,175]);
 const drag=useRef<{x:number;y:number;lo:number;hi:number;bottom:number;top:number;w:number;h:number}|null>(null);
 useEffect(()=>{const el=ref.current;if(!el)return;const resize=()=>setSize([Math.max(200,el.clientWidth),Math.max(140,el.clientHeight)]);resize();const observer=new ResizeObserver(resize);observer.observe(el);return()=>observer.disconnect();},[]);
 const [width,height]=size,left=55,right=width-15;
 const x=(time:number)=>left+(time-lo)/(hi-lo)*(right-left),y=(value:number)=>height-30-(value-bottom)/Math.max(.0001,top-bottom)*(height-55);
 return <svg ref={ref} role="img" aria-label={title} viewBox={`0 0 ${width} ${height}`} style={{width:'100%',height:'100%',display:'block',background:'#10141c',border:'1px solid #2a3142',borderRadius:6,cursor:onPan?'grab':undefined,touchAction:'none',userSelect:'none'}}
 onPointerDown={e=>{if(e.button!==0||!onPan)return;const r=e.currentTarget.getBoundingClientRect();if(!r.width||!r.height)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,lo,hi,bottom,top,w:r.width*(right-left)/width,h:r.height*(height-55)/height};}}
 onPointerMove={e=>{const d=drag.current;if(d&&onPan){const dx=-(e.clientX-d.x)/d.w*(d.hi-d.lo),dy=(e.clientY-d.y)/d.h*(d.top-d.bottom);onPan([d.lo+dx,d.hi+dx],[d.bottom+dy,d.top+dy]);onHover(null);return;}const r=e.currentTarget.getBoundingClientRect();onHover(lo+Math.max(0,Math.min(1,((e.clientX-r.left)*width/r.width-left)/(right-left)))*(hi-lo));}}
 onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}} onPointerLeave={()=>onHover(null)}>
 {[bottom,(top+bottom)/2,top].map((v,i)=><g key={i}><line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="#2a3142"/><text x="3" y={y(v)+4} fill="#8b96ab" fontSize="11">{v.toFixed(1)}</text></g>)}
 {series.map(s=>s.trace.map((run,i)=>{const kept=thinTrace(run.filter(p=>p.time>=lo&&p.time<=hi));return kept.length?<path key={s.name+i} d={kept.map((p,i)=>`${i?'L':'M'}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="1.4"/>:null;}))}
 {hover!==null&&<line x1={x(hover)} x2={x(hover)} y1="15" y2={height-25} stroke="#fff" strokeDasharray="3 3"/>}
 {showXLabels&&[lo,(lo+hi)/2,hi].map((t,i)=><text key={i} x={x(t)} y={height-7} textAnchor={i===0?'start':i===2?'end':'middle'} fontSize="11" fill="#8b96ab">{formatTime(t,.01)}</text>)}
 </svg>;
}
