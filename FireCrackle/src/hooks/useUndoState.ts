import {useRef,useState,type Dispatch,type SetStateAction} from 'react';
import type {LabelUndo} from '../lib/labelUndo';

/** Record edits at their setter, never from a render/effect diff. Bindings refresh after a tab remount. */
export function useUndoState<T>(initial:T|(()=>T),history:LabelUndo|undefined,key:string):[T,Dispatch<SetStateAction<T>>]{
  const [value,setValue]=useState(initial),latest=useRef(value);latest.current=value;
  const apply=(next:T)=>{latest.current=next;setValue(next);};
  history?.bind(key,apply);
  return [value,update=>{
    const before=latest.current,next=typeof update==='function'?(update as (previous:T)=>T)(before):update;
    history?.changed(key,before,next);apply(next);
  }];
}
