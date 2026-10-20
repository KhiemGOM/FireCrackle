/** Inclusive frame range. GUI scans can separately use first/last GUI-visible frames. */
export interface ReviewInterval {first:number;last:number}
const reviewKey=(video:string)=>`firecrackle.misc-review.v1:${encodeURIComponent(video)}`;
export function readReviewInterval(video:string|undefined,current:number,count:number,storage?:Pick<Storage,'getItem'>):ReviewInterval {
 const fallback=reviewInterval(current,current,count);
 try{if(!video)return fallback;const saved=JSON.parse((storage??localStorage).getItem(reviewKey(video))??'null');if(saved?.version===1&&saved.count===count&&Number.isInteger(saved.first)&&Number.isInteger(saved.last))return reviewInterval(saved.first,saved.last,count);}catch{/* Optional local review state. */}
 return fallback;
}
export function saveReviewInterval(video:string|undefined,interval:ReviewInterval,count:number,storage?:Pick<Storage,'setItem'>){
 try{if(video)(storage??localStorage).setItem(reviewKey(video),JSON.stringify({version:1,count,...reviewInterval(interval.first,interval.last,count)}));}catch{/* Optional local review state. */}
}
export function reviewInterval(first:number,last:number,count:number):ReviewInterval {
 const max=Math.max(0,Math.trunc(count)-1);
 const clamp=(n:number)=>Math.min(max,Math.max(0,Number.isFinite(n)?Math.trunc(n):0));
 const a=clamp(first),b=clamp(last);return {first:Math.min(a,b),last:Math.max(a,b)};
}
/** Manual comparison includes exactly the entered endpoints, including video boundaries. */
export function comparisonFrames(interval:ReviewInterval,count:number){
 if(count<1)return {before:null,during:null,after:null};
 const {first,last}=reviewInterval(interval.first,interval.last,count);
 return {before:first,during:Math.floor((first+last)/2),after:last};
}
/** GUI interaction evidence is outside the GUI-visible interval; missing neighbours stay unavailable. */
export function reviewFrames(interval:ReviewInterval,count:number){
 if(count<1)return {before:null,during:null,after:null};
 const {first,last}=reviewInterval(interval.first,interval.last,count);
 return {before:first>0?first-1:null,during:Math.floor((first+last)/2),after:last+1<count?last+1:null};
}
