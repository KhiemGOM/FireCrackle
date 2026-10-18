import {useEffect,useState} from 'react';
import {NEUTRAL_WATER_TINT,waterColor} from '../lib/waterTint';
import {hexToHsv,hsvToHex,saturationValueAt,type Hsv} from '../lib/colorPicker';

export function WaterTintControl({color,onChange}:{color:string;onChange:(color:string)=>unknown}){
 const [draft,setDraft]=useState(color);
 const [open,setOpen]=useState(false),[hsv,setHsv]=useState(()=>hexToHsv(color));
 useEffect(()=>{setDraft(color);const next=hexToHsv(color);setHsv(previous=>({...next,h:next.s===0?previous.h:next.h}));},[color]);
 const change=(next:Hsv)=>{setHsv(next);onChange(hsvToHex(next));};
 const pick=(e:React.PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();change({...hsv,...saturationValueAt(e.clientX-r.left,e.clientY-r.top,r.width,r.height)});};
 return <div role="group" aria-label="Water color" onKeyDown={e=>e.stopPropagation()}>
  <div className="atlas-filter-inputs">
  <label>Water color <button type="button" aria-label="Pick water color" aria-expanded={open} onClick={()=>setOpen(!open)} style={{width:38,height:26,padding:3}}><span style={{display:'block',width:'100%',height:'100%',background:color,borderRadius:3}}/></button></label>
  <input aria-label="Water color hex" type="text" value={draft} spellCheck={false} maxLength={7} style={{width:88,fontFamily:'monospace'}} onChange={e=>{setDraft(e.target.value);const next=waterColor(e.target.value);if(next)onChange(next);}} onBlur={()=>setDraft(color)} aria-invalid={!waterColor(draft)||undefined}/>
  <button disabled={color===NEUTRAL_WATER_TINT} onClick={()=>onChange(NEUTRAL_WATER_TINT)}>Untinted</button>
  </div>
  {open&&<div role="dialog" aria-label="Choose water color" style={{padding:10,margin:'8px 0',border:'1px solid var(--line)',borderRadius:7,background:'var(--panel)'}}>
   <div role="slider" tabIndex={0} aria-label="Water saturation and brightness" aria-valuetext={`${Math.round(hsv.s*100)}% saturation, ${Math.round(hsv.v*100)}% brightness`} style={{position:'relative',height:150,maxWidth:320,cursor:'crosshair',touchAction:'none',background:`linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)`}}
    onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);pick(e);}}
    onPointerMove={e=>{if(e.buttons&1)pick(e);}}
    onKeyDown={e=>{const delta=.01;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();change({...hsv,s:Math.max(0,Math.min(1,hsv.s+(e.key==='ArrowRight'?delta:-delta)))});}if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();change({...hsv,v:Math.max(0,Math.min(1,hsv.v+(e.key==='ArrowUp'?delta:-delta)))});}}}>
    <span style={{position:'absolute',left:`${hsv.s*100}%`,top:`${(1-hsv.v)*100}%`,width:10,height:10,border:'2px solid white',boxShadow:'0 0 0 1px black',borderRadius:'50%',transform:'translate(-50%,-50%)',pointerEvents:'none'}}/>
   </div>
   <label style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}>Hue <input type="range" aria-label="Water hue" min={0} max={359} step={1} value={Math.round(hsv.h)} onChange={e=>change({...hsv,h:e.target.valueAsNumber})} style={{flex:1,maxWidth:280}}/></label>
   <button type="button" onClick={()=>setOpen(false)} style={{marginTop:8}}>Done</button>
  </div>}
 </div>;
}
