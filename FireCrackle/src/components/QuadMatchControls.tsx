import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { matchFireQuad, type QuadCandidate, type QuadMatch } from "../lib/quadMatch";
import type { ManualQuad } from "../lib/quadMask";
import { Icon } from "./Icon";
import type { EdgeFilter } from "../lib/atlasFilter";
import { readPreferences, writePreferences } from "../lib/preferences";
import { reportError } from "../lib/appErrors";
import {invoke,isTauri} from "@tauri-apps/api/core";
import {fuseQuadPhases} from "../lib/quadPhase";
import {phaseMatchInput} from "../lib/quadPhaseInput";
import {matchSoulQuad} from "../lib/quadSoul";
import {readMatchImage as readImage,readFireAtlas as readAtlas,refineMatchCandidates} from "../lib/quadRefine";
import "./QuadMatchControls.css";

interface Props { frameUrl:string; quad:ManualQuad; filter?:EdgeFilter; disabled:boolean; onPreview:(candidate:QuadCandidate)=>void; material?:"normal"|"soul";
  sourceFrame?:(signal:AbortSignal)=>Promise<{url:string;dispose?:()=>void}>;
  /** Increases to ask for a match run (the M key). */ runToken?:number;
  /** A request to preview the nth candidate (M then 1, 2, 3); `n` makes each request distinct. */ pick?:{index:number;n:number}|null }
const identity=(frameUrl:string,quad:ManualQuad,adjustQuad=false,filter?:EdgeFilter,material="normal")=>JSON.stringify([frameUrl,quad,adjustQuad,filter,material]);
const name=(c:QuadCandidate)=>`row ${c.row} · sheet ${c.sheet} · ${c.mirrored?"mirrored":"normal"}`;
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

