import {afterEach,describe,expect,it,vi} from 'vitest';
import {guiWorldCoverage,portalPreview} from './portalPreview';
const reply={width:2,height:1,reliable:false,mask_available:true},pixels=new Uint8ClampedArray([255,215,0,110,0,0,0,0]);
afterEach(()=>vi.unstubAllGlobals());
it('uses the new neutral interaction mask without a fitted HUD',()=>{expect(guiWorldCoverage({maskFrame:5,pixels,reply},5)).toEqual({width:2,height:1,world:new Uint8Array([0,1])});});
it('rejects stale, unavailable and malformed masks',()=>{
 expect(guiWorldCoverage({maskFrame:4,pixels,reply},5)).toBeUndefined();
 expect(guiWorldCoverage({maskFrame:5,pixels,reply:{...reply,mask_available:false}},5)).toBeUndefined();
 expect(guiWorldCoverage({maskFrame:5,pixels:new Uint8ClampedArray(3),reply},5)).toBeUndefined();
 expect(guiWorldCoverage({maskFrame:5,pixels,reply:{...reply,width:NaN}},5)).toBeUndefined();
 expect(guiWorldCoverage({maskFrame:5,pixels,reply:null},5)).toBeUndefined();
});
it('supports legacy reliable masks with no availability field',()=>{expect(guiWorldCoverage({maskFrame:5,pixels,reply:{width:2,height:1,reliable:true}},5)?.world).toEqual(new Uint8Array([0,1]));});
it.each([false,true])('protects GUI only in automatic portal mode (manual: %s)',async manual=>{
 const post=vi.fn(),terminate=vi.fn();vi.stubGlobal('Worker',class{onmessage?:(e:any)=>void;postMessage(message:any){post(message);queueMicrotask(()=>this.onmessage?.({data:{data:message.image.data,applied:true,valid:new Uint8Array(2),phase:0,opacity:.5}}));}terminate=terminate;});
 const image={data:new Uint8ClampedArray(8),width:2,height:1},world=new Uint8Array([0,1]);
 await portalPreview(image,new AbortController().signal,world,manual?{phase:0,opacity:.5}:undefined);
 expect(post.mock.calls[0][0].world).toBe(manual?undefined:world);expect(terminate).toHaveBeenCalledOnce();
});

import { fitCoverage } from "./portalPreview";
describe("GUI coverage for a full-resolution picture", () => {
  const half = { width: 2, height: 1, world: new Uint8Array([1, 0]) };
  it("is unchanged at its own size", () => {
    expect(fitCoverage(half, 2, 1)).toBe(half);
  });
  it("stretches nearest-neighbour to a larger picture of the same shape", () => {
    expect(fitCoverage(half, 4, 2)).toEqual({ width: 4, height: 2, world: new Uint8Array([1, 1, 0, 0, 1, 1, 0, 0]) });
  });
  it("is dropped for a picture of another shape or no coverage", () => {
    expect(fitCoverage(half, 4, 4)).toBeUndefined();
    expect(fitCoverage(undefined, 4, 2)).toBeUndefined();
  });
  it("accepts the rounding of an even-height scaled display frame", () => {
    // 1920x1080 shown as 1280x720; 1366x768 shown as 1280x720 (h=-2 rounds to even)
    expect(fitCoverage({ width: 1280, height: 720, world: new Uint8Array(1280 * 720) }, 1366, 768)?.world.length).toBe(1366 * 768);
  });
});
