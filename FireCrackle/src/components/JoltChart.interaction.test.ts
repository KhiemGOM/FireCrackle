import {beforeEach,expect,it,vi} from 'vitest';
const hooks=vi.hoisted(()=>({values:[] as any[],cursor:0}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:()=>{},useMemo:(fn:()=>any)=>fn(),useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=initial;return [hooks.values[i],(n:any)=>hooks.values[i]=n];}}));
import {JoltChart} from './JoltChart';
import {ComparisonPlot} from './ComparisonPlot';
import {EMPTY_JOLT,type JoltState} from '../lib/jolt';
function all(node:any,type:any):any[]{if(Array.isArray(node))return node.flatMap(n=>all(n,type));if(!node||typeof node!=='object'||!node.props)return [];return [...(node.type===type?[node]:[]),...all(node.props.children,type)];}
function render(state:JoltState){hooks.cursor=0;return JoltChart({state});}
beforeEach(()=>{hooks.values=[];});
it('never fabricates a GUI timeline when Jolt is absent',()=>{expect(all(render(EMPTY_JOLT),ComparisonPlot)).toHaveLength(0);});
it('draws only recovered ticks, preserves clock breaks and allows two-axis pan',()=>{
 const state:JoltState={version:1,clock:'video',session:'["1","1"]',data:{name:'test',source:'',version:'1',unresolved:0,anchors:[{time:0,tick:100,game:'1',screen:'1',segment:'a'},{time:1,tick:120,game:'1',screen:'1',segment:'a'},{time:3,tick:130,game:'1',screen:'1',segment:'b'}]}};
 let plot=all(render(state),ComparisonPlot)[0];
 expect(plot.props.series).toHaveLength(1);
 expect(all(render(state),ComparisonPlot)).toHaveLength(2);
 expect(plot.props.series[0].dots).toBe(true);
 expect(plot.props.formatY(120)).toBe('0:06.00');
 expect(plot.props.series[0].trace).toEqual([[{time:0,value:100},{time:1,value:120}],[{time:3,value:130}]]);
 plot.props.onPan([-1,2],[90,140]);plot=all(render(state),ComparisonPlot)[0];
 expect([plot.props.lo,plot.props.hi,plot.props.bottom,plot.props.top]).toEqual([-1,2,90,140]);
 const phase=all(render(state),ComparisonPlot)[1];
 expect([phase.props.lo,phase.props.hi,phase.props.bottom,phase.props.top]).toEqual([-1,2,-16,16]);
 phase.props.onPan([0,4],[-2,2]);
 expect(all(render(state),ComparisonPlot)[0].props.lo).toBe(0);
 expect(all(render(state),ComparisonPlot)[0].props.bottom).toBe(90);
 expect(all(render(state),ComparisonPlot)[1].props.bottom).toBe(-2);
});
