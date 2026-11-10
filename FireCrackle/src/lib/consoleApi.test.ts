import {beforeEach,expect,it,vi} from 'vitest';
import {createConsoleApi,installConsoleApi,type ConsoleContext} from './consoleApi';
import type {Backend} from './api';
import {DEFAULT_POST} from './post/settings';
import {DEFAULT_VEIL_OPTIONS} from './veil';

const backend={} as Backend;
const context:ConsoleContext={backend,fps:60,frameCount:839409,source:'yt-LNsxw4VRTgQ.mkv',post:DEFAULT_POST,veil:DEFAULT_VEIL_OPTIONS};
function deps(){
 const before=new Blob(['b']),after=new Blob(['a']);
 return {
  pictures:vi.fn(async({frames}:{frames:number[]})=>({pictures:new Map([[frames[0],before],[frames[1],after]]),errors:[] as string[]})),
  exportProof:vi.fn(async()=>true),
  before,after,
 };
}
beforeEach(()=>vi.unstubAllGlobals());

it('a proof of two frames uses the comparison pictures with Auto unveil and saves the blink to the given path',async()=>{
 const d=deps(),api=createConsoleApi(()=>context,d);
 const made=await api.proof({first:17116,last:17117,path:'D:/out/open.gif'});
 expect(d.pictures).toHaveBeenCalledTimes(1);
 const call=(d.pictures.mock.calls[0] as unknown[])[0] as {frames:number[];compare:{veil:boolean;portal:boolean;enhance:boolean;blink:boolean};backend:Backend;veilOptions:unknown};
 expect(call.frames).toEqual([17116,17117]);
 expect(call.compare).toEqual({veil:true,portal:false,enhance:false,blink:true});
 expect(call.backend).toBe(backend);expect(call.veilOptions).toBe(DEFAULT_VEIL_OPTIONS);
 expect(d.exportProof).toHaveBeenCalledWith(backend,{before:17116,after:17117,first:17116,last:17117,fps:60,source:'yt-LNsxw4VRTgQ.mkv',effects:'Unveil'},
  {format:'gif',destination:'save',path:'D:/out/open.gif'},{before:d.before,after:d.after});
 expect(made).toEqual({path:'D:/out/open.gif',before:17116,after:17117,effects:'Unveil',errors:[]});
});
it('unveil off saves the original frames: no post pictures, no effects line',async()=>{
 const d=deps(),api=createConsoleApi(()=>context,d);
 await api.proof({first:100,last:200,path:'D:/p.webp',format:'webp',unveil:false});
 expect(d.pictures).not.toHaveBeenCalled();
 expect(d.exportProof).toHaveBeenCalledWith(backend,{before:100,after:200,first:100,last:200,fps:60,source:'yt-LNsxw4VRTgQ.mkv'},{format:'webp',destination:'save',path:'D:/p.webp'},undefined);
});
it('frames are put in order and kept inside the video, like the Misc comparison',async()=>{
 const d=deps(),api=createConsoleApi(()=>({...context,frameCount:1000}),d);
 await api.proof({first:1200,last:990,path:'D:/p.gif'});
 expect(((d.pictures.mock.calls[0] as unknown[])[0] as {frames:number[]}).frames).toEqual([990,999]);
});
it('GUI pairs use the app pairing: open, close and around the GUI frames',async()=>{
 const d=deps(),api=createConsoleApi(()=>context,d);
 const frames=async(pair:'open'|'close'|'around')=>{d.pictures.mockClear();await api.guiProof({first:17117,last:17163,pair,path:'D:/g.gif'});return ((d.pictures.mock.calls[0] as unknown[])[0] as {frames:number[]}).frames;};
 expect(await frames('open')).toEqual([17116,17117]);
 expect(await frames('close')).toEqual([17163,17164]);
 expect(await frames('around')).toEqual([17116,17164]);
});
it('bad requests reject before any picture work or file write',async()=>{
 const d=deps(),api=createConsoleApi(()=>context,d);
 await expect(api.proof({first:1,last:2} as never)).rejects.toThrow('path');
 await expect(api.proof({first:1.5,last:2,path:'D:/p.gif'})).rejects.toThrow('whole frame');
 await expect(api.proof({first:1,last:2,path:'D:/p.gif',format:'mp4' as never})).rejects.toThrow('format');
 await expect(api.guiProof({first:5,last:9,pair:'middle' as never,path:'D:/p.gif'})).rejects.toThrow('pair');
 await expect(createConsoleApi(()=>null,d).proof({first:1,last:2,path:'D:/p.gif'})).rejects.toThrow('Open a video');
 expect(d.pictures).not.toHaveBeenCalled();expect(d.exportProof).not.toHaveBeenCalled();
});
it('a picture that failed is never replaced by the original frame: no file, the errors are reported',async()=>{
 const d=deps();d.pictures.mockResolvedValue({pictures:new Map([[10,new Blob(['b'])]]),errors:['Frame 20: decode failed']});
 await expect(createConsoleApi(()=>context,d).proof({first:10,last:20,path:'D:/p.gif'})).rejects.toThrow('Frame 20: decode failed');
 expect(d.exportProof).not.toHaveBeenCalled();
});
it('stage errors that still made both pictures are passed back with the saved proof',async()=>{
 const d=deps(),errs=['GUI mask of frame 10: no fit'];
 d.pictures.mockImplementation(async({frames})=>({pictures:new Map([[frames[0],d.before],[frames[1],d.after]]),errors:errs}));
 expect((await createConsoleApi(()=>context,d).proof({first:10,last:20,path:'D:/p.gif'})).errors).toEqual(errs);
});
it('install puts the API on window.firecrackle with a help text',()=>{
 const target={} as {firecrackle?:unknown};
 installConsoleApi(()=>context,target);
 const api=target.firecrackle as {proof:unknown;guiProof:unknown;help:()=>string};
 expect(typeof api.proof).toBe('function');expect(typeof api.guiProof).toBe('function');
 expect(api.help()).toContain('guiProof');
});
