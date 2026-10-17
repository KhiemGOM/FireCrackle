import {expect,it} from "vitest";
import {FrameBuffer,type BufferIo} from "./frameBuffer";
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function rig(){
  const pending=new Map<number,(b:ArrayBuffer)=>void>();let active=0,peak=0;
  const io:BufferIo={fetch:frame=>new Promise(resolve=>{active++;peak=Math.max(peak,active);pending.set(frame,b=>{active--;pending.delete(frame);resolve(b);});}),createUrl:()=>"blob",revokeUrl:()=>{},predecode:async()=>{}};
  return {buffer:new FrameBuffer(10000,io,{ahead:0,behind:0,decodeAhead:0,parallel:2}),pending,peak:()=>peak,done:async(f:number,bytes=1)=>{pending.get(f)!(new ArrayBuffer(bytes));await tick();}};
}
it("direct loads share the same hard concurrency limit as speculative fetches",async()=>{
  const r=rig();const a=r.buffer.load(1),b=r.buffer.load(2),c=r.buffer.load(3);
  const peak=r.peak();
  for(const n of [1,2,3])await r.done(n);
  await Promise.all([a,b,c]);r.buffer.dispose();expect(peak).toBeLessThanOrEqual(2);
});
it("cancelled queued seeks never reach the backend or pin stale bytes",async()=>{
  const r=rig();const a=r.buffer.load(1),b=r.buffer.load(2);
  const controller=new AbortController();
  const stale=r.buffer.load(5000,controller.signal).catch(()=>null);controller.abort();
  await r.done(1);await r.done(2);await Promise.all([a,b]);await stale;
  expect(r.pending.has(5000)).toBe(false);expect(r.buffer.has(5000)).toBe(false);r.buffer.dispose();
});
it("aborting a fetch already in flight discards its out-of-window result",async()=>{
  const r=rig();const controller=new AbortController();
  const stale=r.buffer.load(5000,controller.signal).catch(()=>null);controller.abort();
  await r.done(5000);await stale;
  expect(r.buffer.has(5000)).toBe(false);r.buffer.dispose();
});
it("encoded cache stays within 64 MiB even when many direct loads succeed",async()=>{
  const r=rig();
  for(let f=1;f<12;f++){const p=r.buffer.load(f);await r.done(f,8*1024*1024);await p;}
  expect(Array.from({length:12},(_,i)=>i).filter(f=>r.buffer.has(f)).length).toBeLessThanOrEqual(8);
  r.buffer.dispose();
});
it("a burst of cancelled seeks leaves only active work and the latest seek",async()=>{
  const r=rig();const first=r.buffer.load(1),second=r.buffer.load(2);
  let previous:AbortController|undefined;const waits:Promise<unknown>[]=[];
  for(let f=100;f<200;f++){previous?.abort();previous=new AbortController();waits.push(r.buffer.load(f,previous.signal).catch(()=>null));}
  await r.done(1);await r.done(2);await r.done(199);await Promise.all([first,second,...waits]);
  expect(r.pending.size).toBe(0);expect(r.peak()).toBeLessThanOrEqual(2);r.buffer.dispose();
});
it("speculative filling stops at its byte budget instead of refetching evicted frames",async()=>{
  let count=0;const pending=new Map<number,(b:ArrayBuffer)=>void>();
  const buffer=new FrameBuffer(10000,{fetch:f=>{count++;return new Promise(resolve=>pending.set(f,resolve));},createUrl:()=>"blob",revokeUrl:()=>{},predecode:async()=>{}},{ahead:1000,behind:0,decodeAhead:0,parallel:2},false);
  buffer.prefetch(0,{dir:1,speed:1});
  for(let i=0;i<30&&pending.size;i++){const [f,done]=pending.entries().next().value!;pending.delete(f);done(new ArrayBuffer(8*1024*1024));await tick();}
  expect(count).toBeLessThanOrEqual(8);expect(pending.size).toBe(0);buffer.dispose();
});
it("predecode concurrency is bounded even when fetches finish much faster",async()=>{
  const pending:Array<()=>void>=[];let active=0,peak=0;
  const buffer=new FrameBuffer(100,{fetch:async()=>new ArrayBuffer(1),createUrl:()=>"blob",revokeUrl:()=>{},predecode:()=>new Promise(resolve=>{active++;peak=Math.max(peak,active);pending.push(()=>{active--;resolve();});})},{ahead:20,behind:0,decodeAhead:8,parallel:8},false);
  buffer.prefetch(0,{dir:1,speed:1});await tick();expect(peak).toBeLessThanOrEqual(2);
  buffer.dispose();for(const done of pending)done();await tick();
});
