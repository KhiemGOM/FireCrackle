import { projectQuad, validQuad, type ManualQuad } from "./quadMask";
import type { PreviewSprite } from "./firePreview";
import { optimizeQuad } from "./quadOptimizer";
import { buildFireColourMask } from "./fireColourMask";
import { matchesAppearance, sheetEdgeCounts, type AtlasEdges, type EdgeFilter } from "./atlasFilter";

export interface MatchImage { width:number; height:number; data:Uint8ClampedArray }
export interface QuadCandidate extends PreviewSprite { score:number; quad:ManualQuad; support?:number; maskSamples?:number; regions?:number }
export interface QuadMatch {
  status:"clear"|"ambiguous"|"weak"|"insufficient"|"filtered";
  candidates:QuadCandidate[]; margin:number; searched:number;
}
interface Samples {probes:number;weights:Float64Array;rgb:Float64Array;fire:Uint8Array;valid:Uint8Array;count:number}
interface Template extends PreviewSprite {rgb:Float64Array;alpha:Uint8Array; bounds:[number,number,number,number]}

function sampleFrame(image:MatchImage,quad:ManualQuad,mask:Uint8Array,probes=4):Samples {
  const rgb=new Float64Array(768*probes),fire=new Uint8Array(256*probes),valid=new Uint8Array(256*probes),weights=new Float64Array(256*probes);
  const pixels=new Map<number,number[]>();
  let count=0;
  // Cache the projective coefficients once per objective evaluation.
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=quad;
  const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
  const det=dx1*dy2-dx2*dy1,g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;
  const A=x1-x0+g*x1,B=x3-x0+h*x3,C=y1-y0+g*y1,D=y3-y0+h*y3;
  const project=(u:number,v:number):[number,number]=>[(A*u+B*v+x0)/(g*u+h*v+1),(C*u+D*v+y0)/(g*u+h*v+1)];
  for(let py=0;py<16;py++)for(let px=0;px<16;px++)for(let sub=0;sub<probes;sub++) {
    const i=(py*16+px)*probes+sub,[u,v]=project((px+(probes===1?.5:.25+.5*(sub%2)))/16,(py+(probes===1?.5:.25+.5*Math.floor(sub/2)))/16);
    const X=u*image.width-0.5,Y=v*image.height-0.5;
    if(X<0||Y<0||X>image.width-1||Y>image.height-1)continue;
    const pixel=Math.round(Y)*image.width+Math.round(X),indices=pixels.get(pixel);
    if(indices)indices.push(i);else pixels.set(pixel,[i]);
    const x0=Math.floor(X),y0=Math.floor(Y),x1=Math.min(image.width-1,x0+1),y1=Math.min(image.height-1,y0+1),fx=X-x0,fy=Y-y0;
    for(let c=0;c<3;c++)rgb[i*3+c]=
      image.data[(y0*image.width+x0)*4+c]*(1-fx)*(1-fy)+image.data[(y0*image.width+x1)*4+c]*fx*(1-fy)+
      image.data[(y1*image.width+x0)*4+c]*(1-fx)*fy+image.data[(y1*image.width+x1)*4+c]*fx*fy;
    fire[i]=Number(mask[y0*image.width+x0]*(1-fx)*(1-fy)+mask[y0*image.width+x1]*fx*(1-fy)+mask[y1*image.width+x0]*(1-fx)*fy+mask[y1*image.width+x1]*fx*fy>=0.5);valid[i]=1;
  }
  for(let i=0;i<256;i++)if(valid.subarray(i*probes,i*probes+probes).some(Boolean))count++;
  // Repeated probes of one native pixel cannot manufacture independent votes
  // when an optimizer shrinks a texture over a tiny bright spot.
  for(const indices of pixels.values())for(const i of indices)weights[i]=Math.min(1,probes/indices.length);
  return {rgb,fire,valid,count,probes,weights};
}

