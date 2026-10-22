import type {MatchImage} from "./quadMatch";
import type {ManualQuad} from "./quadMask";
import {phasePixels,readablePhaseQuad} from "./quadPhase";
import {applyVeil,DEFAULT_VEIL_OPTIONS,initVeil} from "./veil";
import { failureMessage } from "./appErrors";

/** Shared Rust/WASM automatic detector, exactly as used for the calibrated crops. */
export async function phaseMatchInput(image:MatchImage,quad:ManualQuad):Promise<{image:MatchImage;rgb?:Uint8Array;error?:string}> {
  if(!readablePhaseQuad(quad,image.width,image.height))return {image};
  try {
    await initVeil();
    const unveiled=applyVeil(image,"auto",DEFAULT_VEIL_OPTIONS);
    if(unveiled.error)throw Error(unveiled.error);
    const prepared={...image,data:new Uint8ClampedArray(unveiled.data)};
    return {image:prepared,rgb:phasePixels(prepared,quad)};
  }catch(error){return {image,error:failureMessage(error)};}
}
