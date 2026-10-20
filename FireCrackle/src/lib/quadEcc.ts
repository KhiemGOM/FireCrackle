import {eccHomography,ECC_SIZE} from "./ecc";
import {projectQuad,validQuad,type ManualQuad} from "./quadMask";
import {buildFireColourMask} from "./fireColourMask";
import {soulChannels} from "./quadSoul";
import {readablePhaseQuad} from "./quadPhase";
import type {MatchImage} from "./quadMatch";
import type {PreviewSprite} from "./firePreview";

export interface QuadRefinement {quad:ManualQuad;changed:boolean;gain:number}
const N=ECC_SIZE;
// OpenCV's uchar RGB-to-gray fixed-point coefficients (one-value differences
// matter for this small, locally optimized registration problem).
const gray=(r:number,g:number,b:number)=>((9798*r+19235*g+3735*b+16384)>>15)/255;
function patch(image:MatchImage,mask:Uint8Array,q:ManualQuad) {
  const values=new Float32Array(N*N),valid=new Uint8Array(N*N);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const [u,v]=projectQuad(q,(x+.5)/N*1.2-.1,(y+.5)/N*1.2-.1),X=Math.round((u*image.width-.5)*32)/32,Y=Math.round((v*image.height-.5)*32)/32;
    if(!Number.isFinite(X)||!Number.isFinite(Y))continue;
    const ix=Math.floor(X),iy=Math.floor(Y),dx=X-ix,dy=Y-iy,rgb=[0,0,0];
    for(const [ax,ay,weight] of [[0,0,(1-dx)*(1-dy)],[1,0,dx*(1-dy)],[0,1,(1-dx)*dy],[1,1,dx*dy]]){
      const xx=ix+ax,yy=iy+ay;if(xx<0||yy<0||xx>=image.width||yy>=image.height)continue;
      for(let c=0;c<3;c++)rgb[c]+=image.data[(yy*image.width+xx)*4+c]*weight;
    }
    values[y*N+x]=gray(...rgb.map(v=>Math.round(v)) as [number,number,number]);
    const xx=Math.round(u*image.width-.5),yy=Math.round(v*image.height-.5);
    valid[y*N+x]=Number(xx>=0&&yy>=0&&xx<image.width&&yy<image.height&&mask[yy*image.width+xx]>0);
  }
  return {values,valid};
}
/** Fixed sprite only; input is original RGB after the shared automatic unveil. */
export function refineQuad(image:MatchImage,sheets:[Uint8ClampedArray,Uint8ClampedArray],quad:ManualQuad,sprite:PreviewSprite,material:"normal"|"soul"="normal"):QuadRefinement {
  const unchanged={quad,changed:false,gain:0};
  if(!validQuad(quad)||!readablePhaseQuad(quad,image.width,image.height)||!Number.isInteger(sprite.row)||sprite.row<0||sprite.row>31||![0,1].includes(sprite.sheet)||image.data.length!==image.width*image.height*4||sheets.some(s=>s.length!==32768))return unchanged;
  const envelope=[[-.1,-.1],[1.1,-.1],[1.1,1.1],[-.1,1.1]].map(([u,v])=>projectQuad(quad,u,v)) as ManualQuad;
  const colourImage=material==="soul"?{...image,data:soulChannels(image.data)}:image;
  const mask=buildFireColourMask(colourImage,material==="soul"?sheets.map(soulChannels) as typeof sheets:sheets,envelope);
  const reference=new Float32Array(N*N),alpha=new Uint8Array(N*N),sheet=sheets[sprite.sheet];
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    let tx=Math.round(((x+.5)/N*1.2-.1)*16-.5);const ty=Math.round(((y+.5)/N*1.2-.1)*16-.5),i=y*N+x;
    if(tx<0||ty<0||tx>15||ty>15)continue;if(sprite.mirrored)tx=15-tx;
    const a=((sprite.row*16+ty)*16+tx)*4;reference[i]=gray(sheet[a],sheet[a+1],sheet[a+2]);alpha[i]=Number(sheet[a+3]>127);
  }
  const original=patch(image,mask,quad),warp=eccHomography(reference,original.values,alpha,original.valid);if(!warp)return unchanged;
  const proposal=([[0,0],[1,0],[1,1],[0,1]] as const).map(([u,v])=>{
    const x=(u+.1)/1.2*N-.5,y=(v+.1)/1.2*N-.5,d=warp[6]*x+warp[7]*y+1;
    const U=((warp[0]*x+warp[1]*y+warp[2])/d+.5)/N*1.2-.1,V=((warp[3]*x+warp[4]*y+warp[5])/d+.5)/N*1.2-.1;
    return {U,V,d,point:projectQuad(quad,U,V)};
  });
  if(proposal.some(p=>!Number.isFinite(p.U)||!Number.isFinite(p.V)||Math.abs(p.d)<1e-9||p.U<-.10001||p.U>1.10001||p.V<-.10001||p.V>1.10001)||!proposal.every(p=>p.d*proposal[0].d>0))return unchanged;
  let candidate=proposal.map(p=>p.point) as ManualQuad;if(!validQuad(candidate))return unchanged;
  const distance=(a:number[],b:number[])=>Math.hypot((a[0]-b[0])*image.width,(a[1]-b[1])*image.height);
  const cap=Math.min(...quad.map((p,i)=>distance(p,quad[(i+1)%4])))/32,move=Math.max(...candidate.map((p,i)=>distance(p,quad[i]))),step=move>0?Math.min(1,cap/move):0;
  candidate=candidate.map((p,i)=>[quad[i][0]+(p[0]-quad[i][0])*step,quad[i][1]+(p[1]-quad[i][1])*step]) as ManualQuad;
  if(!validQuad(candidate)||move*step<1e-4)return unchanged;
  const aligned=patch(image,mask,candidate);let count=0,st=0,sa=0,sb=0;
  for(let i=0;i<N*N;i++)if(alpha[i]&&original.valid[i]&&aligned.valid[i]){count++;st+=reference[i];sa+=original.values[i];sb+=aligned.values[i];}
  if(count<1024)return unchanged;
  st/=count;sa/=count;sb/=count;let tt=0,aa=0,bb=0,ta=0,tb=0;
  for(let i=0;i<N*N;i++)if(alpha[i]&&original.valid[i]&&aligned.valid[i]){const t=reference[i]-st,a=original.values[i]-sa,b=aligned.values[i]-sb;tt+=t*t;aa+=a*a;bb+=b*b;ta+=t*a;tb+=t*b;}
  const gain=tb/Math.sqrt(tt*bb)-ta/Math.sqrt(tt*aa);
  if(!Number.isFinite(gain)||gain<=.005)return unchanged;
  // A locally plausible fit must also register back to the same template.
  // This guards ambiguous/ill-conditioned homographies and numerical drift.
  const reverse=eccHomography(original.values,reference,original.valid,alpha);if(!reverse)return unchanged;
  for(let i=0;i<proposal.length;i++){
    const {U,V}=proposal[i];
    const x=(U+.1)/1.2*N-.5,y=(V+.1)/1.2*N-.5,d=reverse[6]*x+reverse[7]*y+1;
    const bx=(reverse[0]*x+reverse[1]*y+reverse[2])/d,by=(reverse[3]*x+reverse[4]*y+reverse[5])/d;
    const [u,v]=[[0,0],[1,0],[1,1],[0,1]][i];
    if(!Number.isFinite(bx)||!Number.isFinite(by)||Math.hypot(bx-((u+.1)/1.2*N-.5),by-((v+.1)/1.2*N-.5))>.75)return unchanged;
  }
  return {quad:candidate,changed:true,gain};
}
