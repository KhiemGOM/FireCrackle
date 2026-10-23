import {useEffect,useMemo,useState} from 'react';
import {entitySizes,type CameraPose,type Face} from '../lib/reversal';
import {newBurningFace,newEntityFire,newFireBlock,removeClick,setClickWorld,solveTool,toggleFace,usableClicks,type Placement,type Vec3} from '../lib/fireTool';
import type {Fire3D} from '../lib/useFire3D';
import type {ManualQuad} from '../lib/quadMask';
import './Fire3DPanel.css';

const FACES:Face[]=['floor','north','east','south','west','up'];
const fmt=(v:number,d=2)=>Number.isFinite(v)?v.toFixed(d):'–';

function Num({label,value,step=1,onChange}:{label:string;value:number;step?:number;onChange:(v:number)=>void}){
 return <label className="f3-num"><span>{label}</span><input aria-label={label} type="number" step={step} value={Number.isFinite(value)?Number(value.toFixed(4)):''} onChange={e=>{const v=e.target.valueAsNumber;if(Number.isFinite(v))onChange(v);}}/></label>;
}
const describe=(p:Placement)=>p.kind==='entity'?`Entity fire (${p.entity.replace(/^minecraft:/,'')})`:p.soul?'Soul fire':p.faces.floor?'Fire block':'Burning block face';

/** The 3D quad tool's settings: the automatic camera guess corrected by clicked block corners, fire placed in 3D,
 * and one of its planes sent to the manual quad (`onUse`) so the sprite, row stepping, match and refine work on it.
 * The simulated world is its own panel beside the video (Fire3DWorldPane). */
