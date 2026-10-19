// CPU worker orchestration of the existing bounded per-appearance optimizer.
import fs from 'node:fs';
import path from 'node:path';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {quadReadability} from './soul-quad-size-audit.mjs';

const permute=data=>{const out=new Uint8ClampedArray(data.length);for(let i=0;i<data.length;i+=4){out[i]=data[i+1];out[i+1]=data[i+2];out[i+2]=data[i];out[i+3]=data[i+3];}return out;};
if(isMainThread){
 const dir=path.resolve(process.argv[2]),split=process.argv[3]??'tune',workers=Number(process.argv[4]??4);
 if(!['tune','validation'].includes(split)||!Number.isInteger(workers)||workers<1||workers>16)throw Error('Usage: soul-quad-refine.mjs DATA tune|validation [WORKERS1..16]');
 const app=path.resolve(import.meta.dirname,'..'),runtime=path.join(dir,'runtime'),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),
  source=fs.readFileSync(path.join(app,'src/lib/quadMatch.ts'),'utf8'),modified=source.replaceAll('0.06','0.18').replaceAll('0.10','0.30');
 const modulePath=path.join(runtime,'soul-refine-loose.cjs');
 fs.writeFileSync(modulePath,ts.transpileModule(modified,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText.replace(/require\("\.\/(\w+)"\)/g,'require("./$1.cjs")'));
 const samples=manifest.samples.filter(r=>r.split===split&&quadReadability(r.quad,manifest.width,manifest.height).eligible),start=performance.now();
 const batches=await Promise.all(Array.from({length:workers},(_,i)=>new Promise((resolve,reject)=>{
  const worker=new Worker(new URL(import.meta.url),{workerData:{dir,modulePath,width:manifest.width,height:manifest.height,samples:samples.filter((_,j)=>j%workers===i)}});
  worker.on('message',message=>{if(message.progress)console.error(`${split}: worker${i} ${message.progress}`);else resolve(message.rows);});
  worker.on('error',reject);worker.on('exit',code=>{if(code)reject(Error(`Worker${i} exit${code}`));});
 })));
 const byId=new Map(batches.flat().map(r=>[r.id,r])),rows=samples.map(r=>byId.get(r.id));
 const report={split,workers,source_sha256:createHash('sha256').update(source).digest('hex'),modified_sha256:createHash('sha256').update(modified).digest('hex'),seconds:(performance.now()-start)/1000,
  summary:{n:rows.length,frames:new Set(rows.map(r=>r.frame)).size,exact:rows.filter(r=>r.correct).length,top3:rows.filter(r=>r.top3).length,row:rows.filter(r=>r.rowCorrect).length,gate_correct:rows.filter(r=>r.status==='clear'&&r.correct).length,gate_wrong:rows.filter(r=>r.status==='clear'&&!r.correct).length},rows};
 fs.writeFileSync(path.join(dir,`refine-${split}.json`),JSON.stringify(report));console.log(JSON.stringify({...report,rows:undefined}));
}else{
 const {dir,modulePath,width,height,samples}=workerData,req=createRequire(import.meta.url),{matchFireQuad}=req(modulePath),
  sheets=[0,1].map(i=>permute(new Uint8ClampedArray(fs.readFileSync(path.join(dir,`soul_${i}.rgba`)))));
 const rows=[];let frame=-1,image;
 for(const item of samples){
  if(frame!==item.frame){frame=item.frame;const b=fs.readFileSync(path.join(dir,`${frame}.rgb`)),data=new Uint8ClampedArray(width*height*4);for(let i=0;i<b.length/3;i++){data[i*4]=b[i*3];data[i*4+1]=b[i*3+1];data[i*4+2]=b[i*3+2];data[i*4+3]=255;}image={width,height,data:permute(data)};}
  const result=matchFireQuad(image,sheets,item.quad,{refineGeometry:true}),top=result.candidates[0],correct=c=>!!c&&c.score>0&&c.sheet===item.expected[0]&&c.row===item.expected[1]&&c.mirrored===item.expected[2];
  rows.push({...item,status:result.status,margin:result.margin,correct:correct(top),top3:result.candidates.slice(0,3).some(correct),rowCorrect:!!top&&top.score>0&&top.row===item.expected[1],candidates:result.candidates});
  if(rows.length%10===0)parentPort.postMessage({progress:`${rows.length}/${samples.length}`});
 }
 parentPort.postMessage({rows});
}
