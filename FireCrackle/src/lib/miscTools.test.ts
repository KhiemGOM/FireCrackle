import {expect,it} from 'vitest';
import {readReviewInterval,saveReviewInterval,comparisonFrames,reviewFrames,reviewInterval} from './miscTools';
it('restores manual review per video and rejects incompatible saved state',()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,v:string)=>{values.set(key,v);}};
 saveReviewInterval('a.mp4',{first:10,last:20},100,storage);
 expect(readReviewInterval('a.mp4',50,100,storage)).toEqual({first:10,last:20});
 expect(readReviewInterval('b.mp4',50,100,storage)).toEqual({first:50,last:50});
 expect(readReviewInterval('a.mp4',50,200,storage)).toEqual({first:50,last:50});
 expect(readReviewInterval('a.mp4',50,100,{getItem:()=>'{'})).toEqual({first:50,last:50});
});
it('uses the immediate surrounding frames and an actual frame inside the interval',()=>{
 expect(reviewFrames({first:10,last:19},100)).toEqual({before:9,during:14,after:20});
 expect(reviewFrames({first:10,last:10},100)).toEqual({before:9,during:10,after:11});
});
it('shows unavailable boundaries rather than repeating a frame as false before/after evidence',()=>{
 expect(reviewFrames({first:0,last:99},100)).toEqual({before:null,during:49,after:null});
 expect(reviewFrames({first:0,last:0},1)).toEqual({before:null,during:0,after:null});
 expect(reviewFrames({first:0,last:0},0)).toEqual({before:null,during:null,after:null});
});
it('normalizes reversed, out-of-range and invalid input',()=>{
 expect(reviewInterval(50,10,30)).toEqual({first:10,last:29});
 expect(reviewInterval(-100,Infinity,30)).toEqual({first:0,last:0});
});
it('manual comparison includes both endpoints, even when equal or at video boundaries',()=>{
 expect(comparisonFrames({first:828,last:828},1000)).toEqual({before:828,during:828,after:828});
 expect(comparisonFrames({first:10,last:19},100)).toEqual({before:10,during:14,after:19});
 expect(comparisonFrames({first:0,last:99},100)).toEqual({before:0,during:49,after:99});
 expect(comparisonFrames({first:0,last:0},1)).toEqual({before:0,during:0,after:0});
 expect(comparisonFrames({first:0,last:0},0)).toEqual({before:null,during:null,after:null});
});
