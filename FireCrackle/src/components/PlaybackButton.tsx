import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {IconButton} from './Icon';
import type {Playback} from '../lib/actions';
import './ComparisonProofButton.css';
import './PlaybackButton.css';

export const PLAYBACK_SPEEDS=[.25,.5,1,2,4] as const;
export const playbackSpeedText=(speed:number)=>speed===.25?'¼×':speed===.5?'½×':`${speed}×`;

export function PlaybackButton({playback,speed,maxSpeed,onToggle,onSpeed}:{playback:Playback;speed:number;maxSpeed:number;onToggle:()=>void;onSpeed:(speed:number)=>void}){
  const [open,setOpen]=useState(false),id=useId();
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),options=useRef<Array<HTMLButtonElement|null>>([]);
  const current=playback.dir===0?speed:playback.speed,limit=Math.max(1,Math.floor(maxSpeed)||1);
  useEffect(()=>{
    if(!open)return;
    const index=PLAYBACK_SPEEDS.findIndex(value=>value===current);
    (options.current[index]??options.current[0])?.focus();
    const dismiss=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);
  },[open]);
  const close=()=>{setOpen(false);trigger.current?.focus();};
  function navigate(event:KeyboardEvent,index:number){
    event.stopPropagation();
    const allowed=PLAYBACK_SPEEDS.map((speed,i)=>({speed,i})).filter(option=>option.speed<=limit).map(option=>option.i);
    let target:number|undefined;
    const at=allowed.indexOf(index);
    if(event.key==='ArrowDown')target=allowed[(at+1)%allowed.length];
    if(event.key==='ArrowUp')target=allowed[(at+allowed.length-1)%allowed.length];
    if(event.key==='Home')target=allowed[0];
    if(event.key==='End')target=allowed[allowed.length-1];
    if(target!==undefined){event.preventDefault();options.current[target]?.focus();}
    if(event.key==='Escape'){event.preventDefault();close();}
  }
  return <div ref={root} className="comparison-proof-button playback-control" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setOpen(false);}}>
    <IconButton icon={playback.dir===0?'play':'pause'} label={playback.dir===0?'Play video':'Pause video'}
      className={`play-button${playback.dir!==0?' on':''}`} data-owns-keys="true"
      title={`${playback.dir===0?'Play':'Pause'} · ${playbackSpeedText(current)} · Space`}
      onClick={()=>{setOpen(false);onToggle();}}><span>{playback.dir<0?'−':''}{playbackSpeedText(current)}</span></IconButton>
    <button type="button" className="proof-dropdown-trigger" data-owns-keys="true" ref={trigger} aria-label="Playback speed" aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined}
      title="Choose playback speed" onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();setOpen(true);}
        if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();}
      }}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5"/></svg></button>
    {open&&<div className="comparison-proof-menu playback-speed-menu" role="menu" id={id} aria-label="Playback speed">
      {PLAYBACK_SPEEDS.map((value,index)=><button key={value} type="button" role="menuitemradio" aria-checked={current===value} disabled={value>limit} data-owns-keys="true"
        ref={element=>{options.current[index]=element;}} onKeyDown={event=>navigate(event,index)} onClick={()=>{close();onSpeed(value);}}>
        <span>{playbackSpeedText(value)}</span><span aria-hidden="true">{current===value?'✓':''}</span>
      </button>)}
    </div>}
  </div>;
}
