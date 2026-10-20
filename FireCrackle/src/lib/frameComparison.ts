import type {Backend} from './api';
import {inTauri} from './api';
import {copyComparisonProof,type ProofAction} from './comparisonProof';
import {formatTimecode} from './timecode';

export const FRAME_BLINK_MS=640;
/** Absolute RGB difference, amplified only for inspection. Alpha is always opaque. */
export function frameDifference(before:Uint8ClampedArray,after:Uint8ClampedArray,gain=3):Uint8ClampedArray{
 if(before.length!==after.length||before.length%4)throw Error('Comparison pictures have different dimensions.');
 if(!Number.isFinite(gain)||gain<1||gain>8)throw Error('Difference brightness must be between 1 and 8.');
 const result=new Uint8ClampedArray(before.length);
 for(let i=0;i<result.length;i+=4){for(let c=0;c<3;c++)result[i+c]=Math.min(255,Math.abs(after[i+c]-before[i+c])*gain);result[i+3]=255;}
 return result;
}
export function loadFrameImage(bytes:ArrayBuffer):Promise<HTMLImageElement>{
 return new Promise((resolve,reject)=>{const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'})),image=new Image();
  image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Could not load the comparison picture.'));};image.src=url;});
}
function canvasBlob(canvas:HTMLCanvasElement,type='image/png'):Promise<Blob>{return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not render the comparison proof.')),type,0.95));}
export interface FrameProof {before:number;after:number;first:number;last:number;fps:number;source:string}
/** Two originals, identical framing. Animated proofs switch instantly; stills show both. */
export async function renderFrameProof(before:HTMLImageElement,after:HTMLImageElement,proof:FrameProof,animated:boolean,type='image/png'){
 const width=before.naturalWidth,height=before.naturalHeight;
 if(!width||!height||width!==after.naturalWidth||height!==after.naturalHeight)throw Error('Comparison pictures have different dimensions.');
 const w=Math.min(animated?1280:800,width),h=Math.round(height*w/width),header=100,footer=36,gap=animated?0:12;
 const canvas=document.createElement('canvas');canvas.width=animated?w:w*2+gap;canvas.height=header+h+footer;
 if(canvas.height>2048)throw Error('This frame is too tall for a comparison proof.');
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image rendering is unavailable.');
 const stamp=(frame:number)=>`Frame ${frame} · ${formatTimecode(frame/proof.fps,proof.fps)}`;
 const paint=(image:HTMLImageElement,label:string)=>{
  ctx.fillStyle='#111722';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=true;
  ctx.fillStyle='#ffffff';ctx.font='600 20px sans-serif';ctx.fillText('Frame comparison · before / after',18,28,canvas.width-36);
  ctx.fillStyle='#bdc8da';ctx.font='14px sans-serif';ctx.fillText(proof.source,18,51,canvas.width-36);
  ctx.fillText(`Before ${stamp(proof.before)}  /  After ${stamp(proof.after)}`,18,73,canvas.width-36);
  ctx.fillText(`Interval ${proof.first}–${proof.last} · original video frames · ${animated?'direct switch every 640 ms':'side by side'}`,18,canvas.height-13,canvas.width-36);
  ctx.fillStyle='#ffad40';ctx.font='600 14px sans-serif';ctx.fillText(animated?label:'Before',18,94,w-36);
  ctx.drawImage(image,0,header,w,h);
  if(!animated){ctx.fillText('After',w+gap+18,94,w-36);ctx.drawImage(after,w+gap,header,w,h);}
 };
 paint(before,'Before');const base=animated?await canvasBlob(canvas):undefined;
 if(animated)paint(after,'After');
 return {image:await canvasBlob(canvas,type),base};
}
export async function exportFrameProof(backend:Backend,proof:FrameProof,action:ProofAction):Promise<boolean>{
 const animated=action.format==='webp'||action.format==='gif',native=inTauri();
 if(!native&&(animated||action.destination==='copy'&&action.format!=='png'))throw Error('Use the desktop app for this comparison format.');
 const pending=Promise.all([backend.frame(proof.before),backend.frame(proof.after)])
  .then(bytes=>Promise.all(bytes.map(loadFrameImage)))
  .then(([before,after])=>renderFrameProof(before,after,proof,animated,!native&&action.format==='jpeg'?'image/jpeg':'image/png'));
 void pending.catch(()=>{});
 if(action.destination==='copy'&&action.format==='png'){await copyComparisonProof(pending.then(p=>p.image));return true;}
 const extension=action.format==='jpeg'?'jpg':action.format,filename=`frame-comparison-${proof.before}-${proof.after}.${extension}`;
 if(native){
  let path:string|null=null;
  if(action.destination==='save'){const {save}=await import('@tauri-apps/plugin-dialog');path=await save({defaultPath:filename,filters:[{name:action.format.toUpperCase(),extensions:[extension]}]});if(!path)return false;}
  const {image,base}=await pending,{invoke}=await import('@tauri-apps/api/core');
  await invoke(action.destination==='copy'?'copy_formatted_comparison_proof':'save_comparison_proof',{
   ...(path?{path}:{}),format:action.format,png:Array.from(new Uint8Array(await image.arrayBuffer())),base:base?Array.from(new Uint8Array(await base.arrayBuffer())):null,transition:'blink'});
 }else{
  const {image}=await pending,url=URL.createObjectURL(image),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return true;
}
