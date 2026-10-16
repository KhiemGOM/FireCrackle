import {it,expect,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:()=>{},useId:()=> 'test',useRef:()=>({current:null}),useState:(initial:unknown)=>[initial,vi.fn()]}));
import {ComparisonPlot} from './ComparisonPlot';
it('publishes cursor time and Y value in plot coordinates and clears on leave',()=>{
 const onCursor=vi.fn(),onHover=vi.fn();
 const plot=ComparisonPlot({title:'test',series:[],lo:0,hi:10,bottom:-10,top:10,hover:null,onHover,onCursor});
 plot.props.onPointerMove({clientX:535,clientY:85,currentTarget:{getBoundingClientRect:()=>({left:0,top:0,width:1000,height:175})}});
 expect(onCursor).toHaveBeenLastCalledWith({time:5,value:0});
 plot.props.onPointerLeave();expect(onCursor).toHaveBeenLastCalledWith(null);
});
