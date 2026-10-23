import {afterEach,describe,expect,it,vi} from 'vitest';
import * as frameProcessing from './veilFrame';
import {DEFAULT_POST,STARTING_POST,type PostSettings} from './post/settings';
import {BOUNDARY_POST,NO_COMPARE_POST,boundaryPicture,comparesProcessed,comparisonPictures,comparisonSettings,maskScreens,type ComparePost} from './comparisonPost';
import type {Backend} from './api';
import type {GuiMaskReply} from './guiMask';

afterEach(()=>vi.restoreAllMocks());
const on=(patch:Partial<ComparePost>):ComparePost=>({...NO_COMPARE_POST,...patch});
const toned:PostSettings={...STARTING_POST,veil:'on',portal:'manual',stages:{...STARTING_POST.stages,tone:{...STARTING_POST.stages.tone,on:true}}};

describe('comparison settings from the Enhance panel',()=>{
 it('nothing is applied by default',()=>{
  expect(comparesProcessed(NO_COMPARE_POST)).toBe(false);
  const s=comparisonSettings(toned,NO_COMPARE_POST);
  expect([s.veil,s.portal,s.stages.tone.on]).toEqual(['off','off',false]);
 });
 it('reuses the chosen veil and portal modes, and Auto when the panel has them off',()=>{
  expect(comparisonSettings(toned,on({veil:true,portal:true}))).toMatchObject({veil:'on',portal:'manual',portalManual:toned.portalManual});
  expect(comparisonSettings(DEFAULT_POST,on({veil:true,portal:true}))).toMatchObject({veil:'auto',portal:'auto'});
 });
 it('takes the effects only when Enhance is ticked, even with the master switch off',()=>{
  expect(comparisonSettings(toned,on({enhance:true})).stages.tone).toEqual(toned.stages.tone);
  expect(comparisonSettings({...toned,enabled:false},on({veil:true})).enabled).toBe(true);
  expect(comparisonSettings(toned,on({veil:true})).stages.tone.on).toBe(false);
 });
 it('a GUI mask alone is processing; Apply to blink alone is not',()=>{
  expect(comparesProcessed(on({gui:true}))).toBe(true);
  expect(comparesProcessed(on({blink:true}))).toBe(false);
 });
 it('boundary comparisons use auto unveil, which already keeps the open screen; no extra black-out',()=>{expect(BOUNDARY_POST).toEqual({veil:true});});
});

describe('masking the open screen on every compared picture',()=>{
 const px=()=>new Uint8ClampedArray([10,20,30,255, 40,50,60,255, 70,80,90,255]);
 it('blanks a pixel that is screen GUI in any of the pictures',()=>{
  const out=maskScreens(px(),[new Uint8Array([0,1,1]),new Uint8Array([1,1,0])]);
  expect(Array.from(out)).toEqual([0,0,0,255, 40,50,60,255, 0,0,0,255]);
 });
 it('leaves the input alone and ignores a mask of another size or none',()=>{
  const input=px(),copy=new Uint8ClampedArray(input);
  expect(maskScreens(input,[new Uint8Array(2),undefined])).toEqual(copy);
  expect(input).toEqual(copy);
 });
});

