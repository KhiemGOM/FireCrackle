import type {PortalImage,PortalManual,PortalResult} from './portal';

export interface WorldCoverage {width:number;height:number;world:Uint8Array}
/** A panel mask is usable without a HUD fit; coverage must belong to this exact frame. */
export function guiWorldCoverage(state:{maskFrame:number|null;pixels:Uint8ClampedArray|null;reply:{width:number;height:number;reliable:boolean;mask_available?:boolean}|null},frame:number):WorldCoverage|undefined{
  const r=state.reply;
  if(state.maskFrame!==frame||!r||!(r.mask_available??r.reliable)||!state.pixels||!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<=0||r.height<=0||state.pixels.length!==r.width*r.height*4)return;
  return {width:r.width,height:r.height,world:portalWorldMask(state.pixels)};
}

/** Consume the GUI overlay's coverage only; no GUI detection rules live here. */
export function portalWorldMask(gui:Uint8ClampedArray):Uint8Array{
  if(gui.length%4)throw Error('Invalid GUI overlay');
  const world=new Uint8Array(gui.length/4);
  for(let i=0;i<world.length;i++)world[i]=gui[i*4+3]?0:1;
  return world;
}

/** A fresh worker is cancellable when the user seeks; fitting never blocks the UI thread. */
export async function portalPreview(image:PortalImage,signal:AbortSignal,world?:Uint8Array,manual?:PortalManual):Promise<PortalResult>{
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  const worker=new Worker(new URL('./portal.worker.ts',import.meta.url),{type:'module'});
  return new Promise((resolve,reject)=>{
    const finish=()=>{worker.terminate();signal.removeEventListener('abort',abort);};
    const abort=()=>{finish();reject(new DOMException('Cancelled','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=e=>{finish();e.data.error?reject(Error(e.data.error)):resolve(e.data);};
    worker.onerror=e=>{finish();reject(Error(e.message));};
    // Explicit manual/Always undo processes the full picture, independent of GUI coverage.
    worker.postMessage({image,world:manual?undefined:world,manual});
  });
}
