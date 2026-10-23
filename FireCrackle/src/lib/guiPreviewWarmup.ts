import type {Backend} from './api';
import {galleryPreviewWidth,guiThumbnails,previewFrames} from './guiThumbnailCache';
import {guiMotionScores,guiRangeKey,guiReviewFrames,previewPixelChange} from './guiAimReview';
import type {GuiScanStatus} from './guiScan';
import {backgroundBackend} from './appErrors';

type Watcher={key:string;users:number;stop:()=>void};
const watchers=new WeakMap<Backend,Watcher>();
const pathKey=(path:string)=>path.replace(/\\/g,'/');

/** Display-only work: never scans, edits labels, or fetches full-resolution frames. */
export function watchGuiPreviewWarmup(backend:Backend,video:string,total:number):()=>void{
  if(!backend.guiScanStatus||!backend.previewThumbnail||!total)return()=>{};
  const statusBackend=backgroundBackend(backend);
  const key=JSON.stringify([pathKey(video),total]);
  let watcher=watchers.get(backend);
  if(watcher?.key!==key){
    watcher?.stop();
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
    watcher={key,users:0,stop:()=>{stopped=true;clearTimeout(timer);}};
    watchers.set(backend,watcher);
    const warm=async(status:GuiScanStatus)=>{
      guiThumbnails(backend,video,total);
      const cache=previewFrames(backend,galleryPreviewWidth()),scores=guiMotionScores(cache);
      const current=()=>!stopped&&previewFrames(backend,galleryPreviewWidth())===cache;
      cache.setTargets(status.ranges.flatMap(range=>Object.values(guiReviewFrames(range,total))));
      // Only one background pair is queued at a time. Visible requests promote shared work.
      for(const range of status.ranges){
        if(!current())return;
        const rangeKey=guiRangeKey(range);
        if(scores.get(rangeKey)!=null)continue;
        const frames=guiReviewFrames(range,total);
        try{
          const scans=await Promise.all([statusBackend.povStatus?.(),statusBackend.noFireStatus?.()]);
          if(!current())return;
          if(scans.some(scan=>scan?.state==='running')){
            timer=setTimeout(()=>void poll(),1000);return;
          }
          const [before,after]=await Promise.all([
            cache.get(frames.before,current,'background'),cache.get(frames.after,current,'background'),
          ]);
          if(!current())return;
          const score=await previewPixelChange(before,after);
          if(current())scores.set(rangeKey,score);
        }catch{
          // A failed speculative preview can be retried when explicitly opened.
        }
      }
    };
    const poll=async()=>{
      let delay=5000;
      try{
        const status=await statusBackend.guiScanStatus!();
        if(stopped)return;
        if(pathKey(status.video_path)===pathKey(video)&&status.total===total){
          if(status.state==='done'&&status.processed===total){await warm(status);return;}
          if(status.state==='running')delay=1000;
        }
      }catch{
        // Optional preparation must not prevent normal video use.
      }
      if(!stopped)timer=setTimeout(()=>void poll(),delay);
    };
    void poll();
  }
  const owned=watcher;
  owned.users++;
  let released=false;
  return()=>{
    if(released)return;
    released=true;
    if(--owned.users===0){owned.stop();if(watchers.get(backend)===owned)watchers.delete(backend);}
  };
}
