import {afterEach,describe,expect,it,vi} from 'vitest';
import * as frameProcessing from './veilFrame';
import {DEFAULT_POST,STARTING_POST,type PostSettings} from './post/settings';
import {BOUNDARY_POST,NO_COMPARE_POST,comparesProcessed,comparisonPictures,comparisonSettings,maskScreens,type ComparePost} from './comparisonPost';
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
 it('boundary comparisons unveil and then mask the open screen',()=>{expect(BOUNDARY_POST).toMatchObject({veil:true,gui:true});});
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
