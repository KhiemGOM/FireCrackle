import {useEffect,useMemo,useRef,type ReactNode} from 'react';
import {entitySizes,type CameraPose} from '../lib/reversal';
import {removeClick,setClickWorld,setEntity,setMode,toggleBurnFace,usableClicks,type BurnFace,type FireMode,type Vec3} from '../lib/fireTool';
import type {Fire3D} from '../lib/useFire3D';
import './Fire3DBar.css';

const fmt=(v:number,d=1)=>Number.isFinite(v)?v.toFixed(d):'–';
const FACES:BurnFace[]=['north','east','south','west','up'];
const MODES:[FireMode,string,string][]=[
 ['block','Fire block','A fire block on the floor (block coordinates)'],
 ['burning','Burning block','Fire on the faces of a burning block: the fire cell in front of it (block coordinates + faces)'],
 ['entity','Entity fire','Fire on a burning entity: its feet (decimals) and type'],
];

function Num({label,value,step=1,int=false,onChange}:{label:string;value:number;step?:number;int?:boolean;onChange:(v:number)=>void}){
 return <label className="f3-num"><span>{label}</span><input aria-label={label} type="number" step={step} value={Number.isFinite(value)?Number(value.toFixed(int?0:3)):''}
  onChange={e=>{const v=e.target.valueAsNumber;if(Number.isFinite(v))onChange(int?Math.trunc(v):v);}}/></label>;
}

/** The 3D quad tool's bar: Sprite (the same controls as the quad mask) · Camera (corners and the solve) · Fire (one fire
 * in one of three modes). */
