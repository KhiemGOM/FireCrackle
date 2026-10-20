import {useEffect,useRef,useState} from 'react';
import type {Backend} from '../lib/api';
import type {GuiRange,GuiScanStatus} from '../lib/guiScan';
import {formatTimecode} from '../lib/timecode';
import {FRAME_BLINK_MS,loadFrameImage} from '../lib/frameComparison';

// Keep thumbnail seeks serial, so scrolling never floods the video decoder.
let thumbnailQueue:Promise<void>=Promise.resolve();
function GuiBlinkThumbnail({backend,videoKey,first,last,total}:{backend:Backend;videoKey?:string;first:number;last:number;total:number}) {
  const container=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false);
  const [pictures,setPictures]=useState<{before:string;after:string}|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const element=container.current;if(!element)return;
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{root:element.closest('.misc-gui-ranges'),rootMargin:'80px'});
    observer.observe(element);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    let cancelled=false;setPictures(null);setFailed(false);
    if(!visible)return;
    const thumbnail=async(frame:number)=>{
      const bytes=await backend.frame(frame);if(cancelled)return '';
      const image=await loadFrameImage(bytes);if(cancelled)return '';
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=Math.max(1,Math.round(160*image.naturalHeight/image.naturalWidth));
      const context=canvas.getContext('2d');if(!context)throw Error('Thumbnail unavailable');
      context.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.8);
    };
    thumbnailQueue=thumbnailQueue.catch(()=>{}).then(async()=>{
      if(cancelled)return;
      try {
        const before=await thumbnail(Math.max(0,first-1));if(cancelled)return;
        const after=await thumbnail(Math.min(total-1,last+1));
        if(!cancelled)setPictures({before,after});
      }catch{if(!cancelled)setFailed(true);}
    });
    return()=>{cancelled=true;};
  },[backend,videoKey,first,last,total,visible]);
  return <span ref={container} className="misc-gui-thumbnail" title="Before / after GUI · blinking preview" style={{animationDuration:`${FRAME_BLINK_MS*2}ms`}}>
    {pictures?<><img src={pictures.before} alt="Before GUI"/><img className="misc-gui-thumbnail-after" src={pictures.after} alt="After GUI"/></>:<span className="dim">{failed?'No preview':'…'}</span>}
  </span>;
}

export function GuiInteractionTool({backend,videoKey,fps,onCompare}:{backend:Backend;videoKey?:string;fps:number;onCompare:(range:GuiRange)=>void}) {
  const [status,setStatus]=useState<GuiScanStatus|null>(null),[error,setError]=useState(''),[menus,setMenus]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!backend.guiScanStatus)return;
    let stopped=false, timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {const value=await backend.guiScanStatus!();if(!stopped){setStatus(value);setError('');}}
      catch(e){if(!stopped)setError(String(e));}
      if(!stopped)timer=setTimeout(()=>void poll(),1000);
    };
    setStatus(null);void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[backend,videoKey]);
  async function action(start:boolean){
    setBusy(true);setError('');
    try {if(start)setStatus(await backend.guiScanStart!());else await backend.guiScanCancel!();}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  const ranges=status?.ranges.filter(range=>menus||!range.menu)??[],running=status?.state==='running';
  return <section className="misc-panel" aria-label="GUI interactions">
    <div className="misc-compare-toolbar">
      <strong>GUI interactions</strong>
      <button disabled={busy||!backend.guiScanStart||status?.state==='done'} onClick={()=>void action(!running)}>
        {running?'Pause scan':status?.processed?'Resume scan':'Scan video'}
      </button>
      <label><input type="checkbox" checked={menus} onChange={e=>setMenus(e.target.checked)}/> Include menus</label>
    </div>
    <p className="dim">Scan once, then inspect before and after each detected GUI interval. Results are saved with this video.</p>
    {status&&<><progress value={status.processed} max={status.total||1}/><span className="dim"> {status.processed.toLocaleString()} / {status.total.toLocaleString()} frames · {status.state==='done'?'Complete':running?'Scanning':status.state==='paused'?'Paused':'Ready'} · {ranges.length} intervals</span></>}
    {(error||status?.error)&&<p role="alert">{error||status?.error}</p>}
    {!backend.guiScanStart&&<p className="dim">Video scanning is available in the desktop app.</p>}
    <div className="misc-gui-ranges">
      {ranges.map(range=><button key={`${range.first}-${range.last}`} onClick={()=>onCompare(range)}>
        <GuiBlinkThumbnail backend={backend} videoKey={videoKey} first={range.first} last={range.last} total={status!.total}/>
        <span>{formatTimecode(range.first/fps,fps)} – {formatTimecode(range.last/fps,fps)}</span>
        <span className="dim">{range.menu?'Menu':'GUI'} · {range.last-range.first+1} frames</span>
        <span>Inspect</span>
      </button>)}
    </div>
    {status?.state==='done'&&!ranges.length&&<p>No supported GUI intervals detected.</p>}
  </section>;
}
