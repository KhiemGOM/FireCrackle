// Picture correction of one frame (veil -> portal -> Enhance with its GUI mask fitted to the picture), shared by Label and
// the Misc-tools comparison, and the comparison's post effects: the Enhance panel's own settings on the native frame.
import type {Backend} from './api';
import {processFrame,canvasFrameIo,losslessFrameIo,type EnhanceStage,type FrameIo,type ProcessedFrame} from './veilFrame';
import type {VeilMode,VeilOptions} from './veil';
import type {PortalImage,PortalManual,PortalResult} from './portal';
import {fitCoverage,portalPreview,portalWorldMask,sameShape,type WorldCoverage} from './portalPreview';
import {overlayRgba,screenWorld,veilScreenEvidence,type GuiMaskFrame,type ScreenEvidence} from './guiMask';
import {enhance,hasEnhancement} from './post/pipeline';
import {DEFAULT_POST,type PostSettings} from './post/settings';
import {nativeFrame} from './exactFrame';
import {pictureTask} from './pictureWorker';
import {failureMessage} from './appErrors';
import {blobDataUrl} from './canvas';

/** Which post effects the comparison applies. `blink` also shows them in Blink (off: Blink switches the originals). */
/** The post effects of a frame comparison. The open GUI needs no option of its own: unveil already leaves it as it is. */
export interface ComparePost {veil:boolean;portal:boolean;enhance:boolean;blink:boolean}
export const NO_COMPARE_POST:ComparePost={veil:false,portal:false,enhance:false,blink:false};
/** A GUI boundary cut: auto unveil, which already leaves the open inventory or menu as it is (only the HUD is unveiled). */
export const BOUNDARY_POST:Partial<ComparePost>={veil:true};

export const comparesProcessed=(c:ComparePost)=>c.veil||c.portal||c.enhance;

/** The Enhance panel's settings narrowed to the ticked effects. A ticked veil or portal the panel has off runs in Auto. */
export function comparisonSettings(post:PostSettings,c:ComparePost):PostSettings{
 return {...post,enabled:true,
  veil:c.veil?(post.veil==='off'?'auto':post.veil):'off',
  portal:c.portal?(post.portal==='off'?'auto':post.portal):'off',
  stages:c.enhance?post.stages:DEFAULT_POST.stages};
}

type Portal=(image:PortalImage,signal:AbortSignal,world?:Uint8Array,manual?:PortalManual)=>Promise<PortalResult>;
/** A frame's GUI mask as the corrections use it: veil evidence, every GUI pixel (portal) and the open screen (unveil). */
export interface Mask {evidence?:ScreenEvidence;gui?:WorldCoverage;screen?:WorldCoverage}
export function coverageOf(frame:GuiMaskFrame):Mask{
 const {reply,packed}=frame;
 if(!packed)return {};
 return {evidence:veilScreenEvidence(reply),gui:{width:reply.width,height:reply.height,world:portalWorldMask(overlayRgba(packed,reply.width,reply.height))},screen:{width:reply.width,height:reply.height,world:screenWorld(packed)}};
}

/**
 * One frame's picture correction: veil -> portal (GUI pixels protected) -> Enhance, with the frame's GUI mask fitted to
 * `size` (the picture's, when known; a mask of another shape is not used and detection alone decides). Without a size
 * the mask is used as made, for the display frame it was made on. Label and the comparison both run this;
 * `guiProtected` says the portal undo had the GUI mask.
 */
export async function correctFrame({bytes,original,mode,veil,io,mask,size,portal,enhance:stage}:{bytes:ArrayBuffer;original:Blob;mode:VeilMode;veil:VeilOptions;io:FrameIo;mask?:Mask;size?:{width:number;height:number};portal?:(image:PortalImage,world?:Uint8Array)=>Promise<PortalResult>;enhance?:EnhanceStage}):Promise<ProcessedFrame&{guiProtected:boolean}>{
 const fit=(c:WorldCoverage|undefined)=>size?fitCoverage(c,size.width,size.height):c;
 const gui=fit(mask?.gui),screen=fit(mask?.screen);
 const evidence=size?(mask?.evidence&&sameShape(mask.evidence,size)?{...mask.evidence,width:size.width,height:size.height}:undefined):mask?.evidence;
 let guiProtected=false;
 const made=await processFrame(bytes,original,mode,veil,io,portal?picture=>{
  const world=gui&&picture.width===gui.width&&picture.height===gui.height?gui.world:undefined;
  if(world)guiProtected=true;
  return portal(picture,world);
 }:undefined,stage,evidence,screen);
 return {...made,guiProtected};
}

/**
 * Auto unveil of a small gallery preview, the same as Label's: the frame's GUI mask (made from the display frame) is
 * fitted to the preview, so only an open inventory or menu is left as it is. Without a usable mask, detection alone
 * decides. Returns the preview itself when nothing was unveiled.
 */
