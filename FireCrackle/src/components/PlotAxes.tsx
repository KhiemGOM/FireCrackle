import {useRef,type ReactNode} from 'react';
import {zoomAxis,type AxisRange} from '../lib/plotAxes';
/** Dedicated axis hit areas keep ordinary plot dragging available for panning. */
export function PlotAxes({children,x,y,onX,onY,resetX,resetY}:{children:ReactNode;x:AxisRange;y:AxisRange;onX:(range:AxisRange)=>void;onY:(range:AxisRange)=>void;resetX:()=>void;resetY:()=>void}){
 const drag=useRef<{axis:'x'|'y';start:number;range:AxisRange}|null>(null);
 const handle=(axis:'x'|'y')=>({
  role:'slider',tabIndex:0,'aria-label':`Zoom ${axis.toUpperCase()} axis`,'aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':50,
  title:`Drag ${axis==='x'?'left/right':'up/down'} to zoom ${axis.toUpperCase()} only · double-click to reset`,
  onPointerDown:(e:React.PointerEvent<HTMLDivElement>)=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);drag.current={axis,start:axis==='x'?e.clientX:e.clientY,range:axis==='x'?x:y};},
  onPointerMove:(e:React.PointerEvent<HTMLDivElement>)=>{const d=drag.current;if(!d)return;e.stopPropagation();const delta=(axis==='x'?e.clientX:e.clientY)-d.start;(axis==='x'?onX:onY)(zoomAxis(d.range,Math.exp(-delta/160)));},
  onPointerUp:()=>{drag.current=null;},onPointerCancel:()=>{drag.current=null;},onLostPointerCapture:()=>{drag.current=null;},
  onDoubleClick:axis==='x'?resetX:resetY,
  onKeyDown:(e:React.KeyboardEvent<HTMLDivElement>)=>{if(e.key==='Home'){e.preventDefault();(axis==='x'?resetX:resetY)();}else if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(e.key)){e.preventDefault();e.stopPropagation();(axis==='x'?onX:onY)(zoomAxis(axis==='x'?x:y,e.key==='ArrowUp'||e.key==='ArrowRight'?1.2:1/1.2));}},
 });
 return <div className="plot-axes"><div className="plot-axis-y" {...handle('y')}>Y ↕</div><div className="plot-axis-body">{children}</div><div className="plot-axis-x" {...handle('x')}>X ↔ <span>drag axis to zoom</span></div></div>;
}
