import {expect,it} from "vitest";
import {soulChannels,matchSoulQuad} from "./quadSoul";
import type {ManualQuad} from "./quadMask";
it("preserves original RGB and alpha while scoring cyan on its dominant channels",()=>{
 const rgba=new Uint8ClampedArray([10,140,200,127]);expect([...soulChannels(rgba)]).toEqual([140,200,10,127]);expect([...rgba]).toEqual([10,140,200,127]);
});
it("returns soul material and phase from known native-size cyan fire",()=>{
 const w=64,h=64,data=new Uint8ClampedArray(w*h*4),sheets=[new Uint8ClampedArray(16*512*4),new Uint8ClampedArray(16*512*4)] as [Uint8ClampedArray,Uint8ClampedArray];
 for(let i=0;i<w*h;i++)data.set([20,180,240,255],i*4);
 for(let i=16*16*7;i<16*16*8;i++)sheets[1].set([20,180,240,255],i*4);
 const q:ManualQuad=[[0,0],[1,0],[1,1],[0,1]],r=matchSoulQuad({width:w,height:h,data},sheets,q,{refineGeometry:false,phaseEvidence:true});
 expect(r.candidates[0]).toMatchObject({atlas:"soul_fire_1",sheet:1,row:7});expect(r.phaseCandidates).toHaveLength(128);
});
