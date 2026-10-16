import { useEffect, useMemo, useRef, useState } from "react";
import type { Backend } from "../lib/api";
import { EMPTY_JOLT, localJoltKey, parseJolt, restoreJolt, sessionOf, type JoltState } from "../lib/jolt";
import "./JoltPanel.css";

interface Props { backend:Backend; videoKey?:string; state:JoltState; onChange:(state:JoltState)=>void; matched:number|null; t0:number; t1:number; onFocus:(time:number,openVideo:boolean)=>void }
export function JoltPanel({backend,videoKey,state,onChange,matched}:Props){
  const [error,setError]=useState<string|null>(null),[pending,setPending]=useState(true);
  const input=useRef<HTMLInputElement>(null);
  const activeVideo=useRef(videoKey);activeVideo.current=videoKey;
  const changeRef=useRef(onChange);changeRef.current=onChange;
  useEffect(()=>{
    let live=true;setPending(true);setError(null);changeRef.current({...EMPTY_JOLT});
    const load=async()=>{
      if(!videoKey)return {...EMPTY_JOLT};
      const text=backend.joltRead?await backend.joltRead(videoKey):localStorage.getItem(localJoltKey(videoKey));
      return restoreJolt(text);
    };
    void load().then(value=>{if(live)changeRef.current(value);}).catch(e=>{if(live)setError(String(e));}).finally(()=>{if(live)setPending(false);});
    return()=>{live=false;};
  },[backend,videoKey]);
  async function update(next:JoltState){
    if(!videoKey)return;setPending(true);setError(null);
    const target=videoKey;
    try{const text=JSON.stringify(next);if(backend.joltWrite)await backend.joltWrite(target,text);else localStorage.setItem(localJoltKey(target),text);if(activeVideo.current===target)changeRef.current(next);}
    catch(e){if(activeVideo.current===target)setError(`Could not save Jolt data: ${String(e)}`);}finally{if(activeVideo.current===target)setPending(false);}
  }
  async function importFile(file:File){
    try{
      if(file.size>32*1024*1024)throw Error("Jolt report is too large (32 MB maximum).");
      const data=parseJolt(await file.text(),file.name);
      await update({version:1,data,clock:"jolt",session:sessionOf(data.anchors[0])});
    }catch(e){setError(String(e));}
  }
  const anchors=useMemo(()=>(state.data?.anchors??[]).filter(a=>sessionOf(a)===state.session),[state.data,state.session]);
  const sessions=useMemo(()=>[...new Map((state.data?.anchors??[]).map(a=>[sessionOf(a),a])).entries()],[state.data]);
  const sections=useMemo(()=>new Set(anchors.map(a=>a.segment??"0")).size,[anchors]);
  return <section className="jolt-panel" aria-label="Jolt time reference">
    <div className="jolt-controls">
      <strong>X axis</strong>
      <div className="jolt-switch" role="group" aria-label="Phase time reference">
        <button aria-pressed={state.clock==="video"} className={state.clock==="video"?"on":""} disabled={pending} onClick={()=>void update({...state,clock:"video"})}>Video time</button>
        <button aria-pressed={state.clock==="jolt"} className={state.clock==="jolt"?"on":""} disabled={pending||!state.data} onClick={()=>void update({...state,clock:"jolt"})}>Canonical time (Jolt ticks)</button>
      </div>
      <button disabled={pending||!videoKey} onClick={()=>input.current?.click()}>Import Jolt report…</button>
      <input ref={input} type="file" accept=".json,.html,.htm" hidden aria-label="Jolt report file" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void importFile(file);}}/>
      {pending&&<span role="status">Loading / saving Jolt data…</span>}
    </div>
    {error&&<p role="alert">{error}</p>}
    {!state.data?<p className="dim">Optional: import Splosh JoltCracker’s JSON export or HTML report for this same video. Fire labels stay unchanged.</p>:<>
      <div className="jolt-sessions" role="group" aria-label="Jolt game and screen">{sessions.map(([key,a])=><button key={key} disabled={pending} className={key===state.session?"on":""} aria-pressed={key===state.session} onClick={()=>void update({...state,session:key})}>Game {a.game} · screen {a.screen}</button>)}</div>
      <details className="phase-help jolt-report-details"><summary>{anchors.length.toLocaleString()} anchors · {sections} sections · report details</summary>
        <p>{state.data.name}{matched===null?"":` · ${matched.toLocaleString()} fire labels with a clock value`}{state.data.unresolved?` · ${state.data.unresolved} unresolved/conflicting entries excluded`:""}</p>
        {state.data.source&&<p className="dim">Report video: {state.data.source}</p>}
        <p>Clock ticks are estimated between readings within each continuous section. No estimate crosses a reported break or extends beyond the outer readings.</p>
        <p>Imported from <a href="https://splosh.icu/jolt" target="_blank" rel="noreferrer">Splosh JoltCracker</a> · jolt cracking by Dart and repeater64. Saved with this video project.</p>
        <button disabled={pending} onClick={()=>void update({...EMPTY_JOLT})}>Remove Jolt data</button>
      </details>
    </>}
  </section>;
}
