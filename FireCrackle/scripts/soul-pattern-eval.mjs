// Readable-quads-only research. Reuses production sampling; no independent unveil.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {quadReadability} from './soul-quad-size-audit.mjs';
import {gradients,gridEvidence} from './edge-grid-eval.mjs';

const app=path.resolve(import.meta.dirname,'..'),dir=path.resolve(process.argv[2]),split=process.argv[3]??'tune';
if(!['tune','validation'].includes(split))throw Error('Choose tune or validation');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),runtime=path.join(dir,'runtime'),req=createRequire(import.meta.url),
 {sampleFrame,templates,similarity}=req(path.join(runtime,'quadMatch.cjs')),{buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs'));
const {optimizeQuad}=req(path.join(runtime,'quadOptimizer.cjs'));
const prior=JSON.parse(fs.readFileSync(path.join(dir,'scores-validation.json'))),hashes={};
for(const name of ['quadMatch','quadMask','fireColourMask','atlasFilter','quadOptimizer','animationAtlases']){
 hashes[name]=createHash('sha256').update(fs.readFileSync(path.join(app,`src/lib/${name}.ts`))).digest('hex');
 if(hashes[name]!==prior.hashes[name])throw Error('Rebuild frozen runtime: production source changed');
}
let source=fs.readFileSync(path.join(app,'src/lib/quadMatch.ts'),'utf8');
source=source.slice(source.indexOf('function similarity('),source.indexOf('\n/** Search128')).replace('function similarity(','export function similarity(').replaceAll('0.06','0.18').replaceAll('0.10','0.30');
fs.writeFileSync(path.join(runtime,'pattern-loose.cjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText);
const loose=req(path.join(runtime,'pattern-loose.cjs')).similarity;
const permute=data=>{const out=new Uint8ClampedArray(data.length);for(let i=0;i<data.length;i+=4){out[i]=data[i+1];out[i+1]=data[i+2];out[i+2]=data[i];out[i+3]=data[i+3];}return out;};
const sheets=[0,1].map(i=>permute(new Uint8ClampedArray(fs.readFileSync(path.join(dir,`soul_${i}.rgba`))))),models=templates(sheets);
const fusions={fuse_affine:'affine_norm',fuse_chroma:'chroma_norm',fuse_white:'whiteness_norm',fuse_local:'local2',fuse_smooth:'smooth_gain',fuse_shape:'alpha_precision',fuse_narrow:'narrow_norm'};
const methods=['narrow','loose','narrow_norm','loose_norm','alpha_support','alpha_precision','alpha_iou','whiteness','whiteness_norm','chroma','chroma_norm','chroma_shape','local2','local4','smooth_gain','gain025','gain05','gain1','affine_colour','affine_norm','edge_fit','edge_supported','edge_max','row_top2','row_sum4',...Object.keys(fusions)];
function affineColour(o,m){
 const samples=[];
 for(let cell=0;cell<256;cell++)if(m.alpha[cell]>127){
  const rgb=[0,0,0];let weight=0;
  for(let s=0;s<o.probes;s++){const i=cell*o.probes+s;if(!o.valid[i]||!o.fire[i])continue;const w=o.weights[i]/o.probes;weight+=w;for(let c=0;c<3;c++)rgb[c]+=o.rgb[i*3+c]*w;}
  if(weight)samples.push({rgb:rgb.map(x=>x/weight),weight,t:m.rgb.subarray(cell*3,cell*3+3)});
 }
 let best=0;
 for(const gain of [.25,.375,.5,.625,.75,.875,1,1.125,1.25])for(const shift of [0,8]){
  const histogram=new Map();
  for(const p of samples){const d=p.rgb.map((v,c)=>v-gain*p.t[c]);if(d.some(x=>Math.abs(x)>64))continue;const bins=d.map(x=>Math.floor((x+80+shift)/16)),key=bins[0]*1024+bins[1]*32+bins[2],value=(histogram.get(key)??0)+p.weight;histogram.set(key,value);best=Math.max(best,value);}
 }
 return best/256;
}
function lightingScores(o,m){
 const bank2=Array.from({length:4},()=>new Float64Array(96)),bank4=Array.from({length:16},()=>new Float64Array(96)),hits=[];
 for(let cell=0;cell<256;cell++)if(m.alpha[cell]>127)for(let s=0;s<o.probes;s++){
  const i=cell*o.probes+s;if(!o.valid[i]||!o.fire[i])continue;
  const a=i*3,t=cell*3,g=Math.max(o.rgb[a],1),G=Math.max(m.rgb[t],1),db=Math.abs(o.rgb[a+1]/g-m.rgb[t+1]/G),dr=Math.abs(o.rgb[a+2]/g-m.rgb[t+2]/G);
  if(db>.18||dr>.30)continue;
  const gain=Math.log2(g/G),vote=(1-.5*(db/.18+dr/.30))*o.weights[i]/o.probes,bin=Math.round((gain+5)*12),x=cell%16,y=Math.floor(cell/16);
  if(bin>=0&&bin<96){bank2[Math.floor(x/8)+2*Math.floor(y/8)][bin]+=vote;bank4[Math.floor(x/4)+4*Math.floor(y/4)][bin]+=vote;}
  hits.push({gain,vote,u:(x+.25+.5*(s%2))/16-.5,v:(y+.25+.5*Math.floor(s/2))/16-.5});
 }
 const max=h=>{let best=0;for(let i=12;i<=76;i++)best=Math.max(best,h[i]+(1-(1/12)/.12)*(h[i-1]+h[i+1]));return best;};
 let smooth=0;
 for(const sx of [-1,-.5,0,.5,1])for(const sy of [-1,-.5,0,.5,1]){
  const h=new Float64Array(96);for(const hit of hits){const bin=Math.round((hit.gain-sx*hit.u-sy*hit.v+5)*12);if(bin>=0&&bin<96)h[bin]+=hit.vote;}smooth=Math.max(smooth,max(h));
 }
 const global=new Float64Array(96);for(const hit of hits){const b=Math.round((hit.gain+5)*12);if(b>=0&&b<96)global[b]+=hit.vote;}
 const broad=width=>{let best=0;for(let bin=12;bin<=76;bin++){let sum=0;for(let b=0;b<96;b++)sum+=global[b]*Math.max(0,1-Math.abs(bin-b)/12/width);best=Math.max(best,sum);}return best/256;};
 return {local2:bank2.reduce((s,h)=>s+max(h),0)/256,local4:bank4.reduce((s,h)=>s+max(h),0)/256,smooth_gain:smooth/256,gain025:broad(.25),gain05:broad(.5),gain1:broad(1)};
}
const rows=[];let frame=-1,image,gradient;const start=performance.now();
for(const item of manifest.samples.filter(r=>r.split===split&&quadReadability(r.quad,manifest.width,manifest.height).eligible)){
 if(frame!==item.frame){frame=item.frame;const rgb=fs.readFileSync(path.join(dir,`${frame}.rgb`)),data=new Uint8ClampedArray(manifest.width*manifest.height*4);
  for(let i=0;i<rgb.length/3;i++){data[i*4]=rgb[i*3];data[i*4+1]=rgb[i*3+1];data[i*4+2]=rgb[i*3+2];data[i*4+3]=255;}
  image={width:manifest.width,height:manifest.height,data:permute(data)};
  gradient=gradients(image);
 }
 const mask=buildFireColourMask(image,sheets,item.quad),o=sampleFrame(image,item.quad,mask),values=Object.fromEntries(methods.map(m=>[m,[]]));
 const evidence=q=>gridEvidence(gradient,mask,q,{orientation:1,localize:true}),fit=optimizeQuad(item.quad,q=>evidence(q).score,220),edge=evidence(fit.quad),
  adjusted=edge.vertical>=4&&edge.horizontal>=4&&edge.edges>=24?fit.quad:item.quad,
  fitObservation=sampleFrame(image,adjusted,mask),supportObservation={...fitObservation,fire:Uint8Array.from(fitObservation.fire)},active=evidence(adjusted);
 for(let cell=0;cell<256;cell++)if(active.cells[cell]<.2)for(let s=0;s<o.probes;s++)supportObservation.fire[cell*o.probes+s]=0;
 const cyan=new Float64Array(o.valid.length);let cyanTotal=0;
 for(let i=0;i<cyan.length;i++)if(o.valid[i]){
  // Channels are now G,B,R. White cores are retained by the palette mask;
  // chromatically cyan samples provide additional candidate-independent support.
  const g=o.rgb[i*3],b=o.rgb[i*3+1],r=o.rgb[i*3+2];
  cyan[i]=Number(o.fire[i]||Math.min(g,b)-r>=20&&Math.max(g,b)>=40&&Math.min(g,b)>=Math.max(g,b)*.6);
  cyanTotal+=cyan[i]*o.weights[i]/o.probes;
 }
 const diagnostics=[];
 for(const m of models){
  const area=m.alpha.reduce((a,b)=>a+Number(b>127),0),n=similarity(o,m),l=loose(o,m);
  let support=0,white=0,chroma=0;
  for(let cell=0;cell<256;cell++)if(m.alpha[cell]>127)for(let sub=0;sub<o.probes;sub++){
   const i=cell*o.probes+sub;if(!o.valid[i]||!cyan[i])continue;
   const a=i*3,t=cell*3,g=Math.max(o.rgb[a],1),G=Math.max(m.rgb[t],1),w=o.weights[i]/o.probes;
   const dw=Math.abs(o.rgb[a+2]/g-m.rgb[t+2]/G),db=Math.abs(o.rgb[a+1]/g-m.rgb[t+1]/G);
   support+=w;white+=w*Math.max(0,1-dw/.25);chroma+=w*Math.max(0,1-.5*(dw/.3+db/.2));
  }
  const affine=affineColour(o,m),edgeScore=loose(fitObservation,m).score;
  const scores={narrow:n.score,loose:l.score,narrow_norm:n.score*256/area,loose_norm:l.score*256/area,affine_colour:affine,affine_norm:affine*256/area,
   alpha_support:support/256,alpha_precision:support/area,alpha_iou:support/Math.max(1,area+cyanTotal-support),
   whiteness:white/256,whiteness_norm:white/area,chroma:chroma/256,chroma_norm:chroma/area,
   chroma_shape:chroma/Math.max(1,area+cyanTotal-support),...lightingScores(o,m),edge_fit:edgeScore,edge_supported:loose(supportObservation,m).score,edge_max:Math.max(l.score,edgeScore)};
  for(const name of methods)if(scores[name]!==undefined)values[name].push(scores[name]);
  diagnostics.push({area,support,maskSamples:n.maskSamples,narrowSupport:n.support,looseSupport:l.support});
 }
 for(const [name,secondary] of Object.entries(fusions)){
  values[name]=new Array(models.length).fill(0);
  for(const [key,weight] of [['loose',2],[secondary,1]])values[key].map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v).forEach((x,rank)=>{if(x.v>0)values[name][x.i]+=weight/(8+rank);});
 }
 for(const [name,count] of [['row_top2',2],['row_sum4',4]]){
  const rowScores=Array.from({length:32},(_,row)=>values.loose.filter((_,i)=>models[i].row===row).sort((a,b)=>b-a).slice(0,count).reduce((a,b)=>a+b,0)/count);
  values[name]=models.map((m,i)=>rowScores[m.row]+values.loose[i]*1e-9);
 }
 const predictions={};
 for(const name of methods){const indices=values[name].map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v),top=models[indices[0].i],correct=i=>values[name][i]>0&&models[i].sheet===item.expected[0]&&models[i].row===item.expected[1]&&models[i].mirrored===item.expected[2];
  predictions[name]={index:indices[0].i,top:[top.sheet,top.row,top.mirrored],score:indices[0].v,margin:indices[0].v-indices[1].v,correct:correct(indices[0].i),top3:indices.slice(0,3).some(x=>correct(x.i)),rowCorrect:indices[0].v>0&&top.row===item.expected[1]};
 }
 const truth=models.findIndex(m=>m.sheet===item.expected[0]&&m.row===item.expected[1]&&m.mirrored===item.expected[2]);
 rows.push({...item,predictions,cyanTotal,truthDiagnostics:diagnostics[truth],winnerDiagnostics:diagnostics[predictions.loose.index]});
}
const summary=Object.fromEntries(methods.map(n=>[n,{n:rows.length,exact:rows.filter(r=>r.predictions[n].correct).length,top3:rows.filter(r=>r.predictions[n].top3).length,row:rows.filter(r=>r.predictions[n].rowCorrect).length}]));
const report={split,hashes,script_sha256:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),manifest_sha256:prior.manifest_sha256,seconds:(performance.now()-start)/1000,summary,rows};
fs.writeFileSync(path.join(dir,`patterns-${split}.json`),JSON.stringify(report));console.log(JSON.stringify({...report,rows:undefined}));
