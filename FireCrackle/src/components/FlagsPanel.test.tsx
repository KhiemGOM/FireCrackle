import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {FlagsPanel} from './FlagsPanel';
it('shows a JOLT badge rather than calling an imported report interval HARD',()=>{
 const html=renderToStaticMarkup(<FlagsPanel flags={[{frame:1,end_frame:10,kind:'jolt_report',severity:'jolt',phase_delta:30}]} fps={60} current={0} onSeek={()=>{}} details={[{frame:1,end_frame:10,kind:'jolt_report',clock_delta:30,held_ticks:null,explanation:'jolt_removed: Imported cut interval.'}]}/>);
 expect(html).toContain('sev jolt');expect(html).not.toContain('sev hard');expect(html).toContain('Jolt · reported cut interval');expect(html).toContain('reported jump');
});
