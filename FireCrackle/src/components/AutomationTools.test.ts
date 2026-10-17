import {beforeEach,afterEach,expect,it,vi} from "vitest";
import type {ReactElement} from "react";
import type {Backend,PovStatus} from "../lib/api";
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),useEffect:()=>{},useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=initial;return [hooks.values[i],(v:any)=>{hooks.values[i]=v;}];}}));
import {AutomationTools} from "./AutomationTools";
type Element=ReactElement<Record<string,any>>;
function find(node:any,text:string):Element|undefined{if(Array.isArray(node))return node.map(n=>find(n,text)).find(Boolean);if(!node||typeof node!=="object"||!node.props)return;if(node.type==="button"&&node.props.children===text)return node;return find(node.props.children,text);}
const status:PovStatus={id:2,video_path:"v.mkv",state:"done",processed:100,total:100,accepted:4,applied:0,error:null};
const start=vi.fn(),cancel=vi.fn(),apply=vi.fn(),noFireStart=vi.fn(),noFireCancel=vi.fn(),review=vi.fn(),guiSet=vi.fn();
function render(){hooks.cursor=0;return AutomationTools({backend:{povStart:start,povStatus:async()=>hooks.values[0],povCancel:cancel,noFireStart,noFireCancel,noFireStatus:async()=>hooks.values[3],guiAnswerGet:async()=>null,guiAnswerSet:guiSet} as unknown as Backend,videoPath:"v.mkv",onApply:apply,onReview:review,onClose:vi.fn()});}
beforeEach(()=>{hooks.values=[];for(const mock of [start,cancel,apply,noFireStart,noFireCancel,review,guiSet])mock.mockReset();});
afterEach(()=>vi.unstubAllGlobals());
it("never starts scanning until explicitly requested",async()=>{const root=render();expect(start).not.toHaveBeenCalled();start.mockResolvedValue(status);find(root,"Scan video")!.props.onClick();for(let i=0;i<10;i++)await Promise.resolve();expect(start).toHaveBeenCalledOnce();expect(apply).not.toHaveBeenCalled();});
it("requires explicit apply and can cancel running work",async()=>{hooks.values=[status,null,false];let root=render();expect(apply).not.toHaveBeenCalled();find(root,"Apply accepted matches")!.props.onClick();for(let i=0;i<10;i++)await Promise.resolve();expect(apply).toHaveBeenCalledExactlyOnceWith(2);hooks.values=[{...status,state:"running"},null,false];root=render();expect(find(root,"Apply accepted matches")).toBeUndefined();find(root,"Cancel scan")!.props.onClick();expect(cancel).toHaveBeenCalledExactlyOnceWith(2);});
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
  find(render(),"Cancel no-fire scan")!.props.onClick();expect(noFireCancel).toHaveBeenCalledExactlyOnceWith(2);
});