export function Fire3DBar({fire,sprite}:{fire:Fire3D;sprite:ReactNode}){
 const {state,update,click,setClick,selected,setSelected}=fire;
 const sizes=useMemo(()=>fire.ready?[...entitySizes().keys()].sort():[],[fire.ready]);
 const cam=state.camera,g=state.guess,f=state.fire,corners=usableClicks(state);
 // a new corner is selected so its coordinates can be typed at once
 const count=useRef(state.clicks.length);
 useEffect(()=>{if(state.clicks.length>count.current)setSelected(state.clicks[state.clicks.length-1].id);count.current=state.clicks.length;},[state.clicks.length]); // eslint-disable-line react-hooks/exhaustive-deps
 const sel=state.clicks.find(c=>c.id===selected);
 const best=state.candidates.find(c=>c.camera===cam);
 const pending=state.clicks.findIndex(c=>!c.world),need=(g?2:4)-corners.length;
 const next=pending>=0?`type corner ${pending+1}'s position`:need>0?`click ${need} more block corner${need===1?'':'s'}`:'';
 const status=fire.error?fire.error:fire.busy?'Reading the picture…':cam?(best?`Camera solved · corners fit to ${fmt(best.rms,2)} px`:'Camera kept from before')+(next?` · ${next}`:'')
  :g?`Guess: pitch ${fmt(g.pitch)}° · FOV ${g.fovKnown?fmt(g.fov)+'°':'unknown'}${g.ambiguous?' (unsure)':''}${next?` · ${next}`:''}`
  :`No automatic guess for this picture${next?`: ${next}`:''}`;
 const editFire=(next:(x:NonNullable<typeof f>)=>NonNullable<typeof f>)=>update(s=>s.fire?{...s,fire:next(s.fire)}:s);
 const pos:Vec3|null=f?(f.mode==='entity'?f.feet:f.cell):null;
 const setPos=(k:number,v:number)=>editFire(x=>x.mode==='entity'?{...x,feet:x.feet.map((o,i)=>i===k?v:o) as Vec3}:{...x,cell:x.cell.map((o,i)=>i===k?v:o) as Vec3});
 return <div className="f3-bar" onKeyDown={e=>e.stopPropagation()}>
  <section className="f3-group" aria-label="Sprite"><span className="f3-title">Sprite</span>{sprite}</section>
  <section className="f3-group" aria-label="Camera">
   <span className="f3-title">Camera</span>
   <span className={`f3-status${cam&&(best?.rms??0)>3?' bad':''}`} role="status">{status}</span>
   <button aria-pressed={click==='corner'} title="Click block corners on the picture; type each one's position (the first is 0, 0, 0)" onClick={()=>setClick(click==='corner'?'none':'corner')}>Add corners</button>
   {state.clicks.length>0&&<button title="Remove every corner (the camera stays until corners solve it again)" onClick={()=>{update(s=>({...s,clicks:[],candidates:[]}));setSelected(null);}}>Clear</button>}
   {state.clicks.map((c,i)=><button key={c.id} className={`f3-chip${c.world?'':' pending'}`} aria-pressed={selected===c.id} onClick={()=>setSelected(selected===c.id?null:c.id)}
    title="Edit this corner">{i+1}{c.world?` · ${c.world.join(', ')}`:' · ?'}</button>)}
   {sel&&<span className="f3-edit" role="group" aria-label={`Corner ${state.clicks.indexOf(sel)+1}`}>
    {(['x','y','z'] as const).map((k,j)=><Num key={k} label={k} int value={sel.world?.[j]??NaN} onChange={v=>update(s=>setClickWorld(s,sel.id,(sel.world??[0,0,0]).map((q,m)=>m===j?v:q) as Vec3))}/>)}
    <button aria-label="Remove this corner" onClick={()=>{update(s=>removeClick(s,sel.id));setSelected(null);}}>Remove</button>
   </span>}
   <label title="The player stands on the block under the eye: the eye is 1.62 above the floor at this height"><input type="checkbox" checked={state.eyeY!==null} onChange={e=>update(s=>({...s,eyeY:e.target.checked?(corners[0]?.world[1]??0)+1.62:null}))}/> On ground</label>
   {state.candidates.length>1&&<select aria-label="Camera answer" title="Other cameras that fit the corners (a quarter turn apart)" value={state.candidates.findIndex(c=>c.camera===cam)} onChange={e=>update(s=>({...s,camera:s.candidates[Number(e.target.value)].camera}))}>
    {state.candidates.map((c,i)=><option key={i} value={i}>answer {i+1} · {fmt(c.rms,2)} px</option>)}
   </select>}
   {cam&&<details className="f3-values"><summary>Values</summary>{(['x','y','z','yaw','pitch','roll','fov'] as const).map(k=><Num key={k} label={k} value={cam[k]} step={k==='x'||k==='y'||k==='z'?0.01:0.05} onChange={v=>update(s=>({...s,camera:{...s.camera!,[k]:v} as CameraPose}))}/>)}</details>}
  </section>
  <section className="f3-group" aria-label="Fire">
   <span className="f3-title">Fire</span>
   <span className="f3-modes" role="radiogroup" aria-label="Fire mode">{MODES.map(([m,label,title])=><button key={m} role="radio" aria-checked={f?.mode===m} title={title} disabled={!cam||!f||(m==='burning'&&fire.soul)}
    onClick={()=>cam&&editFire(x=>setMode(x,m,cam))}>{label}</button>)}</span>
   {f&&pos&&<>
    {(['x','y','z'] as const).map((k,j)=><Num key={k} label={k} int={f.mode!=='entity'} step={f.mode==='entity'?0.05:1} value={pos[j]} onChange={v=>setPos(j,v)}/>)}
    {f.mode==='burning'&&<span className="f3-faces" role="group" aria-label="Burning faces" title="Which neighbours of the fire cell burn (the plane lies on that face)">{FACES.map(face=><button key={face} aria-pressed={f.faces[face]} onClick={()=>editFire(x=>({...x,faces:toggleBurnFace(x.faces,face)}))}>{face}</button>)}</span>}
    {f.mode==='entity'&&<>
     <input className="f3-entity" aria-label="Entity type" list="f3-entities" value={f.entity} onChange={e=>editFire(x=>setEntity(x,e.target.value))}/>
     <datalist id="f3-entities">{sizes.map(s=><option key={s} value={`minecraft:${s}`}/>)}</datalist>
     <span className="dim">{fmt(f.width,3)} × {fmt(f.height,3)}</span>
    </>}
    <button aria-pressed={click==='fire'} title="Click the picture to put the fire there (on the floor at this height)" onClick={()=>setClick(click==='fire'?'none':'fire')}>Place by click</button>
   </>}
   {!f&&<span className="dim">{cam?'Place by click to put the fire':'Solve the camera first'}</span>}
   {fire.soul&&<span className="dim">Soul fire: fire block shape only</span>}
  </section>
 </div>;
}
