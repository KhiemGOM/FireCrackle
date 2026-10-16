import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChartCursor,discreteCursor} from './ChartCursor';
it('holds the same cursor within a frame, then jumps to the next discrete frame',()=>{
 const a=discreteCursor(1.001,60),b=discreteCursor(1.007,60),c=discreteCursor(1.01,60);
 expect(a).toEqual(b);expect(a.time).toBe(1);expect(c.time).toBe(61/60);
 expect(a.label).toContain('Frame 60');expect(c.label).toContain('Frame 61');
 const html=renderToStaticMarkup(<ChartCursor cursor={a} lo={0} hi={2}/>);
 expect(html).toContain('Snapped chart cursor');expect(html).toContain('left:50%');expect(html).toContain('1px dashed #fff');expect(html).toContain('pointer-events:none');
});
it('snaps canonical charts to whole GUI ticks relative to the clock origin',()=>{
 const a=discreteCursor(.011,60,623),b=discreteCursor(.021,60,623),c=discreteCursor(.03,60,623);
 expect(a).toEqual(b);expect(a.label).toBe('Tick 623');expect(c).toEqual({time:.05,label:'Tick 624'});
});
it('hides cursors outside the viewport or after pointer leave',()=>{
 expect(renderToStaticMarkup(<ChartCursor cursor={null} lo={0} hi={1}/>)).toBe('');
 expect(renderToStaticMarkup(<ChartCursor cursor={{time:2,label:'Frame 120'}} lo={0} hi={1}/>)).toBe('');
});
