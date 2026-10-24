import { afterEach, expect, it, vi } from "vitest";
import { clipCompressedFire, encodeFireCycle, unpackFrames, qualityToCrf } from "./ffmpegCompression";
import { invoke } from "@tauri-apps/api/core";
import type { ManualQuad } from "./quadMask";

vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

function packedCycle() {
  const bytes=new Uint8Array(32*7);const view=new DataView(bytes.buffer);
  for(let row=0;row<32;row++){view.setUint32(row*7,3,true);bytes.set([row,2,3],row*7+4);}
  return bytes.buffer;
}

it("maps damage controls to actual H264 quantization strength",()=> {
  expect(qualityToCrf(0.8)).toBe(20);
  expect(qualityToCrf(0.45)).toBe(28);
  expect(qualityToCrf(0.15)).toBe(36);
  expect(qualityToCrf(0.05)).toBe(42);
});

function canvasMocks() {
  class ImageMock { onload:(()=>void)|null=null;set src(_src:string){queueMicrotask(()=>this.onload?.());} }
  vi.stubGlobal("Image",ImageMock);
  vi.stubGlobal("window",{__TAURI_INTERNALS__:{}});
  const operations:string[]=[];
  const ctx={fillStyle:"",globalCompositeOperation:"source-over",fillRect:vi.fn(),
    createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),
    getImageData:(_x:number,_y:number,w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4).fill(200)}),putImageData:vi.fn(),
    drawImage:vi.fn(function(this:{globalCompositeOperation:string}) {operations.push(this.globalCompositeOperation);})};
  const canvas={width:0,height:0,getContext:()=>ctx,toBlob:(cb:(blob:Blob)=>void)=>cb(new Blob(["png"],{type:"image/png"}))};
  vi.stubGlobal("document",{createElement:()=>canvas});
  vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:fire");vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
  return {ctx,canvas,operations};
}

it("encodes the full animation at delivery pixels on white, reusing the cycle for row changes",async()=> {
  const {ctx,canvas}=canvasMocks();
  vi.mocked(invoke).mockResolvedValue(packedCycle());
  const rgba=new Uint8ClampedArray(16*512*4).fill(255);
  const quad:ManualQuad=[[0.4,0.4],[0.42,0.4],[0.42,0.44],[0.4,0.44]];
  const cycle=await encodeFireCycle(rgba,quad,false,1920,1080,0.45,()=>false);
  expect([canvas.width,canvas.height]).toEqual([1920,1080]);
  expect(ctx.putImageData).toHaveBeenCalledTimes(32);
  expect(ctx.putImageData.mock.calls[0][0].data.slice(0,4)).toEqual(new Uint8ClampedArray([255,255,255,255]));
  expect(ctx.drawImage).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("compress_fire_cycle",expect.objectContaining({width:1920,height:1080,crf:28,frames:expect.arrayContaining([expect.any(Array)])}));
  expect((vi.mocked(invoke).mock.calls[0][1] as {frames:number[][]}).frames).toHaveLength(32);
  const again=await encodeFireCycle(rgba,quad,false,1920,1080,0.45,()=>false);
  expect(again).toBe(cycle);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("clips decoded pixels with sprite alpha, including transparent holes; backdrop never covers video",async()=> {
  const {ctx,operations}=canvasMocks();
  const quad:ManualQuad=[[0,0],[1,0],[1,1],[0,1]];
  const rgba=new Uint8ClampedArray(16*512*4).fill(255);
  const blob=await clipCompressedFire(new Uint8Array([1]),rgba,quad,4,true,1920,1080);
  expect(operations).toEqual(["source-over"]);
  expect(ctx.putImageData.mock.calls[0][0].data[3]).toBe(255);
  expect(ctx.fillRect).not.toHaveBeenCalled();
  expect(blob.type).toBe("image/png");
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});
it("reads exactly32 length-prefixed decoded frames",()=> {
  const bytes=new Uint8Array(32*7); const view=new DataView(bytes.buffer);
  for(let i=0;i<32;i++){view.setUint32(i*7,3,true);bytes.set([i,2,3],i*7+4);}
  const frames=unpackFrames(bytes.buffer);
  expect(frames.length).toBe(32);
  expect([...frames[31]]).toEqual([31,2,3]);
  expect(()=>unpackFrames(bytes.buffer.slice(0,-1))).toThrow();
  expect(()=>unpackFrames(new Uint8Array([...bytes,0]).buffer)).toThrow();
});

// ---- the same encode / clip for any fire raster (the 3D quad draws all its planes' texels)

import { clipCompressed, encodeCycle } from "./ffmpegCompression";

it("a generic cycle draws each of the 32 rows on white and encodes them once per key", async () => {
  canvasMocks();
  vi.mocked(invoke).mockResolvedValue(packedCycle());
  const raster = vi.fn((row: number, white: boolean) => new Uint8ClampedArray(64 * 36 * 4).fill(white ? 255 : row));
  const cycle = await encodeCycle("3d|a", raster, 64, 36, 0.8, () => false);
  expect(raster).toHaveBeenCalledTimes(32);
  expect(raster.mock.calls.map(c => c[0])).toEqual(Array.from({ length: 32 }, (_, r) => r));
  expect(raster.mock.calls.every(c => c[1] === true)).toBe(true);
  expect(invoke).toHaveBeenCalledWith("compress_fire_cycle", expect.objectContaining({ width: 64, height: 36, crf: 20 }));
  expect(await encodeCycle("3d|a", raster, 64, 36, 0.8, () => false)).toBe(cycle);
  expect(raster).toHaveBeenCalledTimes(32);
});
it("a generic clip keeps the codec's colours and the raster's own alpha", async () => {
  const { ctx } = canvasMocks();
  const alpha = new Uint8ClampedArray(2 * 1 * 4); alpha[3] = 255; alpha[7] = 0;
  const blob = await clipCompressed(new Uint8Array([1]), alpha, 2, 1);
  const data = ctx.putImageData.mock.calls[0][0].data;
  expect([data[3], data[7]]).toEqual([255, 0]);
  expect(blob.type).toBe("image/png");
});