describe('making the compared pictures',()=>{
 const reply:GuiMaskReply={width:2,height:1,reliable:false,mask_available:true,scale:null,scaled_width:null,scaled_height:null,notes:[],pieces:[{piece:'InventoryPanel',count:1}]};
 // pixel 0: inventory panel (flagged screen), pixel 1: hotbar
 const packed=new Uint8Array([0x78,0x11]);
 const fakeIo=()=>{const encoded:Uint8ClampedArray[]=[];return {encoded,decode:vi.fn(async()=>({data:new Uint8ClampedArray([9,9,9,255,8,8,8,255]),width:2,height:1})),encode:vi.fn(async(data:Uint8ClampedArray)=>{encoded.push(new Uint8ClampedArray(data));return new Blob([data as BlobPart]);})};};
 const backend=(withMask=true)=>({frame:vi.fn(async()=>new ArrayBuffer(4)),...(withMask?{guiMaskFrame:vi.fn(async()=>({reply,packed}))}:{})}) as unknown as Backend;
 const run=(b:Backend,compare:ComparePost,io=fakeIo(),post:PostSettings=STARTING_POST,portal=vi.fn(async(image:{data:Uint8ClampedArray})=>({data:image.data,applied:true,valid:new Uint8Array(2),phase:0,opacity:.5})))=>
  comparisonPictures({backend:b,frames:[3,7,3],post,compare,veilOptions:{minShare:.5,margin:.2,slack:2},signal:new AbortController().signal,io,portal});

 it('unveil keeps only the open screen untouched; portal avoids every GUI pixel',async()=>{
  const process=vi.spyOn(frameProcessing,'processFrame').mockImplementation(async(_b,original,_m,_o,_io,portal)=>{await portal?.({data:new Uint8ClampedArray(8),width:2,height:1});return {blob:original,applied:true};});
  const portal=vi.fn(async(image:{data:Uint8ClampedArray},_signal?:AbortSignal,_world?:Uint8Array)=>({data:image.data,applied:true,valid:new Uint8Array(2),phase:0,opacity:.5}));
  const b=backend(),result=await run(b,on({veil:true,portal:true}),fakeIo(),STARTING_POST,portal);
  expect([...result.pictures.keys()]).toEqual([3,7]);
  expect(b.frame).toHaveBeenCalledTimes(2);
  const call=process.mock.calls[0];
  expect(call[2]).toBe('auto');
  expect(call[7]).toEqual({width:2,height:1});
  expect(call[8]).toEqual({width:2,height:1,world:new Uint8Array([0,1])});
  expect(portal.mock.calls[0][2]).toEqual(new Uint8Array([0,0]));
 });
 it('one full frame as the gallery shows it: auto unveil, or the plain frame when that fails',async()=>{
  const made=new Blob(['unveiled'],{type:'image/png'});
  const process=vi.spyOn(frameProcessing,'processFrame').mockImplementation(async()=>({blob:made,applied:true}));
  const b=backend(),veilOptions={minShare:.5,margin:.2,slack:2};
  expect(await boundaryPicture({backend:b,frame:5,veilOptions,io:fakeIo()})).toBe(made);
  expect(process.mock.calls[0][2]).toBe('auto');
  process.mockImplementation(async()=>{throw Error('wasm gone');});
  const plain=await boundaryPicture({backend:b,frame:5,veilOptions,io:fakeIo()});
  expect(plain).not.toBe(made);expect(plain.type).toBe('image/jpeg');expect(plain.size).toBe(4);
 });
 it('the full frame is the native (exact) picture, unveiled with the GUI mask fitted to it',async()=>{
  const process=vi.spyOn(frameProcessing,'processFrame').mockImplementation(async(_b,original)=>({blob:original,applied:false}));
  const exactFrame=vi.fn(async()=>new Uint8Array([0x89,0x50,0x4e,0x47,1,2]).buffer);
  const b={...backend(),exactFrame} as unknown as Backend,io={...fakeIo(),decode:vi.fn(async()=>({data:new Uint8ClampedArray(32),width:4,height:2}))};
  const plain=await boundaryPicture({backend:b,frame:5,veilOptions:{minShare:.5,margin:.2,slack:2},io});
  expect(exactFrame).toHaveBeenCalledWith(5);
  expect(b.frame).not.toHaveBeenCalled();
  expect([plain.type,plain.size]).toEqual(['image/png',6]);
  // the 2x1 GUI mask is fitted to the 4x2 native picture (same aspect)
  expect(process.mock.calls[0][8]).toMatchObject({width:4,height:2});
 });
 it('skips the GUI mask fetch when nothing needs it',async()=>{
  vi.spyOn(frameProcessing,'processFrame').mockImplementation(async(_b,original)=>({blob:original,applied:false,enhanced:true}));
  const b=backend();await run(b,on({enhance:true}),fakeIo(),{...STARTING_POST,veil:'on',portal:'off'});
  expect(b.guiMaskFrame).not.toHaveBeenCalled();
 });
 it('masks the open screen of either picture on both, after the corrections',async()=>{
  vi.spyOn(frameProcessing,'processFrame').mockImplementation(async(_b,original)=>({blob:original,applied:true}));
  const io=fakeIo(),result=await run(backend(),on({veil:true,gui:true}),io);
  expect(io.encoded).toHaveLength(2);
  for(const data of io.encoded)expect(Array.from(data)).toEqual([0,0,0,255,8,8,8,255]);
  expect(result.errors).toEqual([]);
 });
 it('without the desktop GUI mask the pictures are still made and the mask is reported missing',async()=>{
  vi.spyOn(frameProcessing,'processFrame').mockImplementation(async(_b,original)=>({blob:original,applied:true}));
  const io=fakeIo(),result=await run(backend(false),on({veil:true,gui:true}),io);
  expect(result.pictures.size).toBe(2);
  expect(io.encoded).toHaveLength(0);
  expect(result.errors.join(' ')).toMatch(/GUI mask/);
 });
 it('a failed stage is reported and the frame keeps what succeeded',async()=>{
  vi.spyOn(frameProcessing,'processFrame').mockImplementation(async(_b,original)=>({blob:original,applied:true,error:'Portal broke'}));
  const result=await run(backend(),on({veil:true}));
  expect(result.pictures.size).toBe(2);
  expect(result.errors[0]).toMatch(/Portal broke/);
 });
 it('a frame that cannot be read fails the comparison',async()=>{
  const b=backend();vi.mocked(b.frame).mockRejectedValue(Error('Decode failed'));
  await expect(run(b,on({veil:true}))).rejects.toThrow('Decode failed');
 });
});

