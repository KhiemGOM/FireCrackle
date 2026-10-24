import { expect, it } from "vitest";
import { rasterizeFire, restoreFireAlpha } from "./quadRaster";
import type { ManualQuad } from "./quadMask";

function solidSheet() {
  const rgba=new Uint8ClampedArray(16*512*4);
  for(let i=0;i<rgba.length;i+=4)rgba.set([180,80,10,255],i);
  return rgba;
}

it("has no pale seams at ANY internal texel boundary of a skewed opaque quad",()=> {
  const q:ManualQuad=[[0.13,0.29],[0.72,0.12],[0.92,0.73],[0.33,0.91]];
  const width=259,height=167,data=rasterizeFire(solidSheet(),9,true,q,width,height,true);
  let insideCount=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const p=[(x+0.5)/width,(y+0.5)/height];
    const inside=q.every((a,i)=> {const b=q[(i+1)%4];return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])>0;});
    const pixel=[...data.slice((y*width+x)*4,(y*width+x)*4+4)];
    expect(pixel).toEqual(inside?[180,80,10,255]:[255,255,255,255]);
    if(inside)insideCount++;
  }
  expect(insideCount).toBeGreaterThan(10000);
});

it("samples the selected animation row and mirror direction without neighbour interpolation",()=> {
  const sheet=new Uint8ClampedArray(16*512*4);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++)sheet.set([x,7,y,255],((7*16+y)*16+x)*4);
  const full:ManualQuad=[[0,0],[1,0],[1,1],[0,1]];
  const plain=rasterizeFire(sheet,7,false,full,32,16);
  const mirrored=rasterizeFire(sheet,7,true,full,32,16);
  expect([...plain.slice(0,4)]).toEqual([0,7,0,255]);
  expect([...plain.slice(31*4,32*4)]).toEqual([15,7,0,255]);
  expect([...mirrored.slice(0,4)]).toEqual([15,7,0,255]);
  expect([...mirrored.slice(-4)]).toEqual([0,7,15,255]);
});

it("clips off-frame geometry without shrinking or remapping the visible sprite",()=> {
  const sheet=solidSheet();
  for(let y=0;y<16;y++)for(let x=0;x<16;x++)sheet[((y*16+x)*4)]=x;
  const q:ManualQuad=[[-1,0],[1,0],[1,1],[-1,1]];
  const data=rasterizeFire(sheet,0,false,q,8,16);
  expect(data[0]).toBe(8);
  expect(data[7*4]).toBe(15);
});

it("restores fire alpha including holes without punching cracks between opaque texels",()=> {
  const sheet=solidSheet();sheet[(8*16+8)*4+3]=0;
  const q:ManualQuad=[[0,0],[1,0],[1,1],[0,1]];
  const mask=rasterizeFire(sheet,0,false,q,32,32);
  const decoded=new Uint8ClampedArray(32*32*4).fill(200);
  restoreFireAlpha(decoded,mask);
  expect(decoded[(16*32+16)*4+3]).toBe(0);
  expect(decoded[(15*32+15)*4+3]).toBe(255);
  expect(decoded[0]).toBe(200);
  expect([...decoded].filter((_,i)=>i%4===3&&decoded[i]===0)).toHaveLength(4);
});

// ---- texels of several planes (the 3D quad: lib/fireTool.ts fireTexels, already far to near) into one raster

import { rasterizeTexels } from "./quadRaster";

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const at = (data: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

it("fills each texel's pixels with its colour and leaves the rest as the backdrop", () => {
  const out = rasterizeTexels([{ points: square(0.25, 0.25, 0.75, 0.75), colour: "rgb(200, 100, 10)", alpha: 1 }], 8, 8);
  expect(at(out, 8, 3, 3)).toEqual([200, 100, 10, 255]);
  expect(at(out, 8, 0, 0)).toEqual([0, 0, 0, 0]);
  expect(at(out, 8, 6, 6)).toEqual([0, 0, 0, 0]);
});
it("later texels cover earlier ones (they come far to near), skewed quads included", () => {
  const out = rasterizeTexels([
    { points: square(0, 0, 1, 1), colour: "rgb(10, 10, 10)", alpha: 1 },
    { points: [[0.5, 0.1], [0.9, 0.5], [0.5, 0.9], [0.1, 0.5]], colour: "rgb(250, 200, 0)", alpha: 1 },
  ], 10, 10);
  expect(at(out, 10, 5, 5)).toEqual([250, 200, 0, 255]);
  expect(at(out, 10, 0, 0)).toEqual([10, 10, 10, 255]);
});
it("on white the colour is blended over white; transparent texels leave the backdrop", () => {
  const out = rasterizeTexels([{ points: square(0, 0, 1, 1), colour: "rgb(0, 0, 0)", alpha: 0.5 }, { points: square(0, 0, 0.5, 1), colour: "rgb(9, 9, 9)", alpha: 0 }], 4, 4, true);
  expect(at(out, 4, 3, 1)).toEqual([128, 128, 128, 255]);
  expect(at(out, 4, 0, 1)).toEqual([128, 128, 128, 255]);
});
it("texels partly outside the picture are clipped; a bad size is an error", () => {
  const out = rasterizeTexels([{ points: square(-0.5, -0.5, 0.5, 0.5), colour: "rgb(1, 2, 3)", alpha: 1 }], 4, 4);
  expect(at(out, 4, 0, 0)).toEqual([1, 2, 3, 255]);
  expect(at(out, 4, 3, 3)).toEqual([0, 0, 0, 0]);
  expect(() => rasterizeTexels([], 0, 4)).toThrow();
  expect(() => rasterizeTexels([], 5000, 4)).toThrow();
});
