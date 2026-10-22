import {beforeEach,afterEach,expect,it,vi} from "vitest";
import type {ReactElement} from "react";
import type {Backend,PovStatus} from "../lib/api";
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),useEffect:()=>{},useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=initial;return [hooks.values[i],(v:any)=>{hooks.values[i]=v;}];}}));
import {AutomationTools} from "./AutomationTools";
import {ScanProgressStats} from "./ScanProgressStats";
import {povScanProgress} from "../lib/scanSpeed";
type Element=ReactElement<Record<string,any>>;
function find(node:any,text:string):Element|undefined{if(Array.isArray(node))return node.map(n=>find(n,text)).find(Boolean);if(!node||typeof node!=="object"||!node.props)return;if(node.type==="button"&&node.props.children===text)return node;return find(node.props.children,text);}
const status:PovStatus={id:2,video_path:"v.mkv",state:"done",processed:100,total:100,accepted:4,applied:0,error:null};
const start=vi.fn(),cancel=vi.fn(),apply=vi.fn(),noFireStart=vi.fn(),noFireCancel=vi.fn(),review=vi.fn(),guiSet=vi.fn();
function render(){hooks.cursor=0;return AutomationTools({backend:{povStart:start,povStatus:async()=>hooks.values[0],povCancel:cancel,noFireStart,noFireCancel,noFireStatus:async()=>hooks.values[3],guiAnswerGet:async()=>null,guiAnswerSet:guiSet} as unknown as Backend,videoPath:"v.mkv",onApply:apply,onReview:review,onClose:vi.fn()});}
beforeEach(()=>{hooks.values=[];for(const mock of [start,cancel,apply,noFireStart,noFireCancel,review,guiSet])mock.mockReset();});
afterEach(()=>vi.unstubAllGlobals());
it("never starts scanning until explicitly requested",async()=>{const root=render();expect(start).not.toHaveBeenCalled();start.mockResolvedValue(status);find(root,"Scan video")!.props.onClick();for(let i=0;i<10;i++)await Promise.resolve();expect(start).toHaveBeenCalledOnce();expect(apply).not.toHaveBeenCalled();});
it("requires explicit apply and can cancel running work",async()=>{hooks.values=[status,null,false];let root=render();expect(apply).not.toHaveBeenCalled();find(root,"Apply accepted matches")!.props.onClick();for(let i=0;i<10;i++)await Promise.resolve();expect(apply).toHaveBeenCalledExactlyOnceWith(2);hooks.values=[{...status,state:"running"},null,false];root=render();expect(find(root,"Apply accepted matches")).toBeUndefined();find(root,"Pause scan")!.props.onClick();expect(cancel).toHaveBeenCalledExactlyOnceWith(2);});
it("does not offer applying failed or cancelled partial results",()=>{for(const state of ["failed","cancelled"]){hooks.values=[{...status,state},null,false];expect(find(render(),"Apply accepted matches")).toBeUndefined();}});
it("no-fire scanning starts on click without GUI confirmation or stored answers",async()=>{
  const root=render();expect(find(root,"Scan & label no fire")!.props.disabled).toBe(false);expect(noFireStart).not.toHaveBeenCalled();
  noFireStart.mockResolvedValue({...status,state:"running"});find(root,"Scan & label no fire")!.props.onClick();
  for(let i=0;i<15;i++)await Promise.resolve();
  expect(guiSet).not.toHaveBeenCalled();expect(noFireStart).toHaveBeenCalledOnce();expect(apply).not.toHaveBeenCalled();
});
it("reviews the original candidate frame and cancels without saving labels",async()=>{
  render();hooks.values[3]=status;hooks.values[7]=[1920,2400];hooks.values[8]=1;
  find(render(),"Review frame")!.props.onClick();expect(review).toHaveBeenCalledExactlyOnceWith(2400);expect(apply).not.toHaveBeenCalled();
  hooks.values[3]={...status,state:"running"};noFireCancel.mockResolvedValue(undefined);
  find(render(),"Pause no-fire scan")!.props.onClick();expect(noFireCancel).toHaveBeenCalledExactlyOnceWith(2);
});
it("identifies the AI no-fire tool and keeps benchmark denominators explicit",()=>{
  const text=JSON.stringify(render());
  expect(text).toContain('AI no-fire');
  expect(text).toContain('8,908');
  expect(text).toContain('10,645');
  expect(text).toContain('7.58%');
});

it("restores paused scan progress and resumes without automatically starting on render",async()=>{
  hooks.values=[{...status,state:"cancelled",processed:40},null,false,{...status,state:"cancelled",processed:60},null,false];
  let root=render();
  expect(start).not.toHaveBeenCalled();expect(noFireStart).not.toHaveBeenCalled();
  expect(find(root,"Resume scan")).toBeDefined();expect(find(root,"Resume no-fire scan")).toBeDefined();
  start.mockResolvedValue({...status,state:"running",processed:40});
  find(root,"Resume scan")!.props.onClick();for(let i=0;i<10;i++)await Promise.resolve();
  expect(start).toHaveBeenCalledOnce();
  hooks.values[0]=null;root=render();noFireStart.mockResolvedValue({...status,state:"running",processed:60});
  find(root,"Resume no-fire scan")!.props.onClick();for(let i=0;i<10;i++)await Promise.resolve();
  expect(noFireStart).toHaveBeenCalledOnce();
});
it("keeps completed cached results available for applying and review without rerunning detection",()=>{
  hooks.values=[status,null,false,status,null,false,0,[1920],0];
  const root=render();
  expect(find(root,"Results cached")!.props.disabled).toBe(true);
  expect(find(root,"Apply cached no-fire")!.props.disabled).toBe(false);
  expect(find(root,"Apply accepted matches")).toBeDefined();expect(find(root,"Review frame")).toBeDefined();
  expect(start).not.toHaveBeenCalled();expect(noFireStart).not.toHaveBeenCalled();
});

it("shows independent live speed and ETA for running scans only",()=>{
  function stats(node:any):Element[]{
    if(Array.isArray(node))return node.flatMap(stats);
    if(!node||typeof node!=="object"||!node.props)return [];
    return node.type===ScanProgressStats?[node]:stats(node.props.children);
  }
  const first={...status,state:"running" as const,processed:40};
  const second={...first,id:3,processed:60};
  hooks.values=[first,null,false,second,null,false];
  expect(stats(render()).map(node=>node.props.progress)).toEqual([povScanProgress(first),povScanProgress(second)]);
  for(const state of ["cancelled","done","failed","saving"]){
    hooks.values=[{...status,state},null,false,{...status,state},null,false];
    expect(stats(render())).toEqual([]);
  }
});

it("labels a first-person scan that is saving as saving, not failed",()=>{
  hooks.values=[{...status,state:"saving"},null,false];
  expect(JSON.stringify(render())).toContain("Saving labels");
  expect(JSON.stringify(render())).not.toContain("Scan failed");
});
it("pausing the no-fire scan blocks a second click and refreshes its status",async()=>{
  hooks.values=[null,null,false,{...status,state:"running"},null,false];
  let resolve!:()=>void;noFireCancel.mockReturnValue(new Promise<void>(r=>{resolve=r;}));
  find(render(),"Pause no-fire scan")!.props.onClick();
  expect(find(render(),"Pause no-fire scan")!.props.disabled).toBe(true);
  resolve();for(let i=0;i<10;i++)await Promise.resolve();
  expect(find(render(),"Pause no-fire scan")!.props.disabled).toBe(false);
});
