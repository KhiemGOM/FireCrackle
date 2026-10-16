import {expect,it} from 'vitest';
import {fireJoltAgreement,joltMarkers} from './joltAgreement';
import {parseJolt,restoreJolt,sessionOf,type JoltState} from './jolt';
import type {PhaseChart} from './chart';
const data=parseJolt(JSON.stringify({anchors:[{time:0,tick:100,segment:'a'},{time:1,tick:120,segment:'a'},{time:2,tick:300,segment:'b'},{time:3,tick:320,segment:'b'}]}),'test');
const state:JoltState={version:1,data,clock:'video',session:sessionOf(data.anchors[0])};
const chart=(pairs:number[][]):PhaseChart=>({points:pairs.map(([pts,step],frame)=>({frame,pts,step,phase:99})),runs:[],flags:[],tick_rate:20,window_ticks:2});
it('subtracts the GUI clock regardless of the main fire X-axis selection, preserving joint jumps',()=>{
 const result=fireJoltAgreement(chart([[0,4],[.5,14],[1,24],[1.5,0],[2,12],[3,0]]),state);
 expect(result.baseline).toBe(0);expect(result.count).toBe(5);
 expect(result.observed.flat().map(p=>p.value)).toEqual([0,0,0,0]);
 expect(result.estimated.flat()).toEqual([{time:.5,value:0}]);
 expect(result.observed.some(run=>run.some(p=>p.time===1)&&run.some(p=>p.time===2))).toBe(false);
});
it('keeps a real post-break difference instead of fitting it away',()=>{
 const result=fireJoltAgreement(chart([[0,4],[2,9],[3,29]]),state);
 expect(result.observed.flat().map(p=>p.value)).toEqual([0,3,3]);
});
it('does not fabricate fire evidence in a fire-free span or an unknown clock span',()=>{
 const result=fireJoltAgreement(chart([[0,4],[1.5,2],[3,0]]),state);
 expect(result.count).toBe(2);expect(result.observed).toHaveLength(2);
 expect(fireJoltAgreement(null,state).count).toBe(0);
});
it('restores classified report breaks and keeps legacy section markers unclassified',()=>{
 const raw={anchors:data.anchors,breaks:[{from:1,to:2,kind:'removed',game:1,jump_seconds:8}]};
 const imported={...state,data:parseJolt(JSON.stringify(raw),'report')};
 expect(restoreJolt(JSON.stringify(imported)).data?.events).toEqual(imported.data.events);
 expect(joltMarkers(imported)).toEqual([{time:1,end:2,label:'Reported cut',color:'#bd8bff',dashed:true}]);
 expect(joltMarkers(state)[0].label).toContain('cause unspecified');
});

it('continues both clocks as parallel straight lines and retains measured fire jumps without invented drift',()=>{
 const result=fireJoltAgreement(chart([[0,4],[1,24],[1.25,29],[1.5,2],[1.75,9],[2,14],[3,2]]),state);
 const gap=result.gaps[0];
 expect(gap.shift).toBe(160);
 expect(gap.before).toEqual([{time:1,value:120},{time:2,value:140}]);
 expect(gap.after).toEqual([{time:1,value:280},{time:2,value:300}]);
 expect(result.fallback.flat().map(p=>p.value)).toEqual([0,0,-2]);
 expect(result.count).toBe(4);
 expect(new Set(gap.phaseBefore.map(p=>p.value)).size).toBe(1);
 expect(new Set(gap.phaseAfter.map(p=>p.value)).size).toBe(1);
});
