import { validQuad, type ManualQuad } from "./quadMask";

/** Sample a single projected texture at delivery-pixel centres. Adjacent source
 * texels share coverage: no per-polygon antialiasing, outlines or white cracks.
 */
export function rasterizeFire(sheet:Uint8ClampedArray,row:number,mirrored:boolean,q:ManualQuad,width:number,height:number,white=false,output?:Uint8ClampedArray):Uint8ClampedArray {
  if(sheet.length!==16*512*4 || !Number.isInteger(row) || row<0 || row>31 || !validQuad(q) || !Number.isInteger(width) || !Number.isInteger(height) || width<=0 || height<=0 || width>4096 || height>4096)throw new Error("Invalid fire raster");
  const data=output??new Uint8ClampedArray(width*height*4);
  if(data.length!==width*height*4)throw new Error("Invalid raster buffer");
  data.fill(white?255:0);
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=q;
  const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3;
  const dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
  const denominator=dx1*dy2-dx2*dy1;
  const g=(dx3*dy2-dx2*dy3)/denominator,h=(dx1*dy3-dx3*dy1)/denominator;
  const a=x1-x0+g*x1,b=x3-x0+h*x3,d=y1-y0+g*y1,e=y3-y0+h*y3;
  const left=Math.max(0,Math.floor(Math.min(...q.map(p=>p[0]))*width));
  const right=Math.min(width,Math.ceil(Math.max(...q.map(p=>p[0]))*width));
  const top=Math.max(0,Math.floor(Math.min(...q.map(p=>p[1]))*height));
  const bottom=Math.min(height,Math.ceil(Math.max(...q.map(p=>p[1]))*height));
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++) {
    const X=(x+0.5)/width,Y=(y+0.5)/height;
    const A=a-X*g,B=b-X*h,C=d-Y*g,D=e-Y*h,det=A*D-B*C;
    const u=((X-x0)*D-B*(Y-y0))/det,v=(A*(Y-y0)-(X-x0)*C)/det;
    if(!(u>=0&&u<1&&v>=0&&v<1))continue;
    const sx=Math.floor(u*16),sy=Math.floor(v*16);
    const source=((row*16+sy)*16+(mirrored?15-sx:sx))*4,target=(y*width+x)*4;
    if(white) {
      const alpha=sheet[source+3]/255;
      for(let c=0;c<3;c++)data[target+c]=sheet[source+c]*alpha+255*(1-alpha);
    } else {
      for(let c=0;c<4;c++)data[target+c]=sheet[source+c];
    }
  }
  return data;
}

/** Texels (points in picture fractions, as lib/quadMask.ts manualTexels and lib/fireTool.ts fireTexels give them) drawn in
 * order into a `width` × `height` RGBA raster: a pixel takes the colour of the last texel whose quad holds its centre,
 * so texels sorted far to near show what the game shows. `white`: blended over a white backdrop, opaque (for the codec),
 * else transparent where nothing is drawn. */
export function rasterizeTexels(texels:{points:Array<[number,number]>;colour:string;alpha:number}[],width:number,height:number,white=false,output?:Uint8ClampedArray):Uint8ClampedArray {
  if(!Number.isInteger(width) || !Number.isInteger(height) || width<=0 || height<=0 || width>4096 || height>4096)throw new Error("Invalid fire raster");
  const data=output??new Uint8ClampedArray(width*height*4);
  if(data.length!==width*height*4)throw new Error("Invalid raster buffer");
  data.fill(white?255:0);
  for(const t of texels) {
    if(!(t.alpha>0))continue;
    const m=/rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(t.colour);
    if(!m)continue;
    const rgb=[Number(m[1]),Number(m[2]),Number(m[3])];
    const p=t.points.map(([x,y])=>[x*width,y*height] as const);
    const left=Math.max(0,Math.floor(Math.min(...p.map(q=>q[0])))),right=Math.min(width,Math.ceil(Math.max(...p.map(q=>q[0]))));
    const top=Math.max(0,Math.floor(Math.min(...p.map(q=>q[1])))),bottom=Math.min(height,Math.ceil(Math.max(...p.map(q=>q[1]))));
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++) {
      // inside the convex quad: the pixel centre is on the same side of every edge
      const X=x+0.5,Y=y+0.5;let sign=0,inside=true;
      for(let i=0;i<p.length&&inside;i++) {
        const [ax,ay]=p[i],[bx,by]=p[(i+1)%p.length],c=(bx-ax)*(Y-ay)-(by-ay)*(X-ax);
        if(c!==0){const s=c>0?1:-1;if(sign===0)sign=s;else if(s!==sign)inside=false;}
      }
      if(!inside)continue;
      const o=(y*width+x)*4;
      if(white){for(let c=0;c<3;c++)data[o+c]=rgb[c]*t.alpha+data[o+c]*(1-t.alpha);data[o+3]=255;}
      else{const a=t.alpha+data[o+3]/255*(1-t.alpha);for(let c=0;c<3;c++)data[o+c]=a>0?(rgb[c]*t.alpha+data[o+c]*(data[o+3]/255)*(1-t.alpha))/a:0;data[o+3]=a*255;}
    }
  }
  return data;
}

/** Keep the decoded codec colours but restore only original texture coverage. */
export function restoreFireAlpha(decoded:Uint8ClampedArray,mask:Uint8ClampedArray):void {
  if(decoded.length!==mask.length)throw new Error("Mismatched raster masks");
  for(let i=3;i<decoded.length;i+=4)decoded[i]=mask[i];
}
