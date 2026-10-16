// Research-only rankings from unchanged native pixels; no label writes.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {jointScores} from '../pixel-pair-eval.mjs';
const app=path.resolve(import.meta.dirname,'../..'),[dataArg,outArg]=process.argv.slice(2);
const dir=path.resolve(dataArg),out=path.resolve(outArg),runtime=path.join(out,'runtime');
fs.mkdirSync(runtime,{recursive:true});
const hashes={};
for(const name of ['quadMatch','quadMask','fireColourMask','atlasFilter','quadOptimizer']){
 let source=fs.readFileSync(path.join(app,`src/lib/${name}.ts`),'utf8');
 hashes[name]=createHash('sha256').update(source).digest('hex');
 if(name==='quadMatch')source+='\nexport {sampleFrame,templates};';
 fs.writeFileSync(path.join(runtime,`${name}.cjs`),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText.replace(/require\("\.\/(\w+)"\)/g,'require("./$1.cjs")'));
}
const req=createRequire(import.meta.url),current=req(path.join(runtime,'quadMatch.cjs')),
 {buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs')),
 old=req(path.join(app,'src-tauri/target/actual-quad-runtime/baseline/quadMatch.js')),
 independent=req(path.join(app,'src-tauri/target/actual-quad-runtime/current-baseline/quadMatch.js')),
 rarity=req(path.join(app,'src-tauri/target/actual-quad-runtime/rarity/quadMatch.js'));
const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(app,`../fire-detection/data/assets/fire_${i}.rgba`)))),models=current.templates(sheets);
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),rows=[],frameHashes={};let frame=-1,image;
const appearance=c=>c.sheet*64+c.row*2+Number(c.mirrored);
const pack=r=>({order:r.candidates.map(appearance),status:r.status,margin:r.margin,score:r.candidates[0]?.score??0});
const start=performance.now();
for(const item of manifest.samples.filter(x=>x.split==='validation')){
 if(frame!==item.frame){frame=item.frame;const rgb=fs.readFileSync(path.join(dir,`${frame}.rgb`)),data=new Uint8ClampedArray(manifest.width*manifest.height*4);
  if(rgb.length*4!==data.length*3)throw Error('Bad native frame');
  frameHashes[frame]=createHash('sha256').update(rgb).digest('hex');
  for(let i=0;i<rgb.length/3;i++){data[i*4]=rgb[i*3];data[i*4+1]=rgb[i*3+1];data[i*4+2]=rgb[i*3+2];data[i*4+3]=255;}
  image={width:manifest.width,height:manifest.height,data};
 }
 const baseline=current.matchFireQuad(image,sheets,item.quad,{refineGeometry:false}),eligible=baseline.searched>0;
 const observed=current.sampleFrame(image,item.quad,buildFireColourMask(image,sheets,item.quad));
 const scores=models.map(m=>jointScores(observed,m,[4])[0]);
 const order=eligible?scores.map((s,i)=>({s,i})).sort((a,b)=>b.s-a.s).slice(0,5).map(x=>x.i):[];
 const result={colour:pack(baseline),pixel_pairs:{order},
  old_sampler:pack(old.matchFireQuad(image,sheets,item.quad,{refineGeometry:false})),
  independent_colour:pack(independent.matchFireQuad(image,sheets,item.quad,{refineGeometry:false})),
  rarity:pack(rarity.matchFireQuad(image,sheets,item.quad,{refineGeometry:false}))};
 // The expensive geometry variants already have complete Quad1 records.
 if(!dir.endsWith('actual-quad1')){
  result.old_size_grid=pack(old.matchFireQuad(image,sheets,item.quad,{refineGeometry:true}));
  result.colour_optimizer=pack(current.matchFireQuad(image,sheets,item.quad,{refineGeometry:true}));
  result.old_optimizer=pack(independent.matchFireQuad(image,sheets,item.quad,{refineGeometry:true}));
 }
 rows.push({id:item.id,frame:item.frame,source:item.source,expected:item.expected,quad:item.quad,...result});
 if(rows.length%25===0)console.error(`ensemble ${dir}: ${rows.length}`);
}
fs.writeFileSync(path.join(out,'rankings.json'),JSON.stringify({hashes,manifest_sha256:createHash('sha256').update(fs.readFileSync(path.join(dir,'manifest.json'))).digest('hex'),frameHashes,seconds:(performance.now()-start)/1000,rows}));
console.log(JSON.stringify({data:dir,cases:rows.length,seconds:(performance.now()-start)/1000}));