function templates(sheets:[Uint8ClampedArray,Uint8ClampedArray]):Template[] {
  const result:Template[]=[];
  for(const sheet of [0,1] as const)for(let row=0;row<32;row++)for(const mirrored of [false,true]) {
    const rgb=new Float64Array(768),alpha=new Uint8Array(256);
    for(let py=0;py<16;py++)for(let px=0;px<16;px++) {
      const i=py*16+px,source=((row*16+py)*16+(mirrored?15-px:px))*4;
      for(let c=0;c<3;c++)rgb[i*3+c]=sheets[sheet][source+c];
      alpha[i]=sheets[sheet][source+3];
    }
    const opaque=Array.from(alpha.keys()).filter(i=>alpha[i]>127);
    const bounds:[number,number,number,number]=opaque.length?[
      Math.min(...opaque.map(i=>i%16))/16,Math.min(...opaque.map(i=>Math.floor(i/16)))/16,
      (Math.max(...opaque.map(i=>i%16))+1)/16,(Math.max(...opaque.map(i=>Math.floor(i/16)))+1)/16,
    ]:[0,0,1,1];
    result.push({sheet,row,mirrored,rgb,alpha,bounds});
  }
  return result;
}

/** Positive-only evidence from the candidate-independent colour mask.
 * Each of the fixed 256 positions can add a vote; unknown pixels, transparency
 * and colour mismatches add zero. Never divide by the observed mask size:
 * revealing another sample must not dilute evidence already collected.
 */
function similarity(observed:Samples,model:Template):{score:number;support:number;maskSamples:number;regions:number} {
  let maskSamples=0,support=0;
  // A texel is a flat colour: lighting can scale the whole face, but cannot
  // independently turn every expected texel into an arbitrary brightness.
  // Maximize a fixed bank of additive, nonnegative gain hypotheses. A newly
  // revealed sample can add evidence, never dilute an existing hypothesis.
  const histogram=new Float64Array(96),hits=new Float64Array(256*observed.probes),bins=new Int16Array(256*observed.probes);
  const regions=new Set<number>();
  for(let cell=0;cell<256;cell++) {
    let masked=false;
    for(let sub=0;sub<observed.probes;sub++) {
      const i=cell*observed.probes+sub;
      if(!observed.valid[i]||!observed.fire[i])continue;
      masked=true;
      if(model.alpha[cell]<=127)continue;
      const a=i*3,t=cell*3,R=Math.max(model.rgb[t],1),r=Math.max(observed.rgb[a],1);
      const dg=Math.abs(observed.rgb[a+1]/r-model.rgb[t+1]/R);
      const db=Math.abs(observed.rgb[a+2]/r-model.rgb[t+2]/R);
      if(dg>0.06||db>0.10)continue;
      const bin=Math.round((Math.log2(r/R)+5)*12);
      if(bin<0||bin>=histogram.length)continue;
      const vote=(1-0.5*(dg/0.06+db/0.10))*observed.weights[i]/observed.probes;
      histogram[bin]+=vote;hits[i]=vote;bins[i]=bin;
    }
    if(masked)maskSamples++;
  }
  const adjacentWeight=1-(1/12)/0.12;
  let votes=0,bestBin=12;
  for(let bin=12;bin<=76;bin++){
    const value=histogram[bin]+adjacentWeight*(histogram[bin-1]+histogram[bin+1]);
    if(value>votes){votes=value;bestBin=bin;}
  }
  for(let cell=0;cell<256;cell++){
    let matched=false;
    for(let sub=0;sub<observed.probes;sub++){
      const i=cell*observed.probes+sub;
      if(hits[i]>0&&Math.abs(bins[i]-bestBin)<=1)matched=true;
    }
    if(matched){support++;regions.add(Math.floor((cell%16)/4)+4*Math.floor(cell/64));}
  }
  return {score:votes/256,support,maskSamples,regions:regions.size};
}

/** Search128 appearances and small position/scale corrections inside the supplied outline.
 * No clock prediction or UI overlay is an input; only the original frame pixels.
 */
export function matchFireQuad(image:MatchImage,sheets:[Uint8ClampedArray,Uint8ClampedArray],quad:ManualQuad,options:{refineGeometry?:boolean;filter?:EdgeFilter}={}):QuadMatch {
  return match(image,sheets,quad,false,true,options.refineGeometry??true,options.filter);
}

/** Oracle-box evaluation adapter: labels bound visible opacity, not the full
 * texture. Expand each candidate using ITS OWN alpha hull, never the truth row.
 * A rectangle cannot recover perspective or hidden texture from a clipped box.
 */
export function matchFireBox(image:MatchImage,sheets:[Uint8ClampedArray,Uint8ClampedArray],box:ManualQuad,options={stretch:true}):QuadMatch {
  return match(image,sheets,box,true,options.stretch);
}

