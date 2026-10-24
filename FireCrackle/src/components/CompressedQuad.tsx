import { useEffect, useMemo, useRef, useState } from "react";
import { clipCompressed, encodeCycle, type FireRaster } from "../lib/ffmpegCompression";
import type { ManualQuad } from "../lib/quadMask";
import { rasterizeFire } from "../lib/quadRaster";
import { failureMessage,  reportError } from "../lib/appErrors";

interface Props {
  rgba:Uint8ClampedArray; quad:ManualQuad; row:number; mirrored:boolean; width:number; height:number;
  displayWidth:number; displayHeight:number; opacity:number; quality:number;
}

/** The quad mask's FFmpeg preview: its one quad (`rasterizeFire`) through the shared encode. */
export function CompressedQuad(props:Props) {
  const {rgba,quad,mirrored,width,height}=props;
  const key=useMemo(()=>{let hash=2166136261;for(const byte of rgba)hash=Math.imul(hash^byte,16777619);return JSON.stringify(["quad",hash,quad,mirrored]);},[rgba,quad,mirrored]);
  return <CompressedFire {...props} cycleKey={key} raster={(row,white)=>rasterizeFire(rgba,row,mirrored,quad,width,height,white)} />;
}

interface FireProps {
  /** What the raster depends on: a new key encodes the 32 rows again, a new row only re-clips. */
  cycleKey:string; raster:FireRaster; row:number; width:number; height:number;
  displayWidth:number; displayHeight:number; opacity:number; quality:number;
}

/** Any fire through FFmpeg (H.264 at `width` × `height`, the chosen damage): the 32 rows are encoded once per
 * geometry/settings change, not per selected row, and the decoded row is clipped with the fire's own alpha. */
export function CompressedFire({cycleKey,raster,row,width,height,displayWidth,displayHeight,opacity,quality}:FireProps) {
  const latest=useRef(raster);latest.current=raster;
  const request=useMemo(()=>({cycleKey,width,height,quality}),[cycleKey,width,height,quality]);
  const [cycle,setCycle]=useState<{request:typeof request;frames?:Uint8Array[];error?:string}|null>(null);
  const [result,setResult]=useState<{request:typeof request;row:number;url?:string;error?:string}|null>(null);
  useEffect(()=> {
    let cancelled=false;
    const timer=window.setTimeout(()=> {
      encodeCycle(cycleKey,(r,white)=>latest.current(r,white),width,height,quality,()=>cancelled)
        .then(frames=> {if(!cancelled)setCycle({request,frames});})
        .catch(e=> {if(!cancelled)setCycle({request,error:failureMessage(e)});});
    },300);
    return ()=> {cancelled=true;window.clearTimeout(timer);};
  },[request]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=> {
    if(cycle?.request!==request || !cycle.frames)return;
    let cancelled=false,url:string|undefined;
    clipCompressed(cycle.frames[row],latest.current(row,false),width,height).then(blob=> {
      if(cancelled)return;
      url=URL.createObjectURL(blob);setResult({request,row,url});
    }).catch(e=> {if(!cancelled)setResult({request,row,error:failureMessage(e)});});
    return ()=> {cancelled=true;if(url)URL.revokeObjectURL(url);};
  },[cycle,request,row]); // eslint-disable-line react-hooks/exhaustive-deps
  const current=result?.request===request && result.row===row?result:null;
  const error=(cycle?.request===request?cycle.error:null) || current?.error;
  useEffect(() => { if (error) reportError("Compression preview", error); }, [error]);
  return current?.url
    ? <image href={current.url} width={displayWidth} height={displayHeight} opacity={opacity} preserveAspectRatio="none" style={{imageRendering:"auto"}} />
    : <text x="12" y="24" fill="white" stroke="black" paintOrder="stroke" strokeWidth="2" role={error?"alert":"status"}>
      {error?`Compression preview failed: ${error}`:"Encoding fire animation with FFmpeg…"}
    </text>;
}
