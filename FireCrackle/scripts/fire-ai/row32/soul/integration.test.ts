import {expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {matchSoulQuad} from "../../../../src/lib/quadSoul";
import {phasePixels,fuseQuadPhases} from "../../../../src/lib/quadPhase";
import type {QuadMatch,QuadCandidate} from "../../../../src/lib/quadMatch";
import type {ManualQuad} from "../../../../src/lib/quadMask";
const root=path.resolve(".."),out=path.join(root,".board/soul-phase-onnx"),enabled=process.env.FIRECRACKLE_SOUL_PARITY==="1";
it.skipIf(!enabled)("matches native pixels and all32 frozen soul scores on nine real quads",()=>{
 const rows=JSON.parse(fs.readFileSync(path.join(out,"fixtures.json"),"utf8")),scores=JSON.parse(fs.readFileSync(path.join(root,".board/soul-phase128/matcher.json"),"utf8")).rows;
 const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(root,`.board/soul-quad/real/soul_${i}.rgba`)))) as [Uint8ClampedArray,Uint8ClampedArray];
 for(const row of rows){
  const rgb=fs.readFileSync(path.join(root,`.board/soul-phase128/${row.video}/${row.frame}.rgb`)),data=new Uint8ClampedArray(row.width*row.height*4);
  for(let i=0;i<rgb.length/3;i++)data.set([rgb[i*3],rgb[i*3+1],rgb[i*3+2],255],i*4);
  const image={width:row.width,height:row.height,data},crop=phasePixels(image,row.quad),expected=fs.readFileSync(path.join(out,row.crop_file));
  expect(Math.max(...crop.map((v,i)=>Math.abs(v-expected[i])))).toBeLessThanOrEqual(1);
  const actual=matchSoulQuad(image,sheets,row.quad,{refineGeometry:false,phaseEvidence:true}),best=Array(32).fill(-Infinity);
  for(const c of actual.phaseCandidates!)best[c.row]=Math.max(best[c.row],c.score);
  const frozen=scores.find((s:any)=>s.id===row.id).scores;
  for(let i=0;i<32;i++)expect(best[i]).toBeCloseTo(frozen[i],12);
 }
 expect(rows).toHaveLength(9);
});
it.skipIf(!enabled)("reproduces the fixed soul ensemble on all calibration/test score vectors",()=>{
 const rows=JSON.parse(fs.readFileSync(path.join(out,"fusion-fixtures.json"),"utf8")),quad:ManualQuad=[[0,0],[1,0],[1,1],[0,1]];
 for(const row of rows){
  const candidates:QuadCandidate[]=row.scores.map((score:number,phase:number)=>({sheet:1,row:phase,mirrored:false,atlas:"soul_fire_1",quad,score}));
  const result:QuadMatch={status:"ambiguous",candidates:[],searched:128,margin:0,phaseCandidates:candidates,allCandidates:candidates};
  expect(fuseQuadPhases(result,row.logits,"CPU","soul").candidates.map(c=>c.row)).toEqual(row.expected);
 }
 expect(rows).toHaveLength(2276);
});
