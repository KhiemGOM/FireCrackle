import { expect,it } from 'vitest';
import {straighten,clockComparison,thinTrace} from './clockComparison';
import {parseJolt,sessionOf,type JoltState} from './jolt';
it('unwraps a crossing locally but never guesses rotations across missing fire',()=>{
 expect(straighten([{time:0,value:15},{time:1,value:-15},{time:10,value:-14}])).toEqual([[{time:0,value:15},{time:1,value:17}],[{time:10,value:-14}]]);
});
it('keeps imported breaks separate and uses measured GUI tick deltas',()=>{
 const data=parseJolt(JSON.stringify({anchors:[{time:0,tick:100,segment:'a'},{time:1,tick:120,segment:'a'},{time:2,tick:130,segment:'b'},{time:3,tick:150,segment:'b'}]}),'x');
 const state:JoltState={version:1,data,clock:'jolt',session:sessionOf(data.anchors[0])};
 const r=clockComparison([0,1,2,3].map(t=>({frame:t*60,pts:t,step:4,phase:20*t-4})),state,true);
 expect(r.gui).toHaveLength(2);expect(r.corrected).toHaveLength(2);
 expect(r.residual[1][0].value).toBe(-10);
 expect(r.gui[0][0].value).toBe(100);
});
it('retains a one-frame spike when reducing long plotted lines',()=>{
 const points=Array.from({length:100},(_,time)=>({time,value:time===57?99:0}));
 const result=thinTrace(points,5);
 expect(result).toContainEqual({time:57,value:99});
 expect(result[0]).toEqual(points[0]);expect(result[result.length-1]).toEqual(points[99]);
});
it('does not draw a false vertical winding across a wrapped phase boundary',()=>{
 const data=parseJolt('{"anchors":[{"time":0,"tick":100},{"time":3,"tick":160}]}','x');
 const state:JoltState={version:1,data,clock:'jolt',session:sessionOf(data.anchors[0])};
 const points=[0,15,-15].map((phase,frame)=>({phase,frame,pts:frame,step:0}));
 const result=clockComparison(points,state,false);
 expect(result.video.map(r=>r.map(p=>p.value))).toEqual([[0,15],[-15]]);
});
