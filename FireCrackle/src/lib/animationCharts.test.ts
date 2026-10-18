import {expect,it} from 'vitest';
import {fireMaterialChart,fitTexturePhase,texturePhaseIntervals,textureTransitions} from './animationCharts';
import type {PhaseChart} from './chart';
import type {TextureObservation} from './animationAtlases';

it('keeps fire and soul views independent without renumbering their common tick',()=>{
 const chart:PhaseChart={tick_rate:20,window_ticks:1,runs:[],flags:[],points:[{frame:1,pts:1,step:5,phase:15},{frame:2,pts:2,step:5,phase:3}],texture_points:[{frame:2,pts:2,atlas:'soul_fire_0',row:5,mirrored:false}]};
 expect(fireMaterialChart(chart,'fire')?.points.map(p=>p.frame)).toEqual([1]);
 expect(fireMaterialChart(chart,'soul')?.points.map(p=>p.frame)).toEqual([2]);
 expect(fireMaterialChart(chart,'soul')?.points[0].step).toBe(5);
});
it('retains both still-lava directions and the two-tick image hold',()=>{
 expect(texturePhaseIntervals('lava_still',1,10)).toEqual([{start:6,duration:2},{start:10,duration:2}]);
 expect(texturePhaseIntervals('lava_still',0,0)).toEqual([{start:74,duration:2}]);
});
it('fits a backward lava sequence by interval overlap rather than monotonic row advance',()=>{
 const points:TextureObservation[]=[18,17,16,15].map((row,i)=>({atlas:'lava_still',row,mirrored:false,frame:i,pts:(40+2*i+7.5)/20}));
 const fit=fitTexturePhase(points,'lava_still',t=>t*20)!;
 expect(fit).toBeGreaterThan(5.5);expect(fit).toBeLessThan(7.5);
 expect(fitTexturePhase(points,'water_still',t=>t*20)).toBeNull();
 expect(fitTexturePhase(points,'lava_still',()=>null)).toBeNull();
});
it('fits a phase interval across the wrap and ignores a conflicting sample',()=>{
 const points:TextureObservation[]=[0,1,2].map((row,i)=>({atlas:'water_still',row,mirrored:false,frame:i,pts:(2*i+.2)/20}));
 points.push({atlas:'water_still',row:10,mirrored:false,frame:4,pts:0});
 const fit=fitTexturePhase(points,'water_still',t=>t*20)!;
 expect(fit>62.2||fit<.2).toBe(true);
});
const lava=(rows:number[]):TextureObservation[]=>rows.map((row,i)=>({atlas:'lava_still',row,mirrored:false,frame:i,pts:i*.1}));
it('allows normal lava reversals at either endpoint',()=>{
 expect(textureTransitions(lava([17,18,19,18,17]),'lava_still',t=>t*20)).toEqual([]);
 expect(textureTransitions(lava([2,1,0,1,2]),'lava_still',t=>t*20)).toEqual([]);
});
it('detects premature reversal using sequence direction, and excessive advance',()=>{
 expect(textureTransitions(lava([9,10,9]),'lava_still',t=>t*20).map(e=>e.frame)).toEqual([2]);
 expect(textureTransitions(lava([1,8]),'lava_still',t=>t*20)).toHaveLength(1);
});
it('restarts at missing evidence or unresolved clock coverage',()=>{
 const p=lava([9,10,9]);p[2].frame=4;
 expect(textureTransitions(p,'lava_still',t=>t*20)).toEqual([]);
 expect(textureTransitions(lava([9,10,9]),'lava_still',t=>t===.1?null:t*20)).toEqual([]);
});
