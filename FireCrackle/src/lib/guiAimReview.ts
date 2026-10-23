import type {GuiRange} from './guiScan';
import {pictureTask} from './pictureWorker';
import {fitCoverage,type WorldCoverage} from './portalPreview';

const motionScores=new WeakMap<object,Map<string,number|null>>();
/** Share completed ordering work across tabs; a new video preview cache gets new scores. */
export function guiMotionScores(cache:object):Map<string,number|null>{
  let scores=motionScores.get(cache);
  if(!scores){scores=new Map();motionScores.set(cache,scores);}
  return scores;
}

export const guiRangeKey=(range:GuiRange)=>`${range.first}-${range.last}`;
export function guiReviewFrames(range:GuiRange,total:number){
  return {before:Math.max(0,range.first-1),after:Math.min(total-1,range.last+1)};
}
export type GuiPair='around'|'open'|'close';
/** The two frames a gallery card compares: around the whole GUI, or across the cut where it opens or closes. */
export function guiPairFrames(range:GuiRange,total:number,pair:GuiPair){
  const around=guiReviewFrames(range,total);
  return pair==='open'?{before:around.before,after:range.first}:pair==='close'?{before:range.last,after:around.after}:around;
}
/** Scores of one frame pair: the same range scores differently around the GUI and across its cuts. */
export const guiScoreKey=(range:GuiRange,pair:GuiPair)=>`${pair}:${guiRangeKey(range)}`;
/** Mean absolute RGB change, 0..1, over the pixels `keep` marks 1 (all when omitted). A review ordering, not an aim/cheating classifier. */
export function meanPixelChange(before:Uint8ClampedArray,after:Uint8ClampedArray,keep?:Uint8Array):number{
  if(before.length!==after.length||before.length===0||before.length%4!==0)throw Error('Comparison images must have matching RGBA pixels.');
  let difference=0,counted=0;
  for(let i=0;i<before.length;i+=4){
    if(keep&&!keep[i/4])continue;
    counted++;
    for(let channel=0;channel<3;channel++)difference+=Math.abs(before[i+channel]-after[i+channel]);
  }
  return counted?difference/(counted*3*255):0;
}
/** The pixels to score at `width` x `height`: outside the open GUI of every picture (unveil's own screen masks). */
export function keepMask(screens:(WorldCoverage|undefined)[],width:number,height:number):Uint8Array|undefined{
  const fitted=screens.map(screen=>fitCoverage(screen,width,height)).filter((s):s is WorldCoverage=>!!s);
  if(!fitted.length)return;
  const keep=new Uint8Array(width*height);
  for(let i=0;i<keep.length;i++)keep[i]=fitted.every(s=>s.world[i])?1:0;
  return keep;
}
/** The movement score of two previews, worked out off the UI thread (lib/pictureWorker.ts). */
export function previewPixelChange(before:string,after:string,screens:(WorldCoverage|undefined)[]=[]):Promise<number>{
  return pictureTask('change',{before,after,screens});
}
/** The score itself, at 128 px wide; worker-safe (no document). */
export async function motionChange(before:string,after:string,screens:(WorldCoverage|undefined)[]=[]):Promise<number>{
  const load=async(src:string)=>{
    const response=await fetch(src);if(!response.ok)throw Error('Could not load motion preview');
    return createImageBitmap(await response.blob());
  };
  const [a,b]=await Promise.all([load(before),load(after)]);
  try{
    if(a.width!==b.width||a.height!==b.height)throw Error('Motion previews have different dimensions.');
    const width=Math.min(128,a.width),height=Math.max(1,Math.round(width*a.height/a.width));
    const canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw Error('Motion preview unavailable');
    context.drawImage(a,0,0,width,height);const left=context.getImageData(0,0,width,height);
    context.drawImage(b,0,0,width,height);const right=context.getImageData(0,0,width,height);
    return meanPixelChange(left.data,right.data,keepMask(screens,width,height));
  }finally{a.close();b.close();}
}
/** Only sealed ranges have a stable `first-last` key, so only they are scored and cached. */
export const scorableRanges=(ranges:GuiRange[])=>ranges.filter(range=>range.sealed!==false);
export function rankGuiRanges(ranges:GuiRange[],scores:ReadonlyMap<string,number|null>):GuiRange[]{
  return [...ranges].sort((a,b)=>(scores.get(guiRangeKey(b))??-1)-(scores.get(guiRangeKey(a))??-1)||a.first-b.first||a.last-b.last);
}
