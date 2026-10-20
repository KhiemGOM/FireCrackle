import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { ManualQuad } from "../lib/quadMask";
import type { QuadCandidate } from "../lib/quadMatch";
import type { EdgeFilter } from "../lib/atlasFilter";

const hooks=vi.hoisted(()=>({values:[] as unknown[],cursor:0,cleanup:undefined as undefined|(()=>void)}));
vi.mock("react",async original=>({...(await original<typeof import("react")>()),
  useRef:(initial:unknown)=> {const i=hooks.cursor++;return hooks.values[i]??=( {current:initial} );},
  useState:(initial:unknown)=> {const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=initial;return [hooks.values[i],(value:unknown)=>{hooks.values[i]=value;}];},
  useEffect:(setup:()=>void|(()=>void))=> {if(!hooks.cleanup)hooks.cleanup=setup()||undefined;},
}));
vi.mock("../lib/quadMatch",()=>({matchFireQuad:vi.fn()}));
vi.mock("../lib/quadRefine",async original=>({...await original<typeof import("../lib/quadRefine")>(),refineMatchCandidates:vi.fn(async(_url:string,candidates:QuadCandidate[])=>candidates)}));
import { matchFireQuad } from "../lib/quadMatch";
import {refineMatchCandidates} from "../lib/quadRefine";
import { QuadMatchControls } from "./QuadMatchControls";

const pending=new Map<string,{onload:(()=>void)|null}>();
const q:ManualQuad=[[0,0],[1,0],[1,1],[0,1]];
const best={sheet:1 as const,row:12,mirrored:true,score:0.95,quad:q};
function render(frameUrl:string,onPreview:(candidate:QuadCandidate)=>void,disabled=false,filter?:EdgeFilter,material:"normal"|"soul"="normal",sourceFrame?:Parameters<typeof QuadMatchControls>[0]['sourceFrame']) {
  hooks.cursor=0;return QuadMatchControls({frameUrl,quad:q,disabled,onPreview,filter,material,sourceFrame});
}
function buttons(node:unknown):ReactElement<Record<string,unknown>>[] {
  if(Array.isArray(node))return node.flatMap(buttons);
  if(!node||typeof node!=="object"||!("props" in node))return [];
  const el=node as ReactElement<Record<string,unknown>>;
  return [...(el.type==="button"?[el]:[]),...buttons(el.props.children)];
}
function adjustment(node:unknown,label="Adjust quad while matching"):ReactElement<Record<string,any>>|undefined {
  if(Array.isArray(node))return node.map(child=>adjustment(child,label)).find(Boolean);
  if(!node||typeof node!=="object"||!("props" in node))return;
  const el=node as ReactElement<Record<string,any>>;
  return el.props["aria-label"]===label?el:adjustment(el.props.children,label);
}
async function settle(){for(let i=0;i<20;i++)await Promise.resolve();}
beforeEach(()=> {
  vi.mocked(refineMatchCandidates).mockImplementation(async(_url,candidates)=>candidates);
  hooks.values=[];hooks.cursor=0;hooks.cleanup=undefined;pending.clear();vi.clearAllMocks();
  class ImageMock {
    naturalWidth=16;naturalHeight=512;onload:(()=>void)|null=null;
    set src(src:string) {if(src.startsWith("frame")){this.naturalWidth=160;this.naturalHeight=100;pending.set(src,this);}else queueMicrotask(()=>this.onload?.());}
  }
  vi.stubGlobal("Image",ImageMock);
  vi.stubGlobal("document",{createElement:()=>({width:0,height:0,getContext:()=>({drawImage:()=>{},getImageData:(_x:number,_y:number,w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)})})})});
  vi.stubGlobal("window",{innerWidth:1000,innerHeight:700,setTimeout:(cb:()=>void)=>{queueMicrotask(cb);return 0;}});
  vi.mocked(matchFireQuad).mockReturnValue({status:"clear",candidates:[best],margin:0.1,searched:128});
});
afterEach(()=>{hooks.cleanup?.();vi.unstubAllGlobals();});

