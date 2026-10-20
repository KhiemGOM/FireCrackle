import {afterEach,expect,it,vi} from 'vitest';
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
