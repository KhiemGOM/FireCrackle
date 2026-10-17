// Hand-mask intervention only: no appearance supplied to annotation or mask creation.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {applyMask} from '../../occlusion-mask-eval.mjs';
const app=path.resolve(import.meta.dirname,'../../..'),root=path.resolve(app,'..'),data=path.join(root,'.board/occlusion-review');
const runtime=path.join(data,'runtime');fs.mkdirSync(runtime,{recursive:true});
const hashes={};for(const name of ['quadMatch','quadMask','fireColourMask','atlasFilter','quadOptimizer']){
 let source=fs.readFileSync(path.join(app,`src/lib/${name}.ts`),'utf8');hashes[name]=createHash('sha256').update(source).digest('hex');
 if(name==='quadMatch')source+='\nexport {sampleFrame,templates,similarity};';
 fs.writeFileSync(path.join(runtime,`${name}.cjs`),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText.replace(/require\("\.\/(\w+)"\)/g,'require("./$1.cjs")'));
}
const req=createRequire(import.meta.url),{sampleFrame,templates,similarity,matchFireQuad}=req(path.join(runtime,'quadMatch.cjs')),
 {buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs'));
const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(root,`fire-detection/data/assets/fire_${i}.rgba`)))),models=templates(sheets);
const manifest=JSON.parse(fs.readFileSync(path.join(data,'manifest.json'))),freeze=JSON.parse(fs.readFileSync(path.join(data,'mask-freeze.json'))),
 annotation=path.join(import.meta.dirname,'annotations.json');
if(freeze.annotation_sha256!==createHash('sha256').update(fs.readFileSync(annotation)).digest('hex'))throw Error('Annotations changed after freeze');
if(freeze.manifest_sha256!==createHash('sha256').update(fs.readFileSync(path.join(data,'manifest.json'))).digest('hex'))throw Error('Cases changed after freeze');
const names=['baseline','definite','core','expanded','uncertain','control_shift'],rows=[];
for(const r of manifest.cases){
 const s=r.sample,w=r.width,h=r.height,raw=fs.readFileSync(path.join(r.native_source,`${s.frame}.rgb`)),pixels=new Uint8ClampedArray(w*h*4);
 if(raw.length!==w*h*3)throw Error('Bad frame');for(let i=0;i<raw.length/3;i++){pixels.set(raw.subarray(i*3,i*3+3),i*4);pixels[i*4+3]=255;}
 const image={data:pixels,width:w,height:h},base=sampleFrame(image,s.quad,buildFireColourMask(image,sheets,s.quad)),eligible=matchFireQuad(image,sheets,s.quad,{refineGeometry:false}).searched>0,methods={};
 const truth=s.expected[0]*64+s.expected[1]*2+Number(s.expected[2]);
 for(const name of names){
  let o=base;if(name!=='baseline'){
   const raw=fs.readFileSync(path.join(data,`${r.code}.${name}`));if(raw.length!==16384)throw Error('Bad mask');
   o=applyMask(base,new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)));
  }
  const ranks=eligible?models.map((m,i)=>({i,...similarity(o,m)})).sort((a,b)=>b.score-a.score):[],win=ranks[0],score=win?.score??0,margin=score-(ranks[1]?.score??0);
  methods[name]={top:win?.i??null,correct:win?.i===truth,nonzeroCorrect:win?.i===truth&&score>0,score,margin,
   clear:!!win&&score>0&&win.support>=32&&win.regions>=3&&margin>=.03,
   weight:o.weights.reduce((a,b,i)=>a+b*o.fire[i],0)};
 }
 rows.push({code:r.code,id:s.id,frame:s.frame,expected:s.expected,dataset:r.dataset,methods});
}
const summary=Object.fromEntries(names.map(name=>[name,{top1:rows.filter(r=>r.methods[name].correct).length,
 nonzeroCorrect:rows.filter(r=>r.methods[name].nonzeroCorrect).length,clear:rows.filter(r=>r.methods[name].clear).length,
 wrongClear:rows.filter(r=>r.methods[name].clear&&!r.methods[name].correct).length,
 zero:rows.filter(r=>r.methods[name].score===0).length,weight:rows.reduce((a,r)=>a+r.methods[name].weight,0)}]));
const result={n:rows.length,hashes,annotation_sha256:freeze.annotation_sha256,summary,rows};
fs.writeFileSync(path.join(data,'results.json'),JSON.stringify(result));console.log(JSON.stringify({...result,rows:undefined}));
