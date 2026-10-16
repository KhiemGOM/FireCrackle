// Experimental coherent line families; no application/label writes.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {gradients} from './edge-grid-eval.mjs';
const app=path.resolve(import.meta.dirname,'..');
export function mapQuad(q,u,v){
 const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=q,dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3,det=dx1*dy2-dx2*dy1,g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;
 return [((x1-x0+g*x1)*u+(x3-x0+h*x3)*v+x0)/(g*u+h*v+1),((y1-y0+g*y1)*u+(y3-y0+h*y3)*v+y0)/(g*u+h*v+1)];
}
/** Sample native edge pixels once, then express their directions in the supplied
 * quad's plane. No sprite appearance or recorded geometry is an input. */
export function edgePoints(gradient,mask,quad,resolution=128){
 const {width:w,height:h,gx,gy}=gradient,points=[[],[]],seen=new Set();
 for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++){
  const u=(x+.5)/resolution,v=(y+.5)/resolution,p=mapQuad(quad,u,v),px=Math.round(p[0]*w-.5),py=Math.round(p[1]*h-.5);
  if(px<1||py<1||px>=w-1||py>=h-1)continue;
  const i=py*w+px;if(seen.has(i))continue;seen.add(i);
  if(!mask[i]&&!mask[i-1]&&!mask[i+1]&&!mask[i-w]&&!mask[i+w])continue;
  const strength=Math.hypot(gx[i],gy[i]);if(strength<6)continue;
  const a=mapQuad(quad,u+.001,v),b=mapQuad(quad,u,v+.001);
  const du=gx[i]*(a[0]-p[0])*w+gy[i]*(a[1]-p[1])*h,dv=gx[i]*(b[0]-p[0])*w+gy[i]*(b[1]-p[1])*h;
  // The point's native pixel may differ from the resampling location. Solve
  // that small displacement in the local projective Jacobian first.
  const ax=(a[0]-p[0])*w/.001,ay=(a[1]-p[1])*h/.001,bx=(b[0]-p[0])*w/.001,by=(b[1]-p[1])*h/.001,det=ax*by-ay*bx,dx=px+.5-p[0]*w,dy=py+.5-p[1]*h;
  if(Math.abs(det)<1e-9)continue;
  const U=u+(dx*by-dy*bx)/det,V=v+(ax*dy-ay*dx)/det,weight=Math.min(1,strength/32);
  if(Math.abs(du)>3*Math.abs(dv))points[0].push({x:U,y:V,slope:-dv/du,weight});
  if(Math.abs(dv)>3*Math.abs(du))points[1].push({x:V,y:U,slope:-du/dv,weight});
 }
 return points;
}
/** Group collinear fragments, then robustly fit a periodic family to the line
 * intercepts. Both missing lines and outliers contribute zero, never penalties. */
