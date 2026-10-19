// Frozen best soul control: G,B,R channel order and previously selected loose gain score.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=path.resolve('.'),out=path.join(root,'.board/soul-phase128'),runtime=path.join(root,'.board/soul-quad/real/runtime'),req=createRequire(import.meta.url);
const {sampleFrame,templates}=req(path.join(runtime,'quadMatch.cjs')),{similarity}=req(path.join(runtime,'pattern-loose.cjs')),{buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs'));
function permute(data){const p=new Uint8ClampedArray(data.length);for(let i=0;i<data.length;i+=4){p[i]=data[i+1];p[i+1]=data[i+2];p[i+2]=data[i];p[i+3]=data[i+3];}return p;}
const sheets=[0,1].map(i=>permute(fs.readFileSync(path.join(root,`.board/soul-quad/real/soul_${i}.rgba`)))),models=templates(sheets);
const meta=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'))),rows=meta.samples.filter(r=>r.split!=='train'),results=[];let last='',image;const started=performance.now(),timing=[];
for(const r of rows){
 const key=`${r.video}-${r.frame}`;
 if(key!==last){
  const rgb=fs.readFileSync(path.join(out,r.video,`${r.frame}.rgb`)),rgba=new Uint8ClampedArray(r.width*r.height*4);
  for(let i=0;i<rgb.length/3;i++){rgba[i*4]=rgb[i*3];rgba[i*4+1]=rgb[i*3+1];rgba[i*4+2]=rgb[i*3+2];rgba[i*4+3]=255;}
  image={width:r.width,height:r.height,data:permute(rgba)};last=key;
 }
 const begin=performance.now(),o=sampleFrame(image,r.quad,buildFireColourMask(image,sheets,r.quad)),scores=Array(32).fill(-Infinity);
 for(const m of models)scores[m.row]=Math.max(scores[m.row],similarity(o,m).score);
 if(!scores.every(Number.isFinite))throw Error('Nonfinite score:'+r.id);
 const ranking=scores.map((score,phase)=>({score,phase})).sort((a,b)=>b.score-a.score||a.phase-b.phase),usable=ranking[0].score>0;
 timing.push(performance.now()-begin);results.push({id:r.id,video:r.video,split:r.split,truth:r.phase,scores,usable,top3:ranking.slice(0,3).map(x=>x.phase)});
 if(results.length%250===0)console.log(JSON.stringify({scored:results.length,total:rows.length,seconds:(performance.now()-started)/1000}));
}
const source_hashes=Object.fromEntries(['quadMatch.cjs','quadMask.cjs','fireColourMask.cjs','pattern-loose.cjs'].map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(runtime,f))).digest('hex')]));
timing.sort((a,b)=>a-b);
fs.writeFileSync(path.join(out,'matcher.json'),JSON.stringify({rows:results,source_hashes,seconds:(performance.now()-started)/1000,timing_ms:{median:timing[Math.floor(timing.length*.5)],p95:timing[Math.floor(timing.length*.95)]},method:'Frozen G,B,R loose shared-gain score; maximum over appearances; three distinct animation phases; known quad without geometry refinement'}));
console.log(JSON.stringify({done:true,n:results.length,seconds:(performance.now()-started)/1000}));
