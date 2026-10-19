import {expect,it} from "vitest";
import {phasePixels,readablePhaseQuad,fuseQuadPhases} from "./quadPhase";
import type {QuadCandidate,QuadMatch} from "./quadMatch";
import type {ManualQuad} from "./quadMask";
const q:ManualQuad=[[0,0],[1,0],[1,1],[0,1]];
it("uses native128px pixel-centre rectification without enlarging a64px crop",()=>{
  const data=new Uint8ClampedArray(128*128*4);for(let i=0;i<128*128;i++)data.set([i%256,(i*3)%256,(i*7)%256,255],i*4);
  const p=phasePixels({width:128,height:128,data},q);
  for(let i=0;i<128*128;i++)expect(Array.from(p.subarray(i*3,i*3+3))).toEqual(Array.from(data.subarray(i*4,i*4+3)));
});
it("rejects small, squashed and clipped model inputs using geometry only",()=>{
  expect(readablePhaseQuad(q,128,128)).toBe(true);
  expect(readablePhaseQuad(q,32,32)).toBe(false);
  expect(readablePhaseQuad(q,200,48)).toBe(false);
  expect(readablePhaseQuad([[-.01,0],[1,0],[1,1],[0,1]],128,128)).toBe(false);
});
function result():QuadMatch {
  const candidates:QuadCandidate[]=[];
  for(let row=0;row<32;row++)for(const sheet of [0,1] as const)candidates.push({row,sheet,mirrored:false,quad:q,score:row===8?.8:.1});
  return {status:"ambiguous",candidates:candidates.slice(0,5),margin:0,searched:128,phaseCandidates:candidates,allCandidates:candidates};
}
it("fuses probabilities into three distinct phases and keeps best appearance/quad",()=>{
  const r=result();r.allCandidates![17]={...r.allCandidates![17],score:.9,mirrored:true};
  const logits=Array(32).fill(-10);logits[9]=10;
  const fused=fuseQuadPhases(r,logits,"CPU");
  expect(fused.candidates).toHaveLength(3);expect(new Set(fused.candidates.map(c=>c.row)).size).toBe(3);
  expect(fused.candidates[0].row).toBe(8);expect(fused.candidates[0].sheet).toBe(1);expect(fused.candidates[0].mirrored).toBe(true);
  expect(fused.candidates[0].quad).toBe(q);expect(fused.candidates[1].row).toBe(9);
});
it("respects filtered appearance admission and refuses invalid network output",()=>{
  const r=result();r.phaseCandidates=r.phaseCandidates!.filter(c=>c.row===2);r.allCandidates=r.allCandidates!.filter(c=>c.row===2);
  const logits=Array(32).fill(0);logits[9]=100;
  expect(fuseQuadPhases(r,logits,"CPU").candidates.map(c=>c.row)).toEqual([2]);
  expect(()=>fuseQuadPhases(r,[NaN],"CPU")).toThrow("invalid");
});
