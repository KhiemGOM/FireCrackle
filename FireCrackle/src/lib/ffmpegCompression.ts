import { inTauri } from "./api";
import type { ManualQuad } from "./quadMask";
import { rasterizeFire, restoreFireAlpha } from "./quadRaster";
import {canvasBlob,loadImage as loadPicture} from "./canvas";

export function qualityToCrf(quality:number):number {
  return quality >= 0.8 ? 20 : quality >= 0.45 ? 28 : quality >= 0.15 ? 36 : 42;
}
export function unpackFrames(buffer:ArrayBuffer):Uint8Array[] {
  const view=new DataView(buffer), result:Uint8Array[]=[];
  let offset=0;
  for(let row=0;row<32;row++) {
    if(offset+4>buffer.byteLength) throw new Error("Incomplete FFmpeg cycle");
    const length=view.getUint32(offset,true);offset+=4;
    if(!length || offset+length>buffer.byteLength) throw new Error("Invalid FFmpeg frame");
    result.push(new Uint8Array(buffer.slice(offset,offset+length)));offset+=length;
  }
  if(offset!==buffer.byteLength) throw new Error("Unexpected data after FFmpeg cycle");
  return result;
}
const loadImage=(src:string)=>loadPicture(src,"Could not rasterize fire");
const png=(canvas:HTMLCanvasElement)=>canvasBlob(canvas,"image/png",undefined,"PNG export failed");

// Serialize expensive encodes. Superseded edits leave the queue before rasterization/IPC.
let tail:Promise<void>=Promise.resolve();
const cycles=new Map<string,Uint8Array[]>();
export async function encodeFireCycle(rgba:Uint8ClampedArray,quad:ManualQuad,mirrored:boolean,width:number,height:number,quality:number,cancelled:()=>boolean):Promise<Uint8Array[]> {
  let hash=2166136261;
  for(const byte of rgba) hash=Math.imul(hash^byte,16777619);
  const key=JSON.stringify([hash,quad,mirrored,width,height,qualityToCrf(quality)]);
  let release!:()=>void;
  const previous=tail;tail=new Promise<void>(resolve=>{release=resolve;});
  await previous;
  try {
    if(cancelled()) throw new Error("Cancelled");
    const cached=cycles.get(key);if(cached)return cached;
    if(!inTauri()) throw new Error("FFmpeg compression requires the desktop app");
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Canvas unavailable");
    const pixels=ctx.createImageData(width,height);
    const frames:number[][]=[];
    for(let row=0;row<32;row++) {
      if(cancelled())throw new Error("Cancelled");
      rasterizeFire(rgba,row,mirrored,quad,width,height,true,pixels.data);
      ctx.putImageData(pixels,0,0);
      frames.push(Array.from(new Uint8Array(await (await png(canvas)).arrayBuffer())));
    }
    if(cancelled())throw new Error("Cancelled");
    const {invoke}=await import("@tauri-apps/api/core");
    const decoded=unpackFrames(await invoke<ArrayBuffer>("compress_fire_cycle",{width,height,frames,crf:qualityToCrf(quality)}));
    cycles.set(key,decoded);
    if(cycles.size>2)cycles.delete(cycles.keys().next().value!);
    return decoded;
  } finally {release();}
}

/** Clip the decoded frame using the original fire alpha; the white backdrop never reaches the video. */
export async function clipCompressedFire(frame:Uint8Array,rgba:Uint8ClampedArray,quad:ManualQuad,row:number,mirrored:boolean,width:number,height:number):Promise<Blob> {
  const damagedUrl=URL.createObjectURL(new Blob([frame as BlobPart],{type:"image/png"}));
  try {
    const damaged=await loadImage(damagedUrl);
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Canvas unavailable");
    ctx.drawImage(damaged,0,0);
    const pixels=ctx.getImageData(0,0,width,height);
    restoreFireAlpha(pixels.data,rasterizeFire(rgba,row,mirrored,quad,width,height));
    ctx.putImageData(pixels,0,0);
    return await png(canvas);
  } finally {URL.revokeObjectURL(damagedUrl);}
}
