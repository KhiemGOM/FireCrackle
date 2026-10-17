import { describe,expect,it } from "vitest";
import { AUTOMATIC_TOOLS,paintAutomaticStrips } from "./labelSources";
import type { Bucket } from "./api";

const bucket:Bucket={frames:4,unset:0,fire:2,no_fire:2,skip:0,flag:null};
function canvas(){
  const rects:Array<{color:string,x:number,y:number,w:number,h:number}>=[];
  const g={fillStyle:"",fillRect(x:number,y:number,w:number,h:number){rects.push({color:g.fillStyle,x,y,w,h});}};
  return {g,rects};
}
describe("automatic label edge bars",()=>{
  it("leaves manual and older backend buckets unstriped",()=>{const {g,rects}=canvas();paintAutomaticStrips(g,bucket,10,30,4,44);expect(rects).toEqual([]);});
  it("never marks a time guess as an automatic label tool",()=>{const {g,rects}=canvas();paintAutomaticStrips(g,{...bucket,auto_time_guess:4},10,30,4,44);expect(rects).toEqual([]);});
  it("retains every tool at both edges of a mixed one-pixel bucket",()=>{
    const {g,rects}=canvas();paintAutomaticStrips(g,{...bucket,auto_no_fire:1,auto_first_person:1,auto_time_guess:1},10,30,1,48);
    expect(rects).toEqual(AUTOMATIC_TOOLS.flatMap((tool,i)=>[
      {color:tool.color,x:10,y:30+i*4,w:1,h:4},
      {color:tool.color,x:10,y:78-(i+1)*4,w:1,h:4},
    ]));
  });
  it("marks only the top and bottom, leaving the middle clear",()=>{
    const {g,rects}=canvas();paintAutomaticStrips(g,{...bucket,auto_no_fire:2},2,8,6,44);
    expect(rects).toEqual([{color:"#38d4bf",x:2,y:8,w:6,h:4},{color:"#38d4bf",x:2,y:48,w:6,h:4}]);
  });
});
