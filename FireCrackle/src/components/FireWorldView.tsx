import {useRef,useState,type WheelEvent} from 'react';
import {orbitCamera,project} from '../lib/reversal';
import {groundGrid,placementQuads,type ToolState,type Vec3} from '../lib/fireTool';
import './FireWorldView.css';

const VIEW_W=800,VIEW_H=560;
const points=(p:[number,number][])=>p.map(q=>q.join(',')).join(' ');

/** The simulated world around the placements: block grid, fire quads, the solved eye and its look direction. Drag to
 * turn, wheel to zoom. Every pixel comes from Rust (orbit camera + projection). */
export function FireWorldView({state,target}:{state:ToolState;target:Vec3}){
 const [orbit,setOrbit]=useState({yaw:-135,pitch:35,dist:14});
 const drag=useRef<{x:number;y:number;yaw:number;pitch:number}|null>(null);
 const cam=orbitCamera(target,orbit.yaw,orbit.pitch,orbit.dist,70);
 if(!cam)return <div className="fq-world dim">No view.</div>;
 const grid=groundGrid(cam,VIEW_W,VIEW_H,[target[0],Math.floor(target[1]),target[2]],8);
 const quads=state.placements.flatMap(p=>placementQuads(p,cam,VIEW_W,VIEW_H).filter(q=>q.px).map(q=>({p,px:q.px!})));
 // placement outlines: the fire cell, or the entity's hitbox
 const boxes=state.placements.map(p=>{
  const [x0,y0,z0,x1,y1,z1]=p.kind==='block'?[p.pos[0],p.pos[1],p.pos[2],p.pos[0]+1,p.pos[1]+1,p.pos[2]+1]:[p.feet[0]-p.width/2,p.feet[1],p.feet[2]-p.width/2,p.feet[0]+p.width/2,p.feet[1]+p.height,p.feet[2]+p.width/2];
  const c:Vec3[]=[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]];
  const px=project(cam,c,VIEW_W,VIEW_H);
  return [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]].flatMap(([a,b])=>px[a]&&px[b]?[[px[a]!,px[b]!]]:[]);
 });
 const eye=state.camera,ahead=eye?orbitCamera([eye.x,eye.y,eye.z],eye.yaw,eye.pitch,1,eye.fov):null;
 // ahead.pos = eye − forward, so the look direction is eye − ahead.pos
 const look=eye&&ahead?project(cam,[[eye.x,eye.y,eye.z],[eye.x+3*(eye.x-ahead.x),eye.y+3*(eye.y-ahead.y),eye.z+3*(eye.z-ahead.z)]],VIEW_W,VIEW_H):null;
 const clicks=project(cam,state.clicks.flatMap(c=>c.world?[c.world]:[]),VIEW_W,VIEW_H);
 return <svg className="fq-world" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="Simulated world view"
  onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,yaw:orbit.yaw,pitch:orbit.pitch};try{(e.target as Element).setPointerCapture?.(e.pointerId);}catch{/* drag without capture */}}}
  onPointerMove={e=>{const d=drag.current;if(d)setOrbit(o=>({...o,yaw:d.yaw-(e.clientX-d.x)*0.4,pitch:Math.max(-89,Math.min(89,d.pitch+(e.clientY-d.y)*0.4))}));}}
  onPointerUp={()=>{drag.current=null;}}
  onWheel={(e:WheelEvent<SVGSVGElement>)=>setOrbit(o=>({...o,dist:Math.max(2,Math.min(80,o.dist*(e.deltaY>0?1.1:1/1.1)))}))}>
  <rect width={VIEW_W} height={VIEW_H} className="fq-world-bg"/>
  {grid.map((l,i)=><line key={i} className="fq-grid" x1={l[0][0]} y1={l[0][1]} x2={l[1][0]} y2={l[1][1]}/>)}
  {boxes.flat().map((l,i)=><line key={`b${i}`} className="fq-box" x1={l[0][0]} y1={l[0][1]} x2={l[1][0]} y2={l[1][1]}/>)}
  {quads.map((q,i)=><polygon key={i} className={`fq-quad ${q.p.kind==='entity'?'entity':q.p.kind==='block'&&q.p.soul?'soul':'block'}`} points={points(q.px)}/>)}
  {clicks.map((p,i)=>p&&<circle key={`c${i}`} className="fq-world-click" cx={p[0]} cy={p[1]} r={4}/>)}
  {look?.[0]&&<circle className="fq-eye" cx={look[0][0]} cy={look[0][1]} r={6}/>}
  {look?.[0]&&look[1]&&<line className="fq-look" x1={look[0][0]} y1={look[0][1]} x2={look[1][0]} y2={look[1][1]}/>}
 </svg>;
}
