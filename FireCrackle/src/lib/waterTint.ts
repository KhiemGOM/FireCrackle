import {ANIMATION_ATLASES,atlasSource} from './animationAtlases';

export const WATER_TINT_KEY='firecrackle.water-tint.v1';
export const NEUTRAL_WATER_TINT='#ffffff';
export type WaterAtlas='water_still'|'water_flow';
export interface WaterPixels {width:number;height:number;rgba:Uint8ClampedArray}
export interface WaterSpriteSheet extends WaterPixels {url:string}
export type WaterSpriteSheets=Record<WaterAtlas,WaterSpriteSheet>;
export function waterColor(value:string):string|null {
 const hex=value.trim();return /^#[0-9a-f]{6}$/i.test(hex)?hex.toLowerCase():null;
}
/** Vanilla FluidRenderer passes biome R/G/B divided by 255 as vertex color.
 * The texture is multiplied by that color (not blended with a solid layer).
 * Quantize the result to RGBA8 once; keep source alpha and all frame boundaries. */
export function tintWaterPixels(source:Uint8ClampedArray,color:string):Uint8ClampedArray {
 const valid=waterColor(color);if(!valid)throw new Error('Invalid water color');
 const value=parseInt(valid.slice(1),16),channels=[value>>>16,(value>>>8)&255,value&255];
 const out=new Uint8ClampedArray(source);
 for(let i=0;i<out.length;i+=4)for(let c=0;c<3;c++)out[i+c]=Math.round(source[i+c]*channels[c]/255);
 return out;
}
const listeners=new Set<()=>void>();
let remembered:string|undefined;
export function getWaterTint():string {
 if(remembered!==undefined)return remembered;
 try{return remembered=waterColor(localStorage.getItem(WATER_TINT_KEY)??'')??NEUTRAL_WATER_TINT;}catch{return NEUTRAL_WATER_TINT;}
}
export function setWaterTint(value:string):boolean {
 const color=waterColor(value);if(!color)return false;
 remembered=color;try{localStorage.setItem(WATER_TINT_KEY,color);}catch{/* Session color still works. */}
 listeners.forEach(listener=>listener());return true;
}
export function subscribeWaterTint(listener:()=>void):()=>void {listeners.add(listener);return()=>{listeners.delete(listener);};}

/** Share the decoded originals and bounded color cache across picker and overlay.
 * In-flight requests deduplicate too; no recoloring on row/frame changes. */
export function createWaterRenderer(load:(atlas:WaterAtlas)=>Promise<WaterPixels>,encode:(pixels:WaterPixels)=>string,capacity=4){
 const originals=new Map<WaterAtlas,Promise<WaterPixels>>(),cache=new Map<string,Promise<WaterSpriteSheets>>();
 const original=(atlas:WaterAtlas)=>{
  let p=originals.get(atlas);if(!p){p=load(atlas).catch(error=>{originals.delete(atlas);throw error;});originals.set(atlas,p);}return p;
 };
 return (value:string):Promise<WaterSpriteSheets>=>{
  const color=waterColor(value);if(!color)return Promise.reject(new Error('Invalid water color'));
  const hit=cache.get(color);if(hit){cache.delete(color);cache.set(color,hit);return hit;}
  const promise=Promise.all((['water_still','water_flow'] as const).map(async atlas=>{
   const raw=await original(atlas),pixels={...raw,rgba:tintWaterPixels(raw.rgba,color)};
   return [atlas,{...pixels,url:color===NEUTRAL_WATER_TINT?atlasSource(atlas):encode(pixels)}] as const;
  })).then(entries=>Object.fromEntries(entries) as WaterSpriteSheets).catch(error=>{cache.delete(color);throw error;});
  cache.set(color,promise);while(cache.size>capacity)cache.delete(cache.keys().next().value!);return promise;
 };
}
function decodeWater(atlas:WaterAtlas):Promise<WaterPixels>{return new Promise((resolve,reject)=>{
 const image=new Image(),a=ANIMATION_ATLASES[atlas];
 image.onload=()=>{try{
  if(image.naturalWidth!==a.side||image.naturalHeight!==a.side*a.rows)throw new Error('Invalid water atlas');
  const canvas=document.createElement('canvas');canvas.width=a.side;canvas.height=a.side*a.rows;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');ctx.drawImage(image,0,0);
  resolve({width:canvas.width,height:canvas.height,rgba:ctx.getImageData(0,0,canvas.width,canvas.height).data});
 }catch(error){reject(error);}};
 image.onerror=()=>reject(new Error('Could not load water atlas'));image.src=atlasSource(atlas);
});}
function encodeWater(pixels:WaterPixels):string {
 const canvas=document.createElement('canvas');canvas.width=pixels.width;canvas.height=pixels.height;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
 const image=ctx.createImageData(pixels.width,pixels.height);image.data.set(pixels.rgba);ctx.putImageData(image,0,0);
 return canvas.toDataURL('image/png');
}
export const renderWaterAtlases=createWaterRenderer(decodeWater,encodeWater);
