import {useRef,useState,type WheelEvent} from 'react';
import {orbitCamera,playerBoxes,project,viewCone,type CameraPose} from '../lib/reversal';
import {axisLines,fireOutline,groundGrid,orbitDrag,panTarget,usableClicks,type Vec3} from '../lib/fireTool';
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
 * and its cell, the clicked corners, the block grid and the axes. Left-drag pans, right-drag turns, the wheel zooms,
 * a double-click resets. Every pixel comes from Rust. */
export function FireWorldView({fire}:{fire:Fire3D}){
 const [orbit,setOrbit]=useState({yaw:-135,pitch:30,zoom:1});
 const [pan,setPan]=useState<Vec3>([0,0,0]);
 const drag=useRef<{button:number;x:number;y:number;yaw:number;pitch:number;view:CameraPose;target:Vec3;pan:Vec3}|null>(null);
 const cam=fire.state.camera,f=fire.state.fire,corners=usableClicks(fire.state);
 const eye:Vec3|null=cam?[cam.x,cam.y,cam.z]:null;
 const fc:Vec3|null=f?(f.mode==='entity'?[f.feet[0],f.feet[1]+f.height/2,f.feet[2]]:[f.cell[0]+0.5,f.cell[1]+0.5,f.cell[2]+0.5]):corners[0]?.world??null;
 if(!eye&&!fc)return <div className="fq-world-empty dim">Solve the camera to see the scene.</div>;
 const centre:Vec3=eye&&fc?[(eye[0]+fc[0])/2,(eye[1]-0.8+fc[1])/2,(eye[2]+fc[2])/2]:(eye??fc)!;
 const target:Vec3=[centre[0]+pan[0],centre[1]+pan[1],centre[2]+pan[2]];
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
 const origin=corners[0]?.world??(f?(f.mode==='entity'?f.feet:f.cell):null);
 const axes=origin?axisLines(view,origin,VIEW_W,VIEW_H):[];
 // client pixels to the view's own (the svg is scaled to its pane)
 const toView=(e:{clientX:number;clientY:number;currentTarget:{getBoundingClientRect():{left:number;top:number;width:number;height:number}}}):[number,number]=>{
  const r=e.currentTarget.getBoundingClientRect();return [(e.clientX-r.left)*VIEW_W/(r.width||VIEW_W),(e.clientY-r.top)*VIEW_H/(r.height||VIEW_H)];
 };
 return <svg className="fq-world" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="3D overview: the player, its view and the fire"
  onContextMenu={e=>e.preventDefault()}
  onDoubleClick={()=>{setOrbit({yaw:-135,pitch:30,zoom:1});setPan([0,0,0]);}}
  onPointerDown={e=>{
   if(e.button!==0&&e.button!==2)return;
   const [x,y]=toView(e);
   drag.current={button:e.button,x,y,yaw:orbit.yaw,pitch:orbit.pitch,view,target,pan};
   try{(e.target as Element).setPointerCapture?.(e.pointerId);}catch{/* drag without capture */}
  }}
  onPointerMove={e=>{
   const d=drag.current;if(!d)return;
   const [x,y]=toView(e);
   if(d.button===2){const o=orbitDrag(d,x-d.x,y-d.y);setOrbit(v=>({...v,...o}));return;}
   // left: pan, the point under the cursor stays under it
   const moved=panTarget(d.view,d.target,[d.x,d.y],[x,y],VIEW_W,VIEW_H);
   setPan([d.pan[0]+moved[0]-d.target[0],d.pan[1]+moved[1]-d.target[1],d.pan[2]+moved[2]-d.target[2]]);
  }}
  onPointerUp={()=>{drag.current=null;}}
  onPointerCancel={()=>{drag.current=null;}}
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
  {axes.map(a=><g key={a.axis} className={`fq-axis ${a.axis}`}><line x1={a.from[0]} y1={a.from[1]} x2={a.to[0]} y2={a.to[1]}/><text className="fq-axis-label" x={a.to[0]+4} y={a.to[1]-4}>{a.label}</text></g>)}
  {cornerPx.map((p,i)=>p&&<g key={`c${i}`} className="fq-world-corner"><circle cx={p[0]} cy={p[1]} r={5}/><text x={p[0]+7} y={p[1]-6}>{i+1}</text></g>)}
 </svg>;
}
function size(fire:Fire3D){return fire.size;}
