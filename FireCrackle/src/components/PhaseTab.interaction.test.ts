import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { Flag, Backend, View } from "../lib/api";
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0,refs:[] as any[],refCursor:0,effects:[] as Array<()=>any>}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),
  useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=typeof initial==="function"?initial():initial;return [hooks.values[i],(next:any)=>{hooks.values[i]=typeof next==="function"?next(hooks.values[i]):next;}];},
  useRef:(initial:any)=>hooks.refs[hooks.refCursor++]??={current:initial},
  useEffect:(fn:()=>any)=>{hooks.effects.push(fn);},
  useMemo:(fn:()=>any)=>fn(),
}));
vi.mock("../hooks/useWheel",()=>({useWheel:()=>{}}));
import { PhaseTab } from "./PhaseTab";
import { FlagsPanel } from "./FlagsPanel";
type Element=ReactElement<Record<string,any>>;
const flag:Flag={frame:800,end_frame:820,severity:"hard",kind:"phase_shift",phase_delta:5};
const jump=vi.fn();
function all(node:any,predicate:(e:Element)=>boolean):Element[] {
  if(Array.isArray(node))return node.flatMap(n=>all(n,predicate));
  if(!node||typeof node!=="object"||!("props" in node))return [];
  return [...(predicate(node)?[node]:[]),...all(node.props.children,predicate)];
}
function render(){hooks.cursor=hooks.refCursor=0;hooks.effects=[];return PhaseTab({backend:{} as Backend,view:{fps:60,frame_count:1000,current:20} as View,version:0,onJump:jump});}
function flags(root:Element){return all(root,e=>e.type===FlagsPanel)[0];}
beforeEach(()=>{jump.mockClear();hooks.refs=[];hooks.values=[{points:[{frame:800,pts:800/60,phase:0,step:1}],runs:[],flags:[flag],tick_rate:20,window_ticks:1},null,null,null,null,{version:1,data:null,clock:"video",session:""},{start:0,pxPerFrame:5}];});
afterEach(()=>vi.unstubAllGlobals());

it("draws a visible highlight on both canvases for the hovered flag",()=>{
  hooks.values[3]=flag;
  hooks.values[6]={start:0,pxPerFrame:1};
  render();
  vi.stubGlobal("window",{devicePixelRatio:1});
  vi.stubGlobal("ResizeObserver",class {observe(){} disconnect(){}});
  const contexts=[0,1].map(()=>({setTransform:vi.fn(),clearRect:vi.fn(),fillRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),fillText:vi.fn(),strokeRect:vi.fn()}));
  contexts.forEach((ctx,i)=>{hooks.refs[i].current={clientWidth:1000,clientHeight:260,getContext:()=>ctx};});
  const stop=hooks.effects[3]();
  for(const ctx of contexts){
    expect(ctx.strokeRect).toHaveBeenCalledOnce();
    const [x,,width]=ctx.strokeRect.mock.calls[0] as number[];
    expect(x).toBeGreaterThan(0);expect(x+width).toBeLessThan(1000);
  }
  stop();
});

it("hovering an offscreen flag never moves or zooms either chart",()=>{
  let root=render();const original=hooks.values[6];
  const rangeLabel=(node:Element)=>all(node,e=>e.props.className==="timeline-controls")[0].props.children[3].props.children;
  const label=rangeLabel(root);
  flags(root).props.onHover(flag);root=render();
  expect(hooks.values[6]).toBe(original);
  expect(all(root,e=>e.props.className==="chart-hover")[0].props.children).toContain("Flag frame 800–820");
  expect(rangeLabel(root)).toEqual(label);
  flags(root).props.onHover(null);root=render();
  expect(rangeLabel(root)).toEqual(label);
  expect(jump).not.toHaveBeenCalled();
});

it("plain flag selection focuses charts and only Ctrl selection opens video",()=>{
  let root=render();flags(root).props.onSelect(flag,false);root=render();
  expect(jump).not.toHaveBeenCalled();
  expect(hooks.values[6].start).toBeLessThan(800);
  expect(hooks.values[6].start+1000/hooks.values[6].pxPerFrame).toBeGreaterThan(820);
  expect(flags(root).props.current).toBe(800);
  flags(root).props.onSelect(flag,true);
  expect(jump).toHaveBeenCalledExactlyOnceWith(800);
});

it("focuses flags in corrected seconds while Ctrl-click keeps the original video frame",()=>{
  hooks.values[5]={version:1,clock:"jolt",session:'["1","1"]',data:{name:"test",version:"2.3",source:"",unresolved:0,anchors:[{time:10,tick:100,game:"1",screen:"1",segment:"0"},{time:20,tick:300,game:"1",screen:"1",segment:"0"}]}};
  let root=render();flags(root).props.onSelect(flag,false);root=render();
  const viewport=hooks.values[6],correctedFrame=(800/60-10)*60;
  expect(viewport.start).toBeLessThan(correctedFrame);
  expect(viewport.start+1000/viewport.pxPerFrame).toBeGreaterThan(correctedFrame);
  flags(root).props.onSelect(flag,true);
  expect(jump).toHaveBeenCalledExactlyOnceWith(800);
});

