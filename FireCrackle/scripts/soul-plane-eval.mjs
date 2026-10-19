// Research only: outline-aligned flatness and connected colour/gain support.
// Inputs at inference are one quad, native RGB and the complete texture atlas.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {quadReadability} from './soul-quad-size-audit.mjs';

export function interiorSpread(pixels){
 if(!pixels.length)return Infinity;
 const quantile=(v,p)=>v.sort((a,b)=>a-b)[Math.floor((v.length-1)*p)];
 return Math.max(...[0,1,2].map(c=>quantile(pixels.map(p=>p[c]),.9)-quantile(pixels.map(p=>p[c]),.1)));
}
export function connectedVotes(votes,diagonal=false){
 const seen=new Uint8Array(256),components=[];
 for(let i=0;i<256;i++)if(votes[i]>0&&!seen[i]){
  let sum=0;const queue=[i];seen[i]=1;
  for(let n=0;n<queue.length;n++){
   const cell=queue[n],x=cell%16,y=Math.floor(cell/16);sum+=votes[cell];
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    if(!dx&&!dy||!diagonal&&dx&&dy)continue;
    const X=x+dx,Y=y+dy,j=Y*16+X;
    if(X>=0&&X<16&&Y>=0&&Y<16&&votes[j]>0&&!seen[j]){seen[j]=1;queue.push(j);}
   }
  }
  components.push(sum);
 }
 return components.sort((a,b)=>b-a);
}
export function clusterScore(o,m,{diagonal=false,top=1,coherent=false}={}){
 const hits=[];
 for(let cell=0;cell<256;cell++)if(m.alpha[cell]>127)for(let s=0;s<o.probes;s++){
  const i=cell*o.probes+s;if(!o.valid[i]||!o.fire[i])continue;
  const a=i*3,t=cell*3,g=Math.max(o.rgb[a],1),G=Math.max(m.rgb[t],1),db=Math.abs(o.rgb[a+1]/g-m.rgb[t+1]/G),dr=Math.abs(o.rgb[a+2]/g-m.rgb[t+2]/G);
  if(db>.18||dr>.30)continue;
  const bin=Math.round((Math.log2(g/G)+5)*12);
  if(bin>=0&&bin<96)hits.push({cell,bin,vote:(1-.5*(db/.18+dr/.30))*o.weights[i]/o.probes});
 }
 let best=0;
 for(let b=12;b<=76;b++){
  const votes=new Float64Array(256),counts=new Uint8Array(256);
  for(const h of hits)if(Math.abs(h.bin-b)<=1){votes[h.cell]+=h.vote*(h.bin===b?1:1-(1/12)/.12);counts[h.cell]++;}
  if(coherent)for(let c=0;c<256;c++)if(counts[c]<3)votes[c]=0;
  best=Math.max(best,connectedVotes(votes,diagonal).slice(0,top).reduce((a,b)=>a+b,0));
 }
 return best/256;
}
function pixel(image,u,v){
 const X=u*image.width-.5,Y=v*image.height-.5;if(X<0||Y<0||X>image.width-1||Y>image.height-1)return null;
 const x=Math.floor(X),y=Math.floor(Y),xx=Math.min(x+1,image.width-1),yy=Math.min(y+1,image.height-1),fx=X-x,fy=Y-y;
 return [0,1,2].map(c=>image.data[(y*image.width+x)*4+c]*(1-fx)*(1-fy)+image.data[(y*image.width+xx)*4+c]*fx*(1-fy)+image.data[(yy*image.width+x)*4+c]*(1-fx)*fy+image.data[(yy*image.width+xx)*4+c]*fx*fy);
}
async function main(){
 const dir=path.resolve(process.argv[2]),split=process.argv[3]??'tune';if(!['tune','validation'].includes(split))throw Error('Invalid split');
 const req=createRequire(import.meta.url),runtime=path.join(dir,'runtime'),prior=JSON.parse(fs.readFileSync(path.join(dir,'patterns-tune.json'))),hashes={};
 for(const name of Object.keys(prior.hashes)){
  hashes[name]=createHash('sha256').update(fs.readFileSync(path.join(import.meta.dirname,`../src/lib/${name}.ts`))).digest('hex');
  if(hashes[name]!==prior.hashes[name])throw Error('Stale prepared runtime');
 }
 const {sampleFrame,templates}=req(path.join(runtime,'quadMatch.cjs')),{projectQuad}=req(path.join(runtime,'quadMask.cjs')),
  {similarity:loose}=req(path.join(runtime,'pattern-loose.cjs')),{buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs'));
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),permute=data=>{const a=new Uint8ClampedArray(data.length);for(let i=0;i<a.length;i+=4){a[i]=data[i+1];a[i+1]=data[i+2];a[i+2]=data[i];a[i+3]=data[i+3];}return a;},
  sheets=[0,1].map(i=>permute(fs.readFileSync(path.join(dir,`soul_${i}.rgba`)))),models=templates(sheets),
  variants=['loose','flat8','flat16','flat32','relative05','relative10','relative20','flat_soft','connected4','connected8','connected_top2','coherent3','coherent_connected'];
 const reference=new Map(JSON.parse(fs.readFileSync(path.join(dir,`patterns-${split}.json`))).rows.map(r=>[r.id,r.predictions.loose]));
 const rows=[];let frame=-1,image;const start=performance.now();
 for(const item of manifest.samples.filter(r=>r.split===split&&quadReadability(r.quad,manifest.width,manifest.height).eligible)){
  if(frame!==item.frame){frame=item.frame;const rgb=fs.readFileSync(path.join(dir,`${frame}.rgb`)),data=new Uint8ClampedArray(manifest.width*manifest.height*4);for(let i=0;i<rgb.length/3;i++){data[i*4]=rgb[i*3];data[i*4+1]=rgb[i*3+1];data[i*4+2]=rgb[i*3+2];data[i*4+3]=255;}image={width:manifest.width,height:manifest.height,data:permute(data)};}
  const mask=buildFireColourMask(image,sheets,item.quad),o=sampleFrame(image,item.quad,mask),spreads=[],relative=[];
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
   const p=[];for(let sy=0;sy<5;sy++)for(let sx=0;sx<5;sx++){const [u,v]=projectQuad(item.quad,(x+.2+.15*sx)/16,(y+.2+.15*sy)/16),rgb=pixel(image,u,v);if(rgb)p.push(rgb);}
   const spread=interiorSpread(p),mean=p.reduce((s,p)=>s+Math.max(...p),0)/Math.max(1,p.length);spreads.push(spread);relative.push(spread/Math.max(32,mean));
  }
  const observations={loose:o};
  for(const name of variants.slice(1,8)){
   const weights=Float64Array.from(o.weights);for(let c=0;c<256;c++){
    const factor=name==='flat_soft'?1/(1+(spreads[c]/16)**2):name.startsWith('flat')?Number(spreads[c]<=Number(name.slice(4))):Number(relative[c]<=({relative05:.05,relative10:.1,relative20:.2}[name]));
    for(let s=0;s<o.probes;s++)weights[c*o.probes+s]*=factor;
   }observations[name]={...o,weights};
  }
  const values=Object.fromEntries(variants.map(n=>[n,[]]));
  for(const m of models){
   for(const [name,obs] of Object.entries(observations))values[name].push(loose(obs,m).score);
   for(const [name,opt] of [['connected4',{}],['connected8',{diagonal:true}],['connected_top2',{top:2}],['coherent3',{top:256,coherent:true}],['coherent_connected',{diagonal:true,coherent:true}]])values[name].push(clusterScore(o,m,opt));
  }
  // Ground truth is accessed only after every score has been computed.
  const predictions={};for(const name of variants){const order=values[name].map((score,i)=>({score,i})).sort((a,b)=>b.score-a.score),m=models[order[0].i],correct=i=>values[name][i]>0&&models[i].sheet===item.expected[0]&&models[i].row===item.expected[1]&&models[i].mirrored===item.expected[2];predictions[name]={top:[m.sheet,m.row,m.mirrored],score:order[0].score,margin:order[0].score-order[1].score,correct:correct(order[0].i),top3:order.slice(0,3).some(x=>correct(x.i)),rowCorrect:order[0].score>0&&m.row===item.expected[1]};}
  const control=reference.get(item.id);
  if(!control||JSON.stringify(control.top)!==JSON.stringify(predictions.loose.top)||Math.abs(control.score-predictions.loose.score)>1e-12)throw Error(`Baseline parity failed: ${item.id}`);
  if(Object.values(predictions).some(p=>!Number.isFinite(p.score)||p.score<0||p.score>1+1e-12))throw Error('Invalid score');
  rows.push({...item,predictions,flatCells:[8,16,32].map(t=>spreads.filter(x=>x<=t).length)});
 }
 const summary=Object.fromEntries(variants.map(n=>[n,{n:rows.length,exact:rows.filter(r=>r.predictions[n].correct).length,top3:rows.filter(r=>r.predictions[n].top3).length,row:rows.filter(r=>r.predictions[n].rowCorrect).length}])),report={split,hashes,script_sha256:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),loose_runtime_sha256:createHash('sha256').update(fs.readFileSync(path.join(runtime,'pattern-loose.cjs'))).digest('hex'),manifest_sha256:prior.manifest_sha256,seconds:(performance.now()-start)/1000,summary,rows};
 fs.writeFileSync(path.join(dir,`planes-${split}.json`),JSON.stringify(report));console.log(JSON.stringify({...report,rows:undefined}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
