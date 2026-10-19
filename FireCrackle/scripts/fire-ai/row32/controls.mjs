// Recompute historical controls only where the shared native unveil changed RGB.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const dir=path.resolve(process.argv[2]),root=path.resolve(import.meta.dirname,'../../../..'),req=createRequire(import.meta.url),runtime=path.join(root,'.board/soul-quad/real/runtime'),
 {sampleFrame,templates,similarity}=req(path.join(runtime,'quadMatch.cjs')),{buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs')),
 rows=JSON.parse(fs.readFileSync(path.join(dir,'selected.json'))),changed=new Set(JSON.parse(fs.readFileSync(path.join(dir,'unveiled.json'))).map(x=>x[1])),
 sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(root,`fire-detection/data/assets/fire_${i}.rgba`)))),models=templates(sheets);
let count=0;
for(const frame of changed){
 const items=rows.filter(r=>r.kind==='orange'&&r.frame===frame&&r.split==='validation'),rgb=fs.readFileSync(path.join(dir,`unveiled/${frame}.rgb`));
 if(!items.length)continue;
 const data=new Uint8ClampedArray(items[0].width*items[0].height*4);for(let i=0;i<rgb.length/3;i++){data[i*4]=rgb[i*3];data[i*4+1]=rgb[i*3+1];data[i*4+2]=rgb[i*3+2];data[i*4+3]=255;}
 const image={width:items[0].width,height:items[0].height,data};
 for(const item of items){const o=sampleFrame(image,item.quad,buildFireColourMask(image,sheets,item.quad)),top=models.map(m=>({m,score:similarity(o,m).score})).sort((a,b)=>b.score-a.score)[0];item.originalBaselinePhase=item.baselinePhase;item.baselinePhase=top.score>0?(top.m.row+(top.m.sheet===0?16:0))%32:null;count++;}
}
fs.writeFileSync(path.join(dir,'selected.json'),JSON.stringify(rows));
const hashes=JSON.parse(fs.readFileSync(path.join(dir,'data-hashes.json')));hashes.selected=createHash('sha256').update(fs.readFileSync(path.join(dir,'selected.json'))).digest('hex');fs.writeFileSync(path.join(dir,'data-hashes.json'),JSON.stringify(hashes,null,2));
console.log(JSON.stringify({recomputed:count,orangePhaseCorrect:rows.filter(r=>r.kind==='orange'&&r.split==='validation'&&r.phase===r.baselinePhase).length}));
