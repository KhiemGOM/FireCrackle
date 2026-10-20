import {expect,it} from "vitest";
import {refineQuad} from "./quadEcc";
import {eccHomography} from "./ecc";
import {validQuad,type ManualQuad} from "./quadMask";

it("abstains on constant/unsupported evidence without moving a selected sprite",()=>{
  const q:ManualQuad=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]],image={width:160,height:100,data:new Uint8ClampedArray(160*100*4)},sheets=[new Uint8ClampedArray(32768),new Uint8ClampedArray(32768)] as [Uint8ClampedArray,Uint8ClampedArray];
  const answer=refineQuad(image,sheets,q,{sheet:1,row:12,mirrored:false});
  expect(answer).toEqual({quad:q,changed:false,gain:0});expect(answer.quad).toBe(q);
});
it("rejects malformed or unreadable quads before alignment",()=>{
  const image={width:100,height:100,data:new Uint8ClampedArray(40000)},sheets=[new Uint8ClampedArray(32768),new Uint8ClampedArray(32768)] as [Uint8ClampedArray,Uint8ClampedArray];
  for(const q of [[[.1,.1],[.11,.1],[.11,.11],[.1,.11]],[[0,0],[1,1],[1,0],[0,1]]] as ManualQuad[]){expect(refineQuad(image,sheets,q,{sheet:0,row:0,mirrored:true}).changed).toBe(false);}
});
it("has a finite identity solution for nonconstant identical masked images",()=>{
  const image=new Float32Array(128*128),mask=new Uint8Array(image.length).fill(1);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++)image[y*128+x]=(Math.sin(x*.13)+Math.cos(y*.19)+Math.sin((x+y)*.07))*.12+.5;
  const warp=eccHomography(image,image,mask,mask);expect(warp).not.toBeNull();
  expect(Array.from(warp!)).toEqual(expect.arrayContaining([expect.any(Number)]));
  for(let i=0;i<9;i++)expect(warp![i]).toBeCloseTo([1,0,0,0,1,0,0,0,1][i],3);
  expect(validQuad([[0,0],[1,0],[1,1],[0,1]])).toBe(true);
});
