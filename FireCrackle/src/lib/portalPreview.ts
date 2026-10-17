import type {PortalImage,PortalManual,PortalResult} from './portal';

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
    worker.postMessage({image,world,manual});
  });
}