it("flag rows forward hover, focus and the actual Ctrl-click modifier",()=>{
  const onSelect=vi.fn(),onHover=vi.fn(),onSeek=vi.fn();
  const root=FlagsPanel({flags:[flag],fps:60,current:0,onSeek,onSelect,onHover});
  const button=all(root,e=>e.type==="button")[0];
  button.props.onMouseEnter();button.props.onMouseLeave();button.props.onFocus();button.props.onBlur();
  expect(onHover.mock.calls).toEqual([[flag],[null],[flag],[null]]);
  button.props.onClick({ctrlKey:false});button.props.onClick({ctrlKey:true});
  expect(onSelect.mock.calls).toEqual([[flag,false],[flag,true]]);
  expect(onSeek).not.toHaveBeenCalled();
});

it("plain chart clicks stay in Phase and Ctrl-click opens the flag frame",()=>{
  let root=render();
  const event=(ctrlKey:boolean)=>({button:0,pointerId:1,clientX:810,ctrlKey,preventDefault:vi.fn(),currentTarget:{setPointerCapture:vi.fn(),getBoundingClientRect:()=>({left:0,width:1000})}});
  // Initially zoomed away; display the full clip for this pointer test.
  hooks.values[6]={start:0,pxPerFrame:1};root=render();
  let canvas=all(root,e=>e.type==="canvas")[0];
  canvas.props.onPointerDown(event(false));canvas.props.onPointerUp(event(false));
  expect(jump).not.toHaveBeenCalled();
  hooks.values[6]={start:0,pxPerFrame:1};root=render();canvas=all(root,e=>e.type==="canvas")[0];
  canvas.props.onPointerDown(event(true));canvas.props.onPointerUp(event(true));
  expect(jump).toHaveBeenCalledExactlyOnceWith(800);
});

it("suppresses native dragging and pans either linked chart without selecting a point",()=>{
  for(const index of [0,1]) {
    hooks.values[6]={start:100,pxPerFrame:5};
    const root=render(),canvas=all(root,e=>e.type==="canvas")[index];
    const event=(clientX:number,button=0)=>({clientX,button,pointerId:7,preventDefault:vi.fn(),currentTarget:{setPointerCapture:vi.fn(),getBoundingClientRect:()=>({left:0,width:1000})}});
    const down=event(100);
    canvas.props.onPointerDown(down);
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(down.currentTarget.setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    canvas.props.onPointerMove(event(150));
    expect(hooks.values[6]).toEqual({start:90,pxPerFrame:5});
    canvas.props.onPointerUp(event(150));
    expect(hooks.values[4]).toBeNull();
    canvas.props.onPointerMove(event(300));
    expect(hooks.values[6]).toEqual({start:90,pxPerFrame:5});
    expect(canvas.props.draggable).toBe(false);
    const nativeDrag={preventDefault:vi.fn()};
    canvas.props.onDragStart(nativeDrag);
    expect(nativeDrag.preventDefault).toHaveBeenCalledOnce();
  }
  expect(jump).not.toHaveBeenCalled();
});

it("clears cancelled captures and ignores non-primary chart drags",()=>{
  hooks.values[6]={start:100,pxPerFrame:5};
  const canvas=all(render(),e=>e.type==="canvas")[0];
  const event={clientX:100,button:0,pointerId:7,preventDefault:vi.fn(),currentTarget:{setPointerCapture:vi.fn(),getBoundingClientRect:()=>({left:0,width:1000})}};
  for(const end of ['onPointerCancel','onLostPointerCapture']) {
    canvas.props.onPointerDown(event);canvas.props[end]();
    canvas.props.onPointerMove({...event,clientX:150});canvas.props.onPointerUp(event);
    expect(hooks.values[6]).toEqual({start:100,pxPerFrame:5});
    expect(hooks.values[4]).toBeNull();
  }
  const right={...event,button:2,preventDefault:vi.fn(),currentTarget:{...event.currentTarget,setPointerCapture:vi.fn()}};
  canvas.props.onPointerDown(right);canvas.props.onPointerMove({...right,clientX:200});
  expect(right.preventDefault).not.toHaveBeenCalled();
  expect(right.currentTarget.setPointerCapture).not.toHaveBeenCalled();
  expect(hooks.values[6]).toEqual({start:100,pxPerFrame:5});
  expect(jump).not.toHaveBeenCalled();
});
