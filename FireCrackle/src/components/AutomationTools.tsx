import { useEffect, useState } from "react";
import type { Backend, PovStatus } from "../lib/api";
import { messageOf } from "../hooks/useWorkspace";
import { Icon } from "./Icon";
import "./AutomationTools.css";

export function AutomationTools({backend,videoPath,onApply,onClose,onReview}:{backend:Backend;videoPath?:string;onApply:(id:number)=>Promise<void>;onClose:()=>void;onReview?:(frame:number)=>void}) {
  const [status,setStatus]=useState<PovStatus|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [pending,setPending]=useState(false);
  const [noFire,setNoFire]=useState<PovStatus|null>(null);
  const [noFireError,setNoFireError]=useState<string|null>(null);
  const [noFirePending,setNoFirePending]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [offset,setOffset]=useState(0);
  const [frames,setFrames]=useState<number[]>([]);
  const [selected,setSelected]=useState(0);
  useEffect(()=>{
    let live=true;
    const refresh=async()=>{try{const next=await backend.povStatus?.();if(live)setStatus(next && next.video_path===videoPath?next:null);}catch(e){if(live)setError(messageOf(e));}};
    const refreshNoFire=async()=>{try{const next=await backend.noFireStatus?.();if(live)setNoFire(next && next.video_path===videoPath?next:null);}catch(e){if(live)setNoFireError(messageOf(e));}};
    void refresh();void refreshNoFire();const timer=setInterval(()=>{void refresh();void refreshNoFire();},700);
    return()=>{live=false;clearInterval(timer);};
  },[backend,videoPath]);
  useEffect(()=>{
    let live=true;setFrames([]);setSelected(0);
    if(noFire?.state==="done") void backend.noFireCandidates?.(noFire.id,offset).then(rows=>{if(live)setFrames(rows);}).catch(e=>{if(live)setNoFireError(messageOf(e));});
    return()=>{live=false;};
  },[backend,noFire?.id,noFire?.state,offset]);
  async function scanNoFire() {
    setNoFirePending(true);setNoFireError(null);setOffset(0);setFrames([]);
    try {
      // This explicit checkbox is the per-video vanilla-GUI confirmation.
      if(await backend.guiAnswerGet?.()!=="yes") await backend.guiAnswerSet?.("yes");
      setNoFire(await backend.noFireStart!());
    } catch(e){setNoFireError(messageOf(e));}finally{setNoFirePending(false);}
  }
  async function perform(action:()=>Promise<unknown>) {
    setPending(true);setError(null);
    try{await action();const next=await backend.povStatus?.();setStatus(next && next.video_path===videoPath?next:null);}
    catch(e){setError(messageOf(e));}finally{setPending(false);}
  }
  const running=status?.state==="running";
  const noFireRunning=noFire?.state==="running"||noFire?.state==="saving";
  const supported=!!backend.povStart;
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal automation-tools" role="dialog" aria-modal="true" aria-label="Auto" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><h2><Icon name="robot" /> Auto</h2><button onClick={onClose}>Close</button></div>
      <div className="modal-body">
        <h3>First-person fire labeller</h3>
        <p>Finds first-person fire sprites. Check automatic labels afterward, especially near unusual timing.</p>
        <p className="dim">Best with full, uncropped vanilla Minecraft 1.16.5 footage. Existing labels stay unchanged; uncertain frames are left alone.</p>
        {!supported&&<p>This tool is available in the desktop app.</p>}
        {status&&<div className="automation-progress" role="status">
          <progress aria-label="First-person scan progress" max={Math.max(1,status.total)} value={status.processed}/>
          <span>{status.state==="running"?"Scanning":status.state==="done"?"Scan complete":status.state==="cancelled"?"Cancelled":"Scan failed"} · {status.processed.toLocaleString()} / {status.total.toLocaleString()} frames</span>
          <span>{status.accepted.toLocaleString()} accepted matches{status.applied>0?` · ${status.applied.toLocaleString()} added`:""}</span>
        </div>}
        {(error||status?.error)&&<p role="alert">{error??status?.error}</p>}
        <div className="automation-actions">
          <button disabled={!supported||running||pending} onClick={()=>void perform(async()=>{setStatus(await backend.povStart!());})}>{status?"Scan again":"Scan video"}</button>
          {running&&<button disabled={pending} onClick={()=>void perform(()=>backend.povCancel!(status!.id))}>Cancel scan</button>}
          {status?.state==="done"&&<button disabled={pending||status.accepted===0||status.applied>0} onClick={()=>void perform(()=>onApply(status.id))}>Apply accepted matches</button>}
        </div>
        <p className="dim">Applying fills empty frames only and can be undone in one step. Closing this panel lets the scan continue.</p>
        {status?.applied ? <p>Open the Phase chart to spot unusual timing. If it looks odd near an automatically labelled frame, check that automatic label first. Use the source filter to isolate tool results. Independently choosing and confirming the same sprite adds “Human checked” while keeping the tool source.</p> : null}
        <section className="automation-experiment" aria-labelledby="no-fire-experiment-heading">
          <h3 id="no-fire-experiment-heading">No-fire checker <span className="experiment-badge">Beta</span></h3>
          <p className="experiment-warning">Missed fire is usually hard to label. If you need more phase readings, recheck Auto’s no-fire labels.</p>
          <p className="dim">Saves No fire on unlabelled frames when the scan finishes. Existing labels stay unchanged. Teal strips mark automatic no-fire labels; Undo removes the batch.</p>
          <p>Best results with:</p>
          <ul>
            <li>Original 1920 × 1080 vanilla Java 1.16.5 footage, with the full game view.</li>
            <li>Default textures and HUD; no shaders, resource packs, cropping or colour edits.</li>
            <li>Clear gameplay with a visible hotbar. Menus, tiny/distant fire and transparent blocks can confuse it.</li>
          </ul>
          <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> This video uses the vanilla 1.16.5 GUI described above.</label>
          <div className="automation-actions">
            <button disabled={!backend.noFireStart||!videoPath||!confirmed||noFireRunning||noFirePending||running} onClick={()=>void scanNoFire()}>Scan &amp; label no fire</button>
            {noFire?.state==="running"&&<button disabled={noFirePending} onClick={()=>void backend.noFireCancel?.(noFire.id).catch(e=>setNoFireError(messageOf(e)))}>Cancel no-fire scan</button>}
          </div>
          {noFire&&<div className="automation-progress" role="status">
            <progress aria-label="No-fire scan progress" max={Math.max(1,noFire.total)} value={noFire.processed}/>
            <span>{noFire.state==="running"?"Scanning":noFire.state==="saving"?"Saving labels":noFire.state==="done"?"Scan complete":noFire.state==="cancelled"?"Cancelled":"Scan failed"} · {noFire.processed.toLocaleString()} / {noFire.total.toLocaleString()} frames · {noFire.accepted.toLocaleString()} candidates{noFire.state==="done"?` · ${noFire.applied.toLocaleString()} labelled`:""}</span>
          </div>}
          {(noFireError||noFire?.error)&&<p role="alert">{noFireError??noFire?.error}</p>}
          {!backend.noFireStart&&<p className="dim">Scanning is available in the desktop app.</p>}
          {noFire?.state==="done"&&frames.length>0&&<div className="automation-actions">
            <select aria-label="Suggested no-fire frame" value={selected} onChange={e=>setSelected(Number(e.target.value))}>{frames.map((frame,i)=><option key={frame} value={i}>Frame {frame.toLocaleString()}</option>)}</select>
            <button disabled={!onReview} onClick={()=>onReview?.(frames[selected])}>Review frame</button>
            <button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-100))}>Previous results</button>
            <button disabled={offset+100>=noFire.accepted} onClick={()=>setOffset(offset+100)}>Next results</button>
          </div>}
          {noFire?.state==="done"&&<p className="dim">{noFire.accepted===0?"No candidates found. Other frames remain unreviewed.":"Review opens the frame in Label. Confirming it yourself removes the automatic strip and keeps its source history."}</p>}
        </section>
      </div>
    </div>
  </div>;
}