function match(image:MatchImage,sheets:[Uint8ClampedArray,Uint8ClampedArray],quad:ManualQuad,opaqueBox:boolean,stretch=true,refineGeometry=true,filter?:EdgeFilter):QuadMatch {
  const insufficient:QuadMatch={status:"insufficient",candidates:[],margin:0,searched:0};
  if(!validQuad(quad)||image.width<=0||image.height<=0||image.data.length!==image.width*image.height*4||sheets.some(s=>s.length!==16*512*4))return insufficient;
  const w=Math.hypot((quad[1][0]-quad[0][0])*image.width,(quad[1][1]-quad[0][1])*image.height);
  const h=Math.hypot((quad[3][0]-quad[0][0])*image.width,(quad[3][1]-quad[0][1])*image.height);
  if(w*h<36||Math.min(w,h)<4)return insufficient;
  let models=templates(sheets);
  if(filter) {
    const edges=sheets.map(sheetEdgeCounts) as AtlasEdges;
    models=models.filter(model=>matchesAppearance(edges,model.sheet,model.row,model.mirrored,filter));
  }
  if(!models.length)return {status:"filtered",candidates:[],margin:0,searched:0};
  const envelope=[[-.1,-.1],[1.1,-.1],[1.1,1.1],[-.1,1.1]].map(([u,v])=>projectQuad(quad,u,v)) as ManualQuad;
  const mask=buildFireColourMask(image,sheets,refineGeometry&&validQuad(envelope)?envelope:quad);
  const best:QuadCandidate[]=models.map(({sheet,row,mirrored})=>({sheet,row,mirrored,score:0,quad}));
  let enoughVisible=false;
  if(refineGeometry&&!opaqueBox) {
    const original=sampleFrame(image,quad,mask);
    for(let i=0;i<models.length;i++){
      const model=models[i];
      const fit=optimizeQuad(quad,shape=>{
        const observed=sampleFrame(image,shape,mask,1);
        if(observed.count<64)return 0;
        enoughVisible=true;
        return similarity(observed,model).score;
      },160);
      const evidence=similarity(sampleFrame(image,fit.quad,mask),model);
      const initial=similarity(original,model);
      best[i]=evidence.score>initial.score?{...best[i],...evidence,quad:fit.quad}:{...best[i],...initial,quad};
    }
    // Every appearance gets its own fit; spend the finer sampling budget on
    // the strongest few without changing the original search envelope.
    const finalists=best.map((_,i)=>i).sort((a,b)=>best[b].score-best[a].score).slice(0,6);
    for(const i of finalists){
      optimizeQuad(quad,shape=>{
        const observed=sampleFrame(image,shape,mask);
        if(observed.count<64)return 0;
        const evidence=similarity(observed,models[i]);
        if(evidence.score>best[i].score)best[i]={...best[i],...evidence,quad:shape};
        return evidence.score;
      },120,best[i].quad);
    }
  }else{
    // Kept only for the archived bbox diagnostic; the app never uses this adapter.
    const scales=opaqueBox&&stretch?[1,0.8,1.2].flatMap(x=>[1,0.8,1.2].map(y=>[x,y])):[[1,1]];
    for(const [scaleX,scaleY] of scales){
      const fit=opaqueBox?[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>projectQuad(quad,(u-.5)*scaleX+.5,(v-.5)*scaleY+.5)) as ManualQuad:quad;
      const shared=opaqueBox?null:sampleFrame(image,fit,mask);
      for(let i=0;i<models.length;i++){
        let observed=shared,expanded=fit;
        if(opaqueBox){
          const [x0,y0,x1,y1]=models[i].bounds;
          expanded=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>projectQuad(fit,(u-x0)/(x1-x0),(v-y0)/(y1-y0))) as ManualQuad;
          observed=sampleFrame(image,expanded,mask);
        }
        if(!observed||observed.count<64)continue;
        enoughVisible=true;
        const evidence=similarity(observed,models[i]);
        if(evidence.score>best[i].score)best[i]={...best[i],...evidence,quad:expanded};
      }
    }
  }
  if(!enoughVisible)return insufficient;
  best.sort((a,b)=>b.score-a.score);
  const margin=best[0].score-(best[1]?.score??0);
  const status=best[0].score===0?"weak":(best[0].support??0)<32||(best[0].regions??0)<3?"insufficient":margin<0.03?"ambiguous":"clear";
  return {status,candidates:best.slice(0,5),margin,searched:models.length};
}
