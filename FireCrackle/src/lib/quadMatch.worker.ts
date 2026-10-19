import {matchFireQuad,type MatchImage,type QuadMatch} from "./quadMatch";
import type {ManualQuad} from "./quadMask";
import type {EdgeFilter} from "./atlasFilter";
import {phaseMatchInput} from "./quadPhaseInput";

type Request={image:MatchImage;sheets:[Uint8ClampedArray,Uint8ClampedArray];quad:ManualQuad;options:{refineGeometry?:boolean;filter?:EdgeFilter;phaseEvidence?:boolean}};
const scope=self as unknown as {onmessage:(event:MessageEvent<Request>)=>void;postMessage:(response:{result?:QuadMatch;error?:string;rgb?:Uint8Array})=>void};
scope.onmessage=async({data})=>{
  try{
    const input=data.options.phaseEvidence?await phaseMatchInput(data.image,data.quad):{image:data.image,rgb:undefined,error:undefined};
    const result=matchFireQuad(input.image,data.sheets,data.quad,{...data.options,phaseEvidence:!!input.rgb});
    if(input.error)result.ai={error:input.error};
    scope.postMessage({result,rgb:input.rgb});
  }
  catch(error){scope.postMessage({error:String(error)});}
};