export async function unveilPreview({url,mask,veil,io,read=src=>fetch(src).then(r=>r.arrayBuffer()),toUrl=blob=>blobDataUrl(blob),onScreen}:{url:string;mask?:()=>Promise<GuiMaskFrame>;veil:VeilOptions;io?:FrameIo;read?:(url:string)=>Promise<ArrayBuffer>;toUrl?:(blob:Blob)=>Promise<string>;onScreen?:(screen:WorldCoverage|undefined)=>void}):Promise<string>{
 const bytes=await read(url);
 let found:Mask={};
 if(mask){try{found=coverageOf(await mask());}catch{/* detection alone */}}
 // the pixel work runs off the UI thread unless the caller supplies its own picture I/O
 const made=io?await unveilPicture({bytes,mask:found,veil,io}):await pictureTask('unveil',{bytes,mask:found,veil});
 onScreen?.(made.screen);
 return made.blob?toUrl(made.blob):url;
}

/** The pixel half of unveilPreview (worker-safe): decode, fit the mask to the picture, Auto unveil, encode. */
export async function unveilPicture({bytes,mask,veil,io=canvasFrameIo}:{bytes:ArrayBuffer;mask:Mask;veil:VeilOptions;io?:FrameIo}):Promise<{blob?:Blob;screen?:WorldCoverage}>{
 const image=await io.decode(bytes);
 const screen=fitCoverage(mask.screen,image.width,image.height);
 const result=await correctFrame({bytes,original:new Blob([bytes],{type:'image/jpeg'}),mode:'auto',veil,mask,size:image,io:{decode:async()=>image,encode:io.encode}});
 return {blob:result.applied?result.blob:undefined,screen};
}

/**
 * The compared frames with the ticked effects, keyed by frame (each frame made once). A failed stage keeps what
 * succeeded and is listed in `errors`; a frame that cannot be read rejects.
 */
export async function comparisonPictures({backend,frames,post,compare,veilOptions,signal,io,portal}:{backend:Backend;frames:number[];post:PostSettings;compare:ComparePost;veilOptions:VeilOptions;signal:AbortSignal;io?:FrameIo;portal?:Portal}):Promise<{pictures:Map<number,Blob>;errors:string[]}>{
 const settings=comparisonSettings(post,compare),errors:string[]=[];
 const enhanceOn=hasEnhancement(settings),manual=settings.portal==='manual'?settings.portalManual:undefined;
 const wantsMask=settings.veil==='auto'||settings.portal==='auto';
 const unique=[...new Set(frames)];
 const made=await Promise.all(unique.map(async frame=>{
  // the video's own resolution, like Label's paused picture; the GUI mask (made on the display frame) is fitted to it
  const original=await nativeFrame(backend,frame),bytes=await original.arrayBuffer();
  let mask:Mask={};
  if(wantsMask&&backend.guiMaskFrame){try{mask=coverageOf(await backend.guiMaskFrame(frame));}catch(e){errors.push(`GUI mask of frame ${frame}: ${failureMessage(e)}`);}}
  const job:CorrectJob={bytes,type:original.type,mode:settings.veil,veil:veilOptions,mask,portal:settings.portal,manual,enhance:enhanceOn,settings};
  // the pixel work runs off the UI thread unless the caller supplies its own picture I/O or portal
  const result=io||portal?await correctPicture(job,io,portal?(image,world,manual)=>portal(image,signal,world,manual):undefined):await pictureTask('correct',job);
  if(signal.aborted)throw Error('cancelled');
  if(result.error)errors.push(`Frame ${frame}: ${result.error}`);
  return {frame,blob:result.blob};
 }));
 return {pictures:new Map(made.map(m=>[m.frame,m.blob])),errors};
}
/** One frame's post effects as plain data, so they can run in the picture worker (lib/pictureTasks.ts). */
export interface CorrectJob {bytes:ArrayBuffer;type:string;mode:VeilMode;veil:VeilOptions;mask:Mask;portal:PostSettings['portal'];manual?:PortalManual;enhance:boolean;settings:PostSettings}
/** The pixel work of one comparison frame (worker-safe): decode once, then the shared correctFrame on the native picture, lossless. */
export async function correctPicture(job:CorrectJob,io:FrameIo=losslessFrameIo,portal:(image:PortalImage,world?:Uint8Array,manual?:PortalManual)=>Promise<PortalResult>=(image,world,manual)=>portalPreview(image,new AbortController().signal,world,manual)):Promise<ProcessedFrame&{guiProtected:boolean}>{
 const image=await io.decode(job.bytes);
 return correctFrame({bytes:job.bytes,original:new Blob([job.bytes],{type:job.type}),mode:job.mode,veil:job.veil,io:{decode:async()=>image,encode:io.encode},mask:job.mask,size:image,
  portal:job.portal!=='off'?(picture,world)=>portal(picture,job.portal==='auto'?world:undefined,job.manual):undefined,
  enhance:job.enhance?picture=>enhance(picture,job.settings):undefined});
}
/** One frame at the video's own resolution as the GUI gallery shows it (auto unveil, the GUI mask fitted to it);
 * the plain frame when unveil fails or changes nothing. */
export async function boundaryPicture({backend,frame,veilOptions,io}:{backend:Backend;frame:number;veilOptions:VeilOptions;io?:FrameIo}):Promise<Blob>{
 const plain=await nativeFrame(backend,frame),bytes=await plain.arrayBuffer();
 let made:Blob|undefined;
 try{
  await unveilPreview({url:'',read:async()=>bytes,mask:backend.guiMaskFrame?()=>backend.guiMaskFrame!(frame):undefined,veil:veilOptions,io,toUrl:async blob=>{made=blob;return '';}});
 }catch{/* the plain frame */}
 return made??plain;
}
