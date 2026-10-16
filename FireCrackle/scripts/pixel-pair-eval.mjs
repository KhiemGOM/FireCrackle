// Candidate-specific, positive-only boundary experiment; not an app matcher.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const app=path.resolve(import.meta.dirname,'..'),pairs=[];
for(let y=0;y<16;y++)for(let x=0;x<16;x++){const i=y*16+x;if(x<15)pairs.push([i,i+1]);if(y<15)pairs.push([i,i+16]);}
export function jointScores(o,model,weights=[.25,1,4]){
 const adjacent=1-(1/12)/.12,gains=new Float64Array(256*96),touched=Array.from({length:256},()=>[]),hist=new Float64Array(96),edges=new Float64Array(96);
 for(let cell=0;cell<256;cell++)if(model.alpha[cell]>127)for(let sub=0;sub<o.probes;sub++){
  const i=cell*o.probes+sub;if(!o.valid[i]||!o.fire[i])continue;
  const a=i*3,t=cell*3,R=Math.max(model.rgb[t],1),r=Math.max(o.rgb[a],1),dg=Math.abs(o.rgb[a+1]/r-model.rgb[t+1]/R),db=Math.abs(o.rgb[a+2]/r-model.rgb[t+2]/R);
  if(dg>.06||db>.1)continue;
  const bin=Math.round((Math.log2(r/R)+5)*12),vote=(1-.5*(dg/.06+db/.1))*o.weights[i]/o.probes;
  for(let d=-1;d<=1;d++){const b=bin+d;if(b<12||b>76)continue;const j=cell*96+b,value=vote*(d===0?1:adjacent);if(gains[j]===0&&value>0)touched[cell].push(b);gains[j]+=value;hist[b]+=value;}
 }
 for(const [a,b] of pairs){
  if(!touched[a].length||!touched[b].length||model.alpha[a]<=127||model.alpha[b]<=127)continue;
  const R=Math.max(model.rgb[a*3],1),S=Math.max(model.rgb[b*3],1),contrast=Math.min(1,Math.abs(Math.log2(R/S))/.5+Math.abs(model.rgb[a*3+1]/R-model.rgb[b*3+1]/S)/.1);
  if(contrast===0)continue;
  for(const bin of touched[a])edges[bin]+=contrast*Math.min(gains[a*96+bin],gains[b*96+bin]);
 }
 return weights.map(weight=>{let best=0;for(let bin=12;bin<=76;bin++)best=Math.max(best,(hist[bin]+weight*edges[bin])/(256+weight*480));return best;});
}
async function main(){
 const [dirArg,outArg,split='tune',mode='exact']=process.argv.slice(2);
 if(!dirArg||!outArg||!['tune','validation'].includes(split)||!['exact','rough'].includes(mode))throw Error('Usage: pixel-pair-eval.mjs DATA OUT tune|validation exact|rough');
 const dir=path.resolve(dirArg),out=path.resolve(outArg),runtime=path.join(out,'runtime');fs.mkdirSync(runtime,{recursive:true});
 const hashes={};for(const name of ['quadMatch','quadMask','fireColourMask','atlasFilter','quadOptimizer']){
  let source=fs.readFileSync(path.join(app,`src/lib/${name}.ts`),'utf8');hashes[name]=createHash('sha256').update(source).digest('hex');if(name==='quadMatch')source+='\nexport {sampleFrame,templates,similarity};';
  fs.writeFileSync(path.join(runtime,`${name}.cjs`),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText.replace(/require\("\.\/(\w+)"\)/g,'require("./$1.cjs")'));
 }
 const req=createRequire(import.meta.url),{sampleFrame,templates,similarity,matchFireQuad}=req(path.join(runtime,'quadMatch.cjs')),{buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs')),{projectQuad}=req(path.join(runtime,'quadMask.cjs'));
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(app,`../fire-detection/data/assets/fire_${i}.rgba`)))),models=templates(sheets),weights=[.25,1,4],rows=[];let frame=-1,image;const start=performance.now();
 for(const item of manifest.samples.filter(x=>x.split===split)){
  if(frame!==item.frame){frame=item.frame;const b=fs.readFileSync(path.join(dir,`${frame}.rgb`)),data=new Uint8ClampedArray(manifest.width*manifest.height*4);for(let i=0;i<b.length/3;i++){data.set(b.subarray(i*3,i*3+3),i*4);data[i*4+3]=255;}image={width:manifest.width,height:manifest.height,data};}
  const quad=mode==='exact'?item.quad:[[0,0],[1,0],[1,1],[0,1]].map(([u,v],i)=>projectQuad(item.quad,(u-.5)*1.12+.5+.03+(i===1?.02:0),(v-.5)*.92+.5-.02+(i===2?.02:0)));
  const eligible=matchFireQuad(image,sheets,quad,{refineGeometry:false}).searched>0,o=sampleFrame(image,quad,buildFireColourMask(image,sheets,quad)),score=weights.map(()=>[]),base=[];
  for(const model of models){base.push(similarity(o,model).score);jointScores(o,model,weights).forEach((s,i)=>score[i].push(s));}
  const truth=models.findIndex(x=>x.sheet===item.expected[0]&&x.row===item.expected[1]&&x.mirrored===item.expected[2]),pack=ss=>{if(!eligible)return {correct:false,top:null,top3:false,score:0,margin:0};const indices=ss.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v);return {correct:indices[0].i===truth,top:indices[0].i,top3:indices.slice(0,3).some(x=>x.i===truth),score:indices[0].v,margin:indices[0].v-indices[1].v};};
  rows.push({id:item.id,frame:item.frame,source:item.source,expected:item.expected,eligible,baseline:pack(base),joint:score.map(pack)});if(rows.length%100===0)console.error(`${mode}/${split}: ${rows.length}`);
 }
 const summary={n:rows.length,baseline:rows.filter(x=>x.baseline.correct).length,joint:weights.map((w,i)=>({weight:w,top1:rows.filter(x=>x.joint[i].correct).length,top3:rows.filter(x=>x.joint[i].top3).length}))};
 const result={split,mode,weights,hashes,scriptHash:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),joined_sha256:manifest.joined_sha256,summary,seconds:(performance.now()-start)/1000,rows};fs.writeFileSync(path.join(out,`joint-${mode}-${split}.json`),JSON.stringify(result));console.log(JSON.stringify({...result,rows:undefined}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename)await main();