import {unveilPreview} from './comparisonPost';
describe('auto unveil of a gallery preview',()=>{
 // a 4x2 display-frame mask: the left half of the top row is the open inventory, the right half the hotbar
 const reply:GuiMaskReply={width:4,height:2,reliable:false,mask_available:true,scale:null,scaled_width:null,scaled_height:null,notes:[],pieces:[{piece:'InventoryPanel',count:1}]};
 const mask=async()=>({reply,packed:new Uint8Array([0x78,0x78,0x11,0x11,0,0,0,0])});
 const io=()=>({decode:vi.fn(async()=>({data:new Uint8ClampedArray(8),width:2,height:1})),encode:vi.fn(async()=>new Blob(['x']))});
 const veil={minShare:.5,margin:.2,slack:2};
 const run=(m:typeof mask|undefined,i=io(),onScreen?:(s:unknown)=>void)=>unveilPreview({url:'data:preview',mask:m,veil,io:i,read:async()=>new ArrayBuffer(4),toUrl:async()=>'data:unveiled',onScreen});
 it('runs Auto with the open-screen mask and evidence fitted to the preview; the hotbar is not protected',async()=>{
  const process=vi.spyOn(frameProcessing,'processFrame').mockImplementation(async(_b,original)=>({blob:original,applied:true}));
  const screen=vi.fn();
  expect(await run(mask,io(),screen)).toBe('data:unveiled');
  expect(screen).toHaveBeenCalledWith({width:2,height:1,world:new Uint8Array([0,1])});
  const call=process.mock.calls[0];
  expect(call[2]).toBe('auto');
  expect(call[7]).toEqual({width:2,height:1});
  expect(call[8]).toEqual({width:2,height:1,world:new Uint8Array([0,1])});
 });
 it('keeps the preview as it is when nothing was unveiled',async()=>{
  vi.spyOn(frameProcessing,'processFrame').mockImplementation(async(_b,original)=>({blob:original,applied:false}));
  expect(await run(mask)).toBe('data:preview');
 });
 it('without a usable mask it still unveils by detection alone',async()=>{
  const process=vi.spyOn(frameProcessing,'processFrame').mockImplementation(async(_b,original)=>({blob:original,applied:true}));
  await run(undefined);
  await run(async()=>{throw Error('no mask');});
  await run(async()=>({reply:{...reply,width:3,height:3},packed:new Uint8Array(9)}));
  for(const call of process.mock.calls){expect(call[2]).toBe('auto');expect(call[7]).toBeUndefined();expect(call[8]).toBeUndefined();}
 });
});
