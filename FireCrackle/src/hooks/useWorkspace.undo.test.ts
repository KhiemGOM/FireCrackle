import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const hooks=vi.hoisted(()=>({states:[] as any[],refs:[] as any[],state:0,ref:0}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:()=>{},useCallback:(f:any)=>f,useRef:(initial:any)=>hooks.refs[hooks.ref++]??={current:initial},useState:(initial:any)=>{
  const i=hooks.state++;if(!(i in hooks.states))hooks.states[i]=typeof initial==='function'?initial():initial;
  return [hooks.states[i],(update:any)=>{hooks.states[i]=typeof update==='function'?update(hooks.states[i]):update;}];
}}));
import {useWorkspace} from './useWorkspace';
import {createMockBackend} from '../lib/mock';
import {LabelUndo} from '../lib/labelUndo';
import type {Backend} from '../lib/api';
function render(backend:Backend,history:LabelUndo){hooks.state=hooks.ref=0;return useWorkspace(backend,true,history);}
beforeEach(()=>{hooks.states=[];hooks.refs=[];vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});});
afterEach(()=>vi.unstubAllGlobals());

it('undoes real backend labels and local tool edits in their shared order, ignoring navigation/no-ops',async()=>{
  const backend=createMockBackend(),history=new LabelUndo();let quad=1;
  let ws=render(backend,history);await ws.open('mock://demo');ws=render(backend,history);
  history.bind<number>('quad',v=>{quad=v;});history.changed('quad',1,2);quad=2;await Promise.resolve();
  await ws.act({type:'setLabel',label:'no_fire'});ws=render(backend,history);
  const labelled=ws.view!.labelled_count;expect(history.size).toBe(2);
  await ws.act({type:'step',frames:5});await ws.act({type:'clear'});expect(history.size).toBe(2);
  history.changed('quad',2,3);quad=3;await Promise.resolve();
  await history.undo();expect(quad).toBe(2);expect((await backend.view()).labelled_count).toBe(labelled);
  await history.undo();expect((await backend.view()).labelled_count).toBe(labelled-1);expect(quad).toBe(2);
  await history.undo();expect(quad).toBe(1);expect(history.size).toBe(0);
});
it('keeps a failed native undo available for retry',async()=>{
  const backend=createMockBackend(),history=new LabelUndo();let ws=render(backend,history);
  await ws.open('mock://demo');ws=render(backend,history);await ws.act({type:'setLabel',label:'skip'});
  const original=backend.act;vi.spyOn(backend,'act').mockImplementationOnce(async()=>{throw Error('backend unavailable');}).mockImplementation(original);
  await expect(history.undo()).rejects.toThrow('backend unavailable');expect(history.size).toBe(1);
  await history.undo();expect(history.size).toBe(0);expect((await backend.view()).undo_depth).toBe(0);
});
