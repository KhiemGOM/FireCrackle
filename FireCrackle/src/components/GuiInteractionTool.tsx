import {useEffect,useRef,useState} from 'react';
import type {Backend} from '../lib/api';
import type {GuiRange,GuiScanStatus} from '../lib/guiScan';
import {guiScanProgress} from '../lib/scanSpeed';
import {scanStateLabel} from '../lib/scanState';
import {ScanProgressStats} from './ScanProgressStats';
import {formatTimecode} from '../lib/timecode';
import {readPreferences,writePreferences} from '../lib/preferences';
import {FRAME_BLINK_MS} from '../lib/frameComparison';
import {guiThumbnails,previewFrames} from '../lib/guiThumbnailCache';
import {guiMotionScores,guiRangeKey,guiReviewFrames,previewPixelChange,rankGuiRanges,scorableRanges} from '../lib/guiAimReview';
import { failureMessage } from '../lib/appErrors';

function GuiBlinkThumbnail({backend,videoKey,first,last,total,large=false,display='blink'}:{backend:Backend;videoKey?:string;first:number;last:number;total:number;large?:boolean;display?:'blink'|'before'|'after'}) {
  guiThumbnails(backend,videoKey,total);
  const cache=previewFrames(backend,512);
  const container=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false);
  const [pictures,setPictures]=useState<{before:string;after?:string}|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const element=container.current;if(!element)return;
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{root:element.closest('.misc-gui-ranges'),rootMargin:'80px'});
    observer.observe(element);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    let cancelled=false;
    setPictures(null);setFailed(false);
    if(!visible)return;
    const wanted=()=>!cancelled;
    const frames=guiReviewFrames({first,last,menu:false},total);
    const before=cache.get(frames.before,wanted).then(image=>{if(!cancelled)setPictures({before:image});return image;});
    void Promise.all([before,cache.get(frames.after,wanted)])
      .then(([before,after])=>{if(!cancelled)setPictures({before,after});})
      .catch(()=>{if(!cancelled)setFailed(true);});
    return()=>{cancelled=true;};
  },[cache,first,last,total,visible]);
  return <span ref={container} className={`misc-gui-thumbnail${large?' misc-gui-aim-picture':''}`} data-display={display} style={{animationDuration:`${FRAME_BLINK_MS*2}ms`}}>
    {pictures?<><img src={pictures.before} alt="Before GUI" draggable={false}/>{pictures.after&&<img className="misc-gui-thumbnail-after" src={pictures.after} alt="After GUI" draggable={false}/>}</>:<span className="dim" role={failed?'alert':undefined} aria-label={failed?'Preview unavailable':'Loading preview'}>{failed?'!':''}</span>}
  </span>;
}

