// Controlled colour-mask ablation, with known foreground/occluder ownership.
// This is a pixel-level toy control, not a full Minecraft scene renderer.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {stricterObservation,boundaryFeatures,featureScore} from './boundary-robust-eval.mjs';
const app=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.argv[2]??'.board/boundary-robust');
const req=createRequire(import.meta.url),{firePalette,isFirePaletteColour}=req(path.join(out,'tune/exact/runtime/fireColourMask.cjs'));
const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(app,`../fire-detection/data/assets/fire_${i}.rgba`)))),palette=firePalette(sheets),cache=new Map();
function sprite(index,cell){const i=((index%64>>1)*16+Math.floor(cell/16))*16+(index%2?15-cell%16:cell%16),offset=i*4,sheet=sheets[index>>6];return Array.from(sheet.subarray(offset,offset+4));}
function hit(rgb){const key=rgb.join(',');if(!cache.has(key))cache.set(key,isFirePaletteColour(...rgb,palette));return Number(cache.get(key));}
const models=Array.from({length:128},(_,index)=>{
 const model={rgb:new Float64Array(768),alpha:new Uint8Array(256)};
 for(let cell=0;cell<256;cell++){const pixel=sprite(index,cell);model.rgb.set(pixel.slice(0,3),cell*3);model.alpha[cell]=pixel[3];}
 return model;
});
const results={};let cases=0;
for(const kind of ['grey_smoke','yellow_rod','white_ui','other_fire']){
 const totals=Object.fromEntries(['current','strict','neutral'].map(n=>[n,{visible:0,visibleKept:0,occluded:0,occluderKept:0}]));
 const classification=Object.fromEntries(['current','strict','neutral','oracle_occluder_mask'].map(n=>[n,{cases:0,colour:0,pairs4:0,facing1:0}]));
 for(let truth=0;truth<128;truth++)for(const fraction of [.25,.5,.75]){
  const o={rgb:new Float64Array(768),fire:new Uint8Array(256)},visible=new Uint8Array(256),occluded=new Uint8Array(256),covered=new Uint8Array(256);
  for(let cell=0;cell<256;cell++){
   const target=sprite(truth,cell),foreign=sprite((truth+37)%128,cell),inside=Math.abs((cell%16+.5)/16-.5)<fraction/2;
   let rgb=target[3]>127?target.slice(0,3).map(v=>Math.round(v*.65)):[25,18,20];
   const cover=inside&&(kind!=='other_fire'||foreign[3]>127);
   if(cover)rgb=kind==='grey_smoke'?[145,145,145]:kind==='yellow_rod'?[190,195,80]:kind==='white_ui'?[245,245,245]:foreign.slice(0,3).map(v=>Math.round(v*.65));
   covered[cell]=Number(cover);visible[cell]=Number(target[3]>127&&!cover);occluded[cell]=Number(target[3]>127&&cover);
   o.rgb.set(rgb,cell*3);o.fire[cell]=hit(rgb);
  }
  const masks={current:o.fire,strict:stricterObservation(o,palette,'strict').fire,neutral:stricterObservation(o,palette,'neutral').fire};
  for(const [name,mask] of Object.entries(masks))for(let cell=0;cell<256;cell++){
   totals[name].visible+=visible[cell];totals[name].visibleKept+=visible[cell]*mask[cell];
   totals[name].occluded+=occluded[cell];totals[name].occluderKept+=occluded[cell]*mask[cell];
  }
  // A predeclared balanced32-appearance subset (every fourth row, both sheets/mirrors).
  // The oracle knows ONLY foreign pixel ownership, not the target appearance.
  if((truth%64>>1)%4===0){
   const oracle=Uint8Array.from(o.fire,(hit,i)=>hit&&!covered[i]?1:0);
   for(const [name,mask] of Object.entries({...masks,oracle_occluder_mask:oracle})){
    const obs={probes:4,rgb:new Float64Array(3072),fire:new Uint8Array(1024),valid:new Uint8Array(1024).fill(1),weights:new Float64Array(1024).fill(1),nativePixels:Int32Array.from({length:1024},(_,i)=>i)};
    for(let cell=0;cell<256;cell++)for(let sub=0;sub<4;sub++){obs.rgb.set(o.rgb.subarray(cell*3,cell*3+3),(cell*4+sub)*3);obs.fire[cell*4+sub]=mask[cell];}
    const scores={colour:[],pairs4:[],facing1:[]};
    for(const model of models){const f=boundaryFeatures(obs,model);scores.colour.push(featureScore(f,'aggregate',0).score);scores.pairs4.push(featureScore(f,'aggregate',4).score);scores.facing1.push(featureScore(f,'facing',1).score);}
    classification[name].cases++;
    for(const [method,values] of Object.entries(scores))if(values.indexOf(Math.max(...values))===truth)classification[name][method]++;
   }
  }
  cases++;
 }
 results[kind]={retention:totals,classification};
 console.error(`${kind} classification ${JSON.stringify(classification)}`);
}
for(const {retention} of Object.values(results))for(const value of Object.values(retention)){
 value.fireRetention=value.visibleKept/value.visible;value.occluderRetention=value.occluderKept/value.occluded;
}
const result={cases,dimGain:.65,fractions:[.25,.5,.75],seed:'deterministic full128 appearances, central bands, foreign appearance+37mod128',definition:'Only original opaque target texels count. Visible means not covered; occluded means replaced by a known foreign pixel.',scriptSHA256:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),results};
fs.writeFileSync(path.join(out,'mask-controls.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
