import {useEffect,useRef,useState} from 'react';
import type {Backend} from '../lib/api';
import type {GuiRange,GuiScanStatus} from '../lib/guiScan';
import {guiScanProgress} from '../lib/scanSpeed';
import {scanStateLabel} from '../lib/scanState';
import {ScanProgressStats} from './ScanProgressStats';
import {formatTimecode} from '../lib/timecode';
import {readPreferences,writePreferences} from '../lib/preferences';
import {FRAME_BLINK_MS} from '../lib/frameComparison';
import {guiThumbnails,previewFrames,previewScreen,unveiledPreviews} from '../lib/guiThumbnailCache';
import {DEFAULT_VEIL_OPTIONS,type VeilOptions} from '../lib/veil';
import {guiMotionScores,guiPairFrames,guiRangeKey,guiScoreKey,previewPixelChange,rankGuiRanges,scorableRanges,type GuiPair} from '../lib/guiAimReview';
import { failureMessage } from '../lib/appErrors';
import {startPolling} from '../lib/poll';
import {DesktopOnly} from './DesktopOnly';
import {ViewButton,type ViewerImage} from './ImageViewer';
import {boundaryPicture} from '../lib/comparisonPost';

/** A gallery frame at full size, unveiled like its card. */
const fullFrame=(backend:Backend,veil:VeilOptions,frame:number,title:string,fps:number):ViewerImage=>({title,detail:`Frame ${frame} · ${formatTimecode(frame/fps,fps)} · auto unveil`,
  src:()=>boundaryPicture({backend,frame,veilOptions:veil}).then(blob=>URL.createObjectURL(blob))});

/** The two pictures of a card, shown as they are and then replaced by their Auto-unveiled versions (open GUI kept, HUD unveiled). */
function GuiBlinkThumbnail({backend,videoKey,first,last,total,large=false,display='blink',pair='around',veil}:{backend:Backend;videoKey?:string;first:number;last:number;total:number;large?:boolean;display?:'blink'|'before'|'after';pair?:GuiPair;veil:VeilOptions}) {
  guiThumbnails(backend,videoKey,total);
  const cache=previewFrames(backend,512),unveiled=unveiledPreviews(backend,veil);
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
    const frames=guiPairFrames({first,last,menu:false},total,pair);
    const before=cache.get(frames.before,wanted).then(image=>{if(!cancelled)setPictures({before:image});return image;});
    void Promise.all([before,cache.get(frames.after,wanted)])
      .then(([before,after])=>{
        if(cancelled)return;
        setPictures({before,after});
        // a failed unveil keeps the plain pictures
        void Promise.all([unveiled.get(frames.before,wanted),unveiled.get(frames.after,wanted)]).then(([before,after])=>{if(!cancelled)setPictures({before,after});}).catch(()=>{});
      })
      .catch(()=>{if(!cancelled)setFailed(true);});
    return()=>{cancelled=true;};
  },[cache,unveiled,first,last,total,visible,pair]);
  return <span ref={container} className={`misc-gui-thumbnail${large?' misc-gui-aim-picture':''}`} data-display={display} style={{animationDuration:`${FRAME_BLINK_MS*2}ms`}}>
    {pictures?<><img src={pictures.before} alt="Before GUI" draggable={false}/>{pictures.after&&<img className="misc-gui-thumbnail-after" src={pictures.after} alt="After GUI" draggable={false}/>}</>:<span className="dim" role={failed?'alert':undefined} aria-label={failed?'Preview unavailable':'Loading preview'}>{failed?'!':''}</span>}
  </span>;
}

