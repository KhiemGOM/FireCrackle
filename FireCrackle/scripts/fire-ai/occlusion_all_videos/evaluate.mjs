// Paired mask intervention on frozen boundary baselines, same native pixels.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {boundaryFeatures,featureScore} from '../../boundary-robust-eval.mjs';
import {applyMask} from '../../occlusion-mask-eval.mjs';

const app=path.resolve(import.meta.dirname,'../../..');
export const METHODS=['colour','pairs4','facing1','facing4','jitter_max_pairs1','jitter_max_pairs4'];
export const rank=(scores,eligible=true)=>eligible?scores.map((score,i)=>({score,i})).sort((a,b)=>b.score-a.score||a.i-b.i).map(r=>r.i):[];
const checkedGuiBuffers=new WeakSet();

// Classification is produced by core/gui_mask.rs; this only vetoes affected probes.
export function applyGui(o,q,width,height,classes,project,reliable=true){
 if(!reliable)return o;
 if(classes.length!==width*height)throw Error('Invalid GUI dimensions');
 if(!checkedGuiBuffers.has(classes)){if(classes.some(c=>c>3))throw Error('Invalid GUI classes');checkedGuiBuffers.add(classes);}
 const weights=Float64Array.from(o.weights);
 for(let cell=0;cell<256;cell++)for(let sub=0;sub<o.probes;sub++){
  const i=cell*o.probes+sub;if(!o.valid[i]||weights[i]===0)continue;
  const u=(cell%16+(o.probes===1?.5:.25+.5*(sub%2)))/16,v=(Math.floor(cell/16)+(o.probes===1?.5:.25+.5*Math.floor(sub/2)))/16;
  const [a,b]=project(q,u,v),x=a*width-.5,y=b*height-.5;
  const x0=Math.max(0,Math.min(width-1,Math.floor(x))),y0=Math.max(0,Math.min(height-1,Math.floor(y))),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1);
  if(classes[y0*width+x0]||classes[y0*width+x1]||classes[y1*width+x0]||classes[y1*width+x1])weights[i]=0;
 }
 return {...o,weights};
}

