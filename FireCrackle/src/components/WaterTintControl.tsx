import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {hasScreenEyedropper,pickScreenColor} from '../lib/eyedropper';
import './WaterTintControl.css';
import {NEUTRAL_WATER_TINT,waterColor} from '../lib/waterTint';
import {hexToHsv,hsvToHex,saturationValueAt,type Hsv} from '../lib/colorPicker';

export function WaterTintControl({color,onChange}:{color:string;onChange:(color:string)=>unknown}){
 const [draft,setDraft]=useState(color);
 const [position,setPosition]=useState<{left:number;top:number}|null>(null),[hsv,setHsv]=useState(()=>hexToHsv(color));
 const [sampling,setSampling]=useState(false),[error,setError]=useState<string|null>(null);
 const root=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null),abort=useRef<AbortController|null>(null);
 useEffect(()=>()=>abort.current?.abort(),[]);
 useEffect(()=>{
  if(!position)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node)&&!popup.current?.contains(e.target as Node))setPosition(null);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setPosition(null);}};
  const close=()=>setPosition(null);
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);window.addEventListener('resize',close);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',close);};
 },[position]);
 useEffect(()=>{setDraft(color);const next=hexToHsv(color);setHsv(previous=>({...next,h:next.s===0?previous.h:next.h}));},[color]);
 const change=(next:Hsv)=>{setHsv(next);onChange(hsvToHex(next));};
 const pick=(e:React.PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();change({...hsv,...saturationValueAt(e.clientX-r.left,e.clientY-r.top,r.width,r.height)});};
 const sample=async()=>{
  if(sampling)return;setError(null);setPosition(null);setSampling(true);
  const controller=new AbortController();abort.current=controller;
  try{const next=await pickScreenColor(controller.signal);if(next&&!controller.signal.aborted){setDraft(next);onChange(next);}}
  catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}
  finally{if(!controller.signal.aborted)setSampling(false);abort.current=null;}
 };
 const supported=hasScreenEyedropper();
 return <div ref={root} role="group" aria-label="Water color" onKeyDown={e=>e.stopPropagation()}>
  <div className="water-tint-bar">
  <span>Tint</span><button type="button" className="water-tint-swatch" aria-label="Pick water color" aria-expanded={!!position} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setPosition(position?null:{left:Math.max(8,Math.min(r.right-272,window.innerWidth-280)),top:Math.max(8,Math.min(r.bottom+6,window.innerHeight-270))});}}><span style={{background:color}}/></button>
  <input aria-label="Water color hex" type="text" value={draft} spellCheck={false} maxLength={7} onChange={e=>{setDraft(e.target.value);const next=waterColor(e.target.value);if(next)onChange(next);}} onBlur={()=>setDraft(color)} aria-invalid={!waterColor(draft)||undefined}/>
  <button type="button" className="water-eyedropper" aria-label="Pick water color from screen" title={supported?'Pick a screen colour · Escape cancels':'Pick a colour from the video/image · Escape cancels'} disabled={sampling} onClick={()=>void sample()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m14 5 5 5M4 20l3-1 12-12a2.1 2.1 0 0 0-3-3L4 16zM12 7l5 5"/></svg>{sampling?'Picking…':null}</button>
  <button type="button" disabled={color===NEUTRAL_WATER_TINT} onClick={()=>onChange(NEUTRAL_WATER_TINT)} title="Remove water tint">Untint</button>
  </div>
  {error&&<div className="water-picker-error" role="alert">{error}</div>}
  {position&&createPortal(<div ref={popup} role="dialog" aria-label="Choose water color" className="water-color-popup" style={position} onKeyDown={e=>e.stopPropagation()}>
   <header><strong>Water tint</strong><button type="button" aria-label="Close water color picker" onClick={()=>setPosition(null)}>×</button></header>
   <div role="slider" tabIndex={0} aria-label="Water saturation and brightness" aria-valuetext={`${Math.round(hsv.s*100)}% saturation, ${Math.round(hsv.v*100)}% brightness`} className="water-color-square" style={{background:`linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)`}}
    onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);pick(e);}}
    onPointerMove={e=>{if(e.buttons&1)pick(e);}}
    onKeyDown={e=>{const delta=.01;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();change({...hsv,s:Math.max(0,Math.min(1,hsv.s+(e.key==='ArrowRight'?delta:-delta)))});}if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();change({...hsv,v:Math.max(0,Math.min(1,hsv.v+(e.key==='ArrowUp'?delta:-delta)))});}}}>
    <span style={{left:`${hsv.s*100}%`,top:`${(1-hsv.v)*100}%`}}/>
   </div>
   <label className="water-hue">Hue <input type="range" aria-label="Water hue" min={0} max={359} step={1} value={Math.round(hsv.h)} onChange={e=>change({...hsv,h:e.target.valueAsNumber})}/></label>
  </div>,document.body)}
 </div>;
}
