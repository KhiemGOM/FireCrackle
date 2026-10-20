import {expect,it,vi} from 'vitest';
import {GuiThumbnailCache,guiThumbnails,clearGuiThumbnails} from './guiThumbnailCache';
import type {Backend} from './api';
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
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
