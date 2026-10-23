import {useEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import type {Backend,View} from '../lib/api';
import {readReviewInterval,saveReviewInterval,comparisonFrames,reviewInterval,type ReviewInterval} from '../lib/miscTools';
import {FRAME_BLINK_MS,exportFrameProof,frameDifference} from '../lib/frameComparison';
import type {ProofAction} from '../lib/comparisonProof';
import {formatTimecode} from '../lib/timecode';
import {ComparisonProofButton} from './ComparisonProofButton';
import {GuiInteractionTool} from './GuiInteractionTool';
import {displayFrame} from '../lib/imagePreview';
import {readPreferences,writePreferences} from '../lib/preferences';
import './MiscToolsTab.css';
import {Viewable,type ViewerImage} from './ImageViewer';
import {canvasBlob} from '../lib/canvas';
import {nativeFrame} from '../lib/exactFrame';
import { failureMessage } from '../lib/appErrors';
import {BOUNDARY_POST,comparesProcessed,comparisonPictures,comparisonSettings,type ComparePost} from '../lib/comparisonPost';
import {guiPairFrames} from '../lib/guiAimReview';
import {hasEnhancement} from '../lib/post/pipeline';
import {DEFAULT_POST,type PostSettings} from '../lib/post/settings';
import {DEFAULT_VEIL_OPTIONS,type VeilOptions} from '../lib/veil';

function useReviewImage(backend:Backend,frame:number|null){
 const [image,setImage]=useState<{frame:number;url:string;full:boolean}|null>(null),[error,setError]=useState<{frame:number;text:string}|null>(null);
 useEffect(()=>{
  if(frame===null)return;
  return displayFrame(backend,frame,(url,full)=>{setImage({frame,url,full});setError(null);},e=>setError({frame,text:failureMessage(e)}));
 },[backend,frame]);
 return {url:image?.frame===frame?image.url:undefined,full:image?.frame===frame&&image.full,error:error?.frame===frame?error.text:undefined};
}
/** The compared frames with the ticked post effects (lib/comparisonPost.ts), as object URLs; nothing when none is ticked. */
function usePostPictures(backend:Backend,frames:(number|null)[],post:PostSettings,compare:ComparePost,veilOptions:VeilOptions){
 const [made,setMade]=useState<{key:string;urls:Map<number,string>;blobs:Map<number,Blob>;errors:string[]}|null>(null),[failure,setFailure]=useState<{key:string;text:string}|null>(null);
 const active=comparesProcessed(compare),wanted=frames.filter((f):f is number=>f!==null);
 const key=active?JSON.stringify([wanted,comparisonSettings(post,compare),compare.gui,veilOptions]):'';
 useEffect(()=>{
  if(!key)return;
  const cancel=new AbortController();let urls:string[]=[];
  // a short wait so dragging an Enhance slider does not start a run per step
  const timer=setTimeout(()=>{void comparisonPictures({backend,frames:wanted,post,compare,veilOptions,signal:cancel.signal}).then(result=>{
   if(cancel.signal.aborted)return;
   const map=new Map([...result.pictures].map(([frame,blob])=>[frame,URL.createObjectURL(blob)]));urls=[...map.values()];
   setMade({key,urls:map,blobs:result.pictures,errors:result.errors});
  }).catch(e=>{if(!cancel.signal.aborted)setFailure({key,text:failureMessage(e)});});},150);
  return()=>{cancel.abort();clearTimeout(timer);urls.forEach(url=>URL.revokeObjectURL(url));};
 },[backend,key]); // eslint-disable-line react-hooks/exhaustive-deps
 const ready=made?.key===key?made:undefined,error=failure?.key===key?failure.text:undefined;
 return {active,busy:active&&!ready&&!error,urls:ready?.urls,blobs:ready?.blobs,errors:ready?.errors??[],error};
}
function DifferencePicture({before,after,gain,canvasRef}:{before:string;after:string;gain:number;canvasRef?:RefObject<HTMLCanvasElement|null>}){
 const own=useRef<HTMLCanvasElement>(null),canvas=canvasRef??own,[error,setError]=useState('');
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
  }).catch(e=>{if(!cancelled)setError(failureMessage(e));});
  return()=>{cancelled=true;};
 },[before,after,gain]);
 return error?<span role="alert">{error}</span>:<canvas ref={canvas} role="img" aria-label={`Absolute RGB difference between before and after, brightness ${gain} times`}/>;
}
/** The picture area: opens the image viewer on its last picture (this side) once there is one. */
function pictureBox(images:ViewerImage[]|null,children:ReactNode){
 return images?<Viewable className="misc-frame-image" images={images} index={images.length-1}>{children}</Viewable>:<div className="misc-frame-image">{children}</div>;
}
/** `processed`: the post-processed pictures of this frame and of the one it is compared with, when post effects are on. */
function ReviewFrame({backend,frame,title,fps,onOpen,compareFrame=null,processed,applyToBlink=false,onApplyToBlink,postActive=false}:{backend:Backend;frame:number|null;title:string;fps:number;onOpen:(frame:number)=>void;compareFrame?:number|null;processed?:{url?:string;compareUrl?:string};applyToBlink?:boolean;onApplyToBlink?:(on:boolean)=>void;postActive?:boolean}){
 const image=useReviewImage(backend,frame),comparison=useReviewImage(backend,compareFrame);
 const [mode,setMode]=useState(()=>readPreferences().miscCompareMode),[gain,setGain]=useState(()=>readPreferences().miscDifferenceGain),[showBefore,setShowBefore]=useState(false);
 useEffect(()=>{if(title==='After')writePreferences({miscCompareMode:mode,miscDifferenceGain:gain});},[title,mode,gain]);
 const ready=!!image.url&&!!comparison.url,inspect=title==='After',diffReady=ready&&image.full&&comparison.full;
 useEffect(()=>{
  setShowBefore(false);
  if(mode!=='blink'||!ready)return;
  const timer=window.setInterval(()=>setShowBefore(value=>!value),FRAME_BLINK_MS);
  return()=>window.clearInterval(timer);
 },[mode,ready,frame,compareFrame]);
 const blinking=mode==='blink'&&ready,displayBefore=blinking&&showBefore;
 // what is shown: the post-processed pictures when they are made (Blink only with Apply to blink), else the originals
 const both=!!processed?.url&&!!processed.compareUrl,usePost=!!processed?.url&&(!blinking||applyToBlink&&both);
 const shown=usePost?processed!.url!:image.url,shownBefore=blinking&&applyToBlink&&both?processed!.compareUrl!:comparison.url;
 const diffPictures=both?{before:processed!.compareUrl!,after:processed!.url!}:diffReady?{before:comparison.url!,after:image.url!}:undefined;
 const diffCanvas=useRef<HTMLCanvasElement>(null),showsDiff=inspect&&mode==='diff';
 // plain frames also open at native resolution; post-processed pictures are shown as made
 const at=(f:number)=>`Frame ${f} · ${formatTimecode(f/fps,fps)}`,native=(f:number)=>()=>nativeFrame(backend,f).then(blob=>URL.createObjectURL(blob));
 // the image viewer shows the pictures as displayed: this side, after the frame it is compared with; the difference on its own
 const viewerImages:ViewerImage[]|null=frame===null||!image.url?null:showsDiff?diffPictures?[{title:`Difference ×${gain}`,detail:`${at(compareFrame??frame)} → ${at(frame)}`,src:()=>diffCanvas.current?canvasBlob(diffCanvas.current).then(blob=>URL.createObjectURL(blob)):Promise.reject(Error('The difference picture is not ready.'))}]:null
  :[...(inspect&&compareFrame!==null&&comparison.url?[{title:'Before',detail:`${at(compareFrame)}${both&&usePost?' · post effects':''}`,...(both&&usePost?{src:processed!.compareUrl!}:{src:comparison.url,native:native(compareFrame)})}]:[]),
    {title,detail:`${at(frame)}${usePost?' · post effects':''}`,src:shown!,...(usePost?{}:{native:native(frame)})}];
 return <figure className="misc-review-frame">
  <figcaption><strong>{title}</strong>{frame!==null&&<span>Frame {frame} · {formatTimecode(frame/fps,fps)}</span>}</figcaption>
  {pictureBox(viewerImages,<>
   {frame===null?<span>No frame on this side of the video.</span>:!image.url?<span role={image.error?'alert':'status'}>{image.error?`Could not load frame: ${image.error}`:'Loading frame…'}</span>:inspect&&mode==='diff'?diffPictures?<DifferencePicture before={diffPictures.before} after={diffPictures.after} gain={gain} canvasRef={diffCanvas}/>:<span>Loading full detail…</span>:<>
    <img src={shown} alt={`${title}: frame ${frame}`} draggable={false}/>
    {blinking&&<img className={`misc-blink-layer ${displayBefore?'visible':''}`} src={shownBefore} alt={`Before: frame ${compareFrame}`} draggable={false} aria-hidden={!displayBefore}/>}
   </>}
   {inspect&&image.url&&<span className="misc-image-badge">{mode==='diff'&&ready?`Difference ×${gain}`:displayBefore?`Before · ${compareFrame}`:`After · ${frame}`}</span>}
  </>)}
  <div className="misc-frame-actions">
   <button disabled={frame===null} onClick={()=>frame!==null&&onOpen(frame)}>Open in Label</button>
   {inspect&&<div className="misc-view-modes" role="group" aria-label="After frame view">
    {([['original','Original'],['diff','Difference'],['blink','Blink']] as const).map(([value,text])=><button key={value} aria-pressed={mode===value} disabled={value!=='original'&&!ready} onClick={()=>setMode(value)}>{text}</button>)}
    {onApplyToBlink&&<label className="misc-blink-post" title="Blink between the post-processed pictures instead of the original frames"><input type="checkbox" aria-label="Apply post effects to blink" checked={applyToBlink} disabled={!postActive} onChange={e=>onApplyToBlink(e.target.checked)}/> Apply to blink</label>}
   </div>}
  </div>
  {inspect&&mode==='diff'&&ready&&<label className="misc-diff-gain">Brightness <input aria-label="Difference brightness" type="range" min={1} max={8} step={1} value={gain} onChange={e=>setGain(Number(e.target.value))}/><span>×{gain}</span></label>}
  {inspect&&compareFrame!==null&&comparison.error&&<span className="dim" role="alert">Before frame: {comparison.error}</span>}
  {inspect&&mode!=='original'&&ready&&<small className="dim">{mode==='blink'?'Before ↔ After · direct switch every 640 ms':'Absolute pixel changes. Animation, lighting and camera movement all contribute.'}</small>}
 </figure>;
}

