import {expect,it} from 'vitest';
import {guiPairFrames,guiReviewFrames,guiScoreKey,keepMask,meanPixelChange,rankGuiRanges,scorableRanges} from './guiAimReview';

it('movement ignores pixels of an open GUI on either side',()=>{
  const before=new Uint8ClampedArray([0,0,0,255, 0,0,0,255]),after=new Uint8ClampedArray([255,255,255,255, 0,0,0,255]);
  expect(meanPixelChange(before,after)).toBe(.5);
  expect(meanPixelChange(before,after,new Uint8Array([0,1]))).toBe(0);
  expect(meanPixelChange(before,after,new Uint8Array([1,1]))).toBe(.5);
  expect(meanPixelChange(before,after,new Uint8Array([0,0]))).toBe(0);
});
it('combines the open-screen masks of both pictures at the scoring size',()=>{
  const a={width:2,height:1,world:new Uint8Array([0,1])},b={width:4,height:2,world:new Uint8Array([1,1,0,0, 1,1,0,0])};
  expect(keepMask([a,b,undefined],2,1)).toEqual(new Uint8Array([0,0]));
  expect(keepMask([a],4,2)).toEqual(new Uint8Array([0,0,1,1, 0,0,1,1]));
  expect(keepMask([undefined],2,1)).toBeUndefined();
});
it('scores are kept per frame pair',()=>{
  const range={first:20,last:39,menu:false};
  expect(new Set(['around','open','close'].map(pair=>guiScoreKey(range,pair as 'around')))).toHaveProperty('size',3);
});

it('pairs frames around the GUI, at its opening cut and at its closing cut',()=>{
  const range={first:20,last:39,menu:false};
  expect(guiPairFrames(range,100,'around')).toEqual({before:19,after:40});
  expect(guiPairFrames(range,100,'open')).toEqual({before:19,after:20});
  expect(guiPairFrames(range,100,'close')).toEqual({before:39,after:40});
});
it('boundary pairs stay inside the video',()=>{
  expect(guiPairFrames({first:0,last:5,menu:false},10,'open')).toEqual({before:0,after:0});
  expect(guiPairFrames({first:3,last:9,menu:false},10,'close')).toEqual({before:9,after:9});
});

it('compares immediate outside neighbours, clamped to the video',()=>{
  expect(guiReviewFrames({first:20,last:39,menu:false},100)).toEqual({before:19,after:40});
  expect(guiReviewFrames({first:0,last:99,menu:false},100)).toEqual({before:0,after:99});
});
it('averages RGB change across all pixels, ignores alpha and normalizes to 0..1',()=>{
  const before=new Uint8ClampedArray([0,0,0,255,0,0,0,0]);
  expect(meanPixelChange(before,new Uint8ClampedArray([255,255,255,0,0,0,0,255]))).toBe(.5);
  expect(meanPixelChange(before,before)).toBe(0);
  expect(()=>meanPixelChange(before,new Uint8ClampedArray(4))).toThrow('matching');
});
it('ranks strongest motion first, keeps ties chronological and unavailable previews last',()=>{
  const ranges=[{first:1,last:2,menu:false},{first:5,last:6,menu:false},{first:8,last:9,menu:false},{first:11,last:12,menu:false}];
  const scores=new Map([['1-2',.1],['5-6',.9],['8-9',.9],['11-12',null]]);
  expect(rankGuiRanges(ranges,scores).map(r=>r.first)).toEqual([5,8,1,11]);
  expect(ranges.map(r=>r.first)).toEqual([1,5,8,11]);
});
it('scores only sealed ranges: still-growing ones are skipped, and ranges without the flag count as sealed',()=>{
  const ranges=[{first:1,last:2,menu:false,sealed:true},{first:5,last:6,menu:false,sealed:false},{first:8,last:9,menu:false}];
  expect(scorableRanges(ranges).map(r=>r.first)).toEqual([1,8]);
  expect(scorableRanges([])).toEqual([]);
});
