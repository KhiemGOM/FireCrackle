import {formatTimecode} from '../lib/timecode';

export function discreteCursor(time:number,fps:number,originTick?:number){
 const rate=Number.isFinite(fps)&&fps>0?fps:60;
 if(originTick!==undefined){const tick=Math.round(originTick+time*20);return {time:(tick-originTick)/20,label:`Tick ${tick}`};}
 const frame=Math.max(0,Math.round(time*rate));
 return {time:frame/rate,label:`Frame ${frame} · ${formatTimecode(frame/rate,rate)}`};
}

/** Separate from the plot canvas: moving the cursor never repaints all evidence. */
export function ChartCursor({cursor,lo,hi}:{cursor:{time:number;label:string}|null;lo:number;hi:number}){
 if(!cursor||cursor.time<lo||cursor.time>hi||hi<=lo)return null;
 const percent=100*(cursor.time-lo)/(hi-lo);
 return <div aria-label="Snapped chart cursor" data-time={cursor.time} style={{position:'absolute',inset:0,pointerEvents:'none',overflow:'hidden'}}>
  <div style={{position:'absolute',left:`${percent}%`,top:0,bottom:0,borderLeft:'1px dashed #fff'}}/>
  <span style={{position:'absolute',left:`${percent}%`,top:5,transform:percent>65?'translateX(calc(-100% - 5px))':'translateX(5px)',whiteSpace:'nowrap',background:'#10141ce8',border:'1px solid #536179',borderRadius:3,padding:'2px 5px',fontSize:11,color:'#fff'}}>{cursor.label}</span>
 </div>;
}
