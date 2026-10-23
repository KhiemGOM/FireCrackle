import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Backend} from './api';
import {displayFrame} from './imagePreview';

const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
let made:Blob[]=[];
beforeEach(()=>{made=[];vi.stubGlobal('URL',{createObjectURL:(b:Blob)=>{made.push(b);return `blob:${made.length}`;},revokeObjectURL:vi.fn()});});
afterEach(()=>vi.unstubAllGlobals());
const jpeg=new Uint8Array([0xff,0xd8,1]).buffer,png=new Uint8Array([0x89,0x50,0x4e,0x47,1,2]).buffer;

it('shows the display frame, then the exact native frame; only the native one is full detail',async()=>{
  const shown:[string,boolean][]=[];
  const backend={frame:vi.fn(async()=>jpeg),exactFrame:vi.fn(async()=>png)} as unknown as Backend;
  displayFrame(backend,7,(url,full)=>shown.push([url,full]),()=>{});
  await flush();
  expect(backend.exactFrame).toHaveBeenCalledWith(7);
  expect(shown).toEqual([['blob:1',false],['blob:2',true]]);
  expect(made[1].type).toBe('image/png');
});
it('without exact frames the display frame is the full detail',async()=>{
  const shown:[string,boolean][]=[];
  displayFrame({frame:vi.fn(async()=>jpeg)} as unknown as Backend,7,(url,full)=>shown.push([url,full]),()=>{});
  await flush();
  expect(shown).toEqual([['blob:1',true]]);
});
it('a failed native decode keeps the display frame as the full detail, not an error',async()=>{
  const shown:[string,boolean][]=[],fail=vi.fn();
  const backend={frame:vi.fn(async()=>jpeg),exactFrame:vi.fn(async()=>{throw Error('decode failed');})} as unknown as Backend;
  displayFrame(backend,7,(url,full)=>shown.push([url,full]),fail);
  await flush();
  expect(shown).toEqual([['blob:1',false],['blob:1',true]]);
  expect(fail).not.toHaveBeenCalled();
});
it('a cancelled frame shows nothing more and releases its pictures',async()=>{
  const shown:[string,boolean][]=[];
  const backend={frame:vi.fn(async()=>jpeg),exactFrame:vi.fn(async()=>png)} as unknown as Backend;
  const stop=displayFrame(backend,7,(url,full)=>shown.push([url,full]),()=>{});
  stop();await flush();
  expect(shown).toEqual([]);
});
