import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import fire0 from "../assets/fire_0.png";
import fire1 from "../assets/fire_1.png";
import { matchFireQuad, type MatchImage, type QuadCandidate, type QuadMatch } from "../lib/quadMatch";
import type { ManualQuad } from "../lib/quadMask";
import { Icon } from "./Icon";
import type { EdgeFilter } from "../lib/atlasFilter";
import { readPreferences, writePreferences } from "../lib/preferences";
import "./QuadMatchControls.css";

interface Props { frameUrl:string; quad:ManualQuad; filter?:EdgeFilter; disabled:boolean; onPreview:(candidate:QuadCandidate)=>void;
  /** Increases to ask for a match run (the M key). */ runToken?:number;
  /** A request to preview the nth candidate (M then 1, 2, 3); `n` makes each request distinct. */ pick?:{index:number;n:number}|null }
function readImage(src:string):Promise<MatchImage> {
  return new Promise((resolve,reject)=> {
    const image=new Image();
    image.onload=()=> {
      try {
        const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("Canvas unavailable");
        ctx.drawImage(image,0,0);
        resolve({width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data});
      }catch(e){reject(e);}
    };
    image.onerror=()=>reject(new Error("Could not load matching image"));image.src=src;
  });
}
let atlas:Promise<[Uint8ClampedArray,Uint8ClampedArray]>|null=null;
function readAtlas() {
  if(!atlas)atlas=Promise.all([readImage(fire0),readImage(fire1)]).then(images=> {
    if(images.some(i=>i.width!==16||i.height!==512))throw new Error("Invalid fire texture sheets");
    return [images[0].data,images[1].data] as [Uint8ClampedArray,Uint8ClampedArray];
  }).catch(e=>{atlas=null;throw e;});
  return atlas;
}
const identity=(frameUrl:string,quad:ManualQuad,adjustQuad=false,filter?:EdgeFilter)=>JSON.stringify([frameUrl,quad,adjustQuad,filter]);
const name=(c:QuadCandidate)=>`sheet ${c.sheet} · row ${c.row} · ${c.mirrored?"mirrored":"normal"}`;
function showDetails(e:SyntheticEvent<HTMLButtonElement>) {
  const tip=e.currentTarget.nextElementSibling as HTMLElement|null;
  if(!tip?.showPopover)return;
  tip.showPopover();
  const anchor=e.currentTarget.getBoundingClientRect(),box=tip.getBoundingClientRect();
  tip.style.left=`${Math.max(8,Math.min(anchor.left,window.innerWidth-box.width-8))}px`;
  tip.style.top=`${anchor.bottom+box.height+8<=window.innerHeight?anchor.bottom+6:Math.max(8,anchor.top-box.height-6)}px`;
}
function hideDetails(e:SyntheticEvent<HTMLButtonElement>) {
  const tip=e.currentTarget.nextElementSibling as HTMLElement|null;
  tip?.hidePopover?.();
}