/** `onCompare` opens a card's two frames in the frame comparison: around the GUI, or across its opening or closing cut. */
export function GuiInteractionTool({backend,videoKey,fps,onCompare,veil=DEFAULT_VEIL_OPTIONS}:{backend:Backend;videoKey?:string;fps:number;onCompare:(range:GuiRange,pair:GuiPair)=>void;veil?:VeilOptions}) {
  const [status,setStatus]=useState<GuiScanStatus|null>(null),[error,setError]=useState(''),[menus,setMenus]=useState(()=>readPreferences().miscGuiMenus),[busy,setBusy]=useState(false);
  const [mode,setMode]=useState(()=>readPreferences().miscGuiMode),[display,setDisplay]=useState(()=>readPreferences().miscGuiDisplay);
  const [order,setOrder]=useState(()=>readPreferences().miscGuiOrder);
  const [ranking,setRanking]=useState<{video:string|undefined;key:string;scores:Map<string,number|null>;processed:number;done:boolean}>({video:undefined,key:'',scores:new Map(),processed:0,done:false});
  const [savedPair,setPair]=useState(()=>readPreferences().miscGuiPair);
  useEffect(()=>writePreferences({miscGuiMenus:menus,miscGuiMode:mode,miscGuiDisplay:display,miscGuiOrder:order,miscGuiPair:savedPair}),[menus,mode,display,order,savedPair]);
  // the opening and closing cuts are an aim-gallery view; the interval list always compares around the GUI
  const pair:GuiPair=mode==='aim'?savedPair:'around';
  useEffect(()=>{
    if(!backend.guiScanStatus)return;
    setStatus(null);
    return startPolling(()=>backend.guiScanStatus!(),{intervalMs:1000,onValue:value=>{setStatus(value);setError('');},onError:e=>setError(failureMessage(e))});
  },[backend,videoKey]);
  async function action(start:boolean){
    setBusy(true);setError('');
    try {if(start)setStatus(await backend.guiScanStart!());else await backend.guiScanCancel!();}
    catch(e){setError(failureMessage(e));}finally{setBusy(false);}
  }
  const ranges=status?.ranges.filter(range=>menus||!range.menu)??[],running=status?.state==='running';
  const scorable=scorableRanges(ranges),scoreKey=JSON.stringify([videoKey,status?.total,pair,veil,scorable.map(guiRangeKey)]);
  if(status?.total){
    guiThumbnails(backend,videoKey,status.total);
    previewFrames(backend,512).setTargets(ranges.flatMap(range=>{const frames=guiPairFrames(range,status.total,pair);return [frames.before,frames.after];}));
  }
  useEffect(()=>{
    if(mode!=='aim'||order!=='motion'||!status?.total)return;
    guiThumbnails(backend,videoKey,status.total);
    // ranked on the pictures the cards show: the chosen pair, auto-unveiled, movement outside the open GUI only
    const cache=unveiledPreviews(backend,veil);
    const scores=guiMotionScores(cache),total=status.total;
    let cancelled=false,next=0,processed=0;
    const publish=(done=false)=>{if(!cancelled)setRanking({video:videoKey,key:scoreKey,scores:new Map(scorable.map(range=>[guiRangeKey(range),scores.get(guiScoreKey(range,pair))??null])),processed,done});};
    publish();
    const worker=async()=>{
      while(!cancelled&&next<scorable.length){
        const range=scorable[next++],key=guiScoreKey(range,pair);
        if(scores.get(key)==null){
          try{
            const frames=guiPairFrames(range,total,pair),wanted=()=>!cancelled;
            const [before,after]=await Promise.all([cache.get(frames.before,wanted,'background'),cache.get(frames.after,wanted,'background')]);
            if(cancelled)return;
            const score=await previewPixelChange(before,after,[previewScreen(cache,frames.before),previewScreen(cache,frames.after)]);if(cancelled)return;scores.set(key,score);
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
        <button aria-pressed={mode==='aim'} onClick={()=>setMode('aim')}>Aim jumps</button>
        <button aria-pressed={mode==='intervals'} onClick={()=>setMode('intervals')}>Intervals</button>
      </div>
      <button disabled={busy||!backend.guiScanStart||status?.state==='done'} onClick={()=>void action(!running)}>
        {running?'Pause scan':status?.processed?'Resume scan':'Scan video'}
      </button>
      <label><input type="checkbox" checked={menus} onChange={e=>setMenus(e.target.checked)}/> Include menus</label>
    </div>
    {mode==='intervals'&&<p className="dim">Scan once, then inspect before and after each detected GUI interval. Results are saved with this video.</p>}
    {status&&(mode==='intervals'||running||status.state==='error'||status.state==='paused')&&<><progress value={status.processed} max={status.total||1}/><span className="dim"> {status.processed.toLocaleString()} / {status.total.toLocaleString()} frames · {scanStateLabel(status.state,status.processed)} · {ranges.length} intervals</span>{running&&<> · <ScanProgressStats key={status.video_path} progress={guiScanProgress(status)}/></>}</>}
    {mode==='aim'&&<div className="misc-aim-controls">
      <div className="misc-view-modes" role="group" aria-label="Gallery image view">
        {(['blink','before','after'] as const).map(value=><button key={value} aria-pressed={display===value} onClick={()=>setDisplay(value)}>{value==='blink'?'Blink':value==='before'?'Before':'After'}</button>)}
      </div>
      <div className="misc-view-modes" role="group" aria-label="Gallery frame pair" title="Around GUI: the frames just outside the whole interaction. GUI opens / closes: the two frames across that cut, to see whether the view jumped there.">
        {([['around','Around GUI'],['open','GUI opens'],['close','GUI closes']] as const).map(([value,text])=><button key={value} aria-pressed={savedPair===value} onClick={()=>setPair(value)}>{text}</button>)}
      </div>
      <label>Order <select value={order} onChange={e=>setOrder(e.target.value as typeof order)} title="Average RGB change in small before/after previews. Lighting and animation also contribute; this is not an aim detector."><option value="motion">Most movement first</option><option value="time">Video order</option></select></label>
      <span className="dim">Click an image to inspect{order==='motion'&&ranking.key===scoreKey&&!ranking.done?` · Ranking ${ranking.processed}/${scorable.length}`:''}</span>
    </div>}
    {(error||status?.error)&&<p role="alert">{error||status?.error}</p>}
    <DesktopOnly what="Video scanning" available={!!backend.guiScanStart}/>
    </div>
    <div className={`misc-gui-ranges${mode==='aim'?' misc-gui-aim-gallery':''}`} aria-label={mode==='aim'?'Aim jump images':'GUI intervals'}>
      {sorted.map(range=>{const frames=guiPairFrames(range,status!.total,pair);return <div key={guiRangeKey(range)} className="misc-gui-card"><button aria-label={`Compare frames ${frames.before} and ${frames.after}`} title={`${formatTimecode(range.first/fps,fps)} – ${formatTimecode(range.last/fps,fps)} · Click to inspect`} onClick={()=>onCompare(range,pair)}>
        <GuiBlinkThumbnail backend={backend} videoKey={videoKey} first={range.first} last={range.last} total={status!.total} large={mode==='aim'} display={mode==='aim'?display:'blink'} pair={pair} veil={veil}/>
        {mode==='intervals'&&<>
        <span>{formatTimecode(range.first/fps,fps)} – {formatTimecode(range.last/fps,fps)}</span>
        <span className="dim">{range.menu?'Menu':'GUI'} · {range.last-range.first+1} frames</span>
        <span>Inspect</span>
        </>}
      </button><ViewButton label={`Enlarge frames ${frames.before} and ${frames.after}`} images={[fullFrame(backend,veil,frames.before,'Before GUI',fps),fullFrame(backend,veil,frames.after,'After GUI',fps)]}/></div>;})}
    </div>
    {status?.state==='done'&&!ranges.length&&<p>No supported GUI intervals detected.</p>}
  </section>;
}
