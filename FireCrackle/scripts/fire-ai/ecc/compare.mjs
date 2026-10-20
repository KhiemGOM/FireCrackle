// Compile and call production scorer/fitter; private pixels/results stay in .board.
import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve('.'),out=path.join(root,'.board/ecc-align'),runtime=path.join(out,'runtime');
fs.mkdirSync(runtime,{recursive:true});
const hashes={};
for(const name of ['quadMatch','quadMask','quadOptimizer','fireColourMask','atlasFilter','animationAtlases']){
 let src=fs.readFileSync(path.join(root,`FireCrackle/src/lib/${name}.ts`),'utf8');
 hashes[name]=createHash('sha256').update(src).digest('hex');
 if(name==='quadMatch')src+='\nexport {sampleFrame,templates,similarity};';
 const js=stripTypeScriptTypes(src,{mode:'transform'}).replace(/from "\.\/(\w+)"/g,'from "./$1.mjs"');
 fs.writeFileSync(path.join(runtime,`${name}.mjs`),js);
}
const load=n=>import(pathToFileURL(path.join(runtime,`${n}.mjs`)).href);
const {sampleFrame,templates,similarity,matchFireQuad}=await load('quadMatch'),{buildFireColourMask}=await load('fireColourMask'),{projectQuad}=await load('quadMask'),{optimizeQuad}=await load('quadOptimizer');
const rows=JSON.parse(fs.readFileSync(path.join(out,'cases.json'))),mode=process.argv[2]??'baseline',limit=Number(process.argv[3]??rows.length);
function sheetsFor(material){
 return [0,1].map(sheet=>{
  const raw=new Uint8ClampedArray(fs.readFileSync(path.join(root,material==='soul'?`.board/soul-quad/real/soul_${sheet}.rgba`:`fire-detection/data/assets/fire_${sheet}.rgba`)));
  // Ordinary raw atlas to canonical phase; soul research cache is already canonical.
  const b=new Uint8ClampedArray(raw.length);
  for(let row=0;row<32;row++)b.set(raw.subarray(((row+(material==='normal'&&sheet===0?16:0))%32)*1024,((row+(material==='normal'&&sheet===0?16:0))%32)*1024+1024),row*1024);
  fs.writeFileSync(path.join(out,`${material}-${sheet}.rgba`),b);
  if(material==='soul')for(let i=0;i<b.length;i+=4){const r=b[i];b[i]=b[i+1];b[i+1]=b[i+2];b[i+2]=r;}
  return b;
 });
}
const assets=Object.fromEntries(['normal','soul'].map(m=>{const sheets=sheetsFor(m);return [m,{sheets,models:templates(sheets)}];}));
const rank=c=>{const s=Array(32).fill(0);for(const v of c)s[v.row]=Math.max(s[v.row],v.score);if(!s.some(v=>v>0))return [];return s.map((score,phase)=>({score,phase})).sort((a,b)=>b.score-a.score||a.phase-b.phase).slice(0,3).map(x=>x.phase);};
const ecc=mode.startsWith('score-ecc')?JSON.parse(fs.readFileSync(path.join(out,mode==='score-ecc-bounded'?'ecc-bounded.json':'ecc.json'))):null;
const locked=ecc?JSON.parse(fs.readFileSync(path.join(out,'selected.json'))).rows:null;
const results=[];let allStart=performance.now();
for(const [index,r] of rows.slice(0,limit).entries()){
 const rgb=fs.readFileSync(path.join(root,r.pixels)),data=new Uint8ClampedArray(r.width*r.height*4);
 for(let i=0;i<rgb.length/3;i++){data[i*4]=rgb[i*3];data[i*4+1]=rgb[i*3+1];data[i*4+2]=rgb[i*3+2];data[i*4+3]=255;}
 if(r.material==='soul')for(let i=0;i<data.length;i+=4){const a=data[i];data[i]=data[i+1];data[i+1]=data[i+2];data[i+2]=a;}
 const image={width:r.width,height:r.height,data}, {sheets,models}=assets[r.material],tol=r.material==='soul'?[.18,.30]:[.06,.10],score=(q,m,mask,probes=4)=>similarity(sampleFrame(image,q,mask,probes),m,tol).score;
 const envelope=q=>[[-.1,-.1],[1.1,-.1],[1.1,1.1],[-.1,1.1]].map(([u,v])=>projectQuad(q,u,v));
 const mask=buildFireColourMask(image,sheets,envelope(r.rough));
 const begin=performance.now();
 if(mode==='parity'){
  fs.writeFileSync(path.join(out,`${index}.exact.mask`),buildFireColourMask(image,sheets,envelope(r.quad)));
  const original=buildFireColourMask(image,sheets,r.quad),scores=Array(32).fill(0);
  for(const m of models)scores[m.row]=Math.max(scores[m.row],score(r.quad,m,original));
  const cached=JSON.parse(fs.readFileSync(path.join(root,r.material==='normal'?'.board/row32-fusion/matcher.json':'.board/soul-phase128/matcher.json'))).rows.find(s=>s.id===r.id);
  const expected=cached.phase_scores??cached.scores,error=Math.max(...scores.map((s,i)=>Math.abs(s-expected[i])));
  if(error>1e-10)throw Error(`Frozen scorer parity failed ${r.id}: ${error}`);
  const roughMask=buildFireColourMask(image,sheets,r.rough),roughMax=Math.max(...models.map(m=>score(r.rough,m,roughMask)));
  if(roughMax<=0)throw Error(`Need explicit no-evidence baseline accounting: ${r.id}`);
  results.push({id:r.id,error,roughMax,top3:rank(models.map(m=>({...m,score:score(r.quad,m,original)})))});
 }else if(mode==='selected'){
  const selected={};
  for(const [name,q] of [['exact',r.quad],['rough',r.rough]]){
   const mk=buildFireColourMask(image,sheets,envelope(q)),b=performance.now();
   const model={m:models[r.selected_model],i:r.selected_model};
   const coarse=optimizeQuad(q,s=>score(s,model.m,mk,1),160);
   const fine=optimizeQuad(q,s=>score(s,model.m,mk),120,coarse.quad);
   const initial=score(q,model.m,mk),value=score(fine.quad,model.m,mk);
   selected[name]={model:model.i,quad:value>initial?fine.quad:q,score:Math.max(initial,value),ms:performance.now()-b};
  }
  results.push({id:r.id,material:r.material,selected});
 }else if(mode==='baseline'){
  fs.writeFileSync(path.join(out,`${index}.mask`),mask);
  const fixed=matchFireQuad(image,sheets,r.rough,{refineGeometry:false,phaseEvidence:true,colourTolerance:tol});
  const fit=matchFireQuad(image,sheets,r.rough,{refineGeometry:true,phaseEvidence:true,colourTolerance:tol});
  const ms=performance.now()-begin;
  const selected={};
  for(const [name,q] of [['exact',r.quad],['rough',r.rough]]){
   const mk=buildFireColourMask(image,sheets,envelope(q));
   const candidates=models.filter(m=>m.row===r.phase).map(m=>{
    const b=performance.now(),v=optimizeQuad(q,s=>score(s,m,mk,1),160);
    // Preserve production full-probe acceptance; selected sprite has same coarse budget.
    return {quad:score(v.quad,m,mk)>score(q,m,mk)?v.quad:q,score:Math.max(score(v.quad,m,mk),score(q,m,mk)),ms:performance.now()-b};
   }).sort((a,b)=>b.score-a.score);
   selected[name]=candidates[0];
  }
  results.push({id:r.id,material:r.material,phase:r.phase,fixed:rank(fixed.allCandidates??[]),fitted:rank(fit.allCandidates??[]),ms,selected});
 }else{
  const e=ecc[index],fits=e.rough.candidates.map((f,i)=>{const m=models[i],initial=score(r.rough,m,mask),value=score(f.quad,m,mask);return {...m,quad:value>initial?f.quad:r.rough,score:Math.max(value,initial)};});
  const selected={};
  for(const name of ['exact','rough']){
   const q=name==='exact'?r.quad:r.rough,mk=buildFireColourMask(image,sheets,envelope(q));
   const chosen=locked[index].selected[name].model;
   const c=e[name].candidates.map((f,i)=>({f,m:models[f.model??i],i:f.model??i})).filter(({i})=>i===chosen).map(({f,m})=>{
    const old=score(q,m,mk),v=score(f.quad,m,mk);return {quad:v>old?f.quad:q,score:Math.max(old,v)};
   }).sort((a,b)=>b.score-a.score);
   selected[name]=c[0];
  }
  results.push({id:r.id,material:r.material,phase:r.phase,fitted:rank(fits),ms:e.rough.ms+performance.now()-begin,selected,failures:e.rough.failures});
 }
 fs.writeFileSync(path.join(out,`${mode}.json`),JSON.stringify({rows:results,source_hashes:hashes,seconds:(performance.now()-allStart)/1000}));
 console.log(JSON.stringify({mode,done:index+1,total:limit,seconds:Math.round((performance.now()-allStart)/1000)}));
}
