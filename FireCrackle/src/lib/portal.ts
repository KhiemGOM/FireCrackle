// Buffer/worker glue only. Portal fitting and inverse are canonical Rust/WASM.
import {initVeil,veilRuntime} from './veil';
/** Off; Auto (fit the animation frame and opacity from the picture); Manual (use the phase and opacity the user chose). */
export type PortalMode = 'off' | 'auto' | 'manual';
export interface PortalImage { data:Uint8ClampedArray; width:number; height:number; }
export interface PortalResult { data:Uint8ClampedArray; applied:boolean; valid:Uint8Array; phase:number; opacity:number; }
/** The animation frame and overlay opacity to undo, chosen by the user instead of fitted. */
export interface PortalManual { phase:number; opacity:number; }

/** Runs `choose` (fit, or the user's values) and then the inverse, with every native buffer freed afterwards. */
function undoWith(image:PortalImage,atlas:Uint8ClampedArray,side:number,world:Uint8Array|undefined,
  choose:(n:ReturnType<typeof veilRuntime>,b:{rgb:number;tex:number;mask:number;stats:number;w:number;h:number})=>{detected:boolean;phase:number;opacity:number}):PortalResult {
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
    const {detected,phase,opacity}=choose(n,{rgb,tex,mask,stats,w,h});
    const result:PortalResult={data,applied:false,valid:new Uint8Array(w*h),phase,opacity};
    if(!detected)return result;
    if(n.portal_inverse(rgb,w*h*3,w,h,tex,atlas.length,side,phase,opacity,mask,valid)<0)throw Error('Portal correction failed');
    result.valid=new Uint8Array(new Uint8Array(n.memory.buffer,valid,w*h));
    result.data=new Uint8ClampedArray(data);const output=new Uint8Array(n.memory.buffer,rgb,w*h*3);
    for(let i=0;i<w*h;i++)if(result.valid[i]){result.data[i*4]=output[i*3];result.data[i*4+1]=output[i*3+1];result.data[i*4+2]=output[i*3+2];result.applied=true;}
    return result;
  } finally {for(const [p,size] of blocks.reverse())n.veil_free(p,size);}
}

export function undoPortal(image:PortalImage,atlas:Uint8ClampedArray,side:number,world?:Uint8Array):PortalResult {
  return undoWith(image,atlas,side,world,(n,b)=>{
    if(n.portal_fit(b.rgb,b.w*b.h*3,b.w,b.h,b.tex,atlas.length,side,b.mask,b.stats)<0)throw Error('Not enough unobstructed pixels to fit the portal');
    // Allocations may grow memory. Read doubles through DataView: allocator alignment is byte-based.
    const read=(i:number)=>new DataView(n.memory.buffer).getFloat64(b.stats+i*8,true);
    return {detected:read(0)!==0,phase:read(1),opacity:read(2)};
  });
}

/**
 * Undo the portal overlay with a phase and opacity the user chose, without fitting. It is applied whether or not the
 * picture looks like a portal; pixels where the inverse is badly conditioned stay unchanged (valid 0), as in the fit.
 */
export function undoPortalManual(image:PortalImage,atlas:Uint8ClampedArray,side:number,phase:number,opacity:number,world?:Uint8Array):PortalResult {
  if(!Number.isInteger(phase)||phase<0||!Number.isFinite(opacity)||opacity<0||opacity>1)throw Error('Invalid manual portal phase or opacity');
  return undoWith(image,atlas,side,world,()=>({detected:true,phase,opacity}));
}

export async function initPortalRuntime(bytes?:BufferSource){await initVeil(bytes);}
