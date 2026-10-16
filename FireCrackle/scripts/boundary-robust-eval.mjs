// Research only. All feature votes are nonnegative with fixed normalization.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const app=path.resolve(import.meta.dirname,'..');
const PAIRS=[];
for(let y=0;y<16;y++)for(let x=0;x<16;x++){const a=y*16+x;if(x<15)PAIRS.push([a,a+1,0]);if(y<15)PAIRS.push([a,a+16,1]);}
const ADJ=1-(1/12)/.12;
export function boundaryFeatures(o,model){
 const gains=new Float64Array(256*96),hist=new Float64Array(96),touched=Array.from({length:256},()=>[]),
  first=new Int32Array(256*96),two=new Uint8Array(256*96),bins=new Int16Array(256*o.probes).fill(-999),hits=new Float64Array(256*o.probes);
 for(let cell=0;cell<256;cell++)if(model.alpha[cell]>127)for(let sub=0;sub<o.probes;sub++){
  const i=cell*o.probes+sub;if(!o.valid[i]||!o.fire[i])continue;
  const a=i*3,t=cell*3,R=Math.max(model.rgb[t],1),r=Math.max(o.rgb[a],1),dg=Math.abs(o.rgb[a+1]/r-model.rgb[t+1]/R),db=Math.abs(o.rgb[a+2]/r-model.rgb[t+2]/R);
  if(dg>.06||db>.1)continue;
  const bin=Math.round((Math.log2(r/R)+5)*12),vote=(1-.5*(dg/.06+db/.1))*o.weights[i]/o.probes;
  bins[i]=bin;hits[i]=vote;
  for(let d=-1;d<=1;d++){
   const b=bin+d;if(b<12||b>76)continue;
   const j=cell*96+b,value=vote*(d===0?1:ADJ);if(gains[j]===0&&value>0)touched[cell].push(b);
   gains[j]+=value;hist[b]+=value;
   if(value>0){const pixel=(o.nativePixels?.[i]??i)+1;if(!first[j])first[j]=pixel;else if(first[j]!==pixel)two[j]=1;}
  }
 }
 const edge=Object.fromEntries(['aggregate','matched','facing','distinct','gradient'].map(n=>[n,new Float64Array(96)]));
 const at=(i,bin)=>Math.abs(bins[i]-bin)>1?0:hits[i]*(bins[i]===bin?1:ADJ);
 for(const [a,b,axis] of PAIRS){
  if(!touched[a].length||!touched[b].length||model.alpha[a]<=127||model.alpha[b]<=127)continue;
  const R=Math.max(model.rgb[a*3],1),S=Math.max(model.rgb[b*3],1),delta=Math.log2(R/S),contrast=Math.min(1,Math.abs(delta)/.5+Math.abs(model.rgb[a*3+1]/R-model.rgb[b*3+1]/S)/.1);
  if(!contrast)continue;
  for(const bin of touched[a]){
   const vote=contrast*Math.min(gains[a*96+bin],gains[b*96+bin]);edge.aggregate[bin]+=vote;
   if(two[a*96+bin]&&two[b*96+bin])edge.distinct[bin]+=vote;
   for(let sub=0;sub<o.probes;sub++){
    const i=a*o.probes+sub,j=b*o.probes+sub;
    if(o.nativePixels&&o.nativePixels[i]===o.nativePixels[j])continue;
    const paired=contrast*Math.min(at(i,bin),at(j,bin));edge.matched[bin]+=paired;
    const observedDelta=Math.log2(Math.max(o.rgb[i*3],1)/Math.max(o.rgb[j*3],1));
    edge.gradient[bin]+=paired*Math.max(0,1-Math.abs(observedDelta-delta)/.12);
   }
   const facing=o.probes===4?(axis===0?[[1,0],[3,2]]:[[2,0],[3,1]]):[[0,0]];
   for(const [sa,sb] of facing){const i=a*o.probes+sa,j=b*o.probes+sb;if(o.nativePixels&&o.nativePixels[i]===o.nativePixels[j])continue;edge.facing[bin]+=contrast*Math.min(at(i,bin),at(j,bin))*(o.probes===4?2:1);}
  }
 }
 return {hist,edge};
}
export function featureScore(features,kind='aggregate',weight=4){
 let best=0,gain=12;
 for(let i=12;i<=76;i++){const score=(features.hist[i]+weight*features.edge[kind][i])/(256+weight*480);if(score>best){best=score;gain=i;}}
 return {score:best,gain,single:features.hist[gain],boundary:features.edge[kind][gain]};
}
export function stricterObservation(o,palette,kind){
 const fire=Uint8Array.from(o.fire);
 for(let i=0;i<fire.length;i++)if(fire[i]){
  const r=o.rgb[i*3],g=o.rgb[i*3+1],b=o.rgb[i*3+2];
  if(kind==='neutral'){fire[i]=Number(b<=r*.6||r>=200);continue;}
  fire[i]=Number(r>=25&&palette.some(([R,G,B])=>{
   const gain=r/Math.max(R,1),warm=b<=r*.6&&B<=R*.6&&G>=R*.3,core=r>=130&&g>=r*.8&&G>=R*.8&&B>=R*.6;
   return (warm||core)&&gain>=.25&&gain<=1.25&&Math.abs(g/r-G/Math.max(R,1))<=.03&&Math.abs(b/r-B/Math.max(R,1))<=.05;
  }));
 }
 return {...o,fire};
}
export const METHODS=['colour','pairs025','pairs1','pairs4',
 'matched1','matched4','facing1','facing4','distinct1','distinct4','gradient1','gradient4',
 'shortlist3','shortlist5','rrf2','strict_colour','strict_pairs','neutral_colour','neutral_pairs',
 'jitter_max_colour','jitter_max_pairs1','jitter_max_pairs4','jitter_mean_colour','jitter_mean_pairs1','jitter_mean_pairs4'];
