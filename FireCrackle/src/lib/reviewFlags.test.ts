import {it,expect} from 'vitest';
import {canonicalFlagPositions,joltCursorText,reviewChart,displayClockAt} from './reviewFlags';
import {correctedJoltChart,joltPhase,timeReference,type JoltState} from './jolt';
import type {PhaseChart} from './chart';
import {flagSpans} from './chart';
const state:JoltState={version:1,clock:'jolt',session:'["1","1"]',data:{name:'test',source:'',version:'2.3',unresolved:0,anchors:[{time:0,tick:100,game:'1',screen:'1',segment:'a'},{time:1,tick:120,game:'1',screen:'1',segment:'a'},{time:4,tick:220,game:'1',screen:'1',segment:'b'},{time:5,tick:240,game:'1',screen:'1',segment:'b'}],events:[{from:1,to:4,kind:'removed',jump_seconds:2,game:'1',screen:'1'}]}};
const chart:PhaseChart={points:[{frame:120,pts:2,step:3,phase:0},{frame:121,pts:2+1/60,step:1,phase:0}],runs:[],flags:[{frame:121,end_frame:121,kind:'phase_shift',severity:'hard',phase_delta:28}],flag_details:[{frame:121,end_frame:121,kind:'phase_shift',clock_delta:28,held_ticks:null,explanation:'forward_jump: test'}],tick_rate:20,window_ticks:2};
it('keeps one source-labelled review list across video/canonical clocks including fire in an unresolved span',()=>{
 const combined=reviewChart(chart,state,60)!;
 expect(combined.flags).toHaveLength(2);
 expect(combined.flags[0]).toMatchObject({kind:'jolt_report',severity:'jolt'});
 expect(combined.flags[1].severity).toBe('hard');
 expect(combined.flag_details!.map(d=>d.explanation.split(':')[0])).toEqual(['jolt_removed','forward_jump']);
 const corrected=correctedJoltChart(joltPhase(combined,timeReference(state)),timeReference(state))!;
 expect(corrected.flags).toEqual(combined.flags);
 expect(corrected.points).toEqual([]);
 expect(corrected.flag_positions![0]).toEqual({t0:1,t1:6,uncertain:true});
 expect(corrected.flag_positions![1].t0).toBeCloseTo(2+1/60);
 expect(corrected.flag_positions![1].t1).toBeCloseTo(2+1/60);
 expect(corrected.flag_positions![1].uncertain).toBe(true);
 const spans=flagSpans(corrected.flags,()=>NaN,0,10,1000,4,corrected.flag_positions);
 expect([spans[0].x0,spans[0].x1]).toEqual([100,600]);
 expect(spans[1].x1-spans[1].x0).toBe(4);
});
it('offers a labelled display estimate without adding ticks to the independent evidence clock',()=>{
 const reference=timeReference(state);
 expect(reference.sampleAt(2)).toBeNull();
 expect(canonicalFlagPositions([{t0:.5,t1:.5},{t0:2,t1:2}],reference,100)[0]).toEqual({t0:.5,t1:.5,uncertain:false});
 expect(displayClockAt(reference,2)).toMatchObject({tick:140,fallback:true,estimated:true});
 expect(reference.sampleAt(2)).toBeNull();
});
it('excludes another game report and preserves the selected label-source fire evidence',()=>{
 expect(reviewChart(chart,{...state,session:'["2","1"]'},60)!.flags).toHaveLength(1);
 expect(reviewChart({...chart,flags:[],points:[]},state,60)!.flags).toHaveLength(1);
});
it('reports actual cursor X/Y values and identifies nearby evidence as nearby',()=>{
 expect(joltCursorText(state,chart,2.01,true,4.5)).toContain('cursor phase +4.50 ticks');
 expect(joltCursorText(state,chart,.2,false,104)).toContain('cursor GUI 104.00 ticks');
 expect(joltCursorText(state,chart,2.01,true,4.5)).toContain('nearest fire: frame');
 expect(joltCursorText(state,chart,null,false)).toContain('Hover');
});
