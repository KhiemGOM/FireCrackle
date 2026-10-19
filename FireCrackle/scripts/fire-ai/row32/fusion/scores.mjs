// Recover every phase score from the frozen deterministic control.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=path.resolve('.'),out=path.join(root,'.board/row32-fusion'),req=createRequire(import.meta.url),runtime=path.join(root,'.board/soul-quad/real/runtime');
const old=JSON.parse(fs.readFileSync(path.join(root,'.board/row32-real/baseline.json')));
const source_hashes=Object.fromEntries(['quadMatch.cjs','quadMask.cjs','fireColourMask.cjs'].map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(runtime,f))).digest('hex')]));
if(JSON.stringify(source_hashes)!==JSON.stringify(old.source_hashes))throw Error('Frozen matcher changed');
const {sampleFrame,templates,similarity}=req(path.join(runtime,'quadMatch.cjs'));
const {buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs'));
const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(root,`fire-detection/data/assets/fire_${i}.rgba`))));
const models=templates(sheets),rows=JSON.parse(fs.readFileSync(path.join(root,'.board/row32-128/manifest.json'))).samples.filter(r=>r.split==='calibration'||r.split==='test');
let last=null,image;const result=[];const started=performance.now();
for(const row of rows){
 const key=`${row.video}-${row.frame}`;
 if(key!==last){
  const dir=row.split==='test'?path.join(root,'.board/row32-real/quad1'):path.join(root,'.board/row32-hybrid/later');
  const rgb=fs.readFileSync(path.join(dir,`${row.frame}.rgb`)),data=new Uint8ClampedArray(row.width*row.height*4);
  for(let i=0;i<rgb.length/3;i++){data[i*4]=rgb[i*3];data[i*4+1]=rgb[i*3+1];data[i*4+2]=rgb[i*3+2];data[i*4+3]=255;}
  image={width:row.width,height:row.height,data};last=key;
 }
 const observed=sampleFrame(image,row.quad,buildFireColourMask(image,sheets,row.quad));
 const order=models.map(model=>({model,score:similarity(observed,model).score})).sort((a,b)=>b.score-a.score);
 const phaseOf=m=>(m.row+(m.sheet===0?16:0))%32;
 const scores=Array(32).fill(-Infinity);
 for(const r of order){const phase=phaseOf(r.model);scores[phase]=Math.max(scores[phase],r.score);}
 if(!scores.every(Number.isFinite))throw Error(`Nonfinite score: ${row.id}`);
 const usable=order[0].score>0;
 result.push({id:row.id,split:row.split,phase:usable?phaseOf(order[0].model):-1,score:order[0].score,phase_scores:scores,phase_order:[...new Set(order.map(r=>phaseOf(r.model)))],usable});
}
const byid=new Map(result.map(r=>[r.id,r]));
for(const r of old.rows){if(byid.get(r.id).phase!==r.phase||byid.get(r.id).score!==r.score)throw Error(`Baseline parity failed: ${r.id}`);}
fs.mkdirSync(out,{recursive:true});
const report={source_hashes,seconds:(performance.now()-started)/1000,baseline_parity:old.rows.length,rows:result};
fs.writeFileSync(path.join(out,'matcher.json'),JSON.stringify(report));console.log(JSON.stringify({...report,rows:undefined}));
