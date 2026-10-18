import { useEffect, useMemo, useState } from "react";
import { clipCompressedFire, encodeFireCycle } from "../lib/ffmpegCompression";
import type { ManualQuad } from "../lib/quadMask";
import { reportError } from "../lib/appErrors";

interface Props {
  rgba:Uint8ClampedArray; quad:ManualQuad; row:number; mirrored:boolean; width:number; height:number;
  displayWidth:number; displayHeight:number; opacity:number; quality:number;
}

/** Encode the animation once per geometry/settings change, not per selected row. */
export function CompressedQuad(props:Props) {
  const {rgba,quad,row,mirrored,width,height,displayWidth,displayHeight,opacity,quality}=props;
  const request=useMemo(()=>({rgba,quad,mirrored,width,height,quality}),[rgba,quad,mirrored,width,height,quality]);
  const [cycle,setCycle]=useState<{request:typeof request;frames?:Uint8Array[];error?:string}|null>(null);
  const [result,setResult]=useState<{request:typeof request;row:number;url?:string;error?:string}|null>(null);
  useEffect(()=> {
    let cancelled=false;
    const timer=window.setTimeout(()=> {
      encodeFireCycle(rgba,quad,mirrored,width,height,quality,()=>cancelled)
        .then(frames=> {if(!cancelled)setCycle({request,frames});})
        .catch(e=> {if(!cancelled)setCycle({request,error:String(e)});});
    },300);
    return ()=> {cancelled=true;window.clearTimeout(timer);};
  },[request]);
  useEffect(()=> {
    if(cycle?.request!==request || !cycle.frames)return;
    let cancelled=false,url:string|undefined;
    clipCompressedFire(cycle.frames[row],rgba,quad,row,mirrored,width,height).then(blob=> {
      if(cancelled)return;
      url=URL.createObjectURL(blob);setResult({request,row,url});
    }).catch(e=> {if(!cancelled)setResult({request,row,error:String(e)});});
    return ()=> {cancelled=true;if(url)URL.revokeObjectURL(url);};
  },[cycle,request,row]);
  const current=result?.request===request && result.row===row?result:null;
  const error=(cycle?.request===request?cycle.error:null) || current?.error;
  useEffect(() => { if (error) reportError("Compression preview", error); }, [error]);
  return current?.url
    ? <image href={current.url} width={displayWidth} height={displayHeight} opacity={opacity} preserveAspectRatio="none" style={{imageRendering:"auto"}} />
    : <text x="12" y="24" fill="white" stroke="black" paintOrder="stroke" strokeWidth="2" role={error?"alert":"status"}>
      {error?`Compression preview failed: ${error}`:"Encoding fire animation with FFmpeg…"}
    </text>;
}
