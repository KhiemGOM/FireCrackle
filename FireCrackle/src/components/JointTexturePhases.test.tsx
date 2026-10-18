import {beforeEach,expect,it,vi} from 'vitest';
import type {ReactElement} from 'react';
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useMemo:(f:()=>any)=>f(),useEffect:()=>{},useRef:(v:any)=>({current:v}),useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=initial;return [hooks.values[i],(v:any)=>{hooks.values[i]=typeof v==='function'?v(hooks.values[i]):v;}];}}));
vi.mock('../hooks/useWheel',()=>({useWheel:()=>{}}));
import {JointTexturePhases,paintJointOffsets} from './JointTexturePhases';
import {EMPTY_JOLT,timeReference} from '../lib/jolt';
import {PlotAxes} from './PlotAxes';
import type {JointSample} from '../lib/jointTexturePhase';
type El=ReactElement<Record<string,any>>;
function find(node:any,predicate:(n:El)=>boolean):El[]{if(Array.isArray(node))return node.flatMap(n=>find(n,predicate));if(!node?.props)return [];return [...(predicate(node)?[node]:[]),...find(node.props.children,predicate)];}
const chart={points:[{frame:60,pts:1,step:20,phase:0}],runs:[],flags:[],tick_rate:20,window_ticks:1};
function render(){hooks.cursor=0;return JointTexturePhases({chart,clock:timeReference(EMPTY_JOLT),duration:10,onJump:vi.fn()});}
beforeEach(()=>{hooks.values=[];});
it('renders exactly one joint plot and lets the modulus change without changing the shared origin',()=>{
 let root=render();expect(find(root,n=>n.type==='canvas')).toHaveLength(1);
 const selector=find(root,n=>n.props['aria-label']==='Joint phase modulo')[0];
 expect(find(selector,n=>n.type==='option').map(n=>n.props.value)).toEqual([32,64,96,608,1216,3648]);
 find(root,n=>n.props['aria-label']==='Joint phase shared origin')[0].props.onChange({target:{valueAsNumber:5}});
 selector.props.onChange({target:{value:'96'}});root=render();
 expect(find(root,n=>n.type===PlotAxes)[0].props.y).toEqual([-48,48]);
 expect(find(root,n=>n.props['aria-label']==='Joint phase shared origin')[0].props.value).toBe(5);
});
it('offers independent material toggles while preserving one shared axis',()=>{
 let root=render();const toggles=find(find(root,n=>n.props['aria-label']==='Joint texture legend')[0],n=>n.type==='input'&&n.props.type==='checkbox');expect(toggles).toHaveLength(6);
 toggles[0].props.onChange({target:{checked:false}});root=render();
 expect(find(root,n=>n.type==='input'&&n.props.type==='checkbox')[0].props.checked).toBe(false);
 expect(find(root,n=>n.type===PlotAxes)).toHaveLength(1);
});
it('batches repeated observations into screen marks instead of one DOM node per wrap',()=>{
 const context=Object.fromEntries(['scale','fillRect','beginPath','moveTo','lineTo','stroke','fillText','save','rect','clip','restore','setLineDash','arc','fill'].map(k=>[k,vi.fn()]));
 const canvas={clientWidth:1000,clientHeight:360,getContext:()=>context} as unknown as HTMLCanvasElement;
 const point:JointSample={frame:0,pts:1,tick:20,estimated:false,material:'fire',period:32,ages:[{start:20,duration:1}]};
 paintJointOffsets(canvas,Array.from({length:2000},(_,frame)=>({...point,frame})),timeReference(EMPTY_JOLT),3648,0,[0,10],[0,3648]);
 expect(context.lineTo.mock.calls.length).toBeLessThan(130);
 expect(context.stroke.mock.calls.length).toBeLessThan(10);
 expect(context.arc.mock.calls.length).toBe(1);
});
it('starts with the familiar centered Timing plot and keeps the all-wrap display opt-in',()=>{
 let root=render();expect(find(root,n=>n.type===PlotAxes)[0].props.y).toEqual([-16,16]);
 const toggle=find(root,n=>n.props['aria-label']==='Show all phase possibilities')[0];expect(toggle.props.checked).toBe(false);
 toggle.props.onChange({target:{checked:true}});root=render();
 expect(find(root,n=>n.props['aria-label']==='Show all phase possibilities')[0].props.checked).toBe(true);
 expect(find(root,n=>n.type==='canvas')).toHaveLength(1);
});