it("routes soul matching to the frozen cyan scorer and preserves its source on preview",async()=>{
  const preview=vi.fn();(buttons(render("frame-soul",preview,false,undefined,"soul"))[0].props.onClick as ()=>void)();
  pending.get("frame-soul")!.onload?.();await settle();
  expect(vi.mocked(matchFireQuad).mock.calls[0][3]).toEqual({refineGeometry:true,colourTolerance:[.18,.30]});
  expect(preview).toHaveBeenCalledWith(expect.objectContaining({atlas:"soul_fire_1",row:12}));
});
it("automatically refines matching suggestions when mask changes are allowed",async()=>{
  const refined={...best,quad:[[.01,0],[1,0],[1,1],[.01,1]] as ManualQuad};
  vi.mocked(refineMatchCandidates).mockResolvedValue([refined]);
  const preview=vi.fn();(buttons(render("frame-auto",preview))[0].props.onClick as ()=>void)();pending.get("frame-auto")!.onload?.();await settle();
  expect(refineMatchCandidates).toHaveBeenCalledWith("frame-auto",[best],"normal",expect.any(AbortSignal));
  expect(preview).toHaveBeenCalledExactlyOnceWith(refined);
});
it("does not run automatic ECC when mask changes are off",async()=>{
  const preview=vi.fn();adjustment(render("frame-fixed",preview))!.props.onChange({target:{checked:false}});
  (buttons(render("frame-fixed",preview))[0].props.onClick as ()=>void)();pending.get("frame-fixed")!.onload?.();await settle();
  expect(refineMatchCandidates).not.toHaveBeenCalled();expect(preview).toHaveBeenCalledExactlyOnceWith(best);
});
it("discards a late refinement after navigating away",async()=>{
  let finish!:(value:QuadCandidate[])=>void;
  vi.mocked(refineMatchCandidates).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const preview=vi.fn();(buttons(render("frame-old",preview))[0].props.onClick as ()=>void)();pending.get("frame-old")!.onload?.();await settle();
  expect(finish).toBeTypeOf("function");render("frame-new",preview);finish([best]);await settle();expect(preview).not.toHaveBeenCalled();
});
it("uses original pixels and disposes their temporary URL after refinement",async()=>{
  const preview=vi.fn(),dispose=vi.fn(),source=vi.fn(async()=>({url:"frame-original",dispose}));
  (buttons(render("frame-enhanced",preview,false,undefined,"normal",source))[0].props.onClick as ()=>void)();await settle();
  expect(pending.has("frame-enhanced")).toBe(false);pending.get("frame-original")!.onload?.();await settle();
  expect(refineMatchCandidates).toHaveBeenCalledWith("frame-original",[best],"normal",expect.any(AbortSignal));expect(dispose).toHaveBeenCalledOnce();
});
it("discards an in-flight normal match when the same frame switches to soul fire",async()=>{
  const preview=vi.fn();(buttons(render("frame-switch",preview))[0].props.onClick as ()=>void)();
  render("frame-switch",preview,false,undefined,"soul");pending.get("frame-switch")!.onload?.();await settle();
  expect(matchFireQuad).not.toHaveBeenCalled();expect(preview).not.toHaveBeenCalled();
});

