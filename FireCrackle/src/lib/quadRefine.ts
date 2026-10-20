import fire0 from "../assets/fire_0.png";
import fire1 from "../assets/fire_1.png";
import {atlasSource,atlasTile} from "./animationAtlases";
import type {MatchImage,QuadCandidate} from "./quadMatch";
import type {PreviewSprite} from "./firePreview";
import type {ManualQuad} from "./quadMask";
import type {QuadRefinement} from "./quadEcc";

export function readMatchImage(src:string):Promise<MatchImage> {
  return new Promise((resolve,reject)=>{
    const image=new Image();image.onload=()=>{try{const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw Error("Canvas unavailable");ctx.drawImage(image,0,0);resolve({width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data});}catch(error){reject(error);}};
    image.onerror=()=>reject(Error("Could not load matching image"));image.src=src;
  });
}
const atlases=new Map<string,Promise<[Uint8ClampedArray,Uint8ClampedArray]>>();
export function readFireAtlas(material:"normal"|"soul") {
  if(!atlases.has(material))atlases.set(material,Promise.all((material==="soul"?[atlasSource("soul_fire_0"),atlasSource("soul_fire_1")]:[fire0,fire1]).map(readMatchImage)).then(images=>{
    if(images.some(i=>i.width!==16||i.height!==512))throw Error("Invalid fire texture sheets");
    return images.map((image,sheet)=>{if(material==="normal")return image.data;const normalized=new Uint8ClampedArray(image.data.length),source=sheet===0?"soul_fire_0":"soul_fire_1";for(let row=0;row<32;row++){const start=atlasTile(source,row)*1024;normalized.set(image.data.subarray(start,start+1024),row*1024);}return normalized;}) as [Uint8ClampedArray,Uint8ClampedArray];
  }).catch(error=>{atlases.delete(material);throw error;}));
  return atlases.get(material)!;
}
export interface RefinementTarget {quad:ManualQuad;sprite:PreviewSprite}
const cancelled=()=>new DOMException("Alignment cancelled","AbortError");
/** One original-image decode / shared unveil for all fixed candidate appearances. */
export async function refineFireQuads(frameUrl:string,targets:RefinementTarget[],material:"normal"|"soul",signal?:AbortSignal):Promise<QuadRefinement[]> {
  if(signal?.aborted)throw cancelled();if(!targets.length)return [];
  const [image,sheets]=await Promise.all([readMatchImage(frameUrl),readFireAtlas(material)]);if(signal?.aborted)throw cancelled();
  if(typeof Worker==="undefined"){
    const [{phaseMatchInput},{refineQuad}]=await Promise.all([import("./quadPhaseInput"),import("./quadEcc")]);
    const prepared=await phaseMatchInput(image,targets[0].quad);if(prepared.error)throw Error(prepared.error);if(signal?.aborted)throw cancelled();
    return targets.map(t=>refineQuad(prepared.image,sheets,t.quad,t.sprite,material));
  }
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./quadRefine.worker.ts",import.meta.url),{type:"module"});
    const finish=()=>{worker.terminate();signal?.removeEventListener("abort",abort);};
    const abort=()=>{finish();reject(cancelled());};signal?.addEventListener("abort",abort,{once:true});
    worker.onmessage=({data}:MessageEvent<{results?:QuadRefinement[];error?:string}>)=>{finish();if(data.results)resolve(data.results);else reject(Error(data.error??"Alignment failed"));};
    worker.onerror=event=>{finish();reject(Error(event.message||"Alignment worker failed"));};
    if(signal?.aborted){abort();return;}
    try{worker.postMessage({image,sheets,targets,material},[image.data.buffer as ArrayBuffer]);}
    catch(error){finish();reject(error);}
  });
}
export async function refineMatchCandidates(frameUrl:string,candidates:QuadCandidate[],material:"normal"|"soul",signal?:AbortSignal):Promise<QuadCandidate[]> {
  const results=await refineFireQuads(frameUrl,candidates.map(sprite=>({quad:sprite.quad,sprite})),material,signal);
  return candidates.map((candidate,i)=>results[i].changed?{...candidate,quad:results[i].quad}:candidate);
}
