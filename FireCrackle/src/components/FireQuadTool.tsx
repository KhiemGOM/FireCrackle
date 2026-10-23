import {useEffect,useMemo,useRef,useState,type PointerEvent,type WheelEvent} from 'react';
import type {Backend,View} from '../lib/api';
import {nativeFrame} from '../lib/exactFrame';
import {canvasFrameIo} from '../lib/veilFrame';
import {failureMessage} from '../lib/appErrors';
import {formatTimecode} from '../lib/timecode';
import {entitySizes,initReversal,orbitCamera,orientation,project,type CameraPose,type Face} from '../lib/reversal';
import {addClick,emptyTool,groundGrid,newBurningFace,newEntityFire,newFireBlock,placementQuads,removeClick,setClickWorld,solveTool,toggleFace,usableClicks,type Placement,type ToolState,type Vec3} from '../lib/fireTool';
import './FireQuadTool.css';

const FACES:Face[]=['floor','north','east','south','west','up'];
const VIEW_W=800,VIEW_H=560;
const fmt=(v:number,d=2)=>Number.isFinite(v)?v.toFixed(d):'–';
const points=(p:[number,number][])=>p.map(q=>q.join(',')).join(' ');

/** A number input that edits one value. */
function Num({label,value,step=1,onChange}:{label:string;value:number;step?:number;onChange:(v:number)=>void}){
 return <label className="fq-num"><span>{label}</span><input aria-label={label} type="number" step={step} value={Number.isFinite(value)?Number(value.toFixed(4)):''} onChange={e=>{const v=e.target.valueAsNumber;if(Number.isFinite(v))onChange(v);}}/></label>;
}

