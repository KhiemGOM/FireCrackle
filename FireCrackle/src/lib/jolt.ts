import { relativePhase, type ChartPoint, type PhaseChart } from "./chart";

export interface JoltAnchor { time:number; tick:number; game:string; screen:string; segment?:string }
export interface JoltData { name:string; source:string; version:string; anchors:JoltAnchor[]; unresolved:number }
export interface JoltState { version:1; data:JoltData|null; clock:"video"|"jolt"; session:string }
export const EMPTY_JOLT:JoltState={version:1,data:null,clock:"video",session:""};
export const JOLT_LIMIT=200_000;
export const sessionOf=(a:JoltAnchor)=>JSON.stringify([a.game,a.screen]);
const wrap=(n:number)=>((n%32)+32)%32;
const finite=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n);
const id=(n:unknown,fallback:string)=>n===undefined?fallback:(typeof n==="string"&&n.length>0&&n.length<=80)||(typeof n==="number"&&Number.isSafeInteger(n))?String(n):(()=>{throw Error("Invalid Jolt game or screen identity.");})();

/** Read data only. HTML report scripts are never evaluated or inserted into the page. */
export function parseJolt(text:string,name:string):JoltData {
  if(text.length>32*1024*1024)throw Error("Jolt report is too large (32 MB maximum).");
  let raw:any;
  if(text.trimStart().startsWith("<")) {
    const script=[...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].find(m=>/\bid\s*=\s*["']data["']/i.test(m[1])&&/\btype\s*=\s*["']application\/json["']/i.test(m[1]));
    if(!script)throw Error("This HTML is not a Jolt report with embedded JSON data.");
    text=script[2];
  }
  try{raw=JSON.parse(text);}catch{throw Error("Could not read the Jolt JSON. Import its raw JSON export or HTML report.");}
  let candidates:any[];
  if(Array.isArray(raw?.runs)&&Array.isArray(raw?.jolts)&&Array.isArray(raw?.games)) {
    candidates=[];
    const games=new Map(raw.games.map((g:any)=>[String(g.number),g]));
    for(const [segment,run] of raw.runs.entries()){
      if(!Array.isArray(run.points))throw Error("Invalid Jolt run points.");
      const game:any=games.get(String(run.game));
      if(!game)throw Error("Jolt run refers to an unknown game.");
      for(const point of run.points){
        if(!Array.isArray(point)||point.length<3||!Number.isInteger(point[2])||!raw.jolts[point[2]])throw Error("Invalid Jolt observation reference.");
        candidates.push({time:point[0],tick:point[1],game:run.game,screen:game.screen??1,segment:String(segment)});
        if(candidates.length>JOLT_LIMIT)throw Error("Too many Jolt anchors (200,000 maximum).");
      }
    }
  } else if(Array.isArray(raw?.anchors))candidates=raw.anchors;
  else if(Array.isArray(raw))candidates=raw;
  else throw Error("Expected a Splosh Jolt JSON/HTML report, or an anchors array with time, tick, game and screen.");
  if(candidates.length>JOLT_LIMIT)throw Error("Too many Jolt anchors (200,000 maximum).");
  let unresolved=0;
  const byTime=new Map<string,JoltAnchor|null>();
  for(const a of candidates){
    if(!a||!finite(a.time)||a.time<0)throw Error("Every Jolt anchor needs a non-negative video time in seconds.");
    if(a.tick==null||Array.isArray(a.tick)){unresolved++;continue;}
    if(!Number.isSafeInteger(a.tick)||a.tick<0)throw Error("Every resolved Jolt tick must be a non-negative integer.");
    const anchor:JoltAnchor={time:a.time,tick:a.tick,game:id(a.game,"1"),screen:id(a.screen,"1"),segment:id(a.segment,"0")};
    const key=`${sessionOf(anchor)}:${Math.round(anchor.time*1e6)}`;
    if(byTime.has(key)){if(byTime.get(key)?.tick!==anchor.tick){byTime.set(key,null);unresolved++;}}
    else byTime.set(key,anchor);
  }
  const anchors=[...byTime.values()].filter((a):a is JoltAnchor=>a!==null).sort((a,b)=>a.time-b.time||a.game.localeCompare(b.game));
  if(!anchors.length)throw Error("No resolved Jolt tick anchors were found. Ambiguous observations cannot be used as a clock.");
  return {name:name.slice(0,180),source:typeof raw.source==="string"?raw.source.slice(0,500):"",version:String(raw.version??"unknown").slice(0,40),anchors,unresolved};
}

export function restoreJolt(text:string|null):JoltState {
  if(!text)return {...EMPTY_JOLT};
  const saved=JSON.parse(text);
  if(saved===null)return {...EMPTY_JOLT};
  if(saved.version!==1)throw Error("Unsupported saved Jolt data version.");
  if(saved.data===null)return {...EMPTY_JOLT};
  const data=parseJolt(JSON.stringify(saved.data),saved.data.name??"Jolt report");
  data.unresolved=Number.isSafeInteger(saved.data.unresolved)?saved.data.unresolved:0;
  data.source=typeof saved.data.source==="string"?saved.data.source:"";
  const sessions=new Set(data.anchors.map(sessionOf));
  return {version:1,data,clock:saved.clock==="jolt"?"jolt":"video",session:sessions.has(saved.session)?saved.session:sessionOf(data.anchors[0])};
}
export function localJoltKey(video:string){return `firecrackle.jolt.v1:${encodeURIComponent(video)}`;}

export interface ClockSample { tick:number; estimated:boolean }
export interface TimeReference { kind:"video"|"jolt"; tickAt:(pts:number)=>number|null; sampleAt:(pts:number)=>ClockSample|null; sampleTimes:number[] }
/** Shared clock contract. Fit between resolved readings in the same imported run;
 * never bridge reported breaks, session changes or tick resets, and never fall back to video time. */
export function timeReference(state:JoltState,tickRate=20):TimeReference {
  if(state.clock!=="jolt")return {kind:"video",tickAt:pts=>finite(pts)?pts*tickRate:null,sampleAt:pts=>finite(pts)?{tick:pts*tickRate,estimated:false}:null,sampleTimes:[]};
  const anchors=(state.data?.anchors??[]).filter(a=>sessionOf(a)===state.session).sort((a,b)=>a.time-b.time);
  const sampleAt=(pts:number):ClockSample|null=>{
    if(!finite(pts))return null;
    let low=0,high=anchors.length;
    while(low<high){const mid=(low+high)>>>1;if(anchors[mid].time<pts-0.000002)low=mid+1;else high=mid;}
    const after=anchors[low],before=anchors[low-1];
    if(after&&Math.abs(after.time-pts)<=0.000002)return {tick:after.tick,estimated:false};
    if(!before||!after||before.segment!==after.segment||after.tick<before.tick||after.time<=before.time)return null;
    return {tick:before.tick+(pts-before.time)/(after.time-before.time)*(after.tick-before.tick),estimated:true};
  };
  return {kind:"jolt",sampleTimes:anchors.map(a=>a.time),sampleAt,tickAt:pts=>sampleAt(pts)?.tick??null};
}

/** Apply the shared GUI clock at each labelled frame's actual PTS. Sprite labels stay unchanged. */
export function joltPhase(chart:PhaseChart|null,reference:TimeReference):PhaseChart|null {
  if(!chart)return null;
  const points:ChartPoint[]=[];
  for(const p of chart.points){
    const sample=reference.sampleAt(p.pts);
    if(sample)points.push({...p,clock_tick:sample.tick,clock_estimated:sample.estimated,phase:wrap(sample.tick-p.step)});
  }
  const baseline=points[0]?.phase??null;
  const flags=points.filter(p=>baseline!==null&&Math.abs(relativePhase(p.phase,baseline))>chart.window_ticks).map(p=>({frame:p.frame,end_frame:p.frame,kind:"phase_outlier" as const,severity:"soft" as const,phase_delta:relativePhase(p.phase,baseline!)}));
  return {...chart,reference_clock:"jolt",points,runs:[],flags,reference_phase:baseline,clock_residuals:[],lag_intervals:[],label_sources:Object.fromEntries(points.map(p=>[p.frame,chart.label_sources?.[p.frame]??[]])),flag_details:flags.map(f=>({...f,clock_delta:f.phase_delta,held_ticks:null,explanation:"Fire differs from the first fire–Jolt phase. Between resolved readings the GUI clock is estimated within each imported continuous run. No fit bridges an imported break. Check labels, frame alignment, pauses and resource reloads."}))};
}

/** Bound SVG work without losing local clock jumps: keep each bin's endpoints and offset extrema. */
export function plotAnchors(anchors:JoltAnchor[],bins=1000):JoltAnchor[] {
  if(anchors.length<=bins*4)return anchors;
  const out:JoltAnchor[]=[];
  const value=(a:JoltAnchor)=>a.tick-20*a.time;
  for(let start=0;start<anchors.length;){
    const end=Math.min(anchors.length,start+Math.ceil(anchors.length/bins));
    let low=start,high=start;
    for(let i=start+1;i<end;i++){if(value(anchors[i])<value(anchors[low]))low=i;if(value(anchors[i])>value(anchors[high]))high=i;}
    for(const i of [...new Set([start,low,high,end-1])].sort((a,b)=>a-b))out.push(anchors[i]);
    start=end;
  }
  return out;
}
