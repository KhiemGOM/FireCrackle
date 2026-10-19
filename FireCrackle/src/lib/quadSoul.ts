import {matchFireQuad,type MatchImage,type QuadMatch} from "./quadMatch";
import type {ManualQuad} from "./quadMask";
import type {EdgeFilter} from "./atlasFilter";

/** Frozen soul control: reorder RGB to G,B,R, preserving alpha and geometry. */
export function soulChannels(data:Uint8ClampedArray):Uint8ClampedArray {
  const out=new Uint8ClampedArray(data.length);
  for(let i=0;i<data.length;i+=4){out[i]=data[i+1];out[i+1]=data[i+2];out[i+2]=data[i];out[i+3]=data[i+3];}
  return out;
}
export function matchSoulQuad(image:MatchImage,sheets:[Uint8ClampedArray,Uint8ClampedArray],quad:ManualQuad,options:{refineGeometry?:boolean;filter?:EdgeFilter;phaseEvidence?:boolean}={}):QuadMatch {
  const result=matchFireQuad({...image,data:soulChannels(image.data)},sheets.map(soulChannels) as typeof sheets,quad,{...options,colourTolerance:[.18,.30]});
  const tag=(items:QuadMatch['candidates'])=>items.map(c=>({...c,atlas:c.sheet===0?"soul_fire_0" as const:"soul_fire_1" as const}));
  return {...result,candidates:tag(result.candidates),...(result.phaseCandidates?{phaseCandidates:tag(result.phaseCandidates)}:{}),...(result.allCandidates?{allCandidates:tag(result.allCandidates)}:{})};
}
