import type {Backend} from './api';
import {loadFrameImage} from './frameComparison';
import {backgroundBackend} from './appErrors';
import {blobDataUrl} from './canvas';
import {unveilPreview} from './comparisonPost';
import type {WorldCoverage} from './portalPreview';
import type {VeilOptions} from './veil';

/** Small JPEGs survive row unmounts and tab switches. Full-size frames are never retained here. */
export class GuiThumbnailCache {
  private images=new Map<number,string>();
  private pending=new Map<number,{promise:Promise<string>;wanted:Array<{needed:()=>boolean;rank:number}>}>();
  private queue:Array<{priority:()=>number;wanted:()=>boolean;run:()=>void}>=[];
  private active=0;
  private bytes=0;
  private generation=0;
  private targets:readonly number[]=[];
  setTargets(frames:readonly number[]){this.targets=frames;}
  constructor(private load:(frame:number,targets?:readonly number[])=>Promise<string>,private capacity=512,private maxBytes=8*1024*1024,private parallel=2){}
  get(frame:number,wanted:()=>boolean=()=>true,priority:'visible'|'background'='visible'):Promise<string>{
    const rank=priority==='visible'?0:1;
    const cached=this.images.get(frame);
    if(cached!==undefined){this.images.delete(frame);this.images.set(frame,cached);return Promise.resolve(cached);}
    const existing=this.pending.get(frame);
    if(existing){existing.wanted.push({needed:wanted,rank});return existing.promise;}
    let resolve!:(image:string)=>void,reject!:(error:unknown)=>void;
    const promise=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});
    const entry={promise,wanted:[{needed:wanted,rank}]},generation=this.generation;
    this.pending.set(frame,entry);
    this.queue.push({wanted:()=>generation===this.generation&&entry.wanted.some(request=>request.needed()),priority:()=>entry.wanted.some(request=>request.rank===0&&request.needed())?0:1,run:()=>{
      if(generation!==this.generation||!entry.wanted.some(request=>request.needed())){
        if(this.pending.get(frame)===entry)this.pending.delete(frame);
        reject(Error('Thumbnail no longer needed'));return;
      }
      this.active++;
      void Promise.resolve().then(()=>this.load(frame,this.targets.filter(n=>Math.floor(n/240)===Math.floor(frame/240)))).then(image=>{
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
    }});
    this.pump();return promise;
  }
  clear(){this.generation++;this.images.clear();this.bytes=0;this.pending.clear();this.pump();}
  private pump(){
    if(this.active<this.parallel){
      for(let i=this.queue.length-1;i>=0;i--){
        if(!this.queue[i].wanted())this.queue.splice(i,1)[0].run();
      }
    }
    while(this.active<this.parallel&&this.queue.length){
      // Visible cards can promote an already queued ranking request without decoding it twice.
      const visible=this.queue.findIndex(task=>task.priority()===0);
      this.queue.splice(visible<0?0:visible,1)[0].run();
    }
  }
}

const caches=new WeakMap<Backend,{video?:string;sizes:Map<number|string,GuiThumbnailCache>}>();
export function clearGuiThumbnails(backend:Backend){caches.get(backend)?.sizes.forEach(cache=>cache.clear());caches.delete(backend);}
export function guiThumbnails(backend:Backend,videoKey:string|undefined,total:number):GuiThumbnailCache{
  const video=JSON.stringify([videoKey,total]),existing=caches.get(backend);
  if(existing?.video!==undefined&&existing.video!==video)clearGuiThumbnails(backend);
  const cache=previewFrames(backend,128);caches.get(backend)!.video=video;return cache;
}
const screens=new WeakMap<GuiThumbnailCache,Map<number,WorldCoverage>>();
/** The open-screen mask unveil used for a preview of `cache` (unveiledPreviews), for scoring movement outside the GUI. */
export function previewScreen(cache:GuiThumbnailCache,frame:number):WorldCoverage|undefined{return screens.get(cache)?.get(frame);}
/** The backend's preview widths: JPEG, decoded at that width (never wider than the video). */
export const PREVIEW_TIERS=[128,512,1024,2048] as const;
/** The smallest preview width covering `px` device pixels. */
export function previewTier(px:number):number{return PREVIEW_TIERS.find(t=>px<=t)??(Number.isFinite(px)?2048:128);}
const CARD_MIN=640,CARD_GAP=12; // MiscToolsTab.css .misc-gui-aim-gallery: repeat(auto-fit,minmax(640px,1fr)), gap 12px
/** The preview width for an aim-gallery card, from the gallery's CSS width and the display's pixel ratio. */
export function cardPreviewWidth(galleryCss:number,dpr:number):number{
  const columns=Math.max(1,Math.floor((galleryCss+CARD_GAP)/(CARD_MIN+CARD_GAP)));
  const card=galleryCss>0?(galleryCss-CARD_GAP*(columns-1))/columns:CARD_MIN;
  return previewTier(card*(dpr>0?dpr:1));
}
let galleryWidth=previewTier(CARD_MIN*(typeof window!=='undefined'?window.devicePixelRatio||1:1));
/** One width for the gallery's cards, their ranking, warm-up and prefetch, so all of them use the same pictures. */
export const galleryPreviewWidth=()=>galleryWidth;
export function setGalleryPreviewWidth(px:number){galleryWidth=previewTier(px);}
/** The gallery previews with Auto unveil applied (lib/comparisonPost.ts unveilPreview), one cache per veil setting and width. */
export function unveiledPreviews(backend:Backend,veil:VeilOptions,width=galleryPreviewWidth()):GuiThumbnailCache{
  const raw=previewFrames(backend,width),owner=caches.get(backend)!,key=`unveil|${previewTier(width)}|${veil.minShare}|${veil.margin}|${veil.slack}`;
  const found=owner.sizes.get(key);if(found)return found;
  const native=backgroundBackend(backend);
  const found_screens=new Map<number,WorldCoverage>();
  const keep=(frame:number,screen:WorldCoverage|undefined)=>{
    found_screens.delete(frame);
    if(screen)found_screens.set(frame,screen);
    if(found_screens.size>256)found_screens.delete(found_screens.keys().next().value!);
  };
  const cache=new GuiThumbnailCache(async frame=>unveilPreview({url:await raw.get(frame),veil,mask:native.guiMaskFrame?()=>native.guiMaskFrame!(frame):undefined,onScreen:screen=>keep(frame,screen)}),256);
  screens.set(cache,found_screens);
  owner.sizes.set(key,cache);return cache;
}
/** Shared display previews; never used as matching, mask, difference or export evidence. */
export function previewFrames(backend:Backend,width=512):GuiThumbnailCache{
  width=previewTier(width);
  let owner=caches.get(backend);if(!owner){owner={sizes:new Map()};caches.set(backend,owner);}
  const found=owner.sizes.get(width);if(found)return found;
  const native=backgroundBackend(backend);
  const cache=new GuiThumbnailCache(async (frame,targets)=>{
    if(native.previewThumbnail){
      const bytes=await native.previewThumbnail(frame,width,targets);
      return blobDataUrl(new Blob([bytes],{type:'image/jpeg'}),'Could not read thumbnail');
    }
    const image=await loadFrameImage(await backend.frame(frame));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.max(1,Math.round(width*image.naturalHeight/image.naturalWidth));
    const context=canvas.getContext('2d');if(!context)throw Error('Thumbnail unavailable');
    context.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.55);
  });
  owner.sizes.set(width,cache);return cache;
}
