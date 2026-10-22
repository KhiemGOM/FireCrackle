import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { Backend, LinkStatus } from "../lib/api";
const hooks=vi.hoisted(()=>({states:[] as any[],refs:[] as any[],cursor:0,refCursor:0,effect:null as null|(()=>()=>void)}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),
  useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.states))hooks.states[i]=initial;return[hooks.states[i],(v:any)=>{hooks.states[i]=typeof v==="function"?v(hooks.states[i]):v;}];},
  useRef:(initial:any)=>hooks.refs[hooks.refCursor++]??={current:initial},useEffect:(fn:any)=>{hooks.effect=fn;},
}));
import { OpenLink } from "./OpenLink";
type Element=ReactElement<Record<string,any>>;
function find(node:Element,test:(e:Element)=>boolean):Element|undefined{if(test(node))return node;for(const child of [node.props.children].flat(Infinity))if(child&&typeof child==="object"&&"props"in child){const match=find(child,test);if(match)return match;}}
const onOpen=vi.fn(async()=>{}),onClose=vi.fn();
let current:LinkStatus|null,cleanup:(()=>void)|undefined;
const backend={mock:false,pickDownloadFolder:vi.fn(async()=>"D:/videos"),linkStart:vi.fn(async()=>current={id:7,state:"running",message:"Downloading",path:null,error:null}),linkStatus:vi.fn(async()=>current),linkCancel:vi.fn(async()=>{})} as unknown as Backend;
function render(){hooks.cursor=hooks.refCursor=0;return OpenLink({backend,initialUrl:"https://youtu.be/example",onOpen,onClose}) as Element;}
async function flush(){await Promise.resolve();await Promise.resolve();await Promise.resolve();}
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();hooks.states=[];hooks.refs=[];current=null;cleanup=undefined;});
afterEach(()=>{cleanup?.();vi.useRealTimers();});
it("chooses a destination, starts one job, opens its completed video once",async()=>{
  let tree=render();cleanup=hooks.effect!();await flush();
  await find(tree,e=>e.type==="button"&&e.props.children==="Download and open")!.props.onClick();await flush();tree=render();
  expect(backend.linkStart).toHaveBeenCalledWith("https://youtu.be/example","D:/videos");
  expect(find(tree,e=>e.type==="button"&&e.props.children==="Download and open")!.props.disabled).toBe(true);
  find(tree,e=>e.type==="button"&&e.props.children==="Cancel download")!.props.onClick();expect(backend.linkCancel).toHaveBeenCalledWith(7);
  current={id:7,state:"done",message:"Done",path:"D:/videos/fire.mkv",error:null};await vi.advanceTimersByTimeAsync(1500);
  expect(onOpen).toHaveBeenCalledExactlyOnceWith("D:/videos/fire.mkv");
});
it("does not reopen an old completed job when the dialog opens",async()=>{
  current={id:3,state:"done",message:"Done",path:"old.mkv",error:null};render();cleanup=hooks.effect!();await flush();expect(onOpen).not.toHaveBeenCalled();
});
it("keeps invalid schemes away from the downloader and isolates Enter",async()=>{
  let tree=render();find(tree,e=>e.type==="input")!.props.onChange({target:{value:"file:///private"}});tree=render();
  const event={key:"Enter",stopPropagation:vi.fn(),preventDefault:vi.fn()};find(tree,e=>e.props.role==="dialog")!.props.onKeyDown(event);await flush();
  expect(event.stopPropagation).toHaveBeenCalled();expect(event.preventDefault).toHaveBeenCalled();expect(backend.linkStart).not.toHaveBeenCalled();expect(find(render(),e=>e.props.role==="alert")).toBeDefined();
});
it("a failed cancel is shown, not left as an unhandled rejection",async()=>{
  current={id:7,state:"running",message:"Downloading",path:null,error:null};
  let tree=render();cleanup=hooks.effect!();await flush();tree=render();
  (backend.linkCancel as any).mockRejectedValueOnce(new Error("yt-dlp did not stop"));
  find(tree,e=>e.type==="button"&&e.props.children==="Cancel download")!.props.onClick();await flush();
  expect(JSON.stringify(render())).toContain("yt-dlp did not stop");
  expect(JSON.stringify(render())).not.toContain("Error: yt-dlp");
});
