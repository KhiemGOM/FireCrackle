import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { appearanceId } from "../lib/atlasFilter";
import type { PreviewSprite } from "../lib/firePreview";
const hooks=vi.hoisted(()=>({states:[] as any[],refs:[] as any[],effects:[] as any[],pending:[] as Array<()=>void>,si:0,ri:0,ei:0,dirty:false}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),
  useState:(initial:unknown)=>{const i=hooks.si++;if(!(i in hooks.states))hooks.states[i]=initial;return [hooks.states[i],(next:any)=>{const value=typeof next==="function"?next(hooks.states[i]):next;if(!Object.is(value,hooks.states[i])){hooks.states[i]=value;hooks.dirty=true;}}];},
  useRef:(initial:unknown)=>hooks.refs[hooks.ri++]??={current:initial},
  useEffect:(setup:()=>unknown,deps:unknown[])=>{const i=hooks.ei++,old=hooks.effects[i];if(old&&deps.every((d,j)=>Object.is(d,old.deps[j])))return;hooks.pending.push(()=>{old?.cleanup?.();hooks.effects[i]={deps,cleanup:setup()};});},
}));
import { AnimationControls } from "./AnimationControls";
type Element=ReactElement<Record<string,any>>;
function find(node:Element,label:string):Element {
  if(node.props.label===label||node.props["aria-label"]===label)return node;
  for(const child of [node.props.children].flat(Infinity))if(child&&typeof child==="object"&&"props" in child){const value=find(child,label);if(value)return value;}
  return undefined as unknown as Element;
}
let current:PreviewSprite;
let props:Omit<Parameters<typeof AnimationControls>[0],"current"|"onPreview"|"onStart">;
const onPreview=vi.fn((sprite:PreviewSprite)=>{current=sprite;}),onStart=vi.fn();
function render(overrides:Partial<typeof props>={}) {
  props={...props,...overrides};
  let root:Element;
  do {hooks.dirty=false;hooks.si=hooks.ri=hooks.ei=0;hooks.pending=[];root=AnimationControls({...props,current,onPreview,onStart});hooks.pending.forEach(run=>run());} while(hooks.dirty);
  return root!;
}
function play(){find(render(),"Play sprite animation").props.onClick();return render();}
beforeEach(()=>{
  hooks.states=[];hooks.refs=[];hooks.effects=[];hooks.pending=[];current={sheet:0,row:0,mirrored:false};
  props={edges:null,frame:10,stopToken:0,disabled:false};onPreview.mockClear();onStart.mockClear();
  vi.useFakeTimers();vi.stubGlobal("window",{setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval});
});
afterEach(()=>{hooks.effects.forEach(e=>e?.cleanup?.());vi.useRealTimers();vi.unstubAllGlobals();});
it("loops through all128 appearances and pauses without writing labels",()=>{
  play();expect(onStart).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(250*128);
  expect(onPreview).toHaveBeenCalledTimes(128);
  expect(new Set(onPreview.mock.calls.map(([s])=>appearanceId(s.sheet,s.row,s.mirrored))).size).toBe(128);
  expect(current).toEqual({sheet:0,row:0,mirrored:false});
  find(render(),"Pause sprite animation").props.onClick();render();
  vi.advanceTimersByTime(1000);expect(onPreview).toHaveBeenCalledTimes(128);
});
it("uses variable delay and stops after frame changes or external sprite selection",()=>{
  find(render(),"Sprite animation delay in milliseconds").props.onChange({target:{valueAsNumber:120}});
  play();vi.advanceTimersByTime(119);expect(onPreview).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);expect(onPreview).toHaveBeenCalledOnce();
  render({frame:11});vi.advanceTimersByTime(1000);expect(onPreview).toHaveBeenCalledOnce();
  play();render({stopToken:1});vi.advanceTimersByTime(1000);expect(onPreview).toHaveBeenCalledOnce();
});
it("filtered-only skips manual exclusions and all mode includes them again",()=>{
  const excluded=Array.from({length:128},(_,i)=>i).filter(i=>i!==0&&i!==2);
  render({filter:{left:null,right:null,excluded}});play();
  vi.advanceTimersByTime(250);expect(current.row).toBe(2);
  vi.advanceTimersByTime(250);expect(current.row).toBe(0);
  find(render(),"Animate filtered sprites only").props.onChange({target:{checked:false}});render();
  vi.advanceTimersByTime(250);expect(current.row).toBe(1);
});
it("does not start a timer for an empty pool or run automatically on mount",()=>{
  let root=render();vi.advanceTimersByTime(1000);expect(onPreview).not.toHaveBeenCalled();
  root=render({filter:{left:null,right:null,excluded:Array.from({length:128},(_,i)=>i)}});
  expect(find(root,"Play sprite animation").props.disabled).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["lava_still", "lava_flow", "water_still", "water_flow", "soul_fire_0"] as const)("animates %s without fire filters and stops on source change", atlas => {
  current = {atlas, sheet: atlas.endsWith("_still") || atlas.endsWith("_0") ? 0 : 1, row: 0, mirrored: false};
  const root = render({filter: {left: 99, right: 99}});
  expect(find(root, "Animate filtered sprites only")).toBeUndefined();
  play();
  for (let i = 0; i < 140; i++) { vi.advanceTimersByTime(250); render(); }
  expect(onPreview).toHaveBeenCalledTimes(140);
  expect(onPreview.mock.calls.every(([s]) => s.atlas?.startsWith(atlas.startsWith("soul") ? "soul_fire" : atlas))).toBe(true);
  current = {atlas: "water_still", sheet: 0, row: 0, mirrored: false};
  if (atlas === "water_still") current.atlas = "lava_still";
  render(); vi.advanceTimersByTime(1000);
  expect(onPreview).toHaveBeenCalledTimes(140);
});