export function QuadMatchControls({frameUrl,quad,disabled,onPreview,filter,runToken=0,pick=null,material="normal",sourceFrame}:Props) {
  const saved=readPreferences();
  const [adjustQuad,setAdjustQuad]=useState(saved.matchAdjustQuad);
  const [onlyFiltered,setOnlyFiltered]=useState(saved.matchOnlyFiltered);
  const activeFilter=onlyFiltered?filter:undefined;
  const key=identity(frameUrl,quad,adjustQuad,activeFilter,material),latest=useRef({key,disabled,onPreview});latest.current={key,disabled,onPreview};
  const token=useRef(0);
  const cancel=useRef<null|(()=>void)>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [result,setResult]=useState<{key:string;data?:QuadMatch;error?:string;selected?:QuadCandidate}|null>(null);
  const current=result?.key===key?result:null;
  useEffect(() => { if (current?.error) reportError("Match sprite", current.error); }, [current?.error]);
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
    let dispose:(()=>void)|undefined;
    try {
      const controller=new AbortController(),stop=()=>controller.abort();cancel.current=stop;
      const source=sourceFrame?await sourceFrame(controller.signal):{url:frameUrl};dispose=source.dispose;
      if(controller.signal.aborted)return;
      // Read the original JPEG, never the displayed overlay or a screenshot.
      const [image,sheets]=await Promise.all([readImage(source.url),readAtlas(material)]);
      await new Promise(resolve=>window.setTimeout(resolve,0));
      if(mine!==token.current||latest.current.key!==start||latest.current.disabled)return;
      const options={refineGeometry:adjustQuad,...(isTauri()?{phaseEvidence:true}:{}),...(material==="soul"?{material}:{}),...(activeFilter?{filter:activeFilter}:{})};
      type Reply={result:QuadMatch;rgb?:Uint8Array};
      const reply=typeof Worker==="undefined"?await(async():Promise<Reply>=>{
        const input=options.phaseEvidence?await phaseMatchInput(image,quad):{image,rgb:undefined,error:undefined};
        const matcher=material==="soul"?matchSoulQuad:matchFireQuad;
        const result=matcher(input.image,sheets,quad,{refineGeometry:adjustQuad,...(activeFilter?{filter:activeFilter}:{}),...(input.rgb?{phaseEvidence:true}:{})});
        if(input.error)result.ai={error:input.error};
        return {result,rgb:input.rgb};
      })():await new Promise<Reply>((resolve,reject)=>{
        const worker=new Worker(new URL("../lib/quadMatch.worker.ts",import.meta.url),{type:"module"});
        const stop=()=>{finish();reject(new Error("Matching cancelled"));};
        const finish=()=>{worker.terminate();if(cancel.current===stop)cancel.current=null;};
        cancel.current=stop;
        worker.onmessage=(event:MessageEvent<{result?:QuadMatch;error?:string;rgb?:Uint8Array}>)=>{
          finish();if(event.data.result)resolve({result:event.data.result,rgb:event.data.rgb});else reject(new Error(event.data.error??"Matching failed"));
        };
        worker.onerror=event=>{finish();reject(new Error(event.message||"Matching worker failed"));};
        worker.postMessage({image,sheets,quad,options},[image.data.buffer as ArrayBuffer]);
      });
      if(mine!==token.current||latest.current.key!==start||latest.current.disabled)return;
      let data=reply.result;
      if(data.ai?.error)reportError("Quad AI unavailable — colour matcher used",data.ai.error);
      if(reply.rgb&&data.phaseCandidates?.length){
        try {
          const answer=await invoke<{logits:number[];provider:string}>("quad_phase",{rgb:Array.from(reply.rgb),material});
          data=fuseQuadPhases(data,answer.logits,answer.provider,material);
        }catch(error){
          data={...data,ai:{error:String(error)}};
          if(mine===token.current&&latest.current.key===start&&!latest.current.disabled)reportError("Quad AI unavailable — colour matcher used",String(error));
        }
      }
      if(mine!==token.current||latest.current.key!==start||latest.current.disabled)return;
      if(adjustQuad&&data.candidates.length){
        const controller=new AbortController(),stop=()=>controller.abort();cancel.current=stop;
        try{data={...data,candidates:await refineMatchCandidates(source.url,data.candidates,material,controller.signal)};}
        catch(error){if(controller.signal.aborted)return;reportError("Refine alignment — original match kept",String(error));}
        finally{if(cancel.current===stop)cancel.current=null;}
      }
      if(mine!==token.current||latest.current.key!==start||latest.current.disabled)return;
      const best=data.status==="clear"?data.candidates[0]:undefined;
      setResult({key:best?identity(frameUrl,best.quad,adjustQuad,activeFilter,material):start,data,selected:best});
      if(best)latest.current.onPreview(best);
    }catch(e){if(mine===token.current&&latest.current.key===start)setResult({key:start,error:String(e)});}
    finally{dispose?.();if(mine===token.current)setBusy(null);}
  }
  function preview(candidate:QuadCandidate) {
    if(!current?.data||disabled)return;
    setResult({...current,key:identity(frameUrl,candidate.quad,adjustQuad,activeFilter,material),selected:candidate});
    onPreview(candidate);
  }
  const summary=current?.error?`Match failed: ${current.error}`:!current?.data?"Uses your quad outline. Preview a match, then Confirm/Enter to label."
    :current.selected?`${current.data.ai?.provider?"AI + colour":"Colour"} guess: ${name(current.selected)}. Verify before confirming.`
    :current.data.status==="filtered"?"No sprites pass the atlas filters. Change the counts or turn off Only filtered sprites."
    :current.data.status==="insufficient"?"Too few visible pixels. Adjust the quad or use a larger fire."
    :current.data.status==="weak"?"Too little matching colour evidence. Closest candidates shown."
    :current.data.ai?.provider?"AI + colour matches. Click a numbered candidate to preview.":"Close matches. Click a numbered candidate to preview.";
  const info=[summary,`Atlas edges: left ${filter?.left??"Any"}, right ${filter?.right??"Any"}. ${onlyFiltered?"Filters applied before matching.":"Searching all sprites."}`,
    current?.data?`Tried ${current.data.searched} / 128 sprites.`:"",current?.data?.ai?.provider?`128px AI + colour matcher · ${current.data.ai.provider}. Three distinct animation phases.`:"",current?.data?.ai?.error?`AI unavailable: ${current.data.ai.error}. Colour matcher used.`:"",adjustQuad?"Per-sprite corner fitting enabled, bounded to 120% of your outline.":"Your quad corners stay fixed.","Results are previews; only Confirm/Enter saves a label."].filter(Boolean).join("\n");
  return <div className="match-controls">
    <button className="icon-button with-text" style={{whiteSpace:"nowrap",flexShrink:0}} disabled={disabled||busy===key} onClick={()=>void find()} title={`Compare ${onlyFiltered?"sprites passing the atlas filters":"all 128 sprite appearances"} using original video pixels. ${adjustQuad?"Optimize each sprite’s four corners inside a 120% envelope.":"Keep your quad corners fixed."} Previews only; never saves a label.`}>
      <Icon name="zoomIn" /> {busy===key?"Matching…":"Find best match"}
    </button>
    <label title="Apply the atlas left/right edge filters before trying any sprite"><input type="checkbox" aria-label="Only filtered sprites" checked={onlyFiltered} onChange={e=>setOnlyFiltered(e.target.checked)} /> Only filtered sprites</label>
    <label title="Fit candidate corners, then refine alignment of each suggested sprite. Off keeps all four corners exactly where you placed them."><input type="checkbox" aria-label="Adjust quad while matching" checked={adjustQuad} onChange={e=>setAdjustQuad(e.target.checked)} /> Allow mask changes</label>
    {current?.data?.candidates.slice(0,3).map((c,i)=> {
      const details=[`Match ${i+1}: ${name(c)}`,c.phaseScore!==undefined?`AI + colour phase rank score ${c.phaseScore.toFixed(3)}`:"",`${Math.round(c.score*256)} votes · ${c.support??"—"} matching / ${c.maskSamples??"—"} fire-colour samples`,`${c.regions??"—"} supported regions · ${current.data!.searched} sprites tried`,current.selected===c?"Currently previewed":"Click to preview",adjustQuad?"May move and resize the quad":"Quad corners stay fixed","Rank scores are not guaranteed confidence. Confirm/Enter saves the label."].filter(Boolean).join("\n");
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
