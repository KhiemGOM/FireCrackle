type Restore=()=>void|Promise<void>;
interface Entry {order:number;changes:Map<string,Restore>}

/** One session-local history shared by Label tools and the native label store. */
export class LabelUndo {
  private entries:Entry[]=[];
  private bindings=new Map<string,(value:unknown)=>void>();
  private serial=0;
  private group:number|null=null;
  private pointer=false;
  private ignored=0;
  private epoch=0;
  private labelDepth=0;
  replaying=false;
  enabled=true;
  get size(){return this.entries.length;}
  bind<T>(key:string,apply:(value:T)=>void){this.bindings.set(key,apply as (value:unknown)=>void);}
  ignore<T>(run:()=>T):T{this.ignored++;try{return run();}finally{this.ignored--;}}
  checkpoint(){this.group=null;return ++this.serial;}
  beginGesture(){this.checkpoint();this.pointer=true;}
  endGesture(){const epoch=this.epoch;queueMicrotask(()=>{if(epoch===this.epoch){this.pointer=false;this.group=null;}});}
  clear(depth=0){this.entries=[];this.group=null;this.pointer=false;this.labelDepth=depth;this.epoch++;}
  record(key:string,restore:Restore,order?:number){
    if(!this.enabled||this.ignored)return;
    if(order===undefined){
      if(this.group===null){
        this.group=++this.serial;const group=this.group;
        queueMicrotask(()=>{if(!this.pointer&&this.group===group)this.group=null;});
      }
      order=this.group;
    }
    let entry=this.entries.find(entry=>entry.order===order);
    if(!entry){entry={order,changes:new Map()};this.entries.push(entry);this.entries.sort((a,b)=>a.order-b.order);}
    // First value of a field in a gesture is its undo target, however many pointer moves follow.
    if(!entry.changes.has(key))entry.changes.set(key,restore);
  }
  changed<T>(key:string,before:T,after:T){
    if(Object.is(before,after)||JSON.stringify(before)===JSON.stringify(after))return;
    this.record(key,()=>this.bindings.get(key)?.(before));
  }
  observeLabels(depth:number|undefined,restore:Restore,order?:number){
    if(depth===undefined)return;
    const previous=this.labelDepth;this.labelDepth=depth;
    // Background batches remain undoable even when they finish on another tab.
    const enabled=this.enabled;this.enabled=true;
    try{for(let i=previous;i<depth;i++)this.record(`labels:${i}`,restore,order??this.checkpoint());}
    finally{this.enabled=enabled;}
  }
  async undo(fallback?:Restore){
    if(this.replaying)return;
    this.group=null;this.pointer=false;
    const entry=this.entries[this.entries.length-1],epoch=this.epoch;
    this.replaying=true;
    try{
      if(entry)for(const restore of [...entry.changes.values()].reverse())await this.ignore(restore);
      else if(fallback)await this.ignore(fallback);
      if(entry&&epoch===this.epoch)this.entries.splice(this.entries.indexOf(entry),1);
    }finally{this.replaying=false;}
  }
  attach(target:Pick<Window,'addEventListener'|'removeEventListener'>){
    const begin=()=>this.beginGesture(),end=()=>this.endGesture();
    target.addEventListener('pointerdown',begin,true);
    target.addEventListener('pointerup',end,true);target.addEventListener('pointercancel',end,true);target.addEventListener('blur',end);
    return()=>{target.removeEventListener('pointerdown',begin,true);target.removeEventListener('pointerup',end,true);target.removeEventListener('pointercancel',end,true);target.removeEventListener('blur',end);};
  }
}
