import {useRef,useState,type PointerEvent} from 'react';
import {clampSideWidth,SIDE_DEFAULT} from '../lib/splitPane';
import type {Fire3D} from '../lib/useFire3D';
import type {Vec3} from '../lib/fireTool';
import {FireWorldView} from './FireWorldView';
import './Fire3DWorldPane.css';

const KEY='firecrackle.fire3d.side';
function readSide():{width:number;collapsed:boolean}{
 try{const v=JSON.parse(localStorage.getItem(KEY)??'null');if(v&&typeof v==='object')return{width:Number(v.width)||SIDE_DEFAULT,collapsed:!!v.collapsed};}catch{/* default */}
 return{width:SIDE_DEFAULT,collapsed:false};
}
function writeSide(v:{width:number;collapsed:boolean}){try{localStorage.setItem(KEY,JSON.stringify(v));}catch{/* not remembered */}}

/** The 3D quad's simulated world, a panel of its own beside the video: drag its left edge to resize, collapse it to a
 * thin strip with the button. */
export function Fire3DWorldPane({fire}:{fire:Fire3D}){
 const [side,setSide]=useState(readSide);
 const pane=useRef<HTMLElement>(null),drag=useRef<{x:number;width:number;space:number}|null>(null);
 const set=(v:{width:number;collapsed:boolean})=>{setSide(v);writeSide(v);};
 const {state}=fire,cam=state.camera,p=state.placements[0];
 const target:Vec3=p?(p.kind==='block'?[p.pos[0]+0.5,p.pos[1],p.pos[2]+0.5]:p.feet):state.clicks.find(c=>c.world)?.world??(cam?[cam.x,cam.y-1.62,cam.z]:[0,0,0]);
 if(side.collapsed)return <aside className="fire3d-side collapsed" aria-label="3D world (collapsed)">
  <button title="Show the 3D world" aria-label="Show the 3D world" onClick={()=>set({...side,collapsed:false})}>‹ 3D</button>
 </aside>;
 const down=(e:PointerEvent<HTMLDivElement>)=>{
  if(e.button!==0)return;
  const space=pane.current?.parentElement?.getBoundingClientRect().width??NaN;
  drag.current={x:e.clientX,width:side.width,space};
  try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* a pointer the browser no longer tracks: drag without capture */}
  e.preventDefault();e.stopPropagation();
 };
 const move=(e:PointerEvent<HTMLDivElement>)=>{const d=drag.current;if(d)setSide(s=>({...s,width:clampSideWidth(d.width+(d.x-e.clientX),d.space)}));};
 const up=()=>{if(drag.current){drag.current=null;setSide(s=>{writeSide(s);return s;});}};
 return <aside ref={pane} className="fire3d-side" style={{width:side.width}} aria-label="3D world">
  <div className="fire3d-divider" role="separator" aria-orientation="vertical" aria-label="Resize the 3D world" title="Drag to resize · double-click to reset"
   onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={()=>set({...side,width:SIDE_DEFAULT})}/>
  <div className="fire3d-side-body">
   <div className="fire3d-side-head"><strong>3D world</strong><span className="dim">drag to turn · wheel to zoom</span>
    <button title="Collapse the 3D world" aria-label="Collapse the 3D world" onClick={()=>set({...side,collapsed:true})}>›</button></div>
   {fire.ready?<FireWorldView state={state} target={target}/>:<span className="dim">Loading…</span>}
  </div>
 </aside>;
}
