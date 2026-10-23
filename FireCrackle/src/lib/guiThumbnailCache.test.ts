import {expect,it,vi} from 'vitest';
import {GuiThumbnailCache,guiThumbnails,clearGuiThumbnails,unveiledPreviews,previewFrames,previewScreen} from './guiThumbnailCache';
import * as comparisonPost from './comparisonPost';
import type {Backend} from './api';
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
it('uses the small native JPEG directly without decoding a full-size frame',async()=>{
  class Reader{result='data:image/jpeg;base64,small';onload:(()=>void)|null=null;readAsDataURL(){this.onload?.();}}
  vi.stubGlobal('FileReader',Reader);
  try{
    const frame=vi.fn(),previewThumbnail=vi.fn(async()=>new ArrayBuffer(4));
    const backend={frame,previewThumbnail} as unknown as Backend,cache=guiThumbnails(backend,'small',100);
    expect(await cache.get(7)).toBe('data:image/jpeg;base64,small');
    expect(await cache.get(7)).toBe('data:image/jpeg;base64,small');
    expect(frame).not.toHaveBeenCalled();expect(previewThumbnail).toHaveBeenCalledTimes(1);
  }finally{vi.unstubAllGlobals();}
});
it('shares only the current video cache and invalidates same-path reopened videos',()=>{
  const backend={} as Backend,first=guiThumbnails(backend,'a',100);
  expect(guiThumbnails(backend,'a',100)).toBe(first);
  expect(guiThumbnails(backend,'b',100)).not.toBe(first);
  const second=guiThumbnails(backend,'b',100);clearGuiThumbnails(backend);
  expect(guiThumbnails(backend,'b',100)).not.toBe(second);
  expect(guiThumbnails(backend,'b',101)).not.toBe(second);
});
it('reuses small images across consumers and deduplicates in-flight frames',async()=>{
  const load=vi.fn(async n=>`jpeg${n}`),cache=new GuiThumbnailCache(load);
  const a=cache.get(9),b=cache.get(9);expect(a).toBe(b);
  expect(await a).toBe('jpeg9');await tick();
  expect(await cache.get(9)).toBe('jpeg9');expect(load).toHaveBeenCalledTimes(1);
});
it('bounds cached images by LRU count and byte budget',async()=>{
  const load=vi.fn(async n=>String(n)),cache=new GuiThumbnailCache(load,2,8);
  await cache.get(1);await cache.get(2);await cache.get(1);await cache.get(3);await tick();
  await cache.get(1);expect(load).toHaveBeenCalledTimes(3);
  await cache.get(2);expect(load).toHaveBeenCalledTimes(4);
  const oversized=new GuiThumbnailCache(load,4,1);
  await oversized.get(7);await tick();await oversized.get(7);expect(load).toHaveBeenCalledTimes(6);
});
it('limits concurrent work and skips queued previews scrolled out of view',async()=>{
  const finish:Array<(value:string)=>void>=[],load=vi.fn(()=>new Promise<string>(resolve=>finish.push(resolve)));
  const cache=new GuiThumbnailCache(load,10,1000,2);
  const a=cache.get(1),b=cache.get(2),skipped=cache.get(3,()=>false).catch(()=>null),d=cache.get(4);
  await tick();expect(load).toHaveBeenCalledTimes(2);
  finish[0]('a');await a;await tick();expect(load).toHaveBeenCalledTimes(3);expect(await skipped).toBeNull();
  finish[1]('b');finish[2]('d');await Promise.all([b,d]);
});
it('does not cancel a shared queued frame still wanted by another row',async()=>{
  let release!:(value:string)=>void;
  const load=vi.fn(n=>n===1?new Promise<string>(resolve=>{release=resolve;}):Promise.resolve('shared'));
  const cache=new GuiThumbnailCache(load,10,1000,1),first=cache.get(1);
  const cancelled=cache.get(2,()=>false),visible=cache.get(2,()=>true);
  await tick();release('one');await first;expect(await visible).toBe('shared');expect(await cancelled).toBe('shared');
  expect(load).toHaveBeenCalledTimes(2);
});
it('retries failed requests and never caches stale work after a video reset',async()=>{
  const load=vi.fn().mockRejectedValueOnce(Error('decode failed')).mockResolvedValue('ok');
  const cache=new GuiThumbnailCache(load);
  await expect(cache.get(1)).rejects.toThrow('decode failed');await tick();expect(await cache.get(1)).toBe('ok');
  let finish!:(value:string)=>void;
  const pendingLoad=vi.fn(()=>new Promise<string>(resolve=>{finish=resolve;})),other=new GuiThumbnailCache(pendingLoad);
  const old=other.get(1);await tick();other.clear();finish('old');await old;await tick();
  const fresh=other.get(1);await tick();expect(pendingLoad).toHaveBeenCalledTimes(2);finish('fresh');expect(await fresh).toBe('fresh');
});
it('loads visible cards ahead of queued ranking work and promotes a shared request',async()=>{
  const finish:Array<(image:string)=>void>=[],order:number[]=[];
  const cache=new GuiThumbnailCache(n=>{order.push(n);return new Promise(resolve=>finish.push(resolve));},20,10000,1);
  const active=cache.get(1,()=>true,'background');
  const background=cache.get(2,()=>true,'background');
  const promoted=cache.get(3,()=>true,'background');
  expect(cache.get(3,()=>true)).toBe(promoted);
  const visible=cache.get(4);
  await tick();finish[0]('first');await active;await tick();expect(order).toEqual([1,3]);
  finish[1]('third');await promoted;await tick();expect(order).toEqual([1,3,4]);
  finish[2]('fourth');await visible;await tick();expect(order).toEqual([1,3,4,2]);
  finish[3]('second');await background;
});
it('demotes an offscreen card that is still needed by background ranking',async()=>{
  const finish:Array<(image:string)=>void>=[],order:number[]=[];let showing=true;
  const cache=new GuiThumbnailCache(n=>{order.push(n);return new Promise(resolve=>finish.push(resolve));},20,10000,1);
  const active=cache.get(1),offscreen=cache.get(2,()=>showing);cache.get(2,()=>true,'background');
  const visible=cache.get(3);showing=false;
  await tick();finish[0]('first');await active;await tick();expect(order).toEqual([1,3]);
  finish[1]('visible');await visible;await tick();expect(order).toEqual([1,3,2]);
  finish[2]('ranked');await offscreen;
});
it('passes only nearby targets to the loader and reuses their cached images',async()=>{
  const load=vi.fn(async n=>`jpeg${n}`),cache=new GuiThumbnailCache(load);
  cache.setTargets([1,20,239,240,300]);
  await cache.get(20);expect(load).toHaveBeenCalledWith(20,[1,20,239]);
  await cache.get(20);expect(load).toHaveBeenCalledTimes(1);
});

it('auto-unveiled previews are one cache per veil setting, built on the raw previews and cleared with them',async()=>{
  const veil={minShare:.5,margin:.2,slack:2},backend={} as Backend;
  guiThumbnails(backend,'v',100);
  const unveiled=unveiledPreviews(backend,veil);
  expect(unveiledPreviews(backend,{...veil})).toBe(unveiled);
  expect(unveiledPreviews(backend,{...veil,slack:3})).not.toBe(unveiled);
  vi.spyOn(previewFrames(backend,512),'get').mockResolvedValue('data:raw');
  const screen={width:2,height:1,world:new Uint8Array([0,1])};
  const unveil=vi.spyOn(comparisonPost,'unveilPreview').mockImplementation(async options=>{options.onScreen?.(screen);return 'data:clear';});
  expect(await unveiled.get(4)).toBe('data:clear');
  expect(previewScreen(unveiled,4)).toEqual(screen);
  expect(previewScreen(unveiled,5)).toBeUndefined();
  expect(unveil.mock.calls[0][0]).toMatchObject({url:'data:raw',veil});
  guiThumbnails(backend,'other',100);
  expect(unveiledPreviews(backend,veil)).not.toBe(unveiled);
  vi.restoreAllMocks();
});
