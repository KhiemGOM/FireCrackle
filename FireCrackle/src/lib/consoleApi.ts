// A console API for the Misc-tools frame comparison: `window.firecrackle` in the app's devtools (or over CDP), so a
// blink proof of any two frames, or of a GUI boundary, is made without clicking. It only strings the app's own pieces
// together: the comparison pictures (native frame, GUI mask, shared Auto unveil: comparisonPost.comparisonPictures),
// the GUI pairing (guiAimReview.guiPairFrames) and the annotated proof export (frameComparison.exportFrameProof).
import type {Backend} from './api';
import {comparisonPictures,compareEffects,comparesProcessed,NO_COMPARE_POST,type ComparePost} from './comparisonPost';
import {exportFrameProof,type FrameProof} from './frameComparison';
import type {ProofAction,ProofFormat} from './comparisonProof';
import {guiPairFrames,type GuiPair} from './guiAimReview';
import {comparisonFrames,reviewInterval} from './miscTools';
import type {PostSettings} from './post/settings';
import type {VeilOptions} from './veil';

/** What the open video gives the API: read fresh at every call, so it follows the video and the settings. */
export interface ConsoleContext {backend:Backend;fps:number;frameCount:number;source:string;post:PostSettings;veil:VeilOptions}
/** `unveil` (default on), `portal` and `enhance`: the comparison's post effects, as its tick boxes. */
export interface ProofRequest {first:number;last:number;path:string;format?:ProofFormat;unveil?:boolean;portal?:boolean;enhance?:boolean}
export interface GuiProofRequest extends Omit<ProofRequest,'first'|'last'> {first:number;last:number;pair:GuiPair}
export interface ProofMade {path:string;before:number;after:number;effects?:string;errors:string[]}
export interface ConsoleApi {proof(request:ProofRequest):Promise<ProofMade>;guiProof(request:GuiProofRequest):Promise<ProofMade>;help():string}

type Deps = {
 pictures:(args:Parameters<typeof comparisonPictures>[0])=>ReturnType<typeof comparisonPictures>;
 exportProof:(backend:Backend,proof:FrameProof,action:ProofAction,pictures?:{before:Blob;after:Blob})=>Promise<boolean>;
};
const FORMATS:readonly ProofFormat[]=['gif','webp','png','jpeg'],PAIRS:readonly GuiPair[]=['open','close','around'];
const HELP=`firecrackle.proof({first, last, path, format?: 'gif'|'webp'|'png'|'jpeg', unveil?: true, portal?: false, enhance?: false})
  the Misc comparison's blink proof of frames first and last, saved to path (no dialog)
firecrackle.guiProof({first, last, pair: 'open'|'close'|'around', path, ...})
  first..last are the frames the GUI is open; pairs as the GUI gallery: open = (first-1, first), close = (last, last+1),
  around = (first-1, last+1)
Both resolve to {path, before, after, effects, errors}; errors lists post-effect stages that failed but left a picture.`;

function whole(value:unknown,name:string):number{
 if(typeof value!=='number'||!Number.isInteger(value)||value<0)throw Error(`${name} must be a whole frame number (0 or more).`);
 return value;
}

export function createConsoleApi(context:()=>ConsoleContext|null,deps:Deps={pictures:comparisonPictures,exportProof:exportFrameProof}):ConsoleApi{
 async function proof(request:ProofRequest):Promise<ProofMade>{
  const first=whole(request?.first,'first'),last=whole(request?.last,'last');
  if(typeof request.path!=='string'||!request.path.trim())throw Error('Give the output path, e.g. path: "D:/proofs/blink.gif".');
  const format=request.format??'gif';
  if(!FORMATS.includes(format))throw Error(`Unknown format "${String(format)}": use ${FORMATS.join(', ')}.`);
  const ctx=context();
  if(!ctx)throw Error('Open a video first.');
  // the comparison's own endpoints: in order, inside the video
  const frames=comparisonFrames(reviewInterval(first,last,ctx.frameCount),ctx.frameCount);
  if(frames.before===null||frames.after===null)throw Error('The video has no frames.');
  const compare:ComparePost={...NO_COMPARE_POST,veil:request.unveil??true,portal:!!request.portal,enhance:!!request.enhance,blink:true};
  let pictures:{before:Blob;after:Blob}|undefined,errors:string[]=[];
  if(comparesProcessed(compare)){
   const made=await deps.pictures({backend:ctx.backend,frames:[frames.before,frames.after],post:ctx.post,compare,veilOptions:ctx.veil,signal:new AbortController().signal});
   const before=made.pictures.get(frames.before),after=made.pictures.get(frames.after);
   // a failed picture is never swapped for the original frame: the proof would claim effects it does not show
   if(!before||!after)throw Error(`The post effects failed: ${made.errors.join(' · ')||'a picture is missing'}.`);
   pictures={before,after};errors=made.errors;
  }
  const effects=pictures?compareEffects(compare):undefined;
  const range=reviewInterval(first,last,ctx.frameCount);
  const saved=await deps.exportProof(ctx.backend,{before:frames.before,after:frames.after,first:range.first,last:range.last,fps:ctx.fps,source:ctx.source,...(effects?{effects}:{})},
   {format,destination:'save',path:request.path},pictures);
  if(!saved)throw Error('The proof was not saved.');
  return {path:request.path,before:frames.before,after:frames.after,...(effects?{effects}:{}),errors};
 }
 return {
  proof,
  async guiProof(request){
   if(!PAIRS.includes(request?.pair))throw Error(`Unknown pair "${String(request?.pair)}": use ${PAIRS.join(', ')}.`);
   const first=whole(request.first,'first'),last=whole(request.last,'last'),ctx=context();
   if(!ctx)throw Error('Open a video first.');
   const pick=guiPairFrames({first,last,menu:false},ctx.frameCount,request.pair);
   return proof({...request,first:pick.before,last:pick.after});
  },
  help:()=>HELP,
 };
}

/** Puts the API on `target` (the window) as `firecrackle`; `context` is read at every call. */
export function installConsoleApi(context:()=>ConsoleContext|null,target:{firecrackle?:unknown}=globalThis as {firecrackle?:unknown}):ConsoleApi{
 const api=createConsoleApi(context);
 target.firecrackle=api;
 return api;
}
