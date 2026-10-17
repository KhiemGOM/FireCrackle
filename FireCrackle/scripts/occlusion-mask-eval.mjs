// Research adapter: all masks share the unchanged native samples and scorer.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const app=path.resolve(import.meta.dirname,'..');
export const MASKS=['colour','opening','majority','learned_soft','learned_half','learned_hard'];
export function fieldAt(field,u,v,width=64,height=64){
 const X=u*width-.5,Y=v*height-.5;if(X<0||Y<0||X>width-1||Y>height-1)return 0;
 const x0=Math.floor(X),y0=Math.floor(Y),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),fx=X-x0,fy=Y-y0;
 return field[y0*width+x0]*(1-fx)*(1-fy)+field[y0*width+x1]*fx*(1-fy)+field[y1*width+x0]*(1-fx)*fy+field[y1*width+x1]*fx*fy;
}
export function applyMask(observed,field,project=null,width=64,height=64){
 const weights=Float64Array.from(observed.weights);
 for(let cell=0;cell<256;cell++)for(let sub=0;sub<observed.probes;sub++){
  const u=(cell%16+(observed.probes===1?.5:.25+.5*(sub%2)))/16,v=(Math.floor(cell/16)+(observed.probes===1?.5:.25+.5*Math.floor(sub/2)))/16;
  const uv=project?project(u,v):[u,v],value=fieldAt(field,...uv,width,height);
  if(!Number.isFinite(value)||value<0||value>1)throw Error('Invalid mask probability');
  weights[cell*observed.probes+sub]*=value;
 }
 return {...observed,weights};
}
async function main(){
 const [dataArg,outArg]=process.argv.slice(2);if(!outArg)throw Error('Usage: occlusion-mask-eval.mjs DATA OUT');
 const data=path.resolve(dataArg),out=path.resolve(outArg),runtime=path.join(out,'runtime');fs.mkdirSync(runtime,{recursive:true});
 const hashes={};for(const name of ['quadMatch','quadMask','fireColourMask','atlasFilter','quadOptimizer']){
  let source=fs.readFileSync(path.join(app,`src/lib/${name}.ts`),'utf8');hashes[name]=createHash('sha256').update(source).digest('hex');if(name==='quadMatch')source+='\nexport {sampleFrame,templates,similarity};';
  fs.writeFileSync(path.join(runtime,`${name}.cjs`),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText.replace(/require\("\.\/(\w+)"\)/g,'require("./$1.cjs")'));
 }
 const req=createRequire(import.meta.url),{sampleFrame,templates,similarity,matchFireQuad}=req(path.join(runtime,'quadMatch.cjs')),
  {buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs')),{projectQuad}=req(path.join(runtime,'quadMask.cjs'));
 const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(app,`../fire-detection/data/assets/fire_${i}.rgba`)))),models=templates(sheets);
 const manifest=JSON.parse(fs.readFileSync(path.join(data,'manifest.json'))),rows=[],names=[...MASKS,...(manifest.oracle?['oracle']:[])];
 let previous=-1,image;const start=performance.now();
 for(const [index,item] of manifest.samples.entries()){
  if(previous!==item.frame){previous=item.frame;const raw=fs.readFileSync(path.join(manifest.native_source??data,`${item.frame}.rgb`)),pixels=new Uint8ClampedArray(manifest.width*manifest.height*4);if(raw.length*4!==pixels.length*3)throw Error('Native frame size');
   for(let i=0;i<raw.length/3;i++){pixels[i*4]=raw[i*3];pixels[i*4+1]=raw[i*3+1];pixels[i*4+2]=raw[i*3+2];pixels[i*4+3]=255;}image={width:manifest.width,height:manifest.height,data:pixels};}
  const mask=buildFireColourMask(image,sheets,item.quad),observed=sampleFrame(image,item.quad,mask),eligible=matchFireQuad(image,sheets,item.quad,{refineGeometry:false}).searched>0,truth=item.expected[0]*64+item.expected[1]*2+Number(item.expected[2]),methods={};
  for(const name of names){
   let o=observed;
   if(name==='oracle'){
    const field=fs.readFileSync(path.join(data,`${item.frame}.oracle`));if(field.length!==image.width*image.height)throw Error('Oracle size');
    o=applyMask(observed,field,(u,v)=>projectQuad(item.quad,u,v),image.width,image.height);
   }else if(name!=='colour'){
    const raw=fs.readFileSync(path.join(data,`${item.mask_index??index}.${name}`));if(raw.length!==4096*4)throw Error('Mask size');
    const field=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));o=applyMask(observed,field);
   }
   const ranks=eligible?models.map((m,i)=>({i,...similarity(o,m)})).sort((a,b)=>b.score-a.score):[],winner=ranks[0],margin=(winner?.score??0)-(ranks[1]?.score??0);
   methods[name]={top:winner?.i??null,top5:ranks.slice(0,5).map(r=>r.i),correct:item.has_target!==false&&winner?.i===truth,
    clear:!!winner&&winner.score>0&&winner.support>=32&&winner.regions>=3&&margin>=.03,margin,score:winner?.score??0,
    retainedWeight:o.weights.reduce((a,b,i)=>a+b*o.fire[i],0),support:winner?.support??0};
  }
  rows.push({id:item.id,frame:item.frame,source:item.source,expected:item.expected,has_target:item.has_target!==false,eligible,methods});
  if(rows.length%250===0)console.error(`${rows.length}/${manifest.samples.length}`);
 }
 const summary=Object.fromEntries(names.map(name=>[name,{top1:rows.filter(r=>r.methods[name].correct).length,
  top3:rows.filter(r=>r.has_target&&r.methods[name].top5.slice(0,3).includes(r.expected[0]*64+r.expected[1]*2+Number(r.expected[2]))).length,
  clear:rows.filter(r=>r.methods[name].clear).length,wrongClear:rows.filter(r=>r.methods[name].clear&&!r.methods[name].correct).length,
  retainedWeight:rows.reduce((a,r)=>a+r.methods[name].retainedWeight,0)}]));
 const result={n:rows.length,targetCases:rows.filter(r=>r.has_target).length,hashes,scriptSHA256:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),summary,seconds:(performance.now()-start)/1000,rows};
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result));console.log(JSON.stringify({...result,rows:undefined}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename)await main();