async function main(){
 const [inputArg,outArg,guiArg]=process.argv.slice(2);if(!outArg)throw Error('Usage: evaluate.mjs DATA OUT [GUI_DIR]');
 const dir=path.resolve(inputArg),out=path.resolve(outArg),runtime=path.join(out,'runtime');fs.mkdirSync(runtime,{recursive:true});
 const hashes={};
 for(const name of ['quadMatch','quadMask','fireColourMask','atlasFilter','quadOptimizer']){
  let source=fs.readFileSync(path.join(app,`src/lib/${name}.ts`),'utf8');hashes[name]=createHash('sha256').update(source).digest('hex');
  if(name==='quadMatch')source+='\nexport {sampleFrame,templates,similarity};';
  fs.writeFileSync(path.join(runtime,`${name}.cjs`),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText.replace(/require\("\.\/(\w+)"\)/g,'require("./$1.cjs")'));
 }
 const req=createRequire(import.meta.url),{sampleFrame,templates,similarity,matchFireQuad}=req(path.join(runtime,'quadMatch.cjs')),
  {buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs')),{projectQuad,validQuad}=req(path.join(runtime,'quadMask.cjs'));
 const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(app,`../fire-detection/data/assets/fire_${i}.rgba`)))),models=templates(sheets);
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),rows=[];let frame=-1,image,guiClasses,guiReliable=false;const started=performance.now();
 function observe(q,mask){
  const o=sampleFrame(image,q,mask);o.nativePixels=new Int32Array(o.valid.length).fill(-1);
  for(let cell=0;cell<256;cell++)for(let sub=0;sub<4;sub++)if(o.valid[cell*4+sub]){
   const [u,v]=projectQuad(q,(cell%16+.25+.5*(sub%2))/16,(Math.floor(cell/16)+.25+.5*Math.floor(sub/2))/16);
   o.nativePixels[cell*4+sub]=Math.round(v*image.height-.5)*image.width+Math.round(u*image.width-.5);
  }
  return o;
 }
 for(const [index,item] of manifest.samples.entries()){
  if(frame!==item.frame){frame=item.frame;const b=fs.readFileSync(path.join(manifest.native_source,`${frame}.rgb`)),data=new Uint8ClampedArray(manifest.width*manifest.height*4);
   if(b.length*4!==data.length*3)throw Error('Native dimensions');
   for(let i=0;i<b.length/3;i++){data[i*4]=b[i*3];data[i*4+1]=b[i*3+1];data[i*4+2]=b[i*3+2];data[i*4+3]=255;}image={width:manifest.width,height:manifest.height,data};
   if(guiArg){guiClasses=fs.readFileSync(path.join(guiArg,`${frame}.classes`));guiReliable=fs.readFileSync(path.join(guiArg,`${frame}.reliable`),'utf8').trim()==='1';}
  }
  const raw=fs.readFileSync(path.join(dir,`${item.mask_index}.mask`)),field=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
  if(field.length!==4096||field.some(p=>!Number.isFinite(p)||p<0||p>1))throw Error('Invalid mask');
  const q=item.quad,eligible=matchFireQuad(image,sheets,q,{refineGeometry:false}).searched>0,colourMask=buildFireColourMask(image,sheets,q),base=observe(q,colourMask),masked=applyMask(base,field),result={};
  const gui=guiArg?applyGui(base,q,image.width,image.height,guiClasses,projectQuad,guiReliable):base;
  const branches=[['',base,false,false],['_mask',masked,true,false]];
  if(guiArg)branches.push(['_gui',gui,false,true],['_both',applyMask(gui,field),true,true]);
  for(const [suffix,observed,useLearned,useGui] of branches){
   const scores={colour:[],pairs4:[],facing1:[],facing4:[]};
   for(const m of models){const f=boundaryFeatures(observed,m);scores.colour.push(similarity(observed,m).score);scores.pairs4.push(featureScore(f,'aggregate',4).score);scores.facing1.push(featureScore(f,'facing',1).score);scores.facing4.push(featureScore(f,'facing',4).score);}
   const usable=eligible&&(!useGui||observed.weights.some((w,i)=>w>0&&observed.fire[i]&&observed.valid[i]));
   const orders=Object.fromEntries(Object.entries(scores).map(([n,s])=>[n,rank(s,usable)]));
   const pool=Array.from(new Set([...orders.colour.slice(0,5),...orders.pairs4.slice(0,5)])),jitter=Object.fromEntries([1,4].map(w=>[w,new Map(pool.map(c=>[c,[]]))]));
   for(const dx of [-1/32,0,1/32])for(const dy of [-1/32,0,1/32]){
    const shape=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>projectQuad(q,u+dx,v+dy));
    let o=validQuad(shape)?observe(shape,colourMask):null;
    // This mask was predicted in q's UV frame. Translate sampling into that frame.
    if(o&&useLearned)o=applyMask(o,field,(u,v)=>[u+dx,v+dy]);
    if(o&&useGui)o=applyGui(o,shape,image.width,image.height,guiClasses,projectQuad,guiReliable);
    for(const c of pool){let f=null;if(o&&o.count>=64)f=boundaryFeatures(o,models[c]);for(const w of [1,4])jitter[w].get(c).push(f?featureScore(f,'aggregate',w).score:0);}
   }
   for(const w of [1,4]){
    const values=new Map(pool.map(c=>[c,Math.max(...jitter[w].get(c))]));
    orders[`jitter_max_pairs${w}`]=pool.slice().sort((a,b)=>values.get(b)-values.get(a)||orders.colour.indexOf(a)-orders.colour.indexOf(b));
   }
   const truth=item.expected[0]*64+item.expected[1]*2+Number(item.expected[2]);
   for(const name of METHODS){const order=orders[name];result[name+suffix]={top:order[0]??null,top5:order.slice(0,5),correct:order[0]===truth,top3:order.slice(0,3).includes(truth)};}
  }
  const guiRemoved=base.weights.reduce((n,w,i)=>n+Number(base.fire[i]&&w>0&&gui.weights[i]===0),0);
  rows.push({...item,eligible,guiReliable,guiRemoved,methods:result});if((index+1)%100===0)console.error(`${index+1}/${manifest.samples.length}`);
 }
 const suffixes=guiArg?['','_mask','_gui','_both']:['','_mask'];
 const summary=Object.fromEntries(suffixes.flatMap(s=>METHODS.map(n=>n+s)).map(n=>[n,{top1:rows.filter(r=>r.methods[n].correct).length,top3:rows.filter(r=>r.methods[n].top3).length}]));
 const result={n:rows.length,video:manifest.video,mode:manifest.mode,hashes,adapter_sha256:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),boundary_sha256:createHash('sha256').update(fs.readFileSync(path.join(app,'scripts/boundary-robust-eval.mjs'))).digest('hex'),seconds:(performance.now()-started)/1000,summary,rows};
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result));console.log(JSON.stringify({...result,rows:undefined}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename)await main();
