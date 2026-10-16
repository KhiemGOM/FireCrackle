import { useEffect, useMemo, useRef, useState } from "react";
import type { Backend } from "../lib/api";
import { EMPTY_JOLT, localJoltKey, parseJolt, plotAnchors, restoreJolt, sessionOf, type JoltState } from "../lib/jolt";
import { formatTime } from "../lib/timeline";
import "./JoltPanel.css";

interface Props { backend:Backend; videoKey?:string; state:JoltState; onChange:(state:JoltState)=>void; matched:number|null; t0:number; t1:number; onFocus:(time:number,openVideo:boolean)=>void }
export function JoltPanel({backend,videoKey,state,onChange,matched,t0,t1,onFocus}:Props){
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
  const visible=useMemo(()=>anchors.filter(a=>a.time>=t0&&a.time<=t1),[anchors,t0,t1]);
  const baseline=anchors[0]?anchors[0].tick-20*anchors[0].time:0;
  const offset=(a:typeof anchors[number])=>a.tick-20*a.time-baseline;
  const [min,max]=useMemo(()=>visible.reduce(([min,max],a)=>[Math.min(min,a.tick-20*a.time-baseline),Math.max(max,a.tick-20*a.time-baseline)],[0,0]),[visible,baseline]),span=Math.max(1,max-min);
  const plotted=useMemo(()=>plotAnchors(visible),[visible]);
  const sections=useMemo(()=>new Set(anchors.map(a=>a.segment??"0")).size,[anchors]);
  const breaks=useMemo(()=>anchors.slice(1).flatMap((a,i)=>a.segment!==anchors[i].segment?[{before:anchors[i].time,after:a.time}]:[]),[anchors]);
  const x=(t:number)=>45+(t-t0)/Math.max(0.001,t1-t0)*940,y=(v:number)=>125-(v-min)/span*105;
  return <section className="jolt-panel" aria-label="Jolt time reference">
    <div className="jolt-controls">
      <strong>Time reference</strong>
      <div className="jolt-switch" role="group" aria-label="Phase time reference">
        <button aria-pressed={state.clock==="video"} className={state.clock==="video"?"on":""} disabled={pending} onClick={()=>void update({...state,clock:"video"})}>Video time</button>
        <button aria-pressed={state.clock==="jolt"} className={state.clock==="jolt"?"on":""} disabled={pending||!state.data} onClick={()=>void update({...state,clock:"jolt"})}>Jolt ticks</button>
      </div>
      <button disabled={pending||!videoKey} onClick={()=>input.current?.click()}>Import Jolt report…</button>
      <input ref={input} type="file" accept=".json,.html,.htm" hidden aria-label="Jolt report file" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void importFile(file);}}/>
      {state.data&&<button disabled={pending} onClick={()=>void update({...EMPTY_JOLT})}>Remove Jolt data</button>}
      {pending&&<span role="status">Loading / saving Jolt data…</span>}
    </div>
    {error&&<p role="alert">{error}</p>}
    {!state.data?<p className="dim">Optional: import Splosh JoltCracker’s JSON export or HTML report for this same video. Fire labels stay unchanged.</p>:<>
      <div className="jolt-sessions" role="group" aria-label="Jolt game and screen">{sessions.map(([key,a])=><button key={key} disabled={pending} className={key===state.session?"on":""} aria-pressed={key===state.session} onClick={()=>void update({...state,session:key})}>Game {a.game} · screen {a.screen}</button>)}</div>
      <p>{state.data.name} · {anchors.length.toLocaleString()} resolved anchors · {sections} continuous sections{matched===null?"":` · ${matched.toLocaleString()} fire labels with a clock value`}{state.data.unresolved?` · ${state.data.unresolved} unresolved/conflicting entries excluded`:""}</p>
      {state.data.source&&<p className="dim">Report video: {state.data.source}</p>}
      <p className="dim">Clock ticks are fitted between readings inside each imported continuous section. Fits never cross Jolt’s reported breaks or game/screen changes. Before the first reading, after the last, and across breaks the clock stays unknown. Hover fire points to distinguish observed and estimated ticks.</p>
      <div className="jolt-chart-title"><b>Jolt versus video time</b><span className="dim">Change in GUI ticks − 20 × video seconds, relative to this game’s first anchor</span></div>
      <svg className="jolt-chart" viewBox="0 0 1000 150" role="img" aria-label="Jolt clock offset against video time">
        {breaks.filter(b=>b.after>=t0&&b.before<=t1).map((b,i)=><rect key={i} x={x(Math.max(t0,b.before))} y="15" width={Math.max(2,x(Math.min(t1,b.after))-x(Math.max(t0,b.before)))} height="115" fill="rgba(245,197,66,0.16)"><title>Imported section break between {b.before.toFixed(3)} and {b.after.toFixed(3)} seconds. No clock fit crosses this interval.</title></rect>)}
        <line x1="45" x2="985" y1={y(0)} y2={y(0)} stroke="#4cc38a" strokeDasharray="5 4"/>
        <text x="2" y="18">{max.toFixed(1)}</text><text x="2" y="128">{min.toFixed(1)}</text>
        <text x="45" y="147">{formatTime(t0,0.01)}</text><text x="985" y="147" textAnchor="end">{formatTime(t1,0.01)}</text>
        {plotted.map((a,i)=><circle key={`${a.time}:${i}`} cx={x(a.time)} cy={y(offset(a))} r="3.5" fill="#50e1ff" role="button" tabIndex={0} aria-label={`Jolt at ${a.time.toFixed(3)} seconds, GUI tick ${a.tick}`} onClick={e=>onFocus(a.time,e.ctrlKey)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();onFocus(a.time,e.ctrlKey);}}}><title>{formatTime(a.time,0.01)} · GUI tick {a.tick} · change {offset(a).toFixed(1)} ticks · click to focus · Ctrl+click to open video</title></circle>)}
      </svg>
      <p className="dim">Imported clock evidence from <a href="https://splosh.icu/jolt" target="_blank" rel="noreferrer">Splosh JoltCracker</a> · jolt cracking by Dart and repeater64. Saved with this video project. Dots are observations. A flat fire–Jolt phase can still span a cut; inspect Jolt/video timing too.</p>
    </>}
  </section>;
}
