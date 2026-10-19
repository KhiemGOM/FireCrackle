import {expect,it} from 'vitest';
import {createMockBackend} from './mock';
import {fireLabel,mergeFireLabels,type Label} from './grid';
import {fireMaterialChart} from './animationCharts';
import {candidateText,replacedLabel} from './labelCandidate';
import {labelSprite} from './firePreview';
const normal:Label={fire:{sheet:1,row:7,mirrored:false}};
const soul:Label={texture:{atlas:'soul_fire_0',row:7,mirrored:true}};
it('retains both appearances while representing one labelled frame',()=>{
 const pair=mergeFireLabels(normal,soul);
 expect(fireLabel(pair)).toEqual(normal);expect(fireLabel(pair,true)).toEqual(soul);
 expect(labelSprite(pair)?.row).toBe(7);expect(candidateText(pair)).toBe('Fire + Soul fire · row 7');
 expect(replacedLabel({label:normal},{label:soul,origin:'picked'})).toBeNull();
});
it('shows one combined point and two independent material readings',async()=>{
 const b=createMockBackend();await b.settingsSet('label.advance_frames',0);await b.act({type:'setLabel',label:normal});await b.act({type:'setLabel',label:soul});
 const view=await b.view();expect(view.labelled_count).toBe(1);expect(fireLabel(view.label,true)).toEqual(soul);
 const chart=await b.phaseChart(100);expect(fireMaterialChart(chart,'combined')?.points).toHaveLength(1);
 expect(fireMaterialChart(chart,'fire')?.points[0].step).toBe(7);expect(fireMaterialChart(chart,'soul')?.points[0].step).toBe(7);
 expect((await b.timeline(0,1,1))[0].fire).toBe(1);
});
it('flags conflicting rows HARD immediately and separates them in All sources',async()=>{
 const b=createMockBackend();await b.settingsSet('label.advance_frames',0);await b.act({type:'setLabel',label:normal});await b.act({type:'setLabel',label:{texture:{...soul.texture,row:8}}});
 expect((await b.flags()).find(f=>f.kind==='fire_conflict')).toMatchObject({frame:0,end_frame:0,severity:'hard'});
 expect((await b.timeline(0,1,1))[0]).toMatchObject({fire:1,flag:'hard'});
 const chart=await b.phaseChart(100);expect(fireMaterialChart(chart,'combined')?.flags.some(f=>f.kind==='fire_conflict')).toBe(true);
 expect(fireMaterialChart(chart,'fire')?.flags).toEqual([]);expect(fireMaterialChart(chart,'soul')?.points[0].step).toBe(8);
 const saved=(await b.view()).label;await b.act({type:'analysisMode',combined:false});expect((await b.flags()).some(f=>f.kind==='fire_conflict')).toBe(false);expect((await b.view()).label).toEqual(saved);
 await b.act({type:'undo'});expect((await b.view()).label).toEqual(normal);
});