export function QuadMatchControls({frameUrl,quad,disabled,onPreview,filter,runToken=0,pick=null}:Props) {
  const saved=readPreferences();
  const [adjustQuad,setAdjustQuad]=useState(saved.matchAdjustQuad);
  const [onlyFiltered,setOnlyFiltered]=useState(saved.matchOnlyFiltered);
  const activeFilter=onlyFiltered?filter:undefined;
  const key=identity(frameUrl,quad,adjustQuad,activeFilter),latest=useRef({key,disabled,onPreview});latest.current={key,disabled,onPreview};
  const token=useRef(0);
  const cancel=useRef<null|(()=>void)>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [result,setResult]=useState<{key:string;data?:QuadMatch;error?:string;selected?:QuadCandidate}|null>(null);
  const current=result?.key===key?result:null;
  useEffect(()=>()=>{token.current++;cancel.current?.();},[]);
  useEffect(()=>()=>{cancel.current?.();},[key,disabled]);
  const handledRun=useRef(0),handledPick=useRef(0);
  // M: run the match once the picture is ready (and again when asked again after a run finished)
  // (started from a timer: a run begun inside the effect itself is cancelled by React's mount/unmount replay in development)
  useEffect(()=>{
    if(!runToken||runToken===handledRun.current||disabled||busy===key)return;
    const timer=window.setTimeout(()=>{handledRun.current=runToken;void find();},0);
    return()=>window.clearTimeout(timer);
  },[runToken,disabled,busy,key]); // eslint-disable-line react-hooks/exhaustive-deps
  // M then 1, 2, 3: preview that candidate as soon as it exists
  useEffect(()=>{
    if(!pick||pick.n===handledPick.current||disabled)return;
    const candidate=current?.data?.candidates[pick.index];
    if(!candidate)return;
    handledPick.current=pick.n;preview(candidate);
  },[pick,current,disabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{writePreferences({matchAdjustQuad:adjustQuad,matchOnlyFiltered:onlyFiltered});},[adjustQuad,onlyFiltered]);
  async function find() {
    const mine=++token.current,start=key;
    cancel.current?.();cancel.current=null;
    setBusy(start);setResult(null);
    try {
      // Read the original JPEG, never the displayed overlay or a screenshot.
      const [image,sheets]=await Promise.all([readImage(frameUrl),readAtlas()]);
      await new Promise(resolve=>window.setTimeout(resolve,0));
      if(mine!==token.current||latest.current.key!==start||latest.current.disabled)return;
      const options={refineGeometry:adjustQuad,...(activeFilter?{filter:activeFilter}:{})};
      const data=typeof Worker==="undefined"?matchFireQuad(image,sheets,quad,options):await new Promise<QuadMatch>((resolve,reject)=>{
        const worker=new Worker(new URL("../lib/quadMatch.worker.ts",import.meta.url),{type:"module"});
        const stop=()=>{finish();reject(new Error("Matching cancelled"));};
        const finish=()=>{worker.terminate();if(cancel.current===stop)cancel.current=null;};
        cancel.current=stop;
        worker.onmessage=(event:MessageEvent<{result?:QuadMatch;error?:string}>)=>{
          finish();if(event.data.result)resolve(event.data.result);else reject(new Error(event.data.error??"Matching failed"));
        };
        worker.onerror=event=>{finish();reject(new Error(event.message||"Matching worker failed"));};
        worker.postMessage({image,sheets,quad,options},[image.data.buffer as ArrayBuffer]);
      });
      if(mine!==token.current||latest.current.key!==start||latest.current.disabled)return;
      const best=data.status==="clear"?data.candidates[0]:undefined;
      setResult({key:best?identity(frameUrl,best.quad,adjustQuad,activeFilter):start,data,selected:best});
      if(best)latest.current.onPreview(best);
    }catch(e){if(mine===token.current&&latest.current.key===start)setResult({key:start,error:String(e)});}
    finally{if(mine===token.current)setBusy(null);}
  }
  function preview(candidate:QuadCandidate) {
    if(!current?.data||disabled)return;
    setResult({...current,key:identity(frameUrl,candidate.quad,adjustQuad,activeFilter),selected:candidate});
    onPreview(candidate);
  }
  const summary=current?.error?`Match failed: ${current.error}`:!current?.data?"Uses your quad outline. Preview a match, then Confirm/Enter to label."
    :current.selected?`Colour guess: ${name(current.selected)}. Verify before confirming.`
    :current.data.status==="filtered"?"No sprites pass the atlas filters. Change the counts or turn off Only filtered sprites."
    :current.data.status==="insufficient"?"Too few visible pixels. Adjust the quad or use a larger fire."
    :current.data.status==="weak"?"Too little matching colour evidence. Closest candidates shown."
    :"Close matches. Click a numbered candidate to preview.";
  const info=[summary,`Atlas edges: left ${filter?.left??"Any"}, right ${filter?.right??"Any"}. ${onlyFiltered?"Filters applied before matching.":"Searching all sprites."}`,
    current?.data?`Tried ${current.data.searched} / 128 sprites.`:"",adjustQuad?"Per-sprite corner fitting enabled, bounded to 120% of your outline.":"Your quad corners stay fixed.","Results are previews; only Confirm/Enter saves a label."].filter(Boolean).join("\n");
  return <div className="match-controls">
    <button className="icon-button with-text" style={{whiteSpace:"nowrap",flexShrink:0}} disabled={disabled||busy===key} onClick={()=>void find()} title={`Compare ${onlyFiltered?"sprites passing the atlas filters":"all 128 sprite appearances"} using original video pixels. ${adjustQuad?"Optimize each sprite’s four corners inside a 120% envelope.":"Keep your quad corners fixed."} Previews only; never saves a label.`}>
      <Icon name="zoomIn" /> {busy===key?"Matching…":"Find best match"}
    </button>
    <label title="Apply the atlas left/right edge filters before trying any sprite"><input type="checkbox" aria-label="Only filtered sprites" checked={onlyFiltered} onChange={e=>setOnlyFiltered(e.target.checked)} /> Only filtered sprites</label>
    <label title="Optimize position, size and perspective for each sprite, within 120% of your outline. Off keeps all four corners exactly where you placed them."><input type="checkbox" aria-label="Adjust quad while matching" checked={adjustQuad} onChange={e=>setAdjustQuad(e.target.checked)} /> Adjust quad</label>
    {current?.data?.candidates.slice(0,3).map((c,i)=> {
      const details=[`Match ${i+1}: ${name(c)}`,`${Math.round(c.score*256)} votes · ${c.support??"—"} matching / ${c.maskSamples??"—"} fire-colour samples`,`${c.regions??"—"} supported regions · ${current.data!.searched} sprites tried`,current.selected===c?"Currently previewed":"Click to preview",adjustQuad?"May move and resize the quad":"Quad corners stay fixed","Positive colour evidence, not a probability. Confirm/Enter saves the label."].join("\n");
      return <span className="match-hover" key={`${c.sheet}-${c.row}-${c.mirrored}`}>
        <button className="match-rank" disabled={disabled} aria-label={`Preview match ${i+1}: ${name(c)}`} aria-pressed={current.selected===c} onClick={()=>preview(c)}
          onMouseEnter={showDetails} onMouseLeave={hideDetails} onFocus={showDetails} onBlur={hideDetails}>{i+1}</button>
        <span className="match-details" popover="manual" role="tooltip">{details}</span>
      </span>;
    })}
    <span className="match-hover">
      <button className={`icon-button icon-only${current?.error?" warn":""}`} aria-label="Match details" onMouseEnter={showDetails} onMouseLeave={hideDetails} onFocus={showDetails} onBlur={hideDetails}><Icon name={current?.error?"alert":"info"} /></button>
      <span className="match-details" popover="manual" role="tooltip">{info}</span>
    </span>
    <span className="match-live-status" role={current?.error?"alert":"status"}>{summary}</span>
  </div>;
}
