// Reuse production colour masking, now centred on the already-fitted selected sprite.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
const root=path.resolve('.'),old=path.join(root,'.board/ecc-align'),out=path.join(root,'.board/ecc-polish');fs.mkdirSync(out,{recursive:true});
const {buildFireColourMask}=await import(pathToFileURL(path.join(old,'runtime/fireColourMask.mjs')).href);
const {projectQuad}=await import(pathToFileURL(path.join(old,'runtime/quadMask.mjs')).href);
const rows=JSON.parse(fs.readFileSync(path.join(old,'cases.json'))),selected=JSON.parse(fs.readFileSync(path.join(old,'selected.json'))).rows;
const sheets=Object.fromEntries(['normal','soul'].map(m=>[m,[0,1].map(s=>{
 const a=new Uint8ClampedArray(fs.readFileSync(path.join(old,`${m}-${s}.rgba`)));
 if(m==='soul')for(let i=0;i<a.length;i+=4){const r=a[i];a[i]=a[i+1];a[i+1]=a[i+2];a[i+2]=r;}
 return a;
})]));
for(let i=0;i<rows.length;i++){
 const r=rows[i],q=selected[i].selected.rough.quad,rgb=fs.readFileSync(path.join(root,r.pixels)),data=new Uint8ClampedArray(r.width*r.height*4);
 for(let j=0;j<rgb.length/3;j++){
  data[j*4]=rgb[j*3+(r.material==='soul'?1:0)];data[j*4+1]=rgb[j*3+(r.material==='soul'?2:1)];data[j*4+2]=rgb[j*3+(r.material==='soul'?0:2)];data[j*4+3]=255;
 }
 const envelope=[[-.1,-.1],[1.1,-.1],[1.1,1.1],[-.1,1.1]].map(([u,v])=>projectQuad(q,u,v));
 fs.writeFileSync(path.join(out,`${i}.mask`),buildFireColourMask({width:r.width,height:r.height,data},sheets[r.material],envelope));
}
console.log('Prepared128 production masks around current fitted geometry; sprite identity remains locked');
