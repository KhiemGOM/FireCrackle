import {projectQuad,validQuad,type ManualQuad} from "./quadMask";
import type {MatchImage,QuadCandidate,QuadMatch} from "./quadMatch";
import model from "../../release/quad-phase-model.json";

/** Same geometry-only eligibility as the real-data calibration: >=3px/texel. */
export function readablePhaseQuad(q:ManualQuad,w:number,h:number):boolean {
  if(!validQuad(q)||w<=0||h<=0||q.some(p=>p.some(v=>v<0||v>1)))return false;
  // Evaluate the analytic homography Jacobian over the full32x32 grid.
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=q,dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3,det=dx1*dy2-dx2*dy1;
  if(Math.abs(det)<1e-14)return false;
  const g=(dx3*dy2-dx2*dy3)/det,hp=(dx1*dy3-dx3*dy1)/det,A=x1-x0+g*x1,B=x3-x0+hp*x3,C=y1-y0+g*y1,D=y3-y0+hp*y3;
  for(let yi=0;yi<=32;yi++)for(let xi=0;xi<=32;xi++){
    const u=xi/32,v=yi/32,d=g*u+hp*v+1,nx=A*u+B*v+x0,ny=C*u+D*v+y0;
    if(d<=0)return false;
    const ux=(A*d-g*nx)/d**2*w/16,uy=(C*d-g*ny)/d**2*h/16,vx=(B*d-hp*nx)/d**2*w/16,vy=(D*d-hp*ny)/d**2*h/16;
    const a=ux*ux+uy*uy,b=ux*vx+uy*vy,c=vx*vx+vy*vy,t=Math.sqrt((a-c)**2+4*b*b),small=Math.sqrt(Math.max(0,(a+c-t)/2)),large=Math.sqrt(Math.max(0,(a+c+t)/2));
    if(small<3||large/small>2.5||!Number.isFinite(large))return false;
  }
  return true;
}
/** Native128px rectification; RGB truncation and out-of-frame zero match training. */
export function phasePixels(image:MatchImage,q:ManualQuad):Uint8Array {
  const out=new Uint8Array(128*128*3);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
    const [u,v]=projectQuad(q,(x+.5)/128,(y+.5)/128),X=u*image.width-.5,Y=v*image.height-.5,x0=Math.floor(X),y0=Math.floor(Y),dx=X-x0,dy=Y-y0;
    for(let c=0;c<3;c++){
      let value=0;
      for(const [ax,ay,weight] of [[0,0,(1-dx)*(1-dy)],[1,0,dx*(1-dy)],[0,1,(1-dx)*dy],[1,1,dx*dy]]){
        const ix=x0+ax,iy=y0+ay;if(ix>=0&&iy>=0&&ix<image.width&&iy<image.height)value+=image.data[(iy*image.width+ix)*4+c]*weight;
      }
      out[(y*128+x)*3+c]=Math.max(0,Math.min(255,value));
    }
  }
  return out;
}
function softmax(values:number[]):number[] {const max=Math.max(...values),p=values.map(v=>Math.exp(v-max)),sum=p.reduce((a,b)=>a+b,0);return p.map(v=>v/sum);}
/** One phase ranking; atlas row already IS animation phase. Preserve each phase's best appearance. */
export function fuseQuadPhases(result:QuadMatch,logits:number[],provider:string):QuadMatch {
  if(logits.length!==32||logits.some(v=>!Number.isFinite(v)))throw Error("Quad AI returned invalid phases");
  const evidence=result.phaseCandidates,appearances=result.allCandidates;
  if(!evidence?.length||!appearances?.length)return result;
  const byPhase=new Map<number,QuadCandidate>(),scores=Array(32).fill(-Infinity) as number[];
  for(const c of evidence)scores[c.row]=Math.max(scores[c.row],c.score);
  for(const c of appearances){const old=byPhase.get(c.row);if(!old||c.score>old.score)byPhase.set(c.row,c);}
  const allowed=[...byPhase.keys()].sort((a,b)=>a-b),cnn=softmax(logits),best=Math.max(...allowed.map(p=>scores[p]));
  const manual=best>0?softmax(allowed.map(p=>scores[p]/model.matcher_temperature)):allowed.map(()=>1/allowed.length);
  const ranks=allowed.map((phase,i)=>({phase,score:model.cnn_weight*cnn[phase]+(1-model.cnn_weight)*manual[i]})).sort((a,b)=>b.score-a.score||a.phase-b.phase);
  const candidates=ranks.slice(0,3).map(r=>({...byPhase.get(r.phase)!,phaseScore:r.score}));
  return {...result,candidates,margin:ranks[0].score-(ranks[1]?.score??0),ai:{provider}};
}
