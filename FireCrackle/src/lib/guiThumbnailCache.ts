import type {Backend} from './api';
import {loadFrameImage} from './frameComparison';

/** Small JPEGs survive row unmounts and tab switches. Full-size frames are never retained here. */
export class GuiThumbnailCache {
  private images=new Map<number,string>();
  private pending=new Map<number,{promise:Promise<string>;wanted:Array<()=>boolean>}>();
  private queue:Array<()=>void>=[];
  private active=0;
  private bytes=0;
  private generation=0;
  constructor(private load:(frame:number)=>Promise<string>,private capacity=512,private maxBytes=8*1024*1024,private parallel=2){}
  get(frame:number,wanted:()=>boolean=()=>true):Promise<string>{
    const cached=this.images.get(frame);
    if(cached!==undefined){this.images.delete(frame);this.images.set(frame,cached);return Promise.resolve(cached);}
    const existing=this.pending.get(frame);
    if(existing){existing.wanted.push(wanted);return existing.promise;}
    let resolve!:(image:string)=>void,reject!:(error:unknown)=>void;
    const promise=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});
    const entry={promise,wanted:[wanted]},generation=this.generation;
    this.pending.set(frame,entry);
    this.queue.push(()=>{
      if(generation!==this.generation||!entry.wanted.some(needed=>needed())){
        if(this.pending.get(frame)===entry)this.pending.delete(frame);
        reject(Error('Thumbnail no longer needed'));return;
      }
      this.active++;
      void Promise.resolve().then(()=>this.load(frame)).then(image=>{
        if(generation===this.generation){
          this.images.set(frame,image);this.bytes+=image.length*2;
          while(this.images.size>this.capacity||this.bytes>this.maxBytes){
            const oldest=this.images.keys().next().value!;
            this.bytes-=this.images.get(oldest)!.length*2;this.images.delete(oldest);
          }
        }
        resolve(image);
      },reject).finally(()=>{
        if(this.pending.get(frame)===entry)this.pending.delete(frame);
        this.active--;this.pump();
      });
    });
    this.pump();return promise;
  }
  clear(){this.generation++;this.images.clear();this.bytes=0;this.pending.clear();this.pump();}
  private pump(){while(this.active<this.parallel&&this.queue.length)this.queue.shift()!();}
}

const caches=new WeakMap<Backend,{video?:string;sizes:Map<number,GuiThumbnailCache>}>();
export function clearGuiThumbnails(backend:Backend){caches.get(backend)?.sizes.forEach(cache=>cache.clear());caches.delete(backend);}
export function guiThumbnails(backend:Backend,videoKey:string|undefined,total:number):GuiThumbnailCache{
  const video=JSON.stringify([videoKey,total]),existing=caches.get(backend);
  if(existing?.video!==undefined&&existing.video!==video)clearGuiThumbnails(backend);
  const cache=previewFrames(backend,128);caches.get(backend)!.video=video;return cache;
}
/** Shared display previews; never used as matching, mask, difference or export evidence. */
export function previewFrames(backend:Backend,width=512):GuiThumbnailCache{
  width=width<=128?128:width<=512?512:1024;
  let owner=caches.get(backend);if(!owner){owner={sizes:new Map()};caches.set(backend,owner);}
  const found=owner.sizes.get(width);if(found)return found;
  const cache=new GuiThumbnailCache(async frame=>{
    if(backend.previewThumbnail){
      const bytes=await backend.previewThumbnail(frame,width);
      return new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);
        reader.onerror=()=>reject(Error('Could not read thumbnail'));reader.readAsDataURL(new Blob([bytes],{type:'image/jpeg'}));
      });
    }
    const image=await loadFrameImage(await backend.frame(frame));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.max(1,Math.round(width*image.naturalHeight/image.naturalWidth));
    const context=canvas.getContext('2d');if(!context)throw Error('Thumbnail unavailable');
    context.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.55);
  });
  owner.sizes.set(width,cache);return cache;
}