export function Fire3DPanel({fire,onUse}:{fire:Fire3D;onUse:(quad:ManualQuad,mirrored:boolean)=>void}){
 const {state,setState,size,choice,setChoice,planes,manual}=fire;
 const [entityKind,setEntityKind]=useState('minecraft:blaze');
 const sizes=useMemo(()=>fire.ready?[...entitySizes().keys()].sort():[],[fire.ready]);
 const w=size?.width??0,h=size?.height??0,cam=state.camera,g=state.guess,clicks=usableClicks(state);
 // the chosen plane follows the camera and the placement: send it to the manual quad whenever it changes
 const key=manual?JSON.stringify(manual):'';
 useEffect(()=>{if(manual)onUse(manual.quad,manual.mirrored);},[key]); // eslint-disable-line react-hooks/exhaustive-deps
 const target:Vec3=state.placements[0]?(state.placements[0].kind==='block'?[state.placements[0].pos[0]+0.5,state.placements[0].pos[1],state.placements[0].pos[2]+0.5]:state.placements[0].feet):clicks[0]?.world??(cam?[cam.x,cam.y-1.62,cam.z]:[0,0,0]);
 const add=(p:Placement)=>{setState(s=>({...s,placements:[...s.placements,p]}));setChoice({placement:p.id,plane:0});};
 const edit=(id:number,f:(p:Placement)=>Placement)=>setState(s=>({...s,placements:s.placements.map(p=>p.id===id?f(p):p)}));
 return <div className="f3-panel" aria-label="3D quad" onKeyDown={e=>e.stopPropagation()}>
  <div className="f3-controls">
   <div className="f3-row" role="status">{fire.error?<span role="alert">{fire.error}</span>:fire.busy?'Reading the frame…':g?<>Guess: yaw {fmt(g.yaw,1)}° (mod 90) · pitch {fmt(g.pitch,1)}° · FOV {g.fovKnown?`${fmt(g.fov,1)}°`:'unknown'} · <strong>{g.ambiguous?'unsure':'confident'}</strong></>:'No automatic guess for this frame: click 4 or more corners.'}</div>
   <div className="f3-row">
    <button aria-pressed={fire.picking} onClick={()=>fire.setPicking(!fire.picking)}>{fire.picking?'Picking corners…':'Pick corners'}</button>
    <span className="dim">The first corner is (0, 0, 0); type the others in blocks from it.</span>
   </div>
   {state.clicks.map((c,i)=><div key={c.id} className="f3-row">
    <strong>{i+1}</strong>
    {(['x','y','z'] as const).map((k,j)=><Num key={k} label={`Corner ${i+1} ${k}`} value={c.world?.[j]??NaN} onChange={v=>setState(s=>setClickWorld(s,c.id,(c.world??[0,0,0]).map((q,m)=>m===j?v:q) as Vec3))}/>)}
    <button aria-label={`Remove corner ${i+1}`} onClick={()=>setState(s=>removeClick(s,c.id))}>✕</button>
   </div>)}
   <div className="f3-row">
    <label><input type="checkbox" checked={state.eyeY!==null} onChange={e=>setState(s=>({...s,eyeY:e.target.checked?1.62:null}))}/> Standing on the ground</label>
    {state.eyeY!==null&&<Num label="Eye y" value={state.eyeY} step={0.01} onChange={v=>setState(s=>({...s,eyeY:v}))}/>}
    <button className="primary" disabled={!fire.ready||!w||clicks.length===0} onClick={()=>setState(s=>solveTool(s,w,h))}>Solve camera</button>
    {state.candidates.length>1&&<select aria-label="Camera answer" value={state.candidates.findIndex(f=>f.camera===cam)} onChange={e=>setState(s=>({...s,camera:s.candidates[Number(e.target.value)].camera}))}>
     {state.candidates.map((f,i)=><option key={i} value={i}>yaw {fmt(f.camera.yaw,1)}° · {fmt(f.rms,2)} px</option>)}
    </select>}
   </div>
   {cam&&<div className="f3-row">{(['x','y','z','yaw','pitch','roll','fov'] as const).map(k=><Num key={k} label={k} value={cam[k]} step={k==='x'||k==='y'||k==='z'?0.01:0.05} onChange={v=>setState(s=>({...s,camera:{...s.camera!,[k]:v} as CameraPose}))}/>)}</div>}
   <div className="f3-row">
    <button disabled={!cam} onClick={()=>add(newFireBlock(target))}>+ Fire block</button>
    <button disabled={!cam} onClick={()=>add(newBurningFace(cam!,target))}>+ Burning face</button>
    <button disabled={!cam} onClick={()=>add(newFireBlock(target,true))}>+ Soul fire</button>
    <button disabled={!cam} onClick={()=>add(newEntityFire(target,entityKind))}>+ Entity fire</button>
    <input aria-label="Entity type" list="f3-entities" value={entityKind} onChange={e=>setEntityKind(e.target.value)}/>
    <datalist id="f3-entities">{['custom',...sizes.map(s=>`minecraft:${s}`)].map(s=><option key={s} value={s}/>)}</datalist>
   </div>
   {state.placements.map((p,i)=>{
    const qs=planes.find(x=>x.placement===p.id)?.quads??[];
    return <div key={p.id} className="f3-placement">
     <strong>{describe(p)}</strong>
     {p.kind==='block'?<>
      {(['x','y','z'] as const).map((k,j)=><Num key={k} label={`Fire ${i+1} ${k}`} value={p.pos[j]} onChange={v=>edit(p.id,q=>q.kind==='block'?{...q,pos:q.pos.map((o,m)=>m===j?Math.trunc(v):o) as Vec3}:q)}/>)}
      {!p.soul&&<span className="f3-faces" role="group" aria-label={`Fire ${i+1} faces`}>{FACES.map(f=><button key={f} aria-pressed={p.faces[f]} onClick={()=>edit(p.id,q=>q.kind==='block'?{...q,faces:toggleFace(q.faces,f)}:q)}>{f}</button>)}</span>}
     </>:<>
      {(['x','y','z'] as const).map((k,j)=><Num key={k} label={`Fire ${i+1} ${k}`} value={p.feet[j]} step={0.05} onChange={v=>edit(p.id,q=>q.kind==='entity'?{...q,feet:q.feet.map((o,m)=>m===j?v:o) as Vec3}:q)}/>)}
      <Num label="w" value={p.width} step={0.05} onChange={v=>edit(p.id,q=>q.kind==='entity'?{...q,width:v}:q)}/>
      <Num label="h" value={p.height} step={0.05} onChange={v=>edit(p.id,q=>q.kind==='entity'?{...q,height:v}:q)}/>
     </>}
     <span className="f3-planes" role="group" aria-label={`Fire ${i+1}: plane used as the quad mask`}>
      {qs.map((q,k)=><button key={k} disabled={!q.px} aria-pressed={choice?.placement===p.id&&choice.plane===k} title={q.px?'Use this plane as the quad mask':'Behind the camera'} onClick={()=>setChoice({placement:p.id,plane:k})}>{k+1}</button>)}
     </span>
     <button aria-label={`Remove fire ${i+1}`} onClick={()=>{setState(s=>({...s,placements:s.placements.filter(q=>q.id!==p.id)}));if(choice?.placement===p.id)setChoice(null);}}>✕</button>
    </div>;})}
  </div>
 </div>;
}
