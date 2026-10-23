import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({invoke:vi.fn(),save:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
vi.mock('@tauri-apps/plugin-dialog',()=>({save:native.save}));
import {frameDifference,renderFrameProof,exportFrameProof} from './frameComparison';
import type {Backend} from './api';
beforeEach(()=>{vi.clearAllMocks();});afterEach(()=>vi.unstubAllGlobals());
it('shows exact RGB change, keeps unchanged pixels black and clamps amplification',()=>{
 expect([...frameDifference(new Uint8ClampedArray([10,90,250,0,20,20,20,255]),new Uint8ClampedArray([12,20,100,255,20,20,20,255]),3)])
  .toEqual([6,210,255,255,0,0,0,255]);
 expect(()=>frameDifference(new Uint8ClampedArray(4),new Uint8ClampedArray(8))).toThrow('dimensions');
 expect(()=>frameDifference(new Uint8ClampedArray(4),new Uint8ClampedArray(4),NaN)).toThrow('brightness');
});
const proof={before:120,after:180,first:120,last:180,fps:60,source:'recording.mkv'};
function fixture(){
 const draws=vi.fn(),text=vi.fn(),snapshots:number[]=[];
 const canvas={width:0,height:0,getContext:()=>({drawImage:draws,fillText:text,fillRect:vi.fn()}),toBlob:(done:(b:Blob)=>void,type:string)=>{snapshots.push(draws.mock.calls.length);done(new Blob([String(draws.mock.calls.length)],{type}));}};
 vi.stubGlobal('document',{createElement:()=>canvas});
 vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});
 vi.stubGlobal('Image',class {naturalWidth=1920;naturalHeight=1080;onload?:()=>void;set src(_:string){this.onload?.();}});
 const createObjectURL=vi.fn(()=> 'blob:frame'),revokeObjectURL=vi.fn();vi.stubGlobal('URL',{createObjectURL,revokeObjectURL});
 native.save.mockResolvedValue('D:/proof.webp');native.invoke.mockResolvedValue(undefined);
 return {canvas,draws,text,snapshots,revokeObjectURL};
}
it('renders a single animated view from two different frames with full interval annotations',async()=>{
 const {draws,text,snapshots}=fixture();const before={naturalWidth:1920,naturalHeight:1080} as HTMLImageElement,after={...before} as HTMLImageElement;
 const output=await renderFrameProof(before,after,proof,true);
 expect(output.base).toBeDefined();expect(snapshots).toEqual([1,2]);expect(draws.mock.calls[0][0]).toBe(before);expect(draws.mock.calls[1][0]).toBe(after);
 expect(draws.mock.calls[0].slice(1)).toEqual(draws.mock.calls[1].slice(1));
 const lines=text.mock.calls.map(c=>c[0]).join('\n');expect(lines).toContain('Frame 120');expect(lines).toContain('Frame 180');expect(lines).toContain('Interval 120–180');expect(lines).toContain('recording.mkv');
});
it('still proof contains both source frames side by side',async()=>{
 const {draws}=fixture();const image={naturalWidth:1920,naturalHeight:1080} as HTMLImageElement;
 expect((await renderFrameProof(image,image,proof,false)).base).toBeUndefined();expect(draws).toHaveBeenCalledTimes(2);expect(draws.mock.calls[1][1]).toBeGreaterThan(draws.mock.calls[0][1]);
});
it('requests the exact inclusive endpoint frames and copies a direct-switch WebP without save dialog',async()=>{
 const {revokeObjectURL}=fixture(),frame=vi.fn(async()=>new ArrayBuffer(4));
 expect(await exportFrameProof({frame} as unknown as Backend,proof,{format:'webp',destination:'copy'})).toBe(true);
 expect(frame.mock.calls).toEqual([[120],[180]]);expect(native.save).not.toHaveBeenCalled();expect(revokeObjectURL).toHaveBeenCalledTimes(2);
 expect(native.invoke).toHaveBeenCalledWith('copy_formatted_comparison_proof',{format:'webp',png:[50],base:[49],transition:'blink'});
});
it('cancelled saving produces no success or file write',async()=>{
 fixture();native.save.mockResolvedValue(null);
 expect(await exportFrameProof({frame:vi.fn(async()=>new ArrayBuffer(4))} as unknown as Backend,proof,{format:'gif',destination:'save'})).toBe(false);
 expect(native.invoke).not.toHaveBeenCalled();
});
it('a decoder failure cannot create a proof from an unrelated or stale picture',async()=>{
 fixture();await expect(exportFrameProof({frame:vi.fn(async()=>{throw Error('Decode failed');})} as unknown as Backend,proof,{format:'webp',destination:'copy'})).rejects.toThrow('Decode failed');expect(native.invoke).not.toHaveBeenCalled();
});
it('a proof of post-processed frames uses those pictures and names the effects',async()=>{
 const {text}=fixture(),frame=vi.fn(async()=>new ArrayBuffer(4));
 const pictures={before:new Blob(['b']),after:new Blob(['a'])};
 expect(await exportFrameProof({frame} as unknown as Backend,{...proof,effects:'Unveil · GUI masked'},{format:'webp',destination:'copy'},pictures)).toBe(true);
 expect(frame).not.toHaveBeenCalled();
 const lines=text.mock.calls.map(c=>c[0]).join('\n');
 expect(lines).toContain('Unveil · GUI masked');expect(lines).not.toContain('original video frames');
});
