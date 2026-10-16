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

it('Ctrl-click opens the actual video X coordinate and never starts a pan',()=>{
 const onOpenTime=vi.fn(),onPan=vi.fn(),setPointerCapture=vi.fn();
 const plot=ComparisonPlot({title:'test',series:[],lo:390,hi:400,bottom:-16,top:16,hover:null,onHover:vi.fn(),onPan,onOpenTime});
 const event={button:0,ctrlKey:true,clientX:535,clientY:85,preventDefault:vi.fn(),currentTarget:{setPointerCapture,getBoundingClientRect:()=>({left:0,top:0,width:1000,height:175})}};
 plot.props.onPointerDown(event);expect(setPointerCapture).not.toHaveBeenCalled();
 plot.props.onClick(event);expect(onOpenTime).toHaveBeenCalledExactlyOnceWith(395);
 plot.props.onClick({...event,ctrlKey:false});expect(onOpenTime).toHaveBeenCalledTimes(1);
 plot.props.onClick({...event,clientX:20});expect(onOpenTime).toHaveBeenCalledTimes(1);
 expect(onPan).not.toHaveBeenCalled();
});
