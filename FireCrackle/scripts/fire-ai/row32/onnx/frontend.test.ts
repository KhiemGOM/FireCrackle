// Local real-pixel audit, deliberately outside the browser TypeScript project.
import {expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {phasePixels,readablePhaseQuad,fuseQuadPhases} from "../../../../src/lib/quadPhase";
import type {QuadCandidate,QuadMatch} from "../../../../src/lib/quadMatch";
import type {ManualQuad} from "../../../../src/lib/quadMask";
const enabled=process.env.FIRECRACKLE_PHASE_PARITY==="1",q:ManualQuad=[[0,0],[1,0],[1,1],[0,1]];
it.skipIf(!enabled)("matches rectification of real native quad frames",()=>{
  const root=path.resolve(".."),out=path.join(root,".board/row32-onnx");
  const cases=JSON.parse(fs.readFileSync(path.join(out,"pixel-parity.json"),"utf8")) as {id:string;quad:ManualQuad;frame:number;width:number;height:number}[];
  let differences=0,total=0,max=0;
  for(const r of cases){
    const rgb=fs.readFileSync(path.join(root,`.board/row32-real/quad1/${r.frame}.rgb`)),data=new Uint8ClampedArray(r.width*r.height*4);
    for(let i=0;i<r.width*r.height;i++)data.set([rgb[i*3],rgb[i*3+1],rgb[i*3+2],255],i*4);
    const actual=phasePixels({width:r.width,height:r.height,data},r.quad),expected=fs.readFileSync(path.join(out,`${r.id}-expected.rgb`));
    expect(readablePhaseQuad(r.quad,r.width,r.height)).toBe(true);
    for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);max=Math.max(max,d);if(d)differences++;total++;}
    fs.writeFileSync(path.join(out,`${r.id}-frontend.rgb`),actual);
  }
  expect(max).toBeLessThanOrEqual(1);
  fs.writeFileSync(path.join(out,"pixel-parity-results.json"),JSON.stringify({cases:cases.length,differences,total,max}));
});
it.skipIf(!enabled)("reproduces the fused ranking on all usable real calibration/test score vectors",()=>{
  const rows=JSON.parse(fs.readFileSync(path.resolve("../.board/row32-onnx/fusion-fixtures.json"),"utf8")) as {logits:number[];scores:number[];expected:number[]}[];
  for(const row of rows){
    const candidates:QuadCandidate[]=row.scores.flatMap((score,phase)=>[0,1].map(sheet=>({sheet:sheet as 0|1,row:phase,mirrored:false,quad:q,score})));
    const r:QuadMatch={status:"ambiguous",candidates:[],searched:128,margin:0,phaseCandidates:candidates,allCandidates:candidates};
    expect(fuseQuadPhases(r,row.logits,"CPU").candidates.map(c=>c.row)).toEqual(row.expected);
  }
  expect(rows.length).toBe(772);
});
