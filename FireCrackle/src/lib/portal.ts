// Buffer/worker glue only. Portal fitting and inverse are canonical Rust/WASM.
import {initVeil,veilRuntime} from './veil';
export type PortalMode = 'off' | 'auto';
export interface PortalImage { data:Uint8ClampedArray; width:number; height:number; }
export interface PortalResult { data:Uint8ClampedArray; applied:boolean; valid:Uint8Array; phase:number; opacity:number; }
export function undoPortal(image:PortalImage,atlas:Uint8ClampedArray,side:number,world?:Uint8Array):PortalResult {
  const {width:w,height:h,data}=image;
  if(w<32||h<32||data.length!==w*h*4||world&&world.length!==w*h)throw Error('Invalid portal image/mask dimensions');
  const n=veilRuntime(),blocks:Array<[number,number]>=[];
  const alloc=(size:number)=>{const p=n.veil_alloc(size);blocks.push([p,size]);return p;};
  try{
    const rgb=alloc(w*h*3),tex=alloc(atlas.length),mask=world?alloc(world.length):0,stats=alloc(64),valid=alloc(w*h);
    const raw=new Uint8Array(n.memory.buffer,rgb,w*h*3);
    for(let i=0;i<w*h;i++){raw[i*3]=data[i*4];raw[i*3+1]=data[i*4+1];raw[i*3+2]=data[i*4+2];}
    new Uint8Array(n.memory.buffer,tex,atlas.length).set(atlas);
    if(world)new Uint8Array(n.memory.buffer,mask,world.length).set(world);
    if(n.portal_fit(rgb,w*h*3,w,h,tex,atlas.length,side,mask,stats)<0)throw Error('Not enough unobstructed pixels to fit the portal');
    // Allocations may grow memory. Read doubles through DataView: allocator alignment is byte-based.
    const read=(i:number)=>new DataView(n.memory.buffer).getFloat64(stats+i*8,true);
    const detected=read(0)!==0,phase=read(1),opacity=read(2);
    const result:PortalResult={data,applied:false,valid:new Uint8Array(w*h),phase,opacity};
    if(!detected)return result;
    if(n.portal_inverse(rgb,w*h*3,w,h,tex,atlas.length,side,phase,opacity,mask,valid)<0)throw Error('Portal correction failed');
    result.valid=new Uint8Array(new Uint8Array(n.memory.buffer,valid,w*h));
    result.data=new Uint8ClampedArray(data);const output=new Uint8Array(n.memory.buffer,rgb,w*h*3);
    for(let i=0;i<w*h;i++)if(result.valid[i]){result.data[i*4]=output[i*3];result.data[i*4+1]=output[i*3+1];result.data[i*4+2]=output[i*3+2];result.applied=true;}
    return result;
  } finally {for(const [p,size] of blocks.reverse())n.veil_free(p,size);}
}

export async function initPortalRuntime(bytes?:BufferSource){await initVeil(bytes);}
