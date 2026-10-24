type Restore=()=>void|Promise<void>;
/** A field's change in one step: how to put the old value back, and how to put the new one back again. */
interface Change {undo:Restore;redo?:Restore}
interface Entry {order:number;changes:Map<string,Change>}

/** One session-local history shared by Label tools and the native label store. */
export class LabelUndo {
  private entries:Entry[]=[];
  /** Undone steps, newest undo last: what `redo` re-applies. A new edit drops them. */
  private undone:Entry[]=[];
  private edits=0;
  /** Native label steps a running redo re-applies: their depth increments are not new edits. */
  private redoLabels=0;
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
  get redoSize(){return this.undone.length;}
  bind<T>(key:string,apply:(value:T)=>void){this.bindings.set(key,apply as (value:unknown)=>void);}
  ignore<T>(run:()=>T):T{this.ignored++;try{return run();}finally{this.ignored--;}}
  checkpoint(){this.group=null;return ++this.serial;}
  beginGesture(){this.checkpoint();this.pointer=true;}
  endGesture(){const epoch=this.epoch;queueMicrotask(()=>{if(epoch===this.epoch){this.pointer=false;this.group=null;}});}
  clear(depth=0){this.entries=[];this.undone=[];this.group=null;this.pointer=false;this.labelDepth=depth;this.epoch++;}
  record(key:string,restore:Restore,order?:number,redo?:Restore){
    if(!this.enabled||this.ignored)return;
    this.edits++;this.undone=[];
    if(order===undefined){
      if(this.group===null){
        this.group=++this.serial;const group=this.group;
        queueMicrotask(()=>{if(!this.pointer&&this.group===group)this.group=null;});
      }
      order=this.group;
    }
    let entry=this.entries.find(entry=>entry.order===order);
    if(!entry){entry={order,changes:new Map()};this.entries.push(entry);this.entries.sort((a,b)=>a.order-b.order);}
    // First value of a field in a gesture is its undo target and the last one its redo target, however many
    // pointer moves come between.
    const change=entry.changes.get(key);
    if(!change)entry.changes.set(key,{undo:restore,redo});
    else if(redo)change.redo=redo;
  }
  changed<T>(key:string,before:T,after:T){
    if(Object.is(before,after)||JSON.stringify(before)===JSON.stringify(after))return;
    this.record(key,()=>this.bindings.get(key)?.(before),undefined,()=>this.bindings.get(key)?.(after));
  }
  observeLabels(depth:number|undefined,restore:Restore,order?:number,redo?:Restore){
    if(depth===undefined)return;
    const previous=this.labelDepth;this.labelDepth=depth;
    // Background batches remain undoable even when they finish on another tab.
    const enabled=this.enabled;this.enabled=true;
    try{
      for(let i=previous;i<depth;i++){
        if(this.redoLabels>0){this.redoLabels--;continue;}
        this.record(`labels:${i}`,restore,order??this.checkpoint(),redo);
      }
    }
    finally{this.enabled=enabled;}
  }
  async undo(fallback?:Restore){
    if(this.replaying)return;
    this.group=null;this.pointer=false;
    const entry=this.entries[this.entries.length-1],epoch=this.epoch,edits=this.edits;
    this.replaying=true;
    try{
      if(entry)for(const change of [...entry.changes.values()].reverse())await this.ignore(change.undo);
      else if(fallback)await this.ignore(fallback);
      if(entry&&epoch===this.epoch){
        this.entries.splice(this.entries.indexOf(entry),1);
        // an edit made while the undo ran is newer than it: nothing to redo past it
        if(edits===this.edits&&[...entry.changes.values()].every(change=>change.redo))this.undone.push(entry);
      }
    }finally{this.replaying=false;}
  }
  /** Re-apply the last undone step (a failed redo keeps it). A new edit since the undo leaves nothing to redo. */
  async redo(){
    if(this.replaying)return;
    this.group=null;this.pointer=false;
    const entry=this.undone[this.undone.length-1],epoch=this.epoch;
    if(!entry)return;
    this.replaying=true;
    this.redoLabels=[...entry.changes.keys()].filter(key=>key.startsWith('labels:')).length;
    try{
      for(const change of entry.changes.values())await this.ignore(change.redo!);
      if(epoch===this.epoch){
        this.undone.splice(this.undone.indexOf(entry),1);
        this.entries.push(entry);this.entries.sort((a,b)=>a.order-b.order);
      }
    }finally{this.replaying=false;this.redoLabels=0;}
  }
  attach(target:Pick<Window,'addEventListener'|'removeEventListener'>){
    const begin=()=>this.beginGesture(),end=()=>this.endGesture();
    target.addEventListener('pointerdown',begin,true);
    target.addEventListener('pointerup',end,true);target.addEventListener('pointercancel',end,true);target.addEventListener('blur',end);
    return()=>{target.removeEventListener('pointerdown',begin,true);target.removeEventListener('pointerup',end,true);target.removeEventListener('pointercancel',end,true);target.removeEventListener('blur',end);};
  }
}
