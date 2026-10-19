// Freeze geometry-only selection and normalize targets to animation steps.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {quadReadability} from '../../soul-quad-size-audit.mjs';
const root=path.resolve(import.meta.dirname,'../../../..'),out=path.resolve(process.argv[2]??'.board/row32');
fs.mkdirSync(out,{recursive:true});
const records=[];
for(const [kind,relative] of [['orange','FireCrackle/src-tauri/target/actual-quad1'],['soul','.board/soul-quad/real']]){
 const dir=path.join(root,relative),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),
  prior=kind==='orange'?JSON.parse(fs.readFileSync(path.join(dir,'coherent-gain-fixed-validation.json'))).rows:JSON.parse(fs.readFileSync(path.join(dir,'patterns-validation.json'))).rows,
  baseline=new Map(prior.map(r=>[r.id,r]));
 for(const item of manifest.samples)if(['tune','validation'].includes(item.split)&&quadReadability(item.quad,manifest.width,manifest.height).eligible){
  const phase=(sheet,row)=>kind==='orange'&&sheet===0?(row+16)%32:row;
  const b=baseline.get(item.id),p=kind==='orange'?b?.candidates[0]:b?.predictions.loose.top;
  const baselinePhase=!p?null:kind==='orange'?(p.score>0?phase(p.sheet,p.row):null):(b.predictions.loose.score>0?p[1]:null);
  records.push({...item,kind,phase:phase(...item.expected),baselinePhase,dir,width:manifest.width,height:manifest.height,manifest_sha256:createHash('sha256').update(fs.readFileSync(path.join(dir,'manifest.json'))).digest('hex')});
 }
}
fs.writeFileSync(path.join(out,'selected.json'),JSON.stringify(records));
console.log(JSON.stringify(Object.fromEntries(['orange','soul'].map(k=>[k,Object.fromEntries(['tune','validation'].map(s=>{const rows=records.filter(r=>r.kind===k&&r.split===s);return [s,{n:rows.length,frames:new Set(rows.map(r=>r.frame)).size,classes:new Set(rows.map(r=>r.phase)).size,baseline:rows.filter(r=>r.baselinePhase===r.phase).length}];}))])),null,2));
