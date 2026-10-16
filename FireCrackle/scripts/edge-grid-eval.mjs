// Local actual-quad experiment. Never writes labels or changes application code.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const app=path.resolve(import.meta.dirname,'..');

export function gradients(image){
 const {width:w,height:h,data}=image,luma=new Float32Array(w*h),gx=new Float32Array(w*h),gy=new Float32Array(w*h);
 for(let i=0;i<w*h;i++)luma[i]=.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x;
  gx[i]=(luma[i-w+1]+2*luma[i+1]+luma[i+w+1]-luma[i-w-1]-2*luma[i-1]-luma[i+w-1])/8;
  gy[i]=(luma[i+w-1]+2*luma[i+w]+luma[i+w+1]-luma[i-w-1]-2*luma[i-w]-luma[i-w+1])/8;
 }
 return {gx,gy,width:w,height:h};
}
function mapping(q,w,h){
 const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=q,dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3,det=dx1*dy2-dx2*dy1;
 const g=(dx3*dy2-dx2*dy3)/det,hp=(dx1*dy3-dx3*dy1)/det,A=x1-x0+g*x1,B=x3-x0+hp*x3,C=y1-y0+g*y1,D=y3-y0+hp*y3;
 return (u,v)=>[(A*u+B*v+x0)/(g*u+hp*v+1)*w-.5,(C*u+D*v+y0)/(g*u+hp*v+1)*h-.5];
}
function bilinear(a,x,y,w,h){
 if(x<0||y<0||x>=w-1||y>=h-1)return 0;
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=iy*w+ix;
 return a[i]*(1-fx)*(1-fy)+a[i+1]*fx*(1-fy)+a[i+w]*(1-fx)*fy+a[i+w+1]*fx*fy;
}
export function gridEvidence(gradient,mask,quad,options={}){
 const {width:w,height:h,gx,gy}=gradient,p=mapping(quad,w,h),seen=new Set(),cells=new Float64Array(256),axes=[new Set(),new Set()];let sum=0,edges=0;
 const orientation=options.orientation??1,localize=options.localize??false;
 for(let axis=0;axis<2;axis++)for(let k=1;k<16;k++)for(let j=0;j<16;j++){
  const u=axis===0?k/16:(j+.5)/16,v=axis===0?(j+.5)/16:k/16,[x,y]=p(u,v);
  if(x<1||y<1||x>=w-2||y>=h-2)continue;
  const index=Math.round(y)*w+Math.round(x),key=axis*w*h+index;
  if(seen.has(key))continue;seen.add(key);
  if(!mask[index]&&!mask[index-1]&&!mask[index+1]&&!mask[index-w]&&!mask[index+w])continue;
  const [tx,ty]=p(u+(axis===1?.001:0),v+(axis===0?.001:0)),length=Math.hypot(tx-x,ty-y);
  if(length<1e-9)continue;
  const nx=-(ty-y)/length,ny=(tx-x)/length;
  const response=(a,b)=>{
   const dx=bilinear(gx,a,b,w,h),dy=bilinear(gy,a,b,w,h);
   return Math.max(0,Math.abs(dx*nx+dy*ny)-orientation*Math.abs(-dx*ny+dy*nx));
  };
  let value=response(x,y);
  if(localize){
   const before=p(u-(axis===0?.25/16:0),v-(axis===1?.25/16:0)),after=p(u+(axis===0?.25/16:0),v+(axis===1?.25/16:0));
   value=Math.max(0,value-.5*(response(...before)+response(...after)));
  }
  value=Math.min(1,value/32);sum+=value;
  if(value>.1){edges++;axes[axis].add(k);}
  if(axis===0){cells[j*16+k-1]+=value;cells[j*16+k]+=value;}
  else {cells[(k-1)*16+j]+=value;cells[k*16+j]+=value;}
 }
 return {score:sum/480,edges,vertical:axes[0].size,horizontal:axes[1].size,cells};
}
function summary(rows){
 const count=key=>({top1:rows.filter(x=>x[key].correct).length,top3:rows.filter(x=>x[key].top3).length,clear:rows.filter(x=>x[key].status==='clear').length,wrongClear:rows.filter(x=>x[key].status==='clear'&&!x[key].correct).length});
 return {n:rows.length,baseline:count('baseline'),edgeFit:count('edgeFit'),supported:count('supported'),moved:rows.filter(x=>x.moved).length,geometryImproved:rows.filter(x=>x.afterError<x.beforeError-1e-8).length,geometryWorse:rows.filter(x=>x.afterError>x.beforeError+1e-8).length};
}
async function main(){
 const [dirArg,outArg,split='tune',variant='aligned',mode='rough',strideArg='1']=process.argv.slice(2);
 if(!dirArg||!outArg||!['tune','validation'].includes(split)||!['exact','rough'].includes(mode))throw Error('Usage: edge-grid-eval.mjs DATA OUT tune|validation strength|aligned|localized exact|rough [STRIDE]');
 const configs={strength:{orientation:0},aligned:{orientation:1},localized:{orientation:1,localize:true}},config=configs[variant];if(!config)throw Error('Unknown variant');
 const dir=path.resolve(dirArg),out=path.resolve(outArg),runtime=path.join(out,'runtime');fs.mkdirSync(runtime,{recursive:true});
 const hashes={};
 for(const name of ['quadMatch','quadMask','fireColourMask','atlasFilter','quadOptimizer']){
  let source=fs.readFileSync(path.join(app,`src/lib/${name}.ts`),'utf8');hashes[name]=createHash('sha256').update(source).digest('hex');
  if(name==='quadMatch')source+='\nexport {sampleFrame,templates,similarity};';
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText.replace(/require\("\.\/(\w+)"\)/g,'require("./$1.cjs")');
  fs.writeFileSync(path.join(runtime,`${name}.cjs`),js);
 }
 const req=createRequire(import.meta.url),{matchFireQuad,sampleFrame,templates,similarity}=req(path.join(runtime,'quadMatch.cjs')),{projectQuad,validQuad}=req(path.join(runtime,'quadMask.cjs')),{optimizeQuad}=req(path.join(runtime,'quadOptimizer.cjs')),{buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs'));
 const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(app,`../fire-detection/data/assets/fire_${i}.rgba`)))),models=templates(sheets);
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),samples=manifest.samples.filter(x=>x.split===split).filter((_,i)=>i%Number(strideArg)===0);
 const rows=[];let frame=-1,image,gradient;const start=performance.now();
 for(const item of samples){
  if(frame!==item.frame){frame=item.frame;const b=fs.readFileSync(path.join(dir,`${frame}.rgb`)),data=new Uint8ClampedArray(manifest.width*manifest.height*4);for(let i=0;i<b.length/3;i++){data.set(b.subarray(i*3,i*3+3),i*4);data[i*4+3]=255;}image={width:manifest.width,height:manifest.height,data};gradient=gradients(image);}
  // Only input geometry is supplied below; truth corners and sprite labels are
  // used afterwards for evaluation, never in the fit or the support mask.
  const outline=mode==='exact'?item.quad:[[0,0],[1,0],[1,1],[0,1]].map(([u,v],i)=>projectQuad(item.quad,(u-.5)*1.12+.5+.03+(i===1?.02:0),(v-.5)*.92+.5-.02+(i===2?.02:0)));
  const envelope=[[-.1,-.1],[1.1,-.1],[1.1,1.1],[-.1,1.1]].map(([u,v])=>projectQuad(outline,u,v)),mask=buildFireColourMask(image,sheets,envelope);
  const qsize=Math.min(Math.hypot((outline[1][0]-outline[0][0])*image.width,(outline[1][1]-outline[0][1])*image.height),Math.hypot((outline[3][0]-outline[0][0])*image.width,(outline[3][1]-outline[0][1])*image.height))/16;
  const evidence=q=>gridEvidence(gradient,mask,q,config),initial=evidence(outline);
  const fit=qsize>=2&&validQuad(outline)?optimizeQuad(outline,q=>evidence(q).score,220):{quad:outline,score:initial.score};
  const selected=evidence(fit.quad),enough=selected.vertical>=4&&selected.horizontal>=4&&selected.edges>=24;
  const quad=enough?fit.quad:outline,moved=quad!==outline,active=evidence(quad);
  const baseline=matchFireQuad(image,sheets,outline,{refineGeometry:false}),fitted=moved?matchFireQuad(image,sheets,quad,{refineGeometry:false}):baseline;
  const obs=sampleFrame(image,quad,mask);
  for(let cell=0;cell<256;cell++)if(active.cells[cell]<.2)for(let sub=0;sub<obs.probes;sub++)obs.fire[cell*obs.probes+sub]=0;
  const candidates=models.map(m=>({...m,...similarity(obs,m)})).sort((a,b)=>b.score-a.score),margin=candidates[0].score-candidates[1].score,top=candidates[0];
  const status=top.score===0?'weak':top.support<32||top.regions<3?'insufficient':margin<.03?'ambiguous':'clear';
  const pack=result=>{const cs=result.candidates,correct=c=>!!c&&c.sheet===item.expected[0]&&c.row===item.expected[1]&&c.mirrored===item.expected[2];return {correct:correct(cs[0]),top3:cs.slice(0,3).some(correct),status:result.status,top:cs[0]&&{sheet:cs[0].sheet,row:cs[0].row,mirrored:cs[0].mirrored,score:cs[0].score},margin:result.margin};};
  const error=q=>Math.sqrt(q.reduce((s,p,i)=>s+((p[0]-item.quad[i][0])*manifest.width)**2+((p[1]-item.quad[i][1])*manifest.height)**2,0)/4);
  rows.push({id:item.id,frame:item.frame,source:item.source,expected:item.expected,outline,quad,qsize,moved,beforeError:error(outline),afterError:error(quad),beforeGrid:initial.score,afterGrid:active.score,edges:active.edges,baseline:pack(baseline),edgeFit:pack(fitted),supported:pack(fitted.searched===0?fitted:{candidates,margin,status})});
  if(rows.length%50===0)console.error(`${variant}/${mode}/${split}: ${rows.length}/${samples.length}`);
 }
 const result={split,variant,mode,stride:Number(strideArg),config,hashes,scriptHash:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),joined_sha256:manifest.joined_sha256,elapsed_seconds:(performance.now()-start)/1000,summary:summary(rows),groups:Object.fromEntries(['block','entity','overlay'].map(s=>[s,summary(rows.filter(x=>x.source===s))])),rows};
 fs.writeFileSync(path.join(out,`${variant}-${mode}-${split}.json`),JSON.stringify(result));console.log(JSON.stringify({...result,rows:undefined}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename)await main();
