import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { Backend } from "../lib/api";
import { EMPTY_JOLT, parseJolt, sessionOf, type JoltState } from "../lib/jolt";
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0,refs:[] as any[],refCursor:0,effects:[] as Array<()=>any>}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),
  useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=typeof initial==="function"?initial():initial;return [hooks.values[i],(next:any)=>{hooks.values[i]=typeof next==="function"?next(hooks.values[i]):next;}];},
  useRef:(initial:any)=>hooks.refs[hooks.refCursor++]??={current:initial},
  useEffect:(fn:()=>any)=>{hooks.effects.push(fn);},
  useMemo:(fn:()=>any)=>fn(),
}));
import { JoltPanel } from "./JoltPanel";
type Element=ReactElement<Record<string,any>>;
function all(node:any,predicate:(e:Element)=>boolean):Element[]{
  if(Array.isArray(node))return node.flatMap(n=>all(n,predicate));
  if(!node||typeof node!=="object"||!("props" in node))return [];
  return [...(predicate(node)?[node]:[]),...all(node.props.children,predicate)];
}
const change=vi.fn(),focus=vi.fn();
const data=parseJolt('{"anchors":[{"time":1,"tick":10},{"time":2,"tick":30}]}',"test.json");
const state:JoltState={version:1,data,clock:"jolt",session:sessionOf(data.anchors[0])};
function render(backend:Partial<Backend>,videoKey="video.mp4",value=state){hooks.cursor=hooks.refCursor=0;hooks.effects=[];return JoltPanel({backend:backend as Backend,videoKey,state:value,onChange:change,matched:2,t0:0,t1:3,onFocus:focus});}
beforeEach(()=>{hooks.values=[null,false];hooks.refs=[];change.mockClear();focus.mockClear();});
it("loads persisted evidence for the current video and clears previous evidence first",async()=>{
  const read=vi.fn().mockResolvedValue(JSON.stringify(state));render({joltRead:read});hooks.effects[0]();
  expect(change).toHaveBeenCalledWith(EMPTY_JOLT);
  await vi.waitFor(()=>expect(change).toHaveBeenCalledWith(state));
  expect(read).toHaveBeenCalledWith("video.mp4");
});
it("switches clocks only after persistence succeeds; failure keeps the selected clock",async()=>{
  const write=vi.fn().mockRejectedValue(Error("disk unavailable"));
  const root=render({joltWrite:write});
  all(root,e=>e.type==="button"&&e.props.children==="Video time")[0].props.onClick();
  await vi.waitFor(()=>expect(hooks.values[0]).toContain("disk unavailable"));
  expect(change).not.toHaveBeenCalled();
  expect(write.mock.calls[0][0]).toBe("video.mp4");
});
it("stale project loads never leak into a newly opened video",async()=>{
  let resolve!:(value:string)=>void;
  render({joltRead:()=>new Promise<string>(r=>resolve=r)});const stop=hooks.effects[0]();stop();
  resolve(JSON.stringify(state));await Promise.resolve();await Promise.resolve();
  expect(change).toHaveBeenCalledTimes(1); // the deliberate EMPTY reset only
});
it("uses Jolt as a time reference without a separate plotted signal",()=>{
  const root=render({});
  expect(all(root,e=>e.type==="svg")).toHaveLength(0);
  expect(all(root,e=>e.type==="button"&&e.props.children==="Corrected time (Jolt)")).toHaveLength(1);
});
