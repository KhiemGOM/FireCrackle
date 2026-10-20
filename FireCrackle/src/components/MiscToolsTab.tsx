import {useEffect,useRef,useState} from 'react';
import type {Backend,View} from '../lib/api';
import {readReviewInterval,saveReviewInterval,comparisonFrames,reviewInterval,type ReviewInterval} from '../lib/miscTools';
import {FRAME_BLINK_MS,exportFrameProof,frameDifference} from '../lib/frameComparison';
import type {ProofAction} from '../lib/comparisonProof';
import {formatTimecode} from '../lib/timecode';
import {ComparisonProofButton} from './ComparisonProofButton';
import {GuiInteractionTool} from './GuiInteractionTool';
import './MiscToolsTab.css';

function useReviewImage(backend:Backend,frame:number|null){
 const [image,setImage]=useState<{frame:number;url:string}|null>(null),[error,setError]=useState<{frame:number;text:string}|null>(null);
 useEffect(()=>{
  if(frame===null)return;
  let cancelled=false,url:string|undefined;
  void backend.frame(frame).then(bytes=>{if(cancelled)return;url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));setImage({frame,url});setError(null);}).catch(e=>{if(!cancelled)setError({frame,text:e instanceof Error?e.message:String(e)});});
  return()=>{cancelled=true;if(url)URL.revokeObjectURL(url);};
 },[backend,frame]);
 return {url:image?.frame===frame?image.url:undefined,error:error?.frame===frame?error.text:undefined};
}
function DifferencePicture({before,after,gain}:{before:string;after:string;gain:number}){
 const canvas=useRef<HTMLCanvasElement>(null),[error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false;setError('');
  const load=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Could not load difference frames.'));image.src=src;});
  void Promise.all([load(before),load(after)]).then(([a,b])=>{
   if(cancelled||!canvas.current)return;
   if(a.naturalWidth!==b.naturalWidth||a.naturalHeight!==b.naturalHeight)throw Error('Comparison pictures have different dimensions.');
   const target=canvas.current;target.width=a.naturalWidth;target.height=a.naturalHeight;
   const ctx=target.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Difference rendering is unavailable.');
   ctx.drawImage(a,0,0);const pixels=ctx.getImageData(0,0,target.width,target.height);
   ctx.drawImage(b,0,0);const other=ctx.getImageData(0,0,target.width,target.height);
   pixels.data.set(frameDifference(pixels.data,other.data,gain));ctx.putImageData(pixels,0,0);
  }).catch(e=>{if(!cancelled)setError(String(e));});
  return()=>{cancelled=true;};
 },[before,after,gain]);
 return error?<span role="alert">{error}</span>:<canvas ref={canvas} role="img" aria-label={`Absolute RGB difference between before and after, brightness ${gain} times`}/>;
}
function ReviewFrame({backend,frame,title,fps,onOpen,compareFrame=null}:{backend:Backend;frame:number|null;title:string;fps:number;onOpen:(frame:number)=>void;compareFrame?:number|null}){
 const image=useReviewImage(backend,frame),comparison=useReviewImage(backend,compareFrame);
 const [mode,setMode]=useState<'original'|'diff'|'blink'>('original'),[gain,setGain]=useState(3),[showBefore,setShowBefore]=useState(false);
 const ready=!!image.url&&!!comparison.url,inspect=title==='After';
 useEffect(()=>{
  setShowBefore(false);
  if(mode!=='blink'||!ready)return;
  const timer=window.setInterval(()=>setShowBefore(value=>!value),FRAME_BLINK_MS);
  return()=>window.clearInterval(timer);
 },[mode,ready,frame,compareFrame]);
 const blinking=mode==='blink'&&ready,displayBefore=blinking&&showBefore;
 return <figure className="misc-review-frame">
  <figcaption><strong>{title}</strong>{frame!==null&&<span>Frame {frame} · {formatTimecode(frame/fps,fps)}</span>}</figcaption>
  <div className="misc-frame-image">
   {frame===null?<span>No frame on this side of the video.</span>:!image.url?<span role={image.error?'alert':'status'}>{image.error?`Could not load frame: ${image.error}`:'Loading frame…'}</span>:inspect&&mode==='diff'&&ready?<DifferencePicture before={comparison.url!} after={image.url} gain={gain}/>:<>
    <img src={image.url} alt={`${title}: frame ${frame}`} draggable={false}/>
    {blinking&&<img className={`misc-blink-layer ${displayBefore?'visible':''}`} src={comparison.url} alt={`Before: frame ${compareFrame}`} draggable={false} aria-hidden={!displayBefore}/>}
   </>}
   {inspect&&image.url&&<span className="misc-image-badge">{mode==='diff'&&ready?`Difference ×${gain}`:displayBefore?`Before · ${compareFrame}`:`After · ${frame}`}</span>}
  </div>
  <div className="misc-frame-actions">
   <button disabled={frame===null} onClick={()=>frame!==null&&onOpen(frame)}>Open in Label</button>
   {inspect&&<div className="misc-view-modes" role="group" aria-label="After frame view">
    {([['original','Original'],['diff','Difference'],['blink','Blink']] as const).map(([value,text])=><button key={value} aria-pressed={mode===value} disabled={value!=='original'&&!ready} onClick={()=>setMode(value)}>{text}</button>)}
   </div>}
  </div>
  {inspect&&mode==='diff'&&ready&&<label className="misc-diff-gain">Brightness <input aria-label="Difference brightness" type="range" min={1} max={8} step={1} value={gain} onChange={e=>setGain(Number(e.target.value))}/><span>×{gain}</span></label>}
  {inspect&&compareFrame!==null&&comparison.error&&<span className="dim" role="alert">Before frame: {comparison.error}</span>}
  {inspect&&mode!=='original'&&ready&&<small className="dim">{mode==='blink'?'Before ↔ After · direct switch every 640 ms':'Absolute pixel changes. Animation, lighting and camera movement all contribute.'}</small>}
 </figure>;
}

