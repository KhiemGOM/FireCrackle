// Diagnostic comparison on reused native recordings; no production changes.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {quadReadability} from './soul-quad-size-audit.mjs';
const root=path.resolve(import.meta.dirname,'../..'),out=path.resolve(process.argv[2]??path.join(root,'.board/soul-colour-audit'));
fs.mkdirSync(out,{recursive:true});
const req=createRequire(import.meta.url),runtime=path.join(root,'.board/soul-quad/real/runtime'),{sampleFrame,templates,similarity}=req(path.join(runtime,'quadMatch.cjs')),
 {similarity:loose}=req(path.join(runtime,'pattern-loose.cjs')),{buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs'));
const prior=JSON.parse(fs.readFileSync(path.join(root,'.board/soul-quad/real/scores-validation.json')));
for(const [name,hash] of Object.entries(prior.hashes))if(createHash('sha256').update(fs.readFileSync(path.join(root,`FireCrackle/src/lib/${name}.ts`))).digest('hex')!==hash)throw Error('Stale runtime');
const permute=data=>{const a=new Uint8ClampedArray(data.length);for(let i=0;i<a.length;i+=4){a[i]=data[i+1];a[i+1]=data[i+2];a[i+2]=data[i];a[i+3]=data[i+3];}return a;};
const sheets={orange:[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(root,`fire-detection/data/assets/fire_${i}.rgba`)))),soul:[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(root,`.board/soul-quad/real/soul_${i}.rgba`))))};
const textureAudit=[];
for(let a=0;a<2;a++)for(let b=0;b<2;b++){
 let best={mismatches:Infinity};
 for(let shift=0;shift<32;shift++)for(const mirror of [false,true]){
  let mismatch=0;
  for(let row=0;row<32;row++)for(let y=0;y<16;y++)for(let x=0;x<16;x++){
   const i=((row*16+y)*16+x)*4,j=((((row+shift)%32)*16+y)*16+(mirror?15-x:x))*4;
   mismatch+=Number((sheets.orange[a][i+3]>127)!==(sheets.soul[b][j+3]>127));
  }
  if(mismatch<best.mismatches)best={mismatches:mismatch,shift,mirror};
 }
 const mapping=new Map(),reverse=new Map();let opaque=0;
 for(let row=0;row<32;row++)for(let y=0;y<16;y++)for(let x=0;x<16;x++){
  const i=((row*16+y)*16+x)*4,j=((((row+best.shift)%32)*16+y)*16+(best.mirror?15-x:x))*4;
  if(sheets.orange[a][i+3]<=127||sheets.soul[b][j+3]<=127)continue;
  opaque++;const A=Array.from(sheets.orange[a].subarray(i,i+3)).join(','),B=Array.from(sheets.soul[b].subarray(j,j+3)).join(',');
  if(!mapping.has(A))mapping.set(A,new Set());mapping.get(A).add(B);
  if(!reverse.has(B))reverse.set(B,new Set());reverse.get(B).add(A);
 }
 textureAudit.push({orangeSheet:a,soulSheet:b,texels:8192,best,opaque,orangeColours:mapping.size,soulColours:reverse.size,nonfunctional:Array.from(mapping.values()).filter(v=>v.size>1).length,manyToOne:Array.from(reverse.values()).filter(v=>v.size>1).length});
}
const results={};
for(const [kind,relative] of [['orange','FireCrackle/src-tauri/target/actual-quad1'],['soul','.board/soul-quad/real']]){
 const dir=path.join(root,relative),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),selected=manifest.samples.filter(r=>r.split==='validation'&&quadReadability(r.quad,manifest.width,manifest.height).eligible),models=[templates(sheets[kind]),templates(sheets[kind].map(permute))],rows=[];
 let frame=-1,images;
 for(const item of selected){
  if(frame!==item.frame){frame=item.frame;const rgb=fs.readFileSync(path.join(dir,`${frame}.rgb`)),data=new Uint8ClampedArray(manifest.width*manifest.height*4);for(let i=0;i<rgb.length/3;i++){data[i*4]=rgb[i*3];data[i*4+1]=rgb[i*3+1];data[i*4+2]=rgb[i*3+2];data[i*4+3]=255;}images=[{width:manifest.width,height:manifest.height,data},{width:manifest.width,height:manifest.height,data:permute(data)}];}
  const predictions={};
  for(const basis of [0,1]){
   const atlas=basis?sheets[kind].map(permute):sheets[kind],mask=buildFireColourMask(images[basis],atlas,item.quad),obs=sampleFrame(images[basis],item.quad,mask),all={...obs,fire:Uint8Array.from(obs.valid)};
   for(const [name,fn,o] of [['narrow',similarity,obs],['loose',loose,obs],['unmasked_loose',loose,all]]){
    const ranked=models[basis].map((m,i)=>({i,...fn(o,m)})).sort((a,b)=>b.score-a.score),top=models[basis][ranked[0].i];
    predictions[`${basis?'GBR':'RGB'}_${name}`]={top:[top.sheet,top.row,top.mirrored],score:ranked[0].score,support:ranked[0].support,maskSamples:ranked[0].maskSamples};
   }
  }
  // Truth used only after all appearance scores.
  for(const p of Object.values(predictions)){p.exact=p.score>0&&JSON.stringify(p.top)===JSON.stringify(item.expected);p.row=p.score>0&&p.top[1]===item.expected[1];}
  rows.push({...item,readability:quadReadability(item.quad,manifest.width,manifest.height),predictions});
 }
 const groups={};for(const group of ['all','block','entity']){
  const items=rows.filter(r=>group==='all'||r.source===group),sorted=items.map(r=>r.readability.minPixelsPerTexel).sort((a,b)=>a-b);
  groups[group]={n:items.length,frames:new Set(items.map(r=>r.frame)).size,medianPixelsPerTexel:sorted[Math.floor(sorted.length/2)]??null,methods:Object.fromEntries(Object.keys(rows[0].predictions).map(name=>[name,{exact:items.filter(r=>r.predictions[name].exact).length,row:items.filter(r=>r.predictions[name].row).length}]))};
 }
 results[kind]={groups,rows};
}
const old=new Map(JSON.parse(fs.readFileSync(path.join(root,'FireCrackle/src-tauri/target/actual-quad1/coherent-gain-fixed-validation.json'))).rows.map(r=>[r.id,r]));
for(const r of results.orange.rows){const p=r.predictions.RGB_narrow,o=old.get(r.id);if(p.exact!==o.correct||Math.abs(p.score-o.candidates[0].score)>1e-12)throw Error('Orange control mismatch');}
const soul=new Map(JSON.parse(fs.readFileSync(path.join(root,'.board/soul-quad/real/patterns-validation.json'))).rows.map(r=>[r.id,r]));
for(const r of results.soul.rows){const p=r.predictions.GBR_loose,o=soul.get(r.id).predictions.loose;if(p.exact!==o.correct||Math.abs(p.score-o.score)>1e-12)throw Error('Soul control mismatch');}
const report={script_sha256:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),textureAudit,results};
fs.writeFileSync(path.join(out,'comparison.json'),JSON.stringify(report));console.log(JSON.stringify({...report,results:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v.groups]))},null,2));