export function GuiInteractionTool({backend,videoKey,fps,onCompare}:{backend:Backend;videoKey?:string;fps:number;onCompare:(range:GuiRange)=>void}) {
  const [status,setStatus]=useState<GuiScanStatus|null>(null),[error,setError]=useState(''),[menus,setMenus]=useState(()=>readPreferences().miscGuiMenus),[busy,setBusy]=useState(false);
  const [mode,setMode]=useState(()=>readPreferences().miscGuiMode),[display,setDisplay]=useState(()=>readPreferences().miscGuiDisplay);
  const [order,setOrder]=useState(()=>readPreferences().miscGuiOrder);
  const [ranking,setRanking]=useState<{video:string|undefined;key:string;scores:Map<string,number|null>;processed:number;done:boolean}>({video:undefined,key:'',scores:new Map(),processed:0,done:false});
  useEffect(()=>writePreferences({miscGuiMenus:menus,miscGuiMode:mode,miscGuiDisplay:display,miscGuiOrder:order}),[menus,mode,display,order]);
  useEffect(()=>{
    if(!backend.guiScanStatus)return;
    let stopped=false, timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {const value=await backend.guiScanStatus!();if(!stopped){setStatus(value);setError('');}}
      catch(e){if(!stopped)setError(failureMessage(e));}
      if(!stopped)timer=setTimeout(()=>void poll(),1000);
    };
    setStatus(null);void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[backend,videoKey]);
  async function action(start:boolean){
    setBusy(true);setError('');
    try {if(start)setStatus(await backend.guiScanStart!());else await backend.guiScanCancel!();}
    catch(e){setError(failureMessage(e));}finally{setBusy(false);}
  }
  const ranges=status?.ranges.filter(range=>menus||!range.menu)??[],running=status?.state==='running';
  const scorable=scorableRanges(ranges),scoreKey=JSON.stringify([videoKey,status?.total,scorable.map(guiRangeKey)]);
  if(status?.total){
    guiThumbnails(backend,videoKey,status.total);
    previewFrames(backend,512).setTargets(ranges.flatMap(range=>{const frames=guiReviewFrames(range,status.total);return [frames.before,frames.after];}));
  }
  useEffect(()=>{
    if(mode!=='aim'||order!=='motion'||!status?.total)return;
    guiThumbnails(backend,videoKey,status.total);
    const cache=previewFrames(backend,512);
    const scores=guiMotionScores(cache),total=status.total;
    let cancelled=false,next=0,processed=0;
    const publish=(done=false)=>{if(!cancelled)setRanking({video:videoKey,key:scoreKey,scores:new Map(scores),processed,done});};
    publish();
    const worker=async()=>{
      while(!cancelled&&next<scorable.length){
        const range=scorable[next++],key=guiRangeKey(range);
        if(scores.get(key)==null){
          try{
            const frames=guiReviewFrames(range,total),wanted=()=>!cancelled;
            const [before,after]=await Promise.all([cache.get(frames.before,wanted,'background'),cache.get(frames.after,wanted,'background')]);
            if(cancelled)return;
            const score=await previewPixelChange(before,after);if(cancelled)return;scores.set(key,score);
          }catch{if(cancelled)return;scores.set(key,null);}
        }
        processed++;publish();
      }
    };
    void Promise.all([worker(),worker()]).then(()=>publish(true));
    return()=>{cancelled=true;};
  },[backend,videoKey,mode,order,scoreKey]);
  // Order from every score known so far; unscored (new or growing) ranges wait at the end in video order.
  const sorted=mode==='aim'&&order==='motion'&&ranking.video===videoKey?rankGuiRanges(ranges,ranking.scores):ranges;
  return <section className="misc-gui-tool" aria-label="GUI interactions">
    <div className="misc-panel misc-gui-controls">
    <div className="misc-compare-toolbar">
      <strong>GUI interactions</strong>
      <div className="misc-view-modes" role="group" aria-label="GUI review mode">
        <button aria-pressed={mode==='intervals'} onClick={()=>setMode('intervals')}>Intervals</button>
        <button aria-pressed={mode==='aim'} onClick={()=>setMode('aim')}>Aim jumps</button>
      </div>
      <button disabled={busy||!backend.guiScanStart||status?.state==='done'} onClick={()=>void action(!running)}>
        {running?'Pause scan':status?.processed?'Resume scan':'Scan video'}
      </button>
      <label><input type="checkbox" checked={menus} onChange={e=>setMenus(e.target.checked)}/> Include menus</label>
    </div>
    {mode==='intervals'&&<p className="dim">Scan once, then inspect before and after each detected GUI interval. Results are saved with this video.</p>}
    {status&&(mode==='intervals'||running)&&<><progress value={status.processed} max={status.total||1}/><span className="dim"> {status.processed.toLocaleString()} / {status.total.toLocaleString()} frames · {scanStateLabel(status.state,status.processed)} · {ranges.length} intervals</span>{running&&<> · <ScanProgressStats key={status.video_path} progress={guiScanProgress(status)}/></>}</>}
    {mode==='aim'&&<div className="misc-aim-controls">
      <div className="misc-view-modes" role="group" aria-label="Gallery image view">
        {(['blink','before','after'] as const).map(value=><button key={value} aria-pressed={display===value} onClick={()=>setDisplay(value)}>{value==='blink'?'Blink':value==='before'?'Before':'After'}</button>)}
      </div>
      <label>Order <select value={order} onChange={e=>setOrder(e.target.value as typeof order)} title="Average RGB change in small before/after previews. Lighting and animation also contribute; this is not an aim detector."><option value="motion">Most movement first</option><option value="time">Video order</option></select></label>
      <span className="dim">Click an image to inspect{order==='motion'&&ranking.key===scoreKey&&!ranking.done?` · Ranking ${ranking.processed}/${scorable.length}`:''}</span>
    </div>}
    {(error||status?.error)&&<p role="alert">{error||status?.error}</p>}
    {!backend.guiScanStart&&<p className="dim">Video scanning is available in the desktop app.</p>}
    </div>
    <div className={`misc-gui-ranges${mode==='aim'?' misc-gui-aim-gallery':''}`} aria-label={mode==='aim'?'Aim jump images':'GUI intervals'}>
      {sorted.map(range=><button key={guiRangeKey(range)} aria-label={`Compare frames ${Math.max(0,range.first-1)} and ${Math.min(status!.total-1,range.last+1)}`} title={`${formatTimecode(range.first/fps,fps)} – ${formatTimecode(range.last/fps,fps)} · Click to inspect`} onClick={()=>onCompare(range)}>
        <GuiBlinkThumbnail backend={backend} videoKey={videoKey} first={range.first} last={range.last} total={status!.total} large={mode==='aim'} display={mode==='aim'?display:'blink'}/>
        {mode==='intervals'&&<>
        <span>{formatTimecode(range.first/fps,fps)} – {formatTimecode(range.last/fps,fps)}</span>
        <span className="dim">{range.menu?'Menu':'GUI'} · {range.last-range.first+1} frames</span>
        <span>Inspect</span>
        </>}
      </button>)}
    </div>
    {status?.state==='done'&&!ranges.length&&<p>No supported GUI intervals detected.</p>}
  </section>;
}
