/** Masked homography ECC, following OpenCV's ecc.cpp (Intel BSD license;
 * see THIRD_PARTY_NOTICES.md). No image enhancement or veil rules live here.
 * Sampling uses OpenCV's 1/32-pixel interpolation grid for research parity.
 */
export const ECC_SIZE=128;
const N=ECC_SIZE,L=N*N,F=Math.fround;
export type Plane=Float32Array;
export function linear(a:ArrayLike<number>,x:number,y:number):number {
  x=Math.round(x*32)/32;y=Math.round(y*32)/32;
  const ix=Math.floor(x),iy=Math.floor(y),dx=x-ix,dy=y-iy;
  const at=(u:number,v:number)=>u>=0&&u<N&&v>=0&&v<N?a[v*N+u]:0;
  return at(ix,iy)*(1-dx)*(1-dy)+at(ix+1,iy)*dx*(1-dy)+at(ix,iy+1)*(1-dx)*dy+at(ix+1,iy+1)*dx*dy;
}
function blur(a:ArrayLike<number>):Plane {
  const b=new Float32Array(L),c=new Float32Array(L),reflect=(x:number)=>x<0?1:x>=N?N-2:x;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++)b[y*N+x]=a[y*N+reflect(x-1)]*.25+a[y*N+x]*.5+a[y*N+reflect(x+1)]*.25;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++)c[y*N+x]=b[reflect(y-1)*N+x]*.25+b[y*N+x]*.5+b[reflect(y+1)*N+x]*.25;
  return c;
}
function inverse(a:Float64Array):Float32Array|null {
  const m=Array.from({length:8},(_,i)=>Array.from({length:16},(_,j)=>j<8?a[i*8+j]:Number(j-8===i)));
  for(let k=0;k<8;k++){
    let p=k;for(let i=k+1;i<8;i++)if(Math.abs(m[i][k])>Math.abs(m[p][k]))p=i;
    if(!Number.isFinite(m[p][k])||Math.abs(m[p][k])<1e-12)return null;
    [m[k],m[p]]=[m[p],m[k]];const d=m[k][k];for(let j=k;j<16;j++)m[k][j]/=d;
    for(let i=0;i<8;i++)if(i!==k){const v=m[i][k];for(let j=k;j<16;j++)m[i][j]-=v*m[k][j];}
  }
  return Float32Array.from(m.flatMap(r=>r.slice(8)));
}
/** Maps template canvas pixels to input canvas pixels. Null means abstain. */
export function eccHomography(reference:Plane,input:Plane,alpha:Uint8Array,valid:Uint8Array):Float32Array|null {
  const t=blur(reference),image=blur(input),tm=blur(alpha),im=blur(valid),gx=new Float32Array(L),gy=new Float32Array(L);
  for(let i=0;i<L;i++){tm[i]=tm[i]>=.95?1:0;im[i]=im[i]>=.95?1:0;}
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    gx[y*N+x]=(image[y*N+(x===N-1?N-2:x+1)]-image[y*N+(x===0?1:x-1)])*.5;
    gy[y*N+x]=(image[(y===N-1?N-2:y+1)*N+x]-image[(y===0?1:y-1)*N+x])*.5;
  }
  const w=Float32Array.from([1,0,0,0,1,0,0,0,1]),values=new Float32Array(L),dxs=new Float32Array(L),dys=new Float32Array(L),mask=new Uint8Array(L),xs=new Float64Array(L),ys=new Float64Array(L),ds=new Float64Array(L);
  let previous=-1,rho=-1;
  for(let iteration=0;iteration<60;iteration++){
    let count=0,si=0,st=0;
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      const i=y*N+x,d=w[6]*x+w[7]*y+1,X=(w[0]*x+w[1]*y+w[2])/d,Y=(w[3]*x+w[4]*y+w[5])/d;
      const ix=Math.round(X),iy=Math.round(Y);mask[i]=Number(tm[i]>0&&ix>=0&&iy>=0&&ix<N&&iy<N&&im[iy*N+ix]>0);
      if(!mask[i])continue;
      values[i]=linear(image,X,Y);dxs[i]=linear(gx,X,Y);dys[i]=linear(gy,X,Y);xs[i]=X;ys[i]=Y;ds[i]=d;
      si+=values[i];st+=t[i];count++;
    }
    if(count<64)return null;
    const mi=si/count,mt=st/count,H=new Float64Array(64),ip=new Float64Array(8),tp=new Float64Array(8),j=new Float64Array(8);
    let ni=0,nt=0,corr=0;
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      const i=y*N+x;if(!mask[i])continue;
      const a=F(values[i]-mi),b=F(t[i]-mt),dx=dxs[i]/ds[i],dy=dys[i]/ds[i],v=-xs[i]*dx-ys[i]*dy;
      j.set([F(dx*x),F(dy*x),F(v*x),F(dx*y),F(dy*y),F(v*y),F(dx),F(dy)]);
      ni+=a*a;nt+=b*b;corr+=a*b;
      for(let k=0;k<8;k++){ip[k]+=j[k]*a;tp[k]+=j[k]*b;for(let z=k;z<8;z++)H[k*8+z]+=j[k]*j[z];}
    }
    for(let k=0;k<8;k++){ip[k]=F(ip[k]);tp[k]=F(tp[k]);for(let z=k;z<8;z++)H[z*8+k]=H[k*8+z]=F(H[k*8+z]);}
    const inv=inverse(H);if(!inv||ni<=1e-12||nt<=1e-12)return null;
    previous=rho;rho=corr/Math.sqrt(ni*nt);if(!Number.isFinite(rho))return null;
    const hi=new Float32Array(8);for(let k=0;k<8;k++){let sum=0;for(let z=0;z<8;z++)sum+=inv[k*8+z]*ip[z];hi[k]=sum;}
    let numerator=ni,denominator=corr;
    for(let k=0;k<8;k++){numerator-=ip[k]*hi[k];denominator-=tp[k]*hi[k];}
    if(denominator<=0)return null;
    const lambda=numerator/denominator,delta=new Float32Array(8);
    for(let k=0;k<8;k++){let sum=0;for(let z=0;z<8;z++)sum+=inv[k*8+z]*F(lambda*tp[z]-ip[z]);delta[k]=sum;}
    for(const [i,k] of [0,3,6,1,4,7,2,5].entries())w[k]+=delta[i];
    if(w.some(v=>!Number.isFinite(v)))return null;
    if(Math.abs(rho-previous)<1e-5)break;
  }
  return w;
}
