import {expect,it} from 'vitest';
import {textureJoltAgreement} from './textureJolt';
import type {JoltState} from './jolt';
const state={version:1,clock:'video',session:'["1","1"]',data:{name:'test',version:'2.3',source:'',unresolved:0,anchors:[{time:0,tick:0,game:'1',screen:'1',segment:'0'},{time:10,tick:200,game:'1',screen:'1',segment:'0'}]}} as JoltState;
it('shows the independent Jolt clock even when the main chart selects video time',()=>{
 const d=textureJoltAgreement([{frame:0,pts:0,atlas:'water_still',row:0,mirrored:false},{frame:3,pts:.1,atlas:'water_still',row:1,mirrored:false}], 'water_still',state);
 expect(d.period).toBe(64);expect(d.paired).toBe(2);expect(d.observed).toHaveLength(1);expect(d.estimated).toHaveLength(1);
 expect(d.clock[0]).toEqual([{time:0,value:0},{time:10,value:200}]);
 expect(d.observed[0][0].value).toBeCloseTo(-1);expect(d.estimated[0][0].value).toBeCloseTo(-1);
});
it('keeps still lava directions and hold intervals while excluding other materials',()=>{
 const d=textureJoltAgreement([{frame:0,pts:0,atlas:'lava_still',row:5,mirrored:false},{frame:1,pts:1,atlas:'water_still',row:5,mirrored:false}],'lava_still',state);
 expect(d.period).toBe(76);expect(d.paired).toBe(1);expect(d.observed).toHaveLength(2);
 expect(d.observed.every(run=>Math.abs(run[1].value-run[0].value)===2)).toBe(true);
});
it('marks extrapolation as display-only rather than paired evidence',()=>{
 const d=textureJoltAgreement([{frame:400,pts:20,atlas:'water_flow',row:1,mirrored:false}],'water_flow',state);
 expect(d.paired).toBe(0);expect(d.fallback.length).toBeGreaterThan(0);
});
