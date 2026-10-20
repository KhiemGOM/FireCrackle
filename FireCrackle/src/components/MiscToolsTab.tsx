import {useEffect,useState} from 'react';
import type {Backend,View} from '../lib/api';
import {readReviewInterval,saveReviewInterval,reviewFrames,reviewInterval,type ReviewInterval} from '../lib/miscTools';
import {formatTimecode} from '../lib/timecode';
import './MiscToolsTab.css';

function ReviewFrame({backend,frame,title,fps,onOpen}:{backend:Backend;frame:number|null;title:string;fps:number;onOpen:(frame:number)=>void}){
 const [image,setImage]=useState<{frame:number;url:string}|null>(null),[error,setError]=useState<{frame:number;text:string}|null>(null);
 useEffect(()=>{
  if(frame===null)return;
  let cancelled=false,url:string|undefined;
  void backend.frame(frame).then(bytes=>{if(cancelled)return;url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));setImage({frame,url});}).catch(e=>{if(!cancelled)setError({frame,text:e instanceof Error?e.message:String(e)});});
  return()=>{cancelled=true;if(url)URL.revokeObjectURL(url);};
 },[backend,frame]);
 return <figure className="misc-review-frame">
  <figcaption><strong>{title}</strong>{frame!==null&&<span>Frame {frame} · {formatTimecode(frame/fps,fps)}</span>}</figcaption>
  <div className="misc-frame-image">{frame===null?<span>No frame on this side of the video.</span>:image?.frame===frame?<img src={image.url} alt={`${title}: frame ${frame}`} draggable={false}/>:error?.frame===frame?<span role="alert">Could not load frame: {error.text}</span>:<span role="status">Loading frame…</span>}</div>
  <button disabled={frame===null} onClick={()=>frame!==null&&onOpen(frame)}>Open in Label</button>
 </figure>;
}

/** Same workspace decoder/video as Label and Phase. Detector integration is a separate step. */
export function MiscToolsTab({backend,view,videoKey,onOpenFrame}:{backend:Backend;view:View;videoKey?:string;onOpenFrame:(frame:number)=>void}){
 const [tool,setTool]=useState<'compare'|'gui'>('compare');
 const [interval,setInterval]=useState<ReviewInterval>(()=>readReviewInterval(videoKey,view.current,view.frame_count));
 const range=reviewInterval(interval.first,interval.last,view.frame_count),frames=reviewFrames(range,view.frame_count),fps=view.fps||1;
 const name=videoKey?.split(/[\\/]/).pop();
 useEffect(()=>saveReviewInterval(videoKey,range,view.frame_count),[videoKey,range.first,range.last,view.frame_count]);
 const edit=(side:'first'|'last',value:number)=>{if(!Number.isFinite(value))return;setInterval(previous=>{const frame=Math.max(0,Math.min(view.frame_count-1,Math.trunc(value)));return side==='first'?{first:frame,last:Math.max(frame,previous.last)}:{first:Math.min(frame,previous.first),last:frame};});};
 return <main className="misc-tools" aria-label="Misc tools">
  <header><h2>Misc tools</h2><span className="dim">{name??'Current video'} · {view.frame_count.toLocaleString()} frames · {view.fps} fps</span></header>
  <div className="misc-tool-tabs" role="tablist" aria-label="Inspection tools">
   <button role="tab" aria-selected={tool==='compare'} onClick={()=>setTool('compare')}>Frame comparison</button>
   <button role="tab" aria-selected={tool==='gui'} onClick={()=>setTool('gui')}>GUI interactions</button>
  </div>
  {tool==='gui'?<section className="misc-panel" aria-label="GUI interactions">
   <h3>GUI interactions</h3><p>Review the frame before a GUI opens, a frame while it is open, and the frame after it closes to look for camera changes.</p>
   <p className="dim" role="status">The GUI interaction detector is being developed separately. Automatic scanning is not connected here yet.</p>
   <button onClick={()=>setTool('compare')}>Compare frames manually</button>
  </section>:<section className="misc-panel" aria-label="Frame comparison">
   <div className="misc-compare-controls" data-owns-keys="true">
    <label>First frame <input aria-label="First comparison frame" type="number" min={0} max={view.frame_count-1} value={range.first} onChange={e=>edit('first',e.target.valueAsNumber)}/></label>
    <label>Last frame <input aria-label="Last comparison frame" type="number" min={range.first} max={view.frame_count-1} value={range.last} onChange={e=>edit('last',e.target.valueAsNumber)}/></label>
    <button onClick={()=>setInterval({first:view.current,last:view.current})}>Use current frame</button>
   </div>
   <p className="dim">Choose an interval. Compare its immediate neighbours and a frame inside it. These are original video frames.</p>
   <div className="misc-frame-grid">
    <ReviewFrame backend={backend} frame={frames.before} title="Before" fps={fps} onOpen={onOpenFrame}/>
    <ReviewFrame backend={backend} frame={frames.during} title="During" fps={fps} onOpen={onOpenFrame}/>
    <ReviewFrame backend={backend} frame={frames.after} title="After" fps={fps} onOpen={onOpenFrame}/>
   </div>
  </section>}
 </main>;
}
