import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChartCursor,discreteCursor,createFrameCursor} from './ChartCursor';
it('holds the same cursor within a frame, then jumps to the next discrete frame',()=>{
 const a=discreteCursor(1.001,60),b=discreteCursor(1.007,60),c=discreteCursor(1.01,60);
 expect(a).toEqual(b);expect(a.time).toBe(1);expect(c.time).toBe(61/60);
 expect(a.label).toContain('Frame 60');expect(c.label).toContain('Frame 61');
 const html=renderToStaticMarkup(<ChartCursor cursor={a} lo={0} hi={2}/>);
 expect(html).toContain('Snapped chart cursor');expect(html).toContain('left:50%');expect(html).toContain('1px dashed #fff');expect(html).toContain('pointer-events:none');
});
it('uses all 60 video frames on mapped axes, including the two frames between 20 Hz ticks',()=>{
 const snap=createFrameCursor(60,120,frame=>7+frame/60*1.2);
 const frames=[60,61,62,63].map(frame=>snap(7+frame/60*1.2+.001));
 expect(frames.map(p=>p.frame)).toEqual([60,61,62,63]);
 expect(frames.map(p=>p.time)).toEqual([60,61,62,63].map(frame=>7+frame/60*1.2));
 expect(frames.every(p=>p.label.startsWith('Frame '))).toBe(true);
});
it('keeps video-frame identity across mapped clock jumps and resets',()=>{
 const snap=createFrameCursor(60,6,frame=>[0,.02,.04,1,.01,.03][frame]);
 expect(snap(.029).frame).toBe(5);expect(snap(.039).frame).toBe(2);expect(snap(1).frame).toBe(3);
});
it('hides cursors outside the viewport or after pointer leave',()=>{
 expect(renderToStaticMarkup(<ChartCursor cursor={null} lo={0} hi={1}/>)).toBe('');
 expect(renderToStaticMarkup(<ChartCursor cursor={{time:2,label:'Frame 120'}} lo={0} hi={1}/>)).toBe('');
});