/** The frame, its fire quads and clicked corners, drawn with the solved camera. Clicking adds a block corner. */
function VideoView({url,w,h,state,quads,grid,picking,onClick}:{url?:string;w:number;h:number;state:ToolState;quads:{p:Placement;px:[number,number][]}[];grid:[number,number][][];picking:boolean;onClick:(px:[number,number])=>void}){
 const svg=useRef<SVGSVGElement>(null);
 const down=(e:PointerEvent<SVGSVGElement>)=>{
  if(!picking||e.button!==0)return;
  const m=svg.current?.getScreenCTM();if(!m)return;
  const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());
  if(p.x>=0&&p.y>=0&&p.x<=w&&p.y<=h)onClick([p.x,p.y]);
 };
 return <svg ref={svg} className={`fq-video${picking?' picking':''}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" onPointerDown={down} role="img" aria-label="Video frame with the fire quads">
  {url&&<image href={url} x={0} y={0} width={w} height={h}/>}
  {grid.map((l,i)=><line key={i} className="fq-grid" x1={l[0][0]} y1={l[0][1]} x2={l[1][0]} y2={l[1][1]}/>)}
  {quads.map((q,i)=><polygon key={i} className={`fq-quad ${q.p.kind==='entity'?'entity':q.p.soul?'soul':'block'}`} points={points(q.px)}/>)}
  {state.clicks.map((c,i)=><g key={c.id} className={`fq-click${c.world?'':' pending'}`}>
   <circle cx={c.px[0]} cy={c.px[1]} r={Math.max(w,h)/240}/><text x={c.px[0]+Math.max(w,h)/160} y={c.px[1]-Math.max(w,h)/200}>{i+1}</text>
  </g>)}
 </svg>;
}

/** The simulated world around the placements: block grid, fire quads, the solved eye and its look direction. Drag to
 * turn, wheel to zoom. Every pixel comes from Rust (orbit camera + projection). */
function WorldView({state,target}:{state:ToolState;target:Vec3}){
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
  onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,yaw:orbit.yaw,pitch:orbit.pitch};(e.target as Element).setPointerCapture?.(e.pointerId);}}
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

/** 3D fire tool: the automatic camera guess, corrected by clicked block corners; fire blocks, burning faces, soul fire
 * and entity fire placed in 3D and drawn over the frame next to a simulated world view. */
export function FireQuadTool({backend,view}:{backend:Backend;view:View}){
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 const [frame,setFrame]=useState(view.current);
 const [picture,setPicture]=useState<{frame:number;url:string;w:number;h:number}|null>(null);
 const [state,setState]=useState<ToolState>(()=>emptyTool(view.current));
 const [picking,setPicking]=useState(true),[busy,setBusy]=useState(false);
 const [entityKind,setEntityKind]=useState('minecraft:blaze');
 useEffect(()=>{void initReversal().then(()=>setReady(true)).catch(e=>setError(failureMessage(e)));},[]);
 // the frame at native resolution, and the automatic guess from it
 useEffect(()=>{
  if(!ready)return;
  let cancelled=false,url='';
  setBusy(true);setError('');
  void (async()=>{
   const blob=await nativeFrame(backend,frame);
   const img=await canvasFrameIo.decode(await blob.arrayBuffer());
   if(cancelled)return;
   url=URL.createObjectURL(blob);
   setPicture({frame,url,w:img.width,h:img.height});
   const guess=orientation(img.data,img.width,img.height);
   setState(s=>({...emptyTool(frame),clicks:s.frame===frame?s.clicks:[],placements:s.placements,eyeY:s.eyeY,camera:s.camera,guess}));
  })().catch(e=>{if(!cancelled)setError(failureMessage(e));}).finally(()=>{if(!cancelled)setBusy(false);});
  return()=>{cancelled=true;if(url)URL.revokeObjectURL(url);};
 },[backend,frame,ready]);
 const w=picture?.w??1920,h=picture?.h??1080;
 const cam=state.camera;
 const quads=useMemo(()=>cam&&ready?state.placements.flatMap(p=>placementQuads(p,cam,w,h).filter(q=>q.px).map(q=>({p,px:q.px!}))):[],[cam,state.placements,ready,w,h]);
 const target:Vec3=state.placements[0]?(state.placements[0].kind==='block'?[state.placements[0].pos[0]+0.5,state.placements[0].pos[1],state.placements[0].pos[2]+0.5]:state.placements[0].feet):usableClicks(state)[0]?.world??(cam?[cam.x,cam.y-1.62,cam.z]:[0,0,0]);
 const grid=useMemo(()=>cam&&ready?groundGrid(cam,w,h,target,8):[],[cam,ready,w,h,target[0],target[1],target[2]]); // eslint-disable-line react-hooks/exhaustive-deps
 const sizes=useMemo(()=>ready?[...entitySizes().keys()].sort():[],[ready]);
 const update=(f:(s:ToolState)=>ToolState)=>setState(s=>f(s));
 const editPlacement=(id:number,f:(p:Placement)=>Placement)=>update(s=>({...s,placements:s.placements.map(p=>p.id===id?f(p):p)}));
 const placeAt:Vec3=target;
 const g=state.guess;
 if(error&&!ready)return <section className="misc-panel" aria-label="3D fire"><span role="alert">{error}</span></section>;
 return <section className="misc-panel fq-tool" aria-label="3D fire">
  <div className="fq-toolbar">
   <Num label="Frame" value={frame} onChange={v=>setFrame(Math.max(0,Math.min(view.frame_count-1,Math.trunc(v))))}/>
   <button onClick={()=>setFrame(view.current)}>Current frame</button>
   <span className="dim">{formatTimecode(frame/(view.fps||1),view.fps||1)}</span>
   <span className="fq-guess" role="status">{busy?'Reading the frame…':g?`Automatic guess: yaw ${fmt(g.yaw,1)}° (mod 90) · pitch ${fmt(g.pitch,1)}° · FOV ${g.fovKnown?fmt(g.fov,1)+'°':'unknown'} · ${g.ambiguous?'unsure':'confident'} (margin ${fmt(g.margin,2)})`:'No automatic guess for this frame: click 4 or more corners.'}</span>
   {error&&<span role="alert">{error}</span>}
  </div>
  <div className="fq-split">
   <div className="fq-pane">
    <div className="fq-pane-head"><strong>Video</strong><label><input type="checkbox" checked={picking} onChange={e=>setPicking(e.target.checked)}/> Click to add a block corner</label></div>
    <VideoView url={picture?.url} w={w} h={h} state={state} quads={quads} grid={grid} picking={picking} onClick={px=>update(s=>addClick(s,px))}/>
   </div>
   <div className="fq-pane">
    <div className="fq-pane-head"><strong>World</strong><span className="dim">drag to turn · wheel to zoom</span></div>
    {ready&&<WorldView state={state} target={target}/>}
   </div>
  </div>
  <div className="fq-panels">
   <section aria-label="Corners">
    <h3>Corners</h3>
    <p className="dim">The first corner is (0, 0, 0); type the others relative to it, in blocks.</p>
    {state.clicks.length===0&&<p className="dim">Click a block corner on the video.</p>}
    {state.clicks.map((c,i)=><div key={c.id} className="fq-row">
     <strong>{i+1}</strong><span className="dim">({fmt(c.px[0],0)}, {fmt(c.px[1],0)})</span>
     {(['x','y','z'] as const).map((k,j)=><Num key={k} label={`Corner ${i+1} ${k}`} value={c.world?.[j]??NaN} onChange={v=>update(s=>setClickWorld(s,c.id,(c.world?c.world.map((q,m)=>m===j?v:q):[0,0,0].map((q,m)=>m===j?v:q)) as Vec3))}/>)}
     <button aria-label={`Remove corner ${i+1}`} onClick={()=>update(s=>removeClick(s,c.id))}>✕</button>
    </div>)}
    <label className="fq-row"><input type="checkbox" checked={state.eyeY!==null} onChange={e=>update(s=>({...s,eyeY:e.target.checked?1.62:null}))}/> Standing on the ground: eye height</label>
    {state.eyeY!==null&&<Num label="Eye y" value={state.eyeY} step={0.01} onChange={v=>update(s=>({...s,eyeY:v}))}/>}
    <div className="fq-row"><button className="primary" disabled={!ready||usableClicks(state).length===0} onClick={()=>update(s=>solveTool(s,w,h))}>Solve camera</button>
     <span className="dim">{usableClicks(state).length} corner{usableClicks(state).length===1?'':'s'} with coordinates</span></div>
    {state.candidates.length>1&&<div className="fq-candidates" role="radiogroup" aria-label="Camera answers">
     {state.candidates.map((f,i)=><label key={i}><input type="radio" name="fq-candidate" checked={cam===f.camera} onChange={()=>update(s=>({...s,camera:f.camera}))}/> yaw {fmt(f.camera.yaw,1)}° · {fmt(f.rms,2)} px</label>)}
    </div>}
   </section>
   <section aria-label="Camera">
    <h3>Camera</h3>
    {cam?<div className="fq-grid-fields">{(['x','y','z','yaw','pitch','roll','fov'] as const).map(k=><Num key={k} label={k} value={cam[k]} step={k==='x'||k==='y'||k==='z'?0.01:0.05} onChange={v=>update(s=>({...s,camera:{...s.camera!,[k]:v} as CameraPose}))}/>)}</div>:<p className="dim">Solve from corners first; then nudge any value by hand.</p>}
   </section>
   <section aria-label="Fire">
    <h3>Fire</h3>
    <div className="fq-row">
     <button disabled={!cam} onClick={()=>update(s=>({...s,placements:[...s.placements,newFireBlock(placeAt)]}))}>+ Fire block</button>
     <button disabled={!cam} onClick={()=>update(s=>({...s,placements:[...s.placements,newBurningFace(cam!,placeAt)]}))}>+ Burning block face</button>
     <button disabled={!cam} onClick={()=>update(s=>({...s,placements:[...s.placements,newFireBlock(placeAt,true)]}))}>+ Soul fire</button>
     <button disabled={!cam} onClick={()=>update(s=>({...s,placements:[...s.placements,newEntityFire(placeAt,entityKind)]}))}>+ Entity fire</button>
     <input aria-label="Entity type" list="fq-entities" value={entityKind} onChange={e=>setEntityKind(e.target.value)}/>
     <datalist id="fq-entities">{['custom',...sizes.map(s=>`minecraft:${s}`)].map(s=><option key={s} value={s}/>)}</datalist>
    </div>
    {state.placements.map((p,i)=><div key={p.id} className="fq-placement">
     <strong>{i+1}. {p.kind==='entity'?`Entity fire (${p.entity})`:p.soul?'Soul fire':p.faces.floor?'Fire block':'Burning block face'}</strong>
     {p.kind==='block'?<>
      {(['x','y','z'] as const).map((k,j)=><Num key={k} label={`Fire ${i+1} ${k}`} value={p.pos[j]} onChange={v=>editPlacement(p.id,q=>q.kind==='block'?{...q,pos:q.pos.map((o,m)=>m===j?Math.trunc(v):o) as Vec3}:q)}/>)}
      {!p.soul&&<div className="fq-faces" role="group" aria-label={`Fire ${i+1} faces`}>{FACES.map(f=><button key={f} aria-pressed={p.faces[f]} onClick={()=>editPlacement(p.id,q=>q.kind==='block'?{...q,faces:toggleFace(q.faces,f)}:q)}>{f}</button>)}</div>}
     </>:<>
      {(['x','y','z'] as const).map((k,j)=><Num key={k} label={`Fire ${i+1} ${k}`} value={p.feet[j]} step={0.05} onChange={v=>editPlacement(p.id,q=>q.kind==='entity'?{...q,feet:q.feet.map((o,m)=>m===j?v:o) as Vec3}:q)}/>)}
      <Num label={`Fire ${i+1} width`} value={p.width} step={0.05} onChange={v=>editPlacement(p.id,q=>q.kind==='entity'?{...q,width:v}:q)}/>
      <Num label={`Fire ${i+1} height`} value={p.height} step={0.05} onChange={v=>editPlacement(p.id,q=>q.kind==='entity'?{...q,height:v}:q)}/>
     </>}
     <button aria-label={`Remove fire ${i+1}`} onClick={()=>update(s=>({...s,placements:s.placements.filter(q=>q.id!==p.id)}))}>✕</button>
    </div>)}
    {!cam&&<p className="dim">Fire is placed once there is a camera.</p>}
   </section>
  </div>
 </section>;
}