function rank(scores,eligible=true){return eligible?scores.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v).map(r=>r.i):[];}
export function chooseShortlist(base,pair,count){const allowed=base.slice(0,count);return allowed.sort((a,b)=>pair[b]-pair[a]||base.indexOf(a)-base.indexOf(b));}
async function main(){
 const [dirArg,outArg,split='tune',mode='exact']=process.argv.slice(2);
 if(!dirArg||!outArg||!['tune','validation'].includes(split)||!['exact','rough'].includes(mode))throw Error('Usage: boundary-robust-eval.mjs DATA OUT tune|validation exact|rough');
 const dir=path.resolve(dirArg),out=path.resolve(outArg),runtime=path.join(out,'runtime');fs.mkdirSync(runtime,{recursive:true});
 const hashes={};for(const name of ['quadMatch','quadMask','fireColourMask','atlasFilter','quadOptimizer']){
  let source=fs.readFileSync(path.join(app,`src/lib/${name}.ts`),'utf8');hashes[name]=createHash('sha256').update(source).digest('hex');if(name==='quadMatch')source+='\nexport {sampleFrame,templates,similarity};';
  fs.writeFileSync(path.join(runtime,`${name}.cjs`),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText.replace(/require\("\.\/(\w+)"\)/g,'require("./$1.cjs")'));
 }
 const req=createRequire(import.meta.url),{sampleFrame,templates,similarity,matchFireQuad}=req(path.join(runtime,'quadMatch.cjs')),{buildFireColourMask,firePalette}=req(path.join(runtime,'fireColourMask.cjs')),{projectQuad,validQuad}=req(path.join(runtime,'quadMask.cjs'));
 const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(app,`../fire-detection/data/assets/fire_${i}.rgba`)))),models=templates(sheets),palette=firePalette(sheets);
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),rows=[];let frame=-1,image;const start=performance.now();
 function sample(q,mask){
  const o=sampleFrame(image,q,mask);o.nativePixels=new Int32Array(o.valid.length).fill(-1);
  for(let cell=0;cell<256;cell++)for(let sub=0;sub<4;sub++)if(o.valid[cell*4+sub]){
   const [u,v]=projectQuad(q,(cell%16+.25+.5*(sub%2))/16,(Math.floor(cell/16)+.25+.5*Math.floor(sub/2))/16);
   o.nativePixels[cell*4+sub]=Math.round(v*image.height-.5)*image.width+Math.round(u*image.width-.5);
  }
  return o;
 }
 for(const item of manifest.samples.filter(x=>x.split===split)){
  if(frame!==item.frame){frame=item.frame;const b=fs.readFileSync(path.join(dir,`${frame}.rgb`)),data=new Uint8ClampedArray(manifest.width*manifest.height*4);if(b.length*4!==data.length*3)throw Error('Bad native frame');for(let i=0;i<b.length/3;i++){data[i*4]=b[i*3];data[i*4+1]=b[i*3+1];data[i*4+2]=b[i*3+2];data[i*4+3]=255;}image={width:manifest.width,height:manifest.height,data};}
  const q=mode==='exact'?item.quad:[[0,0],[1,0],[1,1],[0,1]].map(([u,v],i)=>projectQuad(item.quad,(u-.5)*1.12+.5+.03+(i===1?.02:0),(v-.5)*.92+.5-.02+(i===2?.02:0)));
  const eligible=matchFireQuad(image,sheets,q,{refineGeometry:false}).searched>0,mask=buildFireColourMask(image,sheets,q),o=sample(q,mask),strict=stricterObservation(o,palette,'strict'),neutral=stricterObservation(o,palette,'neutral');
  const arrays=Object.fromEntries(METHODS.map(n=>[n,[]])),features=[];
  for(const m of models){
   const f=boundaryFeatures(o,m);features.push(f);arrays.colour.push(similarity(o,m).score);
   for(const [name,kind,w] of [['pairs025','aggregate',.25],['pairs1','aggregate',1],['pairs4','aggregate',4],...['matched','facing','distinct','gradient'].flatMap(kind=>[1,4].map(w=>[kind+w,kind,w]))])arrays[name].push(featureScore(f,kind,w).score);
   for(const [name,obs] of [['strict',strict],['neutral',neutral]]){arrays[name+'_colour'].push(similarity(obs,m).score);arrays[name+'_pairs'].push(featureScore(boundaryFeatures(obs,m)).score);}
  }
  const base=rank(arrays.colour,eligible),pairs=rank(arrays.pairs4,eligible),orders={};
  orders.shortlist3=chooseShortlist(base,arrays.pairs4,3);orders.shortlist5=chooseShortlist(base,arrays.pairs4,5);
  const rr=new Float64Array(128);for(const list of [base,pairs])list.slice(0,5).forEach((c,i)=>rr[c]+=1/(61+i));orders.rrf2=rank(Array.from(rr),eligible);
  const pool=Array.from(new Set([...base.slice(0,5),...pairs.slice(0,5)]));
  const jitter=Object.fromEntries(['colour','pairs1','pairs4'].map(n=>[n,new Map(pool.map(c=>[c,[]]))]));
  for(const dx of [-1/32,0,1/32])for(const dy of [-1/32,0,1/32]){
   const shape=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>projectQuad(q,u+dx,v+dy));
   const obs=validQuad(shape)?sample(shape,mask):null;
   for(const c of pool){let values=[0,0,0];if(obs&&obs.count>=64){const f=boundaryFeatures(obs,models[c]);values=[similarity(obs,models[c]).score,featureScore(f,'aggregate',1).score,featureScore(f,'aggregate',4).score];}
    ['colour','pairs1','pairs4'].forEach((n,i)=>jitter[n].get(c).push(values[i]));}
  }
  for(const name of ['colour','pairs1','pairs4'])for(const agg of ['max','mean']){
   const scores=new Map(pool.map(c=>{const values=jitter[name].get(c);return [c,agg==='max'?Math.max(...values):values.reduce((a,b)=>a+b,0)/9];}));
   orders[`jitter_${agg}_${name}`]=pool.slice().sort((a,b)=>scores.get(b)-scores.get(a)||base.indexOf(a)-base.indexOf(b));
  }
  const truth=models.findIndex(m=>m.sheet===item.expected[0]&&m.row===item.expected[1]&&m.mirrored===item.expected[2]),packed={};
  for(const name of METHODS){const order=orders[name]??rank(arrays[name],eligible);packed[name]={top:order[0]??null,top5:order.slice(0,5),correct:order[0]===truth,top3:order.slice(0,3).includes(truth)};}
  const describe=c=>c===undefined?null:Object.fromEntries(['aggregate','matched','facing','distinct','gradient'].map(k=>[k,featureScore(features[c],k,4)]));
  rows.push({id:item.id,frame:item.frame,source:item.source,expected:item.expected,eligible,quad:q,observedFire:o.fire.reduce((a,b)=>a+b,0),strictFire:strict.fire.reduce((a,b)=>a+b,0),neutralFire:neutral.fire.reduce((a,b)=>a+b,0),methods:packed,detail:{truth:describe(truth),colour:describe(base[0]),pairs:describe(pairs[0])}});
  if(rows.length%100===0)console.error(`${split}/${mode}: ${rows.length}`);
 }
 const summary=Object.fromEntries(METHODS.map(name=>[name,{top1:rows.filter(r=>r.methods[name].correct).length,top3:rows.filter(r=>r.methods[name].top3).length}]));
 const result={split,mode,n:rows.length,hashes,scriptSHA256:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),joined_sha256:manifest.joined_sha256,seconds:(performance.now()-start)/1000,summary,rows};
 fs.writeFileSync(path.join(out,`${split}-${mode}.json`),JSON.stringify(result));console.log(JSON.stringify({...result,rows:undefined}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename)await main();
