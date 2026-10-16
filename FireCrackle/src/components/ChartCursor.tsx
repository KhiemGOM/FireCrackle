import {formatTimecode} from '../lib/timecode';

export interface FrameCursor {frame:number;time:number;label:string}

/** One rule for every chart: choose a video frame, then draw its mapped X position. */
export function createFrameCursor(fps:number,frameCount=Number.MAX_SAFE_INTEGER,frameTime?:(frame:number)=>number){
 const rate=Number.isFinite(fps)&&fps>0?fps:60,last=Math.max(0,frameCount-1);
 const cursor=(frame:number,time:number):FrameCursor=>({frame,time,label:`Frame ${frame} · ${formatTimecode(frame/rate,rate)}`});
 if(!frameTime)return (time:number)=>{const frame=Math.max(0,Math.min(last,Math.round(time*rate)));return cursor(frame,frame/rate);};
 // The clock projection may contain jumps or resets. Search sorted display positions,
 // retaining the original video-frame identity instead of rounding GUI ticks.
 const positions=Array.from({length:frameCount},(_,frame)=>({frame,time:frameTime(frame)})).filter(p=>Number.isFinite(p.time));
 if(positions.some((p,i)=>i>0&&p.time<positions[i-1].time))positions.sort((a,b)=>a.time-b.time||a.frame-b.frame);
 return (time:number)=>{
  let lo=0,hi=positions.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(positions[mid].time<time)lo=mid+1;else hi=mid;}
  const a=positions[Math.max(0,lo-1)],b=positions[Math.min(lo,positions.length-1)];
  const picked=!a?b:!b?a:Math.abs(a.time-time)<=Math.abs(b.time-time)?a:b;
  return picked?cursor(picked.frame,picked.time):cursor(0,frameTime(0));
 };
}
export function discreteCursor(time:number,fps:number){return createFrameCursor(fps)(time);}

/** Separate from the plot canvas: moving the cursor never repaints all evidence. */
export function ChartCursor({cursor,lo,hi}:{cursor:{time:number;label:string}|null;lo:number;hi:number}){
 if(!cursor||cursor.time<lo||cursor.time>hi||hi<=lo)return null;
 const percent=100*(cursor.time-lo)/(hi-lo);
 return <div aria-label="Snapped chart cursor" data-time={cursor.time} style={{position:'absolute',inset:0,pointerEvents:'none',overflow:'hidden'}}>
  <div style={{position:'absolute',left:`${percent}%`,top:0,bottom:0,borderLeft:'1px dashed #fff'}}/>
  <span style={{position:'absolute',left:`${percent}%`,top:5,transform:percent>65?'translateX(calc(-100% - 5px))':'translateX(5px)',whiteSpace:'nowrap',background:'#10141ce8',border:'1px solid #536179',borderRadius:3,padding:'2px 5px',fontSize:11,color:'#fff'}}>{cursor.label}</span>
 </div>;
}
