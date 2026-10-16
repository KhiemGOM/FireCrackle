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

it('uses the same snapped time for the linked cursor, readout and Ctrl-click',()=>{
 const onHover=vi.fn(),onCursor=vi.fn(),onOpenTime=vi.fn();
 const snapTime=(t:number)=>Math.round(t*60)/60;
 const plot=ComparisonPlot({title:'test',series:[],lo:0,hi:10,bottom:-10,top:10,hover:null,onHover,onCursor,onOpenTime,snapTime});
 const event={ctrlKey:true,clientX:536,clientY:85,preventDefault:vi.fn(),currentTarget:{getBoundingClientRect:()=>({left:0,top:0,width:1000,height:175})}};
 plot.props.onPointerMove(event);plot.props.onClick(event);
 expect(onHover).toHaveBeenLastCalledWith(301/60);
 expect(onCursor).toHaveBeenLastCalledWith({time:301/60,value:0});
 expect(onOpenTime).toHaveBeenLastCalledWith(301/60);
});