/** Same workspace decoder/video as Label and Phase. Detector integration is a separate step. */
/** `post` and `veil`: the Enhance panel's settings, which the comparison's post effects reuse. */
export function MiscToolsTab({backend,view,videoKey,onOpenFrame,post=DEFAULT_POST,veil=DEFAULT_VEIL_OPTIONS}:{backend:Backend;view:View;videoKey?:string;onOpenFrame:(frame:number)=>void;post?:PostSettings;veil?:VeilOptions}){
 const [tool,setTool]=useState(()=>readPreferences().miscTool);
 useEffect(()=>writePreferences({miscTool:tool}),[tool]);
 const [interval,setInterval]=useState<ReviewInterval>(()=>readReviewInterval(videoKey,view.current,view.frame_count));
 const [proofBusy,setProofBusy]=useState(false),[proofFeedback,setProofFeedback]=useState<string>(),[proofError,setProofError]=useState('');
 const exporting=useRef(false);
 const [compare,setCompare]=useState<ComparePost>(()=>readPreferences().miscComparePost);
 useEffect(()=>writePreferences({miscComparePost:compare}),[compare]);
 const range=reviewInterval(interval.first,interval.last,view.frame_count),frames=comparisonFrames(range,view.frame_count),fps=view.fps||1;
 const postPictures=usePostPictures(backend,[frames.before,frames.during,frames.after],post,compare,veil);
 const tick=(key:keyof ComparePost,on:boolean)=>setCompare(previous=>({...previous,[key]:on}));
 const effects=([['veil','Unveil'],['portal','Portal undone'],['enhance','Enhanced'],['gui','GUI masked']] as const).filter(([key])=>compare[key]).map(([,text])=>text).join(' · ');
 const processedOf=(frame:number|null,other:number|null=null)=>postPictures.urls&&frame!==null?{url:postPictures.urls.get(frame),compareUrl:other===null?undefined:postPictures.urls.get(other)}:undefined;
 const canEnhance=hasEnhancement(comparisonSettings(post,{...compare,enhance:true}));
 const name=videoKey?.split(/[\\/]/).pop();
 useEffect(()=>saveReviewInterval(videoKey,range,view.frame_count),[videoKey,range.first,range.last,view.frame_count]);
 useEffect(()=>{setProofFeedback(undefined);setProofError('');},[range.first,range.last]);
 useEffect(()=>{if(!proofFeedback)return;const timer=setTimeout(()=>setProofFeedback(undefined),2500);return()=>clearTimeout(timer);},[proofFeedback]);
 const edit=(side:'first'|'last',value:number)=>{if(!Number.isFinite(value))return;setInterval(previous=>{const frame=Math.max(0,Math.min(view.frame_count-1,Math.trunc(value)));return side==='first'?{first:frame,last:Math.max(frame,previous.last)}:{first:Math.min(frame,previous.first),last:frame};});};
 async function exportProof(action:ProofAction){
  if(exporting.current||frames.before===null||frames.after===null)return;
  exporting.current=true;setProofBusy(true);setProofFeedback(undefined);setProofError('');
  // the proof shows what the cards show: the post-processed pictures when post effects are on
  const before=postPictures.blobs?.get(frames.before),after=postPictures.blobs?.get(frames.after);
  const pictures=postPictures.active&&before&&after?{before,after}:undefined;
  try{
   if(postPictures.active&&!pictures)throw Error('The post effects are still being applied.');
   if(await exportFrameProof(backend,{before:frames.before,after:frames.after,first:range.first,last:range.last,fps,source:name??'Current video',...(pictures?{effects}:{})},action,pictures))setProofFeedback(action.destination==='copy'?'Copied!':'Saved!');}
  catch(e){setProofError(failureMessage(e));}
  finally{exporting.current=false;setProofBusy(false);}
 }
 return <main className="misc-tools" aria-label="Misc tools">
  <header><h2>Misc tools</h2><span className="dim">{name??'Current video'} · {view.frame_count.toLocaleString()} frames · {Number(view.fps.toFixed(3))} fps</span></header>
  <div className="misc-tool-tabs" role="tablist" aria-label="Inspection tools">
   <button role="tab" aria-selected={tool==='compare'} onClick={()=>setTool('compare')}>Frame comparison</button>
   <button role="tab" aria-selected={tool==='gui'} onClick={()=>setTool('gui')}>GUI interactions</button>
  </div>
  {tool==='gui'?<GuiInteractionTool backend={backend} videoKey={videoKey} fps={fps} veil={veil} onCompare={(range,pair)=>{const pick=guiPairFrames(range,view.frame_count,pair);setInterval({first:pick.before,last:pick.after});if(pair!=='around')setCompare(previous=>({...previous,...BOUNDARY_POST}));setTool('compare');}}/>:<section className="misc-panel" aria-label="Frame comparison">
   <div className="misc-compare-toolbar">
    <div className="misc-compare-controls" data-owns-keys="true">
     <label>Before frame <input aria-label="First comparison frame" type="number" min={0} max={view.frame_count-1} value={range.first} disabled={proofBusy} onChange={e=>edit('first',e.target.valueAsNumber)}/></label>
     <label>After frame <input aria-label="Last comparison frame" type="number" min={range.first} max={view.frame_count-1} value={range.last} disabled={proofBusy} onChange={e=>edit('last',e.target.valueAsNumber)}/></label>
     <button disabled={proofBusy} onClick={()=>setInterval({first:view.current,last:view.current})}>Use current frame</button>
    </div>
    <div className="misc-post-toggles" role="group" aria-label="Post effects on the comparison">
     <span>Post effects</span>
     <label title="Undo the GUI veil with the Enhance panel's mode (Auto when it is Off). An open inventory or menu is left as it is; the hotbar and HUD are unveiled."><input type="checkbox" aria-label="Unveil comparison frames" checked={compare.veil} onChange={e=>tick('veil',e.target.checked)}/> Unveil</label>
     <label title="Undo the nether portal overlay with the Enhance panel's mode (Auto when it is Off)."><input type="checkbox" aria-label="Undo portal on comparison frames" checked={compare.portal} onChange={e=>tick('portal',e.target.checked)}/> Portal</label>
     <label title={canEnhance?'Apply the effects that are on in the Enhance panel.':'Turn on an effect in the Enhance panel first.'}><input type="checkbox" aria-label="Enhance comparison frames" checked={compare.enhance} disabled={!canEnhance} onChange={e=>tick('enhance',e.target.checked)}/> Enhance</label>
     <label title={backend.guiMaskFrame?'Black out the open inventory or menu of either frame on both, so only the world is compared. The hotbar and HUD stay.':'The GUI mask is available in the desktop app.'}><input type="checkbox" aria-label="Mask the open GUI on comparison frames" checked={compare.gui} disabled={!backend.guiMaskFrame} onChange={e=>tick('gui',e.target.checked)}/> Mask GUI</label>
     {postPictures.busy&&<span className="dim" role="status">Applying…</span>}
    </div>
    <ComparisonProofButton disabled={frames.before===null||frames.after===null||postPictures.busy} busy={proofBusy} feedback={proofFeedback} onExport={action=>void exportProof(action)} title="Copy an annotated WebP that switches directly between Before and After. Choose a format or use its save icon."/>
   </div>
   <p className="dim">Both endpoints are included: Before and After show exactly the frame numbers you enter. Use Difference or Blink to inspect the change.</p>
   {proofError&&<p className="misc-proof-error" role="alert">Comparison proof: {proofError}</p>}
   {(postPictures.error||postPictures.errors.length>0)&&<p className="misc-proof-error" role="alert">Post effects: {postPictures.error??postPictures.errors.join(' · ')}</p>}
   {proofFeedback&&<span className="misc-proof-feedback" role="status">{proofFeedback}</span>}
   <div className="misc-frame-grid">
    <ReviewFrame backend={backend} frame={frames.before} title="Before" fps={fps} onOpen={onOpenFrame} processed={processedOf(frames.before)}/>
    <ReviewFrame backend={backend} frame={frames.during} title="Midpoint" fps={fps} onOpen={onOpenFrame} processed={processedOf(frames.during)}/>
    <ReviewFrame backend={backend} frame={frames.after} compareFrame={frames.before} title="After" fps={fps} onOpen={onOpenFrame} processed={processedOf(frames.after,frames.before)} applyToBlink={compare.blink} onApplyToBlink={on=>tick('blink',on)} postActive={postPictures.active}/>
   </div>
   <div className="misc-proof-note"><strong>Share the jump</strong><span>Comparison proof copies a Before ↔ After animation. PNG / JPEG show both frames side by side. Each includes the video, inclusive range, frame numbers and timecodes.</span></div>
  </section>}
 </main>;
}
