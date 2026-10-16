import {useEffect,useId,useRef,useState} from 'react';
import {thinTrace,type Trace} from '../lib/clockComparison';
import {formatTime} from '../lib/timeline';
import type {AxisRange} from '../lib/plotAxes';
import type {ClockMarker} from '../lib/joltAgreement';

export function ComparisonPlot({title,series,lo,hi,bottom,top,hover,onHover,onPan,showXLabels=true,formatY,markers=[],zeroLine=false,onZoom,onCursor,onOpenTime,cursorLabel,snapTime=(time:number)=>time,annotations=[]}:{cursorLabel?:(time:number)=>string;snapTime?:(time:number)=>number;onOpenTime?:(time:number)=>void;annotations?:{time:number;text:string}[];title:string;series:{name:string;color:string;trace:Trace;dots?:boolean;dashed?:boolean}[];lo:number;hi:number;bottom:number;top:number;hover:number|null;onHover:(time:number|null)=>void;onPan?:(x:AxisRange,y:AxisRange)=>void;showXLabels?:boolean;formatY?:(value:number)=>string;markers?:ClockMarker[];zeroLine?:boolean;onZoom?:(factor:number,time:number)=>void;onCursor?:(point:{time:number;value:number}|null)=>void}){
 const clip=useId();
 const ref=useRef<SVGSVGElement>(null),[size,setSize]=useState<[number,number]>([1000,175]);
 const drag=useRef<{x:number;y:number;lo:number;hi:number;bottom:number;top:number;w:number;h:number}|null>(null);
 useEffect(()=>{const el=ref.current;if(!el)return;const resize=()=>setSize([Math.max(200,el.clientWidth),Math.max(140,el.clientHeight)]);resize();const observer=new ResizeObserver(resize);observer.observe(el);return()=>observer.disconnect();},[]);
 const [width,height]=size,left=85,right=width-15;
 const x=(time:number)=>left+(time-lo)/(hi-lo)*(right-left),y=(value:number)=>height-30-(value-bottom)/Math.max(.0001,top-bottom)*(height-55);
 useEffect(()=>{const el=ref.current;if(!el||!onZoom)return;const wheel=(e:WheelEvent)=>{e.preventDefault();const r=el.getBoundingClientRect();onZoom(Math.exp(-e.deltaY*.002),lo+Math.max(0,Math.min(1,((e.clientX-r.left)*width/r.width-left)/(right-left)))*(hi-lo));};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[onZoom,lo,hi,width,left,right]);
 return <svg ref={ref} role="img" aria-label={title} viewBox={`0 0 ${width} ${height}`} style={{width:'100%',height:'100%',display:'block',background:'#10141c',border:'1px solid #2a3142',borderRadius:6,cursor:onPan?'grab':undefined,touchAction:'none',userSelect:'none'}}
 onPointerDown={e=>{if(e.button!==0||(e.ctrlKey&&onOpenTime)||!onPan)return;const r=e.currentTarget.getBoundingClientRect();if(!r.width||!r.height)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,lo,hi,bottom,top,w:r.width*(right-left)/width,h:r.height*(height-55)/height};}}
 onClick={e=>{if(!e.ctrlKey||!onOpenTime)return;const r=e.currentTarget.getBoundingClientRect();if(!r.width||!r.height)return;e.preventDefault();const px=(e.clientX-r.left)*width/r.width,py=(e.clientY-r.top)*height/r.height;if(px<left||px>right||py<15||py>height-30)return;onOpenTime(snapTime(lo+(px-left)/(right-left)*(hi-lo)));}}
 onPointerMove={e=>{const d=drag.current;if(d&&onPan){const dx=-(e.clientX-d.x)/d.w*(d.hi-d.lo),dy=(e.clientY-d.y)/d.h*(d.top-d.bottom);onPan([d.lo+dx,d.hi+dx],[d.bottom+dy,d.top+dy]);onHover(null);onCursor?.(null);return;}const r=e.currentTarget.getBoundingClientRect();if(!r.width||!r.height)return;const time=snapTime(lo+Math.max(0,Math.min(1,((e.clientX-r.left)*width/r.width-left)/(right-left)))*(hi-lo));const value=bottom+(height-30-(e.clientY-r.top)*height/r.height)/(height-55)*(top-bottom);onHover(time);onCursor?.({time,value});}}
 onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}} onPointerLeave={()=>{onHover(null);onCursor?.(null);}}>
 <defs><clipPath id={clip}><rect x={left} y={15} width={Math.max(1,right-left)} height={height-40}/></clipPath></defs>
 {[0,.25,.5,.75,1].map(f=><line key={f} x1={x(lo+f*(hi-lo))} x2={x(lo+f*(hi-lo))} y1={15} y2={height-25} stroke="#202c3b"/>)}
 {[bottom,(top+bottom)/2,top].map((v,i)=><g key={i}><line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="#2a3142"/><text x="3" y={y(v)+4} fill="#8b96ab" fontSize="11">{formatY?formatY(v):v.toFixed(1)}</text></g>)}
 <g clipPath={`url(#${clip})`}>
 {markers.map((m,i)=><g key={i}><title>{m.label}</title>{m.end!==undefined&&<rect x={Math.min(x(m.time),x(m.end))} y={15} width={Math.abs(x(m.end)-x(m.time))} height={height-40} fill={m.color} opacity=".07"/>}{[m.time,...(m.end!==undefined&&m.end!==m.time?[m.end]:[])].map((t,j)=><line key={j} x1={x(t)} x2={x(t)} y1={15} y2={height-25} stroke={m.color} strokeDasharray={m.dashed?'6 5':undefined} opacity=".8"/>)}</g>)}
 {zeroLine&&<line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#59c99a" strokeDasharray="5 4"/>}
 {series.map(s=>s.trace.map((run,i)=>{const kept=thinTrace(run.filter((p,j)=>p.time>=lo&&p.time<=hi||p.time<lo&&run[j+1]?.time>=lo||p.time>hi&&run[j-1]?.time<=hi));return kept.length?<g key={s.name+i}><path d={kept.map((p,i)=>`${i?'L':'M'}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="1.5" strokeDasharray={s.dashed?'4 3':undefined}/>{(s.dots||kept.length===1)&&kept.map((p,j)=><circle key={j} cx={x(p.time)} cy={y(p.value)} r={s.dots?3.5:2} fill={s.dots?'#c4ff38':s.color} stroke={s.dots?'#91be29':undefined}><title>{`${s.name} · video ${formatTime(p.time,.01)} · ${formatY?formatY(p.value):p.value.toFixed(2)}`}</title></circle>)}</g>:null;}))}
 {annotations.filter(a=>a.time>=lo&&a.time<=hi).map((a,i)=><text key={i} x={Math.max(left+5,Math.min(right-260,x(a.time)))} y={30+i%3*16} fill="#e2e8f0" fontSize="11" paintOrder="stroke" stroke="#10141c" strokeWidth="3">{a.text}</text>)}
 </g>
 {hover!==null&&<g aria-label="Snapped chart cursor" data-time={hover} pointerEvents="none"><line x1={x(hover)} x2={x(hover)} y1="15" y2={height-25} stroke="#fff" strokeDasharray="3 3"/>{cursorLabel&&<text x={x(hover)+(x(hover)>right-180?-5:5)} y={height-33} textAnchor={x(hover)>right-180?'end':'start'} fontSize="11" fill="#fff" paintOrder="stroke" stroke="#10141c" strokeWidth="4">{cursorLabel(hover)}</text>}</g>}
 {showXLabels&&[lo,(lo+hi)/2,hi].map((t,i)=><text key={i} x={x(t)} y={height-7} textAnchor={i===0?'start':i===2?'end':'middle'} fontSize="11" fill="#8b96ab">{formatTime(t,.01)}</text>)}
 </svg>;
}
