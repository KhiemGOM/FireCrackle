import type {GuiRange} from './guiScan';

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
/** Mean absolute RGB change, 0..1. A review ordering, not an aim/cheating classifier. */
export function meanPixelChange(before:Uint8ClampedArray,after:Uint8ClampedArray):number{
  if(before.length!==after.length||before.length===0||before.length%4!==0)throw Error('Comparison images must have matching RGBA pixels.');
  let difference=0;
  for(let i=0;i<before.length;i+=4)for(let channel=0;channel<3;channel++)difference+=Math.abs(before[i+channel]-after[i+channel]);
  return difference/(before.length/4*3*255);
}
export async function previewPixelChange(before:string,after:string):Promise<number>{
  const load=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{
    const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Could not load motion preview'));image.src=src;
  });
  const [a,b]=await Promise.all([load(before),load(after)]);
  if(a.naturalWidth!==b.naturalWidth||a.naturalHeight!==b.naturalHeight)throw Error('Motion previews have different dimensions.');
  const canvas=document.createElement('canvas');canvas.width=Math.min(128,a.naturalWidth);canvas.height=Math.max(1,Math.round(canvas.width*a.naturalHeight/a.naturalWidth));
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('Motion preview unavailable');
  context.drawImage(a,0,0,canvas.width,canvas.height);const left=context.getImageData(0,0,canvas.width,canvas.height);
  context.drawImage(b,0,0,canvas.width,canvas.height);const right=context.getImageData(0,0,canvas.width,canvas.height);
  return meanPixelChange(left.data,right.data);
}
export function rankGuiRanges(ranges:GuiRange[],scores:ReadonlyMap<string,number|null>):GuiRange[]{
  return [...ranges].sort((a,b)=>(scores.get(guiRangeKey(b))??-1)-(scores.get(guiRangeKey(a))??-1)||a.first-b.first||a.last-b.last);
}
