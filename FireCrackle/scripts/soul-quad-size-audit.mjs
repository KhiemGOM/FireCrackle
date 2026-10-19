// Geometry-only readable-quad selection, shared across cached fire/soul results.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const READABLE_QUAD={minPixelsPerTexel:3,maxAnisotropy:2.5,gridSteps:32,requireFullyOnscreen:true};

export function quadReadability(q,width,height){
 const bad={eligible:false,minPixelsPerTexel:0,maxAnisotropy:null,reason:'invalid'};
 if(q?.length!==4||q.some(p=>p.length!==2||p.some(x=>!Number.isFinite(x)))||width<=0||height<=0)return bad;
 if(q.some(p=>p.some(x=>x<0||x>1)))return {...bad,reason:'clipped'};
 const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=q;
 const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3,det=dx1*dy2-dx2*dy1;
 if(Math.abs(det)<1e-14)return bad;
 const g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det,A=x1-x0+g*x1,B=x3-x0+h*x3,C=y1-y0+g*y1,D=y3-y0+h*y3;
 let min=Infinity,anisotropy=1;
 for(let yi=0;yi<=READABLE_QUAD.gridSteps;yi++)for(let xi=0;xi<=READABLE_QUAD.gridSteps;xi++){
  const u=xi/READABLE_QUAD.gridSteps,v=yi/READABLE_QUAD.gridSteps,d=g*u+h*v+1,nx=A*u+B*v+x0,ny=C*u+D*v+y0;
  if(d<=0||!Number.isFinite(d))return bad;
  const ux=(A*d-g*nx)/d**2*width/16,uy=(C*d-g*ny)/d**2*height/16,
   vx=(B*d-h*nx)/d**2*width/16,vy=(D*d-h*ny)/d**2*height/16;
  const a=ux*ux+uy*uy,b=ux*vx+uy*vy,c=vx*vx+vy*vy,t=Math.sqrt((a-c)**2+4*b*b),
   small=Math.sqrt(Math.max(0,(a+c-t)/2)),large=Math.sqrt(Math.max(0,(a+c+t)/2));
  if(!small||!Number.isFinite(large))return bad;
  min=Math.min(min,small);anisotropy=Math.max(anisotropy,large/small);
 }
 const enough=min>=READABLE_QUAD.minPixelsPerTexel,regular=anisotropy<=READABLE_QUAD.maxAnisotropy;
 return {eligible:enough&&regular,minPixelsPerTexel:min,maxAnisotropy:anisotropy,reason:!enough?'small_or_squashed':!regular?'anisotropic':'readable'};
}

function summarize(rows,get){
 const selected=rows.filter(x=>x.readability.eligible),all=selected.map(get),passes=all.filter(x=>x.status==='clear');
 return {quads:selected.length,frames:new Set(selected.map(x=>x.frame)).size,exact:all.filter(x=>x.correct).length,
  top3:all.filter(x=>x.top3).length,row:all.filter(x=>x.rowCorrect).length,
  gate_correct:passes.filter(x=>x.correct).length,gate_wrong:passes.filter(x=>!x.correct).length};
}

function main(){
 const [soulArg,fireArg,outArg]=process.argv.slice(2);
 if(!outArg)throw Error('Usage: soul-quad-size-audit.mjs SOUL_DATA FIRE_DATA OUT.json');
 const soul=path.resolve(soulArg),fire=path.resolve(fireArg),manifest=JSON.parse(fs.readFileSync(path.join(soul,'manifest.json'))),
  oldManifest=JSON.parse(fs.readFileSync(path.join(fire,'manifest.json')));
 const primary=JSON.parse(fs.readFileSync(path.join(soul,'scores-validation.json'))),secondary=JSON.parse(fs.readFileSync(path.join(soul,'boundary-validation.json')));
 const rows=primary.rows.map(r=>({...r,readability:quadReadability(r.quad,manifest.width,manifest.height)})),byId=new Map(rows.map(r=>[r.id,r]));
 for(const r of secondary.rows)Object.assign(byId.get(r.id).predictions,r.predictions);
 const methods=Object.keys(rows[0].predictions),result={criteria:READABLE_QUAD,soul:{all:rows.length,methods:{},selected:rows.filter(x=>x.readability.eligible)},fire:{}};
 for(const method of methods)result.soul.methods[method]=summarize(rows,r=>r.predictions[method]);
 for(const [name,file] of [['shared_gain','coherent-gain-fixed-validation.json'],['previous','current-baseline-fixed-validation.json']]){
  const data=JSON.parse(fs.readFileSync(path.join(fire,file))),items=data.rows.map(r=>({...r,readability:quadReadability(r.quad,oldManifest.width,oldManifest.height)}));
  const prediction=r=>({correct:r.correct,top3:r.top3,status:r.status,rowCorrect:!!r.candidates[0]&&r.candidates[0].score>0&&r.candidates[0].row===r.expected[1]});
  result.fire[name]={all:items.length,summary:summarize(items,prediction),groups:Object.fromEntries(['block','entity','overlay'].map(src=>[src,summarize(items.filter(r=>r.source===src),prediction)])),selected:items.filter(r=>r.readability.eligible)};
 }
 fs.writeFileSync(outArg,JSON.stringify(result));
 console.log(JSON.stringify({...result,soul:{...result.soul,selected:undefined},fire:Object.fromEntries(Object.entries(result.fire).map(([k,v])=>[k,{...v,selected:undefined}]))},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
