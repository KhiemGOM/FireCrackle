// Post effects on the Misc-tools frame comparison: the Enhance panel's own veil, portal and effect settings, run through
// the same processFrame as Label, plus an optional open-screen mask so a blink compares only the world.
import type {Backend} from './api';
import {processFrame,canvasFrameIo,type FrameIo} from './veilFrame';
import type {VeilOptions} from './veil';
import type {PortalImage,PortalManual,PortalResult} from './portal';
import {fitCoverage,portalPreview,portalWorldMask,sameShape,type WorldCoverage} from './portalPreview';
import {overlayRgba,screenWorld,veilScreenEvidence,type GuiMaskFrame} from './guiMask';
import {enhance,hasEnhancement} from './post/pipeline';
import {DEFAULT_POST,type PostSettings} from './post/settings';
import {nativeFrame} from './exactFrame';
import {failureMessage} from './appErrors';
import {blobDataUrl} from './canvas';

/** Which post effects the comparison applies. `blink` also shows them in Blink (off: Blink switches the originals). */
export interface ComparePost {veil:boolean;portal:boolean;enhance:boolean;gui:boolean;blink:boolean}
export const NO_COMPARE_POST:ComparePost={veil:false,portal:false,enhance:false,gui:false,blink:false};
/** A GUI boundary cut: auto unveil, which already leaves the open inventory or menu as it is (only the HUD is unveiled). */
export const BOUNDARY_POST:Partial<ComparePost>={veil:true};

export const comparesProcessed=(c:ComparePost)=>c.veil||c.portal||c.enhance||c.gui;

/** The Enhance panel's settings narrowed to the ticked effects. A ticked veil or portal the panel has off runs in Auto. */
export function comparisonSettings(post:PostSettings,c:ComparePost):PostSettings{
 return {...post,enabled:true,
  veil:c.veil?(post.veil==='off'?'auto':post.veil):'off',
  portal:c.portal?(post.portal==='off'?'auto':post.portal):'off',
  stages:c.enhance?post.stages:DEFAULT_POST.stages};
}

/** Blank (opaque black) every pixel that is open-screen GUI in any of the compared pictures. Masks of another size are ignored. */
export function maskScreens(data:Uint8ClampedArray,worlds:(Uint8Array|undefined)[]):Uint8ClampedArray{
 const out=new Uint8ClampedArray(data),usable=worlds.filter((w):w is Uint8Array=>!!w&&w.length*4===data.length);
 for(let i=0;i<data.length/4;i++)if(usable.some(w=>!w[i]))out.set([0,0,0,255],i*4);
 return out;
}

type Portal=(image:PortalImage,signal:AbortSignal,world?:Uint8Array,manual?:PortalManual)=>Promise<PortalResult>;
interface Mask {evidence?:{width:number;height:number};gui?:WorldCoverage;screen?:WorldCoverage}
function coverages(frame:GuiMaskFrame):Mask{
 const {reply,packed}=frame;
 if(!packed)return {};
 return {evidence:veilScreenEvidence(reply),gui:{width:reply.width,height:reply.height,world:portalWorldMask(overlayRgba(packed,reply.width,reply.height))},screen:{width:reply.width,height:reply.height,world:screenWorld(packed)}};
}

/**
 * Auto unveil of a small gallery preview, the same as Label's: the frame's GUI mask (made from the display frame) is
 * fitted to the preview, so only an open inventory or menu is left as it is. Without a usable mask, detection alone
 * decides. Returns the preview itself when nothing was unveiled.
 */
