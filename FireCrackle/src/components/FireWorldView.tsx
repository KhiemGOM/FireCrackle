import {useRef,useState,type WheelEvent} from 'react';
import {orbitCamera,playerBoxes,project,viewCone} from '../lib/reversal';
import {fireOutline,groundGrid,usableClicks,type Vec3} from '../lib/fireTool';
import type {Fire3D} from '../lib/useFire3D';
import {workingY} from './Fire3DOverlay';
import './FireWorldView.css';

const VIEW_W=800,VIEW_H=560;
const pts=(p:[number,number][])=>p.map(q=>q.join(',')).join(' ');
// box corner i: bit 0 = x high, bit 1 = y high, bit 2 = z high
const FACES=[[0,1,3,2],[4,5,7,6],[0,1,5,4],[2,3,7,6],[0,2,6,4],[1,3,7,5]];
const PART=['fq-leg','fq-leg','fq-body','fq-skin','fq-skin','fq-skin'];
const dist=(a:Vec3,b:Vec3)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

/** An overview of the scene the camera sees: the player (whose eye is the solved camera) with its view cone, the fire
 * and its cell, the clicked corners and the block grid. Drag to turn, wheel to zoom. Every pixel comes from Rust. */
export function FireWorldView({fire}:{fire:Fire3D}){
 const [orbit,setOrbit]=useState({yaw:-135,pitch:30,zoom:1});
 const drag=useRef<{x:number;y:number;yaw:number;pitch:number}|null>(null);
 const cam=fire.state.camera,f=fire.state.fire,corners=usableClicks(fire.state);
 const eye:Vec3|null=cam?[cam.x,cam.y,cam.z]:null;
 const fc:Vec3|null=f?(f.mode==='entity'?[f.feet[0],f.feet[1]+f.height/2,f.feet[2]]:[f.cell[0]+0.5,f.cell[1]+0.5,f.cell[2]+0.5]):corners[0]?.world??null;
 if(!eye&&!fc)return <div className="fq-world-empty dim">Solve the camera to see the scene.</div>;
 const target:Vec3=eye&&fc?[(eye[0]+fc[0])/2,(eye[1]-0.8+fc[1])/2,(eye[2]+fc[2])/2]:(eye??fc)!;
 const span=eye&&fc?dist(eye,fc):4;
 const view=orbitCamera(target,orbit.yaw,orbit.pitch,Math.max(5,span*1.15+3)*orbit.zoom,60);
 if(!view)return null;
 const P=(p:Vec3[])=>project(view,p,VIEW_W,VIEW_H);
 const y=workingY(fire)??(eye?eye[1]-1.62:0);
 const grid=groundGrid(view,VIEW_W,VIEW_H,[target[0],y,target[2]],Math.ceil(span/2)+6);
 // the player, faces drawn far to near
 const faces=cam?playerBoxes(cam).flatMap((b,bi)=>FACES.map(fi=>{
  const corners3=fi.map(k=>b[k]);const c:Vec3=[0,1,2].map(k=>corners3.reduce((s,p)=>s+p[k],0)/4) as Vec3;
  const px=P(corners3);return px.every(Boolean)?{d:dist(c,[view.x,view.y,view.z]),cls:PART[bi],px:px as [number,number][]}:null;
 }).filter((x):x is {d:number;cls:string;px:[number,number][]}=>!!x)).sort((a,b)=>b.d-a.d):[];
 const cone=cam&&size(fire)?viewCone(cam,size(fire)!.width,size(fire)!.height,Math.max(2,fc&&eye?dist(eye,fc)*1.1:6)):[];
 const conePx=P(cone),eyePx=eye?P([eye])[0]:null;
 const outline=f?fireOutline(f):[],outlinePx=P(outline.flat());
 const firePx=fire.quads.map(q=>P(q.world)).filter(p=>p.every(Boolean)) as [number,number][][];
 const cornerPx=P(corners.map(c=>c.world));
 return <svg className="fq-world" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="3D overview: the player, its view and the fire"
  onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,yaw:orbit.yaw,pitch:orbit.pitch};try{(e.target as Element).setPointerCapture?.(e.pointerId);}catch{/* drag without capture */}}}
  onPointerMove={e=>{const d=drag.current;if(d)setOrbit(o=>({...o,yaw:d.yaw-(e.clientX-d.x)*0.4,pitch:Math.max(-85,Math.min(89,d.pitch+(e.clientY-d.y)*0.4))}));}}
  onPointerUp={()=>{drag.current=null;}}
  onWheel={(e:WheelEvent<SVGSVGElement>)=>setOrbit(o=>({...o,zoom:Math.max(0.2,Math.min(6,o.zoom*(e.deltaY>0?1.1:1/1.1)))}))}>
  <rect width={VIEW_W} height={VIEW_H} className="fq-world-bg"/>
  {grid.map((l,i)=><line key={`g${i}`} className="fq-grid" x1={l[0][0]} y1={l[0][1]} x2={l[1][0]} y2={l[1][1]}/>)}
  {eyePx&&conePx.every(Boolean)&&<g className="fq-cone">
   {conePx.map((c,i)=><line key={i} x1={eyePx[0]} y1={eyePx[1]} x2={c![0]} y2={c![1]}/>)}
   <polygon points={pts(conePx as [number,number][])}/>
  </g>}
  {outline.map((_,i)=>{const a=outlinePx[2*i],b=outlinePx[2*i+1];return a&&b&&<line key={`o${i}`} className="fq-box" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}/>;})}
  {firePx.map((p,i)=><polygon key={`f${i}`} className={`fq-quad ${fire.soul&&f?.mode==='block'?'soul':f?.mode==='entity'?'entity':'block'}`} points={pts(p)}/>)}
  {faces.map((q,i)=><polygon key={`p${i}`} className={`fq-player ${q.cls}`} points={pts(q.px)}/>)}
  {cornerPx.map((p,i)=>p&&<g key={`c${i}`} className="fq-world-corner"><circle cx={p[0]} cy={p[1]} r={5}/><text x={p[0]+7} y={p[1]-6}>{i+1}</text></g>)}
 </svg>;
}
function size(fire:Fire3D){return fire.size;}
