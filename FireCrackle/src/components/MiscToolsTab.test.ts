import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {ReactElement} from 'react';
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0,effects:[] as Array<()=>any>}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:(f:()=>any)=>hooks.effects.push(f),useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=typeof initial==='function'?initial():initial;return [hooks.values[i],(v:any)=>{hooks.values[i]=typeof v==='function'?v(hooks.values[i]):v;}];}}));
import {MiscToolsTab} from './MiscToolsTab';
import type {Backend,View} from '../lib/api';
type El=ReactElement<Record<string,any>>;
function find(node:any,predicate:(n:El)=>boolean):El[]{if(Array.isArray(node))return node.flatMap(n=>find(n,predicate));if(!node?.props)return [];return [...(predicate(node)?[node]:[]),...find(node.props.children,predicate)];}
const backend={frame:vi.fn(async()=>new ArrayBuffer(2))} as unknown as Backend,onOpen=vi.fn();
const view={current:10,frame_count:100,fps:60} as View;
function render(){hooks.cursor=0;hooks.effects=[];return MiscToolsTab({backend,view,videoKey:'video.mp4',onOpenFrame:onOpen});}
beforeEach(()=>{hooks.values=[];hooks.effects=[];onOpen.mockClear();});
afterEach(()=>vi.unstubAllGlobals());
it('compares real immediate frames from the active video and allows an inclusive interaction interval',()=>{
 let root=render();expect(find(root,n=>n.props.title==='Before')[0].props.frame).toBe(9);
 expect(find(root,n=>n.props.title==='During')[0].props.frame).toBe(10);
 find(root,n=>n.props['aria-label']==='Last comparison frame')[0].props.onChange({target:{valueAsNumber:19}});root=render();
 expect(find(root,n=>n.props.title==='During')[0].props.frame).toBe(14);
 expect(find(root,n=>n.props.title==='After')[0].props.frame).toBe(20);
 find(root,n=>n.type==='button'&&n.props.children==='Use current frame')[0].props.onClick();root=render();
 expect(find(root,n=>n.props.title==='After')[0].props.frame).toBe(11);
});
it('clearly identifies the unconnected detector and offers manual review without fake scan results',()=>{
 let root=render();find(root,n=>n.props.role==='tab'&&n.props.children==='GUI interactions')[0].props.onClick();root=render();
 expect(find(root,n=>n.props.role==='status')[0].props.children).toContain('not connected');
 expect(find(root,n=>n.type==='button'&&n.props.children==='Scan')).toHaveLength(0);
 find(root,n=>n.type==='button'&&n.props.children==='Compare frames manually')[0].props.onClick();root=render();
 expect(find(root,n=>n.props['aria-label']==='First comparison frame')).toHaveLength(1);
});
it('loads the actual frame decoder output, opens its exact frame and revokes its temporary image',async()=>{
 const root=render(),side=find(root,n=>n.props.title==='Before')[0];
 hooks.cursor=0;hooks.values=[];hooks.effects=[];
 const createObjectURL=vi.fn(()=> 'blob:review'),revokeObjectURL=vi.fn();vi.stubGlobal('URL',{createObjectURL,revokeObjectURL});
 let child=(side.type as Function)(side.props);const cleanup=hooks.effects[0]();await Promise.resolve();await Promise.resolve();
 hooks.cursor=0;child=(side.type as Function)(side.props);
 expect(backend.frame).toHaveBeenCalledWith(9);expect(find(child,n=>n.type==='img')[0].props.src).toBe('blob:review');
 find(child,n=>n.type==='button')[0].props.onClick();expect(onOpen).toHaveBeenCalledWith(9);
 cleanup();expect(revokeObjectURL).toHaveBeenCalledWith('blob:review');
});