export function fitFamily(points,strict=false){
 if(points.length<12)return null;
 let best=null;
 const scale=512,offset=.3,bins=820;
 for(let ai=-10;ai<=10;ai++){
  const slope=ai*.02,hist=new Float64Array(bins),low=new Float64Array(bins).fill(2),high=new Float64Array(bins).fill(-1);
  for(const p of points){
   if(Math.abs(p.slope-slope)>.08)continue;
   const centre=(p.x-slope*p.y+offset)*scale;
   for(let d=-1;d<=1;d++){
    const i=Math.round(centre)+d;if(i<0||i>=bins)continue;
    hist[i]+=p.weight*(d===0?1:.5);low[i]=Math.min(low[i],p.y);high[i]=Math.max(high[i],p.y);
   }
  }
  const peaks=[];
  for(let i=1;i<bins-1;i++)if(hist[i]>=2&&high[i]-low[i]>.03&&hist[i]>=hist[i-1]&&hist[i]>hist[i+1])peaks.push({b:i/scale-offset,weight:hist[i]});
  peaks.sort((a,b)=>b.weight-a.weight);
  const lines=[];for(const p of peaks)if(lines.every(q=>Math.abs(q.b-p.b)>.018))lines.push(p);
  if(lines.length<4)continue;
  for(let si=0;si<=60;si++){
   const spacing=.05+si*.0005;
   for(const origin of lines){
    const phase=origin.b-Math.round(origin.b/spacing)*spacing,inliers=[];let score=0;
    for(const line of lines){
     const index=Math.round((line.b-phase)/spacing),residual=Math.abs(line.b-phase-index*spacing),vote=Math.max(0,1-residual/(spacing*.12));
     if(vote>0){score+=line.weight*vote;inliers.push({...line,index});}
    }
    const indices=new Set(inliers.map(x=>x.index));
    if(indices.size<(strict?6:4)||Math.max(...indices)-Math.min(...indices)<4)continue;
    if(best&&score<=best.score)continue;
    best={slope,spacing,phase,score,lineCount:indices.size,lines:inliers};
   }
  }
 }
 return best;
}
export function familyCorners(x,y){
 if(!x||!y)return null;
 const det=1-x.slope*y.slope;if(Math.abs(det)<.1)return null;
 const q=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>{
  const a=x.phase+16*x.spacing*u,b=y.phase+16*y.spacing*v;
  return [(a+x.slope*b)/det,(y.slope*a+b)/det];
 });
 return q.every(p=>p.every(v=>v>=-.1&&v<=1.1))?q:null;
}
function summary(rows){
 const count=key=>({top1:rows.filter(x=>x[key].correct).length,top3:rows.filter(x=>x[key].top3).length,clear:rows.filter(x=>x[key].status==='clear').length,wrongClear:rows.filter(x=>x[key].status==='clear'&&!x[key].correct).length});
 return {n:rows.length,baseline:count('baseline'),groupFit:count('groupFit'),moved:rows.filter(x=>x.moved).length,geometryImproved:rows.filter(x=>x.afterError<x.beforeError-1e-8).length,geometryWorse:rows.filter(x=>x.afterError>x.beforeError+1e-8).length};
}
async function main(){
 const [dirArg,outArg,split='tune',mode='rough',strideArg='1',variant='loose']=process.argv.slice(2),stride=Number(strideArg);
 if(!dirArg||!outArg||!['tune','validation'].includes(split)||!['exact','rough'].includes(mode)||!['loose','strict'].includes(variant)||!Number.isInteger(stride)||stride<1)throw Error('Usage: plane-group-eval.mjs DATA OUT tune|validation exact|rough STRIDE loose|strict');
 const dir=path.resolve(dirArg),out=path.resolve(outArg),runtime=path.join(out,'runtime');fs.mkdirSync(runtime,{recursive:true});
 const hashes={};for(const name of ['quadMatch','quadMask','fireColourMask','atlasFilter','quadOptimizer']){
  const source=fs.readFileSync(path.join(app,`src/lib/${name}.ts`),'utf8');hashes[name]=createHash('sha256').update(source).digest('hex');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText.replace(/require\("\.\/(\w+)"\)/g,'require("./$1.cjs")');fs.writeFileSync(path.join(runtime,`${name}.cjs`),js);
 }
 const req=createRequire(import.meta.url),{matchFireQuad}=req(path.join(runtime,'quadMatch.cjs')),{validQuad}=req(path.join(runtime,'quadMask.cjs')),{buildFireColourMask}=req(path.join(runtime,'fireColourMask.cjs'));
 const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(app,`../fire-detection/data/assets/fire_${i}.rgba`))));
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),samples=manifest.samples.filter(x=>x.split===split).filter((_,i)=>i%stride===0),rows=[];let frame=-1,image,gradient;const start=performance.now();
 for(const item of samples){
  if(frame!==item.frame){frame=item.frame;const b=fs.readFileSync(path.join(dir,`${frame}.rgb`)),data=new Uint8ClampedArray(manifest.width*manifest.height*4);for(let i=0;i<b.length/3;i++){data.set(b.subarray(i*3,i*3+3),i*4);data[i*4+3]=255;}image={width:manifest.width,height:manifest.height,data};gradient=gradients(image);}
  const outline=mode==='exact'?item.quad:[[0,0],[1,0],[1,1],[0,1]].map(([u,v],i)=>mapQuad(item.quad,(u-.5)*1.12+.5+.03+(i===1?.02:0),(v-.5)*.92+.5-.02+(i===2?.02:0)));
  const mask=buildFireColourMask(image,sheets,outline),points=edgePoints(gradient,mask,outline),size=Math.min(Math.hypot((outline[1][0]-outline[0][0])*image.width,(outline[1][1]-outline[0][1])*image.height),Math.hypot((outline[3][0]-outline[0][0])*image.width,(outline[3][1]-outline[0][1])*image.height))/16;
  const x=size>=2?fitFamily(points[0],variant==='strict'):null,y=size>=2?fitFamily(points[1],variant==='strict'):null,local=familyCorners(x,y),proposal=local?.map(([u,v])=>mapQuad(outline,u,v));
  const quad=proposal&&validQuad(proposal)?proposal:outline,moved=quad!==outline,baseline=matchFireQuad(image,sheets,outline,{refineGeometry:false}),fit=moved?matchFireQuad(image,sheets,quad,{refineGeometry:false}):baseline;
  const pack=r=>{const correct=c=>!!c&&c.sheet===item.expected[0]&&c.row===item.expected[1]&&c.mirrored===item.expected[2],top=r.candidates[0];return {correct:correct(top),top3:r.candidates.slice(0,3).some(correct),status:r.status,margin:r.margin,top:top&&{sheet:top.sheet,row:top.row,mirrored:top.mirrored,score:top.score}};};
  const error=q=>Math.sqrt(q.reduce((s,p,i)=>s+((p[0]-item.quad[i][0])*image.width)**2+((p[1]-item.quad[i][1])*image.height)**2,0)/4),family=f=>f&&{slope:f.slope,spacing:f.spacing,phase:f.phase,lineCount:f.lineCount,score:f.score};
  rows.push({id:item.id,frame:item.frame,source:item.source,expected:item.expected,outline,quad,moved,beforeError:error(outline),afterError:error(quad),points:points.map(p=>p.length),families:[family(x),family(y)],baseline:pack(baseline),groupFit:pack(fit)});
  if(rows.length%50===0)console.error(`${variant}/${mode}/${split}: ${rows.length}/${samples.length}`);
 }
 const result={split,mode,stride,variant,hashes,scriptHash:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),gradientScriptHash:createHash('sha256').update(fs.readFileSync(path.join(app,'scripts/edge-grid-eval.mjs'))).digest('hex'),joined_sha256:manifest.joined_sha256,elapsed_seconds:(performance.now()-start)/1000,summary:summary(rows),groups:Object.fromEntries(['block','entity','overlay'].map(s=>[s,summary(rows.filter(x=>x.source===s))])),rows};
 fs.writeFileSync(path.join(out,`${variant}-${mode}-${split}.json`),JSON.stringify(result));console.log(JSON.stringify({...result,rows:undefined}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename)await main();