it("previews a clear match only after original image decoding completes",async()=> {
  const preview=vi.fn();(buttons(render("frame-a",preview))[0].props.onClick as ()=>void)();
  expect(preview).not.toHaveBeenCalled();
  expect(adjustment(render("frame-a",preview))!.props.checked).toBe(true);
  pending.get("frame-a")!.onload?.();await settle();
  expect(preview).toHaveBeenCalledExactlyOnceWith(best);
  expect(matchFireQuad).toHaveBeenCalledWith(expect.anything(),expect.anything(),q,{refineGeometry:true});
});
it("discards a result if the user navigates to another frame while it loads",async()=> {
  const preview=vi.fn();(buttons(render("frame-a",preview))[0].props.onClick as ()=>void)();
  render("frame-b",preview);pending.get("frame-a")!.onload?.();await settle();
  expect(matchFireQuad).not.toHaveBeenCalled();expect(preview).not.toHaveBeenCalled();
});
it("leaves ambiguous matches untouched until a candidate is explicitly clicked",async()=> {
  vi.mocked(matchFireQuad).mockReturnValue({status:"ambiguous",candidates:[best],margin:0.01,searched:128});
  const preview=vi.fn();(buttons(render("frame-a",preview))[0].props.onClick as ()=>void)();
  pending.get("frame-a")!.onload?.();await settle();expect(preview).not.toHaveBeenCalled();
  const candidates=buttons(render("frame-a",preview));
  expect(candidates[1].props.children).toBe(1);
  expect(candidates[1].props["aria-label"]).toContain("row 12 · sheet 1 · mirrored");
  expect(candidates[1].props.title).toBeUndefined();
  expect(candidates[candidates.length-1].props.title).toBeUndefined();
  expect(candidates[1].props.onMouseEnter).toBeTypeOf("function");
  expect(candidates[1].props.onFocus).toBeTypeOf("function");
  const tip={showPopover:vi.fn(),hidePopover:vi.fn(),style:{} as Record<string,string>,getBoundingClientRect:()=>({width:360,height:160})};
  const event={currentTarget:{nextElementSibling:tip,getBoundingClientRect:()=>({left:980,top:620,bottom:650})}};
  (candidates[1].props.onMouseEnter as (event:unknown)=>void)(event);
  expect(tip.showPopover).toHaveBeenCalledOnce();
  expect(tip.style).toEqual({left:"632px",top:"454px"});
  (candidates[1].props.onMouseLeave as (event:unknown)=>void)(event);
  expect(tip.hidePopover).toHaveBeenCalledOnce();
  (candidates[1].props.onClick as ()=>void)();expect(preview).toHaveBeenCalledExactlyOnceWith(best);
});
it("discards an in-flight result if the source frame becomes unavailable",async()=> {
  const preview=vi.fn();(buttons(render("frame-a",preview))[0].props.onClick as ()=>void)();
  render("frame-a",preview,true);pending.get("frame-a")!.onload?.();await settle();
  expect(preview).not.toHaveBeenCalled();expect(matchFireQuad).not.toHaveBeenCalled();
});
it("can disable default-on geometry adjustment to keep corners fixed",async()=> {
  const preview=vi.fn();
  adjustment(render("frame-a",preview))!.props.onChange({target:{checked:false}});
  (buttons(render("frame-a",preview))[0].props.onClick as ()=>void)();
  pending.get("frame-a")!.onload?.();await settle();
  expect(matchFireQuad).toHaveBeenCalledWith(expect.anything(),expect.anything(),q,{refineGeometry:false});
  expect(preview).toHaveBeenCalledExactlyOnceWith(best);
});
it("discards an in-flight match when geometry adjustment mode changes",async()=> {
  const preview=vi.fn();
  (buttons(render("frame-a",preview))[0].props.onClick as ()=>void)();
  adjustment(render("frame-a",preview))!.props.onChange({target:{checked:false}});
  render("frame-a",preview);
  pending.get("frame-a")!.onload?.();await settle();
  expect(matchFireQuad).not.toHaveBeenCalled();expect(preview).not.toHaveBeenCalled();
});
it.each([true,false])("uses current atlas filters only when selected (%s)",async enabled=> {
  const preview=vi.fn(),filter={left:3,right:7};
  const ui=render("frame-a",preview,false,filter);
  expect(adjustment(ui,"Only filtered sprites")!.props.checked).toBe(true);
  if(!enabled)adjustment(ui,"Only filtered sprites")!.props.onChange({target:{checked:false}});
  (buttons(render("frame-a",preview,false,filter))[0].props.onClick as ()=>void)();
  pending.get("frame-a")!.onload?.();await settle();
  expect(matchFireQuad).toHaveBeenCalledWith(expect.anything(),expect.anything(),q,enabled?{refineGeometry:true,filter}:{refineGeometry:true});
});
it("discards matches when an active atlas filter changes during decoding",async()=> {
  const preview=vi.fn();
  (buttons(render("frame-a",preview,false,{left:3,right:null}))[0].props.onClick as ()=>void)();
  render("frame-a",preview,false,{left:4,right:null});
  pending.get("frame-a")!.onload?.();await settle();
  expect(matchFireQuad).not.toHaveBeenCalled();expect(preview).not.toHaveBeenCalled();
});

it("runs fitting in a worker and discards a completed old-frame result",async()=>{
  const workers: {onmessage:((e:unknown)=>void)|null;terminate:ReturnType<typeof vi.fn>;postMessage:ReturnType<typeof vi.fn>}[]=[];
  class WorkerMock{
    onmessage:((e:unknown)=>void)|null=null;onerror=null;terminate=vi.fn();postMessage=vi.fn();
    constructor(){workers.push(this);}
  }
  vi.stubGlobal("Worker",WorkerMock);
  const preview=vi.fn();(buttons(render("frame-a",preview))[0].props.onClick as ()=>void)();
  pending.get("frame-a")!.onload?.();await settle();
  expect(workers).toHaveLength(1);
  expect(workers[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({options:{refineGeometry:true}}),expect.any(Array));
  expect(matchFireQuad).not.toHaveBeenCalled();
  render("frame-b",preview);
  workers[0].onmessage?.({data:{result:{status:"clear",candidates:[best],margin:.1,searched:128}}});
  await settle();expect(preview).not.toHaveBeenCalled();expect(workers[0].terminate).toHaveBeenCalled();
});
