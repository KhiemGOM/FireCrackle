import {useEffect,useState} from 'react';
import {NEUTRAL_WATER_TINT,waterColor} from '../lib/waterTint';

export function WaterTintControl({color,onChange}:{color:string;onChange:(color:string)=>unknown}){
 const [draft,setDraft]=useState(color);
 useEffect(()=>setDraft(color),[color]);
 return <div className="atlas-filter-inputs" role="group" aria-label="Water color" onKeyDown={e=>e.stopPropagation()}>
  <label>Water color <input type="color" aria-label="Pick water color" value={color} onChange={e=>onChange(e.target.value)} style={{width:38,height:26,padding:2}}/></label>
  <input aria-label="Water color hex" type="text" value={draft} spellCheck={false} maxLength={7} style={{width:88,fontFamily:'monospace'}} onChange={e=>{setDraft(e.target.value);const next=waterColor(e.target.value);if(next)onChange(next);}} onBlur={()=>setDraft(color)} aria-invalid={!waterColor(draft)||undefined}/>
  <button disabled={color===NEUTRAL_WATER_TINT} onClick={()=>onChange(NEUTRAL_WATER_TINT)}>Untinted</button>
 </div>;
}