/** Same workspace decoder/video as Label and Phase. Detector integration is a separate step. */
export function MiscToolsTab({backend,view,videoKey,onOpenFrame}:{backend:Backend;view:View;videoKey?:string;onOpenFrame:(frame:number)=>void}){
 const [tool,setTool]=useState<'compare'|'gui'>('compare');
 const [interval,setInterval]=useState<ReviewInterval>(()=>readReviewInterval(videoKey,view.current,view.frame_count));
 const [proofBusy,setProofBusy]=useState(false),[proofFeedback,setProofFeedback]=useState<string>(),[proofError,setProofError]=useState('');
 const exporting=useRef(false);
 const range=reviewInterval(interval.first,interval.last,view.frame_count),frames=comparisonFrames(range,view.frame_count),fps=view.fps||1;
 const name=videoKey?.split(/[\\/]/).pop();
 useEffect(()=>saveReviewInterval(videoKey,range,view.frame_count),[videoKey,range.first,range.last,view.frame_count]);
 useEffect(()=>{setProofFeedback(undefined);setProofError('');},[range.first,range.last]);
 useEffect(()=>{if(!proofFeedback)return;const timer=setTimeout(()=>setProofFeedback(undefined),2500);return()=>clearTimeout(timer);},[proofFeedback]);
 const edit=(side:'first'|'last',value:number)=>{if(!Number.isFinite(value))return;setInterval(previous=>{const frame=Math.max(0,Math.min(view.frame_count-1,Math.trunc(value)));return side==='first'?{first:frame,last:Math.max(frame,previous.last)}:{first:Math.min(frame,previous.first),last:frame};});};
 async function exportProof(action:ProofAction){
  if(exporting.current||frames.before===null||frames.after===null)return;
  exporting.current=true;setProofBusy(true);setProofFeedback(undefined);setProofError('');
  try{if(await exportFrameProof(backend,{before:frames.before,after:frames.after,first:range.first,last:range.last,fps,source:name??'Current video'},action))setProofFeedback(action.destination==='copy'?'Copied!':'Saved!');}
  catch(e){setProofError(e instanceof Error?e.message:String(e));}
  finally{exporting.current=false;setProofBusy(false);}
 }
 return <main className="misc-tools" aria-label="Misc tools">
  <header><h2>Misc tools</h2><span className="dim">{name??'Current video'} · {view.frame_count.toLocaleString()} frames · {Number(view.fps.toFixed(3))} fps</span></header>
  <div className="misc-tool-tabs" role="tablist" aria-label="Inspection tools">
   <button role="tab" aria-selected={tool==='compare'} onClick={()=>setTool('compare')}>Frame comparison</button>
   <button role="tab" aria-selected={tool==='gui'} onClick={()=>setTool('gui')}>GUI interactions</button>
  </div>
  {tool==='gui'?<GuiInteractionTool backend={backend} videoKey={videoKey} fps={fps} onCompare={range=>{setInterval({first:Math.max(0,range.first-1),last:Math.min(view.frame_count-1,range.last+1)});setTool('compare');}}/>:<section className="misc-panel" aria-label="Frame comparison">
   <div className="misc-compare-toolbar">
    <div className="misc-compare-controls" data-owns-keys="true">
     <label>Before frame <input aria-label="First comparison frame" type="number" min={0} max={view.frame_count-1} value={range.first} disabled={proofBusy} onChange={e=>edit('first',e.target.valueAsNumber)}/></label>
     <label>After frame <input aria-label="Last comparison frame" type="number" min={range.first} max={view.frame_count-1} value={range.last} disabled={proofBusy} onChange={e=>edit('last',e.target.valueAsNumber)}/></label>
     <button disabled={proofBusy} onClick={()=>setInterval({first:view.current,last:view.current})}>Use current frame</button>
    </div>
    <ComparisonProofButton disabled={frames.before===null||frames.after===null} busy={proofBusy} feedback={proofFeedback} onExport={action=>void exportProof(action)} title="Copy an annotated WebP that switches directly between Before and After. Choose a format or use its save icon."/>
   </div>
   <p className="dim">Both endpoints are included: Before and After show exactly the frame numbers you enter. Use Difference or Blink to inspect the change.</p>
   {proofError&&<p className="misc-proof-error" role="alert">Comparison proof: {proofError}</p>}
   {proofFeedback&&<span className="misc-proof-feedback" role="status">{proofFeedback}</span>}
   <div className="misc-frame-grid">
    <ReviewFrame backend={backend} frame={frames.before} title="Before" fps={fps} onOpen={onOpenFrame}/>
    <ReviewFrame backend={backend} frame={frames.during} title="Midpoint" fps={fps} onOpen={onOpenFrame}/>
    <ReviewFrame backend={backend} frame={frames.after} compareFrame={frames.before} title="After" fps={fps} onOpen={onOpenFrame}/>
   </div>
   <div className="misc-proof-note"><strong>Share the jump</strong><span>Comparison proof copies a Before ↔ After animation. PNG / JPEG show both frames side by side. Each includes the video, inclusive range, frame numbers and timecodes.</span></div>
  </section>}
 </main>;
}