export async function unveilPreview({url,mask,veil,io=canvasFrameIo,read=src=>fetch(src).then(r=>r.arrayBuffer()),toUrl=blob=>blobDataUrl(blob),onScreen}:{url:string;mask?:()=>Promise<GuiMaskFrame>;veil:VeilOptions;io?:FrameIo;read?:(url:string)=>Promise<ArrayBuffer>;toUrl?:(blob:Blob)=>Promise<string>;onScreen?:(screen:WorldCoverage|undefined)=>void}):Promise<string>{
 const bytes=await read(url),image=await io.decode(bytes);
 let found:Mask={};
 if(mask){try{found=coverages(await mask());}catch{/* detection alone */}}
 const evidence=found.evidence&&sameShape(found.evidence,image)?{width:image.width,height:image.height}:undefined;
 const screen=fitCoverage(found.screen,image.width,image.height);
 onScreen?.(screen);
 const result=await processFrame(bytes,new Blob([bytes],{type:'image/jpeg'}),'auto',veil,{decode:async()=>image,encode:io.encode},undefined,undefined,evidence,screen);
 return result.applied?toUrl(result.blob):url;
}

/**
 * The compared frames with the ticked effects, keyed by frame (each frame made once). A failed stage keeps what
 * succeeded and is listed in `errors`; a frame that cannot be read rejects.
 */
export async function comparisonPictures({backend,frames,post,compare,veilOptions,signal,io=canvasFrameIo,portal=portalPreview}:{backend:Backend;frames:number[];post:PostSettings;compare:ComparePost;veilOptions:VeilOptions;signal:AbortSignal;io?:FrameIo;portal?:Portal}):Promise<{pictures:Map<number,Blob>;errors:string[]}>{
 const settings=comparisonSettings(post,compare),errors:string[]=[];
 const enhanceOn=hasEnhancement(settings),manual=settings.portal==='manual'?settings.portalManual:undefined;
 const wantsMask=settings.veil==='auto'||settings.portal==='auto'||compare.gui;
 if(wantsMask&&!backend.guiMaskFrame&&compare.gui)errors.push('The GUI mask is available in the desktop app.');
 const unique=[...new Set(frames)];
 const made=await Promise.all(unique.map(async frame=>{
  const bytes=await backend.frame(frame),original=new Blob([bytes],{type:'image/jpeg'});
  let mask:Mask={};
  if(wantsMask&&backend.guiMaskFrame){try{mask=coverages(await backend.guiMaskFrame(frame));}catch(e){errors.push(`GUI mask of frame ${frame}: ${failureMessage(e)}`);}}
  const result=await processFrame(bytes,original,settings.veil,veilOptions,io,settings.portal!=='off'?image=>{
   const world=settings.portal==='auto'&&mask.gui?.width===image.width&&mask.gui.height===image.height?mask.gui.world:undefined;
   return portal(image,signal,world,manual);
  }:undefined,enhanceOn?image=>enhance(image,settings):undefined,mask.evidence,mask.screen);
  if(result.error)errors.push(`Frame ${frame}: ${result.error}`);
  return {frame,blob:result.blob,screen:mask.screen?.world};
 }));
 const pictures=new Map(made.map(m=>[m.frame,m.blob]));
 if(compare.gui&&made.some(m=>m.screen)){
  const worlds=made.map(m=>m.screen);
  await Promise.all(made.map(async m=>{
   const image=await io.decode(await m.blob.arrayBuffer());
   pictures.set(m.frame,await io.encode(maskScreens(image.data,worlds),image.width,image.height));
  }));
 }
 return {pictures,errors};
}
/** One frame at the video's own resolution as the GUI gallery shows it (auto unveil, the GUI mask fitted to it);
 * the plain frame when unveil fails or changes nothing. */
export async function boundaryPicture({backend,frame,veilOptions,io=canvasFrameIo}:{backend:Backend;frame:number;veilOptions:VeilOptions;io?:FrameIo}):Promise<Blob>{
 const plain=await nativeFrame(backend,frame),bytes=await plain.arrayBuffer();
 let made:Blob|undefined;
 try{
  await unveilPreview({url:'',read:async()=>bytes,mask:backend.guiMaskFrame?()=>backend.guiMaskFrame!(frame):undefined,veil:veilOptions,io,toUrl:async blob=>{made=blob;return '';}});
 }catch{/* the plain frame */}
 return made??plain;
}
