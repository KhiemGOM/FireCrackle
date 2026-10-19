// Frozen deterministic control, evaluated only on the whole-video test split.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=path.resolve('.'),out=path.join(root,'.board/row32-real'),req=createRequire(import.meta.url),runtime=path.join(root,'.board/soul-quad/real/runtime');
const {sampleFrame,templates,similarity}=req(path.join(runtime,'quadMatch.cjs'));
const {buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs'));
const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(root,`fire-detection/data/assets/fire_${i}.rgba`))));
const models=templates(sheets),rows=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'))).samples.filter(r=>r.split==='test');
let last=null,image;const result=[];
for(const row of rows){
 if(row.frame!==last){
  const rgb=fs.readFileSync(path.join(out,'quad1',`${row.frame}.rgb`)),data=new Uint8ClampedArray(row.width*row.height*4);
  for(let i=0;i<rgb.length/3;i++){data[i*4]=rgb[i*3];data[i*4+1]=rgb[i*3+1];data[i*4+2]=rgb[i*3+2];data[i*4+3]=255;}
  image={width:row.width,height:row.height,data};last=row.frame;
 }
 const observed=sampleFrame(image,row.quad,buildFireColourMask(image,sheets,row.quad));
 const order=models.map(model=>({model,score:similarity(observed,model).score})).sort((a,b)=>b.score-a.score);
 const phase=order[0].score>0?(order[0].model.row+(order[0].model.sheet===0?16:0))%32:null;
 result.push({id:row.id,frame:row.frame,source:row.source,truth:row.phase,phase,correct:phase===row.phase,score:order[0].score});
}
const summarize=rs=>({n:rs.length,correct:rs.filter(r=>r.correct).length,accuracy:rs.filter(r=>r.correct).length/rs.length});
const source_hashes=Object.fromEntries(['quadMatch.cjs','quadMask.cjs','fireColourMask.cjs'].map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(runtime,f))).digest('hex')]));
const report={test:summarize(result),groups:Object.fromEntries([...new Set(rows.map(r=>r.source))].map(s=>[s,summarize(result.filter(r=>r.source===s))])),source_hashes,rows:result};
fs.writeFileSync(path.join(out,'baseline.json'),JSON.stringify(report));console.log(JSON.stringify({...report,rows:undefined},null,2));
