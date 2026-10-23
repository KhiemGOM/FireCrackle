// Picture work (unveil, encode, movement scores) off the UI thread: a small pool of picture.worker.ts, so the window
// and its buttons stay responsive while the gallery fills. Without workers (tests, old hosts) a task runs inline.
import {runPictureTask,type PictureTask,type PictureTasks} from './pictureTasks';

const POOL=2;
interface Slot{worker:Worker;busy:number}
let slots:Slot[]|null=null,broken=false,nextId=0;
const pending=new Map<number,{resolve:(v:never)=>void;reject:(e:Error)=>void;slot:Slot}>();

function pool():Slot[]|null{
  if(broken||typeof Worker==='undefined')return null;
  if(!slots)slots=Array.from({length:POOL},()=>{
    const slot:Slot={worker:new Worker(new URL('./picture.worker.ts',import.meta.url),{type:'module'}),busy:0};
    slot.worker.onmessage=(e:MessageEvent<{id:number;result?:unknown;error?:string}>)=>{
      const job=pending.get(e.data.id);if(!job)return;
      pending.delete(e.data.id);job.slot.busy--;
      if(e.data.error!==undefined)job.reject(Error(e.data.error));else job.resolve(e.data.result as never);
    };
    // a worker that cannot start: fail what it holds, and run everything inline from now on
    slot.worker.onerror=()=>{broken=true;for(const [id,job] of pending)if(job.slot===slot){pending.delete(id);job.reject(Error('The picture worker failed to start'));}};
    return slot;
  });
  return slots;
}

export function pictureTask<K extends PictureTask>(task:K,args:PictureTasks[K]['args']):Promise<PictureTasks[K]['result']>{
  const all=pool();
  if(!all)return runPictureTask(task,args);
  const slot=all.reduce((a,b)=>b.busy<a.busy?b:a),id=++nextId;
  slot.busy++;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,slot});slot.worker.postMessage({id,task,args});});
}

/** Tests: forget the pool. */
export function resetPictureWorkers(){slots?.forEach(s=>s.worker.terminate());slots=null;broken=false;pending.clear();}
