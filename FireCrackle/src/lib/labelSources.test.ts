import { afterEach,describe,expect,it,vi } from "vitest";
import { AUTOMATIC_TOOLS,paintAutomaticStrips } from "./labelSources";
import type { Bucket } from "./api";

const bucket:Bucket={frames:4,unset:0,fire:2,no_fire:2,skip:0,flag:null};
function canvas(){
  const ink={strokeStyle:"",globalAlpha:1,lineWidth:0,beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn()};
  const tile={width:0,height:0,getContext:()=>ink};
  vi.stubGlobal("document",{createElement:()=>tile});
  const rects:Array<{color:unknown,x:number,y:number,w:number,h:number}>=[];
  const createPattern=vi.fn(()=>({color:ink.strokeStyle} as unknown as CanvasPattern));
  const g={fillStyle:"" as string|CanvasGradient|CanvasPattern,createPattern,
    fillRect(x:number,y:number,w:number,h:number){rects.push({color:g.fillStyle,x,y,w,h});}};
  return {g:g as unknown as CanvasRenderingContext2D,rects,ink,tile,createPattern};
}
afterEach(()=>vi.unstubAllGlobals());
describe("automatic label patterns",()=>{
  it("leaves manual and older backend buckets unstriped",()=>{const {g,rects,createPattern}=canvas();paintAutomaticStrips(g,bucket,10,30,4,44);expect(rects).toEqual([]);expect(createPattern).not.toHaveBeenCalled();});
  it("retains every tool in a mixed one-pixel bucket",()=>{const {g,rects}=canvas();paintAutomaticStrips(g,{...bucket,auto_no_fire:1,auto_first_person:1,auto_time_guess:1},10,30,1,45);expect(rects).toEqual(AUTOMATIC_TOOLS.map((tool,i)=>({color:{color:tool.color},x:10,y:30+i*15,w:1,h:15})));});
  it("covers the full label height with thin dense hatching, reusing the tile",()=>{
    const {g,rects,tile,ink,createPattern}=canvas();
    paintAutomaticStrips(g,{...bucket,auto_no_fire:2},2,8,6,44);
    paintAutomaticStrips(g,{...bucket,auto_no_fire:2},8,8,6,44);
    expect(rects[0]).toEqual({color:{color:"#38d4bf"},x:2,y:8,w:6,h:44});
    expect(tile.width).toBe(6);expect(tile.height).toBe(6);expect(ink.lineWidth).toBe(1);
    expect(createPattern).toHaveBeenCalledTimes(1);
  });
});
