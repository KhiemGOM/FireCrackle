import {it,expect,vi} from 'vitest';
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0,effects:[] as Array<()=>any>}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:(fn:()=>any)=>hooks.effects.push(fn),useMemo:(fn:()=>any)=>fn(),useRef:(initial:any)=>({current:initial}),useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=typeof initial==='function'?initial():initial;return [hooks.values[i],(value:any)=>hooks.values[i]=value];}}));
vi.mock('../hooks/useWheel',()=>({useWheel:()=>{}}));
import {Timeline} from './Timeline';
import type {Backend,View} from '../lib/api';
it('loads the same independent review evidence as the charts rather than colouring a new fire jump from legacy soft flags',async()=>{
 vi.useFakeTimers();
 try {
  const legacy={frame:61,end_frame:61,kind:'phase_outlier',severity:'soft',phase_delta:2};
  const phaseChart=vi.fn().mockResolvedValue({points:[{frame:60,pts:1,step:3,phase:0},{frame:61,pts:61/60,step:1,phase:0}],runs:[],flags:[legacy],tick_rate:20,window_ticks:2});
  const joltRead=vi.fn().mockResolvedValue(JSON.stringify({version:1,clock:'jolt',session:'["1","1"]',data:{anchors:[{time:0,tick:0},{time:2,tick:40}],events:[{from:.5,to:1.5,game:'1',screen:'1',kind:'removed',jump_seconds:.2}]}}));
  Timeline({backend:{phaseChart,joltRead} as unknown as Backend,view:{frame_count:120,current:0,fps:60} as View,flags:[legacy as any],version:1,settings:[],videoKey:'test.mkv',onSeek:()=>{}});
  const stop=hooks.effects[9]();
  await vi.advanceTimersByTimeAsync(80);
  expect(phaseChart).toHaveBeenCalledWith(120,'independent');expect(joltRead).toHaveBeenCalledWith('test.mkv');
  expect(hooks.values[6].flags.map((f:any)=>f.severity)).toEqual(['jolt','hard']);
  stop();
 } finally {vi.useRealTimers();}
});
