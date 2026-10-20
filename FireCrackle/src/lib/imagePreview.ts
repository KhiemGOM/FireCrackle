import type {Backend} from './api';
import {previewFrames} from './guiThumbnailCache';
import {loadFrameImage} from './frameComparison';

/** Publish a small cached preview first, then the original for detailed inspection. */
export function displayFrame(backend:Backend,frame:number,show:(url:string,full:boolean)=>void,fail:(error:unknown)=>void){
  let cancelled=false,original:string|undefined;
  const full=()=>{if(cancelled)return;void backend.frame(frame).then(bytes=>{
    if(cancelled)return;original=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));show(original,true);
  }).catch(error=>{if(!cancelled)fail(error);});};
  if(backend.previewThumbnail){
    void previewFrames(backend).get(frame,()=>!cancelled).then(url=>{if(!cancelled)show(url,false);},()=>{}).then(full);
  }else full();
  return()=>{cancelled=true;if(original)URL.revokeObjectURL(original);};
}

const photoIds=new WeakMap<Blob,number>(),photos=new Map<string,Promise<string>>();
let photoId=0;
/** Reuse small photo previews without modifying the imported original. */
export function photoPreview(file:Blob,width=128):Promise<string>{
  let id=photoIds.get(file);if(id===undefined){id=++photoId;photoIds.set(file,id);}
  const key=`${id}:${width}`,held=photos.get(key);if(held){photos.delete(key);photos.set(key,held);return held;}
  const result=(async()=>{
    const bitmap=typeof createImageBitmap==='function'?await createImageBitmap(file,{resizeWidth:width,resizeQuality:'low'}):null;
    try{
      const image=bitmap??await loadFrameImage(await file.arrayBuffer());
      const w=bitmap?bitmap.width:(image as HTMLImageElement).naturalWidth,h=bitmap?bitmap.height:(image as HTMLImageElement).naturalHeight;
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.max(1,Math.round(width*h/w));
      const context=canvas.getContext('2d');if(!context)throw Error('Photo preview unavailable');
      context.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.55);
    }finally{bitmap?.close();}
  })().catch(error=>{if(photos.get(key)===result)photos.delete(key);throw error;});
  photos.set(key,result);while(photos.size>512)photos.delete(photos.keys().next().value!);return result;
}
