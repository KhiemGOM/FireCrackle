import {expect,it} from 'vitest';
import {guiReviewFrames,meanPixelChange,rankGuiRanges,scorableRanges} from './guiAimReview';

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
