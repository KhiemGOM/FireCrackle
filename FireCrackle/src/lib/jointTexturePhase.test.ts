import {expect,it} from 'vitest';
import {jointSamples,projectOffsets,sharedOffsets,timingOffset,type JointSample} from './jointTexturePhase';
import {timeReference,EMPTY_JOLT} from './jolt';
import type {PhaseChart} from './chart';

const sample=(period:number,start:number,duration=1,tick=0):JointSample=>({frame:0,pts:0,tick,estimated:false,material:'fire',period,ages:[{start,duration}]});
const covers=(ranges:{start:number;end:number}[],v:number)=>ranges.some(r=>v>=r.start&&v<=r.end);
it('keeps every lift when the final modulo is larger or incommensurate',()=>{
 const ranges=projectOffsets(sample(48,0,1,8),32);
 expect(covers(ranges,7.5)).toBe(true);expect(covers(ranges,23.5)).toBe(true);
 expect(covers(ranges,15)).toBe(false);
 expect(projectOffsets(sample(32,0,1,8),64)).toEqual([{start:7,end:8},{start:39,end:40}]);
});
it('shows a 32-tick shift as matching at32 but different at64 with still-water evidence',()=>{
 const before=sample(64,0,2,10),after=sample(64,0,2,42);
 expect(projectOffsets(before,32)).toEqual(projectOffsets(after,32));
 expect(projectOffsets(before,64)).not.toEqual(projectOffsets(after,64));
});
it('matches the existing signed fire timing plot and distinguishes provisional higher wraps',()=>{
 expect(timingOffset(sample(32,0,1,5),32).value).toBe(5);
 expect(timingOffset(sample(32,0,1,31),32).value).toBe(-1);
 expect(timingOffset(sample(32,0,1,16),32).value).toBe(16);
 expect(timingOffset(sample(32,0,1,5),32,3).value).toBe(2);
 expect(timingOffset(sample(32,0,1,5),64).ambiguous).toBe(true);
 expect(timingOffset(sample(64,0,2,5),64).ambiguous).toBe(false);
});
it('does not draw a misleading zero when the selected modulus provides no phase information',()=>{
 const p=sample(76,2,2,10);p.ages.push({start:72,duration:2});
 expect(timingOffset(p,32).value).toBe(null);
});
it('splits the seam and merges overlapping direction/dwell possibilities',()=>{
 expect(projectOffsets(sample(32,0,3,1),32)).toEqual([{start:0,end:1},{start:30,end:32}]);
 const p=sample(76,2,2,10);p.ages.push({start:72,duration:2});
 // The two directions occupy complementary halves of every four-tick cell.
 expect(projectOffsets(p,32)).toEqual([{start:0,end:32}]);
});
it('projects every exact vanilla age into all selected moduli without dropping its true offset',()=>{
 for(const period of [32,48,64,76])for(const modulo of [32,64,96,608,1216,3648])for(let age=0;age<period;age++){
  const p=sample(period,age,1,18.25),ranges=projectOffsets(p,modulo);
  for(let lift=0;lift<3648;lift+=period){const b=((18.25-age-.5-lift)%modulo+modulo)%modulo;expect(covers(ranges,b)).toBe(true);}
 }
});
it('only intersects evidence captured in the same frame',()=>{
 const a=sample(32,0,1,10),b={...sample(64,0,2,10),material:'water_still' as const};
 expect(sharedOffsets([a,b],32)).toEqual([{frame:0,pts:0,tick:10,intervals:[{start:9,end:10}]}]);
 expect(sharedOffsets([a,{...b,frame:1}],32)).toEqual([]);
 expect(sharedOffsets([a,{...b,ages:[{start:8,duration:2}]}],32)[0].intervals).toEqual([]);
});
it('keeps possible agreement at the shared circular seam and uses one origin for all textures',()=>{
 const a=sample(32,0,1,0),b={...sample(64,0,2,1),material:'water_still' as const};
 expect(sharedOffsets([a,b],32)[0].intervals.some(i=>i.start===0)).toBe(true);
 expect(projectOffsets(sample(32,0,1,8),32,3)).toEqual([{start:4,end:5}]);
 expect(projectOffsets(sample(64,0,1,8),32,3)).toEqual([{start:4,end:5}]);
});
it('uses one clock origin, normalized fire steps and soul provenance; never fills missing Jolt coverage',()=>{
 const chart:PhaseChart={tick_rate:20,window_ticks:1,runs:[],flags:[],points:[{frame:0,pts:1,step:4,phase:16},{frame:1,pts:2,step:8,phase:0}],texture_points:[{frame:1,pts:2,atlas:'soul_fire_0',row:8,mirrored:false},{frame:2,pts:3,atlas:'lava_still',row:3,mirrored:false}]};
 const out=jointSamples(chart,timeReference(EMPTY_JOLT));
 expect(out.map(p=>[p.material,p.tick,p.ages])).toEqual([['fire',20,[{start:4,duration:1}]],['soul',40,[{start:8,duration:1}]],['lava_still',60,[{start:6,duration:2},{start:70,duration:2}]]]);
 expect(jointSamples(chart,{kind:'jolt',sampleAt:()=>null,tickAt:()=>null,sampleTimes:[]})).toEqual([]);
});
