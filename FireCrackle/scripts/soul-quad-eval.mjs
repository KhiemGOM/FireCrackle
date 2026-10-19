// Research adapters compile the production sampler/scorer. No unveil math here.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {boundaryFeatures,featureScore} from './boundary-robust-eval.mjs';

const root=path.resolve(import.meta.dirname,'..'),dir=path.resolve(process.argv[2]??''),split=process.argv[3]??'tune';
if(!['tune','validation'].includes(split))throw Error('Specify tune or validation');
const names=(process.argv[4]??'raw,blue,green,ratio,wide025,wide05,wide1,pair').split(',');
const boundaryKinds={boundary025:['aggregate',.25],boundary1:['aggregate',1],gradient1:['gradient',1],facing1:['facing',1]};
const known={raw:'raw',blue:'blue',green:'green',ratio:'blue',wide025:'blue',wide05:'blue',wide1:'blue',pair:'blue',tolerant:'green',loose:'green',...Object.fromEntries(Object.keys(boundaryKinds).map(n=>[n,'green']))};
if(names.some(x=>!known[x]))throw Error('Unknown scoring variant');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),runtime=path.join(dir,'runtime');
fs.mkdirSync(runtime,{recursive:true});
const hashes={};
for(const name of ['quadMatch','quadMask','fireColourMask','atlasFilter','quadOptimizer','animationAtlases']){
 let source=fs.readFileSync(path.join(root,`src/lib/${name}.ts`),'utf8');
 hashes[name]=createHash('sha256').update(source).digest('hex');
 if(name==='quadMatch')source+='\nexport {sampleFrame,templates,similarity};';
 // Asset URL helpers aren't invoked by scoring; Node has no Vite import.meta.env.
 fs.writeFileSync(path.join(runtime,name+'.cjs'),ts.transpileModule(source.replaceAll('import.meta.env.BASE_URL','"/"'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText.replace(/require\("\.\/(\w+)"\)/g,'require("./$1.cjs")'));
}
const req=createRequire(import.meta.url),base=req(path.join(runtime,'quadMatch.cjs')),
 {buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs'));
const {projectQuad}=req(path.join(runtime,'quadMask.cjs'));
const original=fs.readFileSync(path.join(root,'src/lib/quadMatch.ts'),'utf8');
const begin=original.indexOf('function similarity('),end=original.indexOf('\n/** Search128',begin);
if(begin<0||end<0)throw Error('Production scorer changed: review adapter');
const scores={raw:base.similarity,blue:base.similarity,green:base.similarity};
const boundaryCache=new WeakMap();
for(const [name,[kind,weight]] of Object.entries(boundaryKinds))scores[name]=(o,m)=>{
 let cache=boundaryCache.get(o);if(!cache){cache=new Map();boundaryCache.set(o,cache);}
 if(!cache.has(m))cache.set(m,boundaryFeatures(o,m));
 return {...base.similarity(o,m),score:featureScore(cache.get(m),kind,weight).score};
};
for(const name of names.filter(x=>!scores[x])){
 let source=original.slice(begin,end).replace('function similarity(','export function similarity(');
 if(name==='tolerant'||name==='loose'){
  const factor=name==='tolerant'?2:3;
  source=source.replaceAll('0.06',String(.06*factor)).replaceAll('0.10',String(.10*factor));
 }else if(name.startsWith('wide')){
  const width={wide025:.25,wide05:.5,wide1:1}[name];
  source=source.replace('const value=histogram[bin]+adjacentWeight*(histogram[bin-1]+histogram[bin+1]);',`let value=0;for(let k=0;k<histogram.length;k++)value+=histogram[k]*Math.max(0,1-Math.abs(k-bin)/12/${width});`)
   .replace('Math.abs(bins[i]-bestBin)<=1',`Math.abs(bins[i]-bestBin)/12<${width}`);
 }else if(name==='ratio'){
  source=source.replace('const value=histogram[bin]+adjacentWeight*(histogram[bin-1]+histogram[bin+1]);','const value=histogram.reduce((a,b)=>a+b,0);')
   .replace('Math.abs(bins[i]-bestBin)<=1','true');
 }else if(name==='pair'){
  // Previously tried within-texel gain agreement, retained as an exploratory competitor.
  source=source.replace('histogram[bin]+=vote;hits[i]=vote;bins[i]=bin;','hits[i]=vote;bins[i]=bin;');
  source=source.replace('const adjacentWeight=',`for(let cell=0;cell<256;cell++)for(let s=0;s<observed.probes;s++){
   const i=cell*observed.probes+s;if(!hits[i])continue;
   let coherence=0;for(let j=cell*observed.probes;j<(cell+1)*observed.probes;j++)if(j!==i&&hits[j])coherence+=Math.max(0,1-Math.abs(bins[i]-bins[j])/12/.2);
   hits[i]*=(1+4*coherence/Math.max(1,observed.probes-1))/5;histogram[bins[i]]+=hits[i];
  }const adjacentWeight=`);
 }
 const file=path.join(runtime,name+'.cjs');
 fs.writeFileSync(file,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText);
 scores[name]=req(file).similarity;
}
function channels(data,axis){
 if(axis==='raw')return data;
 const out=new Uint8ClampedArray(data.length),order=axis==='blue'?[2,1,0]:[1,2,0];
 for(let i=0;i<data.length;i+=4){for(let c=0;c<3;c++)out[i+c]=data[i+order[c]];out[i+3]=data[i+3];}
 return out;
}
const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(dir,`soul_${i}.rgba`))));
const axes=[...new Set(names.map(n=>known[n]))],models={},palettes={};
for(const axis of axes){palettes[axis]=sheets.map(s=>channels(s,axis));models[axis]=base.templates(palettes[axis]);}
hashes.boundaryResearch=createHash('sha256').update(fs.readFileSync(path.join(root,'scripts/boundary-robust-eval.mjs'))).digest('hex');
const rows=[],timing=Object.fromEntries(names.map(n=>[n,0])),sharedTiming={};
const start=performance.now();let frame=-1,images;
const samples=manifest.samples.filter(x=>x.split===split);
let verified=0;
for(const item of samples){
 if(frame!==item.frame){
  frame=item.frame;const rgb=fs.readFileSync(path.join(dir,`${frame}.rgb`)),data=new Uint8ClampedArray(manifest.width*manifest.height*4);
  if(rgb.length!==manifest.width*manifest.height*3)throw Error('Wrong RGB frame dimensions');
  for(let i=0;i<rgb.length/3;i++){data[i*4]=rgb[i*3];data[i*4+1]=rgb[i*3+1];data[i*4+2]=rgb[i*3+2];data[i*4+3]=255;}
  images=Object.fromEntries(axes.map(axis=>[axis,{width:manifest.width,height:manifest.height,data:channels(data,axis)}]));
 }
 const q=item.quad,w=Math.hypot((q[1][0]-q[0][0])*manifest.width,(q[1][1]-q[0][1])*manifest.height),h=Math.hypot((q[3][0]-q[0][0])*manifest.width,(q[3][1]-q[0][1])*manifest.height);
 const row={...item,predictions:{}};
 for(const axis of axes){
  const t=performance.now(),mask=buildFireColourMask(images[axis],palettes[axis],q),observed=base.sampleFrame(images[axis],q,mask);
  if(names.some(n=>boundaryKinds[n])){
   observed.nativePixels=new Int32Array(observed.valid.length).fill(-1);
   for(let cell=0;cell<256;cell++)for(let sub=0;sub<4;sub++)if(observed.valid[cell*4+sub]){
    const [u,v]=projectQuad(q,(cell%16+.25+.5*(sub%2))/16,(Math.floor(cell/16)+.25+.5*Math.floor(sub/2))/16);
    observed.nativePixels[cell*4+sub]=Math.round(v*manifest.height-.5)*manifest.width+Math.round(u*manifest.width-.5);
   }
  }
  sharedTiming[axis]=(sharedTiming[axis]??0)+performance.now()-t;
  for(const name of names.filter(n=>known[n]===axis)){
   const t=performance.now();
   const candidates=w*h<36||Math.min(w,h)<4||observed.count<64?[]:models[axis].map(m=>({...scores[name](observed,m),sheet:m.sheet,row:m.row,mirrored:m.mirrored})).sort((a,b)=>b.score-a.score);
   timing[name]+=performance.now()-t;
   const top=candidates[0],margin=top?top.score-(candidates[1]?.score??0):0;
   const status=!top?'insufficient':top.score===0?'weak':top.support<32||top.regions<3?'insufficient':margin<.03?'ambiguous':'clear';
   const correct=c=>!!c&&c.score>0&&c.sheet===item.expected[0]&&c.row===item.expected[1]&&c.mirrored===item.expected[2];
   row.predictions[name]={top,margin,status,correct:correct(top),top3:candidates.slice(0,3).some(correct),rowCorrect:!!top&&top.score>0&&top.row===item.expected[1],candidates:candidates.slice(0,3)};
   if(process.argv.includes('--verify')&&['raw','blue','green'].includes(name)&&top?.score>0&&verified<12){
    const actual=base.matchFireQuad(images[axis],palettes[axis],q,{refineGeometry:false});
    if(actual.status!==status||Math.abs(actual.margin-margin)>1e-12)throw Error('Adapter status/margin parity failed');
    if(top&&JSON.stringify(actual.candidates[0]&&[actual.candidates[0].sheet,actual.candidates[0].row,actual.candidates[0].mirrored,actual.candidates[0].score])!==JSON.stringify([top.sheet,top.row,top.mirrored,top.score]))throw Error('Adapter top parity failed');
    verified++;
   }
  }
 }
 rows.push(row);if(rows.length%100===0)console.error(`${split}: ${rows.length}/${samples.length}`);
}
function summary(items,name){const p=items.map(x=>x.predictions[name]);return {quads:p.length,frames:new Set(items.map(x=>x.frame)).size,exact:p.filter(x=>x.correct).length,top3:p.filter(x=>x.top3).length,row:p.filter(x=>x.rowCorrect).length,accepted_correct:p.filter(x=>x.status==='clear'&&x.correct).length,accepted_wrong:p.filter(x=>x.status==='clear'&&!x.correct).length};}
const result={kind:manifest.kind,split,names,hashes,verified,manifest_sha256:createHash('sha256').update(fs.readFileSync(path.join(dir,'manifest.json'))).digest('hex'),elapsed_seconds:(performance.now()-start)/1000,timing_ms:timing,mask_sample_ms:sharedTiming,
 summary:Object.fromEntries(names.map(n=>[n,summary(rows,n)])),groups:{},rows};
for(const [name,filter] of [['high_visibility',r=>r.visibility>=.75],['low_visibility',r=>r.visibility<.25],['unveiled',r=>r.unveiled],['sheet0',r=>r.expected[0]===0],['sheet1',r=>r.expected[0]===1]])result.groups[name]=Object.fromEntries(names.map(n=>[n,summary(rows.filter(filter),n)]));
const tagIndex=process.argv.indexOf('--tag'),tag=tagIndex<0?'scores':process.argv[tagIndex+1];
if(!tag||!/^[a-zA-Z0-9_-]+$/.test(tag))throw Error('Invalid output tag');
fs.writeFileSync(path.join(dir,`${tag}-${split}.json`),JSON.stringify(result));
console.log(JSON.stringify({...result,rows:undefined}));
