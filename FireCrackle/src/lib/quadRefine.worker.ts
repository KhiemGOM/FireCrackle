import {refineQuad} from "./quadEcc";
import {phaseMatchInput} from "./quadPhaseInput";
import type {MatchImage} from "./quadMatch";
import type {RefinementTarget} from "./quadRefine";
import { failureMessage } from "./appErrors";
type Request={image:MatchImage;sheets:[Uint8ClampedArray,Uint8ClampedArray];targets:RefinementTarget[];material:"normal"|"soul"};
self.onmessage=async({data}:MessageEvent<Request>)=>{
  try{
    const input=await phaseMatchInput(data.image,data.targets[0].quad);if(input.error)throw Error(input.error);
    self.postMessage({results:data.targets.map(t=>refineQuad(input.image,data.sheets,t.quad,t.sprite,data.material))});
  }catch(error){self.postMessage({error:failureMessage(error)});}
};
