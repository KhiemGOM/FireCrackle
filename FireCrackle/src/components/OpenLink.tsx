import { useEffect, useRef, useState } from "react";
import type { Backend, LinkStatus, ToolProgress } from "../lib/api";
import { messageOf } from "../hooks/useWorkspace";
import "./OpenLink.css";

export function ToolSetupNotice({backend}:{backend:Backend}) {
  const [status,setStatus]=useState<ToolProgress|null>(null);
  useEffect(()=>{let live=true;const poll=async()=>{try{const next=await backend.toolStatus?.();if(live)setStatus(next??null);}catch{/* A failed setup is reported by the operation that requested it. */}};void poll();const timer=setInterval(()=>void poll(),500);return()=>{live=false;clearInterval(timer);};},[backend]);
  if(!status)return null;
  return <div className="banner tool-download" role="status">Downloading {status.name} for first use · {(status.downloaded/1048576).toFixed(1)} MB{status.total?` / ${(status.total/1048576).toFixed(1)} MB`:""}<progress aria-label="Tool download progress" max={status.total??1} value={status.total?status.downloaded:undefined}/></div>;
}

export function OpenLink({backend,initialUrl="",onOpen,onClose}:{backend:Backend;initialUrl?:string;onOpen:(path:string)=>Promise<void>;onClose:()=>void}) {
  const [url,setUrl]=useState(initialUrl);
  const [status,setStatus]=useState<LinkStatus|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [pending,setPending]=useState(false);
  const opened=useRef<number|null>(null);
  const active=useRef<number|null>(null);
  const onOpenRef=useRef(onOpen);onOpenRef.current=onOpen;
  useEffect(()=>{
    let live=true;let polling=false;
    const refresh=async()=>{if(polling)return;polling=true;try{const next=await backend.linkStatus?.();if(!live)return;setStatus(next??null);
      if(next?.state==="running")active.current=next.id;
      if(next?.state==="done"&&next.path&&active.current===next.id&&opened.current!==next.id){opened.current=next.id;await onOpenRef.current(next.path);}
    }catch(e){if(live)setError(messageOf(e));}finally{polling=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),700);return()=>{live=false;clearInterval(timer);};
  },[backend]);
  const running=status?.state==="running";
  async function start(){setError(null);setPending(true);try{
    const parsed=new URL(url.trim());if(!["https:","http:"].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error("Paste an http:// or https:// video link without login details.");
    const folder=await backend.pickDownloadFolder?.();if(!folder)return;
    const next=await backend.linkStart!(url.trim(),folder);active.current=next.id;setStatus(next);
  }catch(e){setError(messageOf(e));}finally{setPending(false);}}
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal open-link" role="dialog" aria-modal="true" aria-label="Open video link" onMouseDown={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.key==="Escape")onClose();if(e.key==="Enter"&&!running&&!pending){e.preventDefault();void start();}}}>
      <div className="modal-head"><h2>Open video link</h2><button onClick={onClose}>Close</button></div>
      <div className="modal-body">
        <p>Paste a YouTube link or another video site supported by yt-dlp. Choose where to save the video; it opens here when the download finishes.</p>
        <label className="link-field">Video link<input autoFocus type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" disabled={running||pending}/></label>
        <p className="dim">One video per link. Downloads the best available quality. yt-dlp and Deno are downloaded on first use and cached separately from FireCrackle. FFmpeg is also downloaded if needed on Windows; Linux uses system FFmpeg.</p>
        {backend.mock&&<p>Link downloads are available in the desktop app.</p>}
        {status&&<p role="status" className="link-status">{status.message}{running&&<><br/><small>You can close this panel while the download continues; reopen it to open the finished video.</small></>}</p>}
        {(error||status?.error)&&<p role="alert">{error??status?.error}</p>}
        <div className="link-actions"><button className="on" disabled={!backend.linkStart||!url.trim()||running||pending} onClick={()=>void start()}>{pending?"Preparing…":"Download and open"}</button>
        {running&&<button onClick={()=>void backend.linkCancel?.(status.id).catch(e=>setError(messageOf(e)))}>Cancel download</button>}
        {status?.state==="done"&&status.path&&<button onClick={()=>void onOpen(status.path!)}>Open downloaded video</button>}</div>
        <p className="dim">Powered by yt-dlp, Deno and FFmpeg. Credits and license details are in Credits and THIRD_PARTY_NOTICES.txt.</p>
      </div>
    </div>
  </div>;
}
