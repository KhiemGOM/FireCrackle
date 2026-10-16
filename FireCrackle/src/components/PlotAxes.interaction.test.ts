import {expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),useRef:()=>({current:null})}));
import {PlotAxes} from './PlotAxes';
it('routes each drag and reset to its own axis only',()=>{
 const onX=vi.fn(),onY=vi.fn(),resetX=vi.fn(),resetY=vi.fn();
 const root=PlotAxes({children:null,x:[0,100],y:[-16,16],onX,onY,resetX,resetY});
 const children=root.props.children as any[],y=children[0].props,x=children[2].props;
 const event=(clientX:number,clientY:number)=>({clientX,clientY,button:0,pointerId:1,preventDefault:vi.fn(),stopPropagation:vi.fn(),currentTarget:{setPointerCapture:vi.fn()}});
 y.onPointerDown(event(0,100));y.onPointerMove(event(0,-60));y.onPointerUp();
 expect(onY).toHaveBeenCalledOnce();expect(onY.mock.calls[0][0][1]).toBeCloseTo(16/Math.E);expect(onX).not.toHaveBeenCalled();
 x.onPointerDown(event(100,0));x.onPointerMove(event(-60,0));x.onPointerUp();
 expect(onX).toHaveBeenCalledOnce();expect(onY).toHaveBeenCalledOnce();
 y.onDoubleClick();expect(resetY).toHaveBeenCalledOnce();expect(resetX).not.toHaveBeenCalled();
 x.onDoubleClick();expect(resetX).toHaveBeenCalledOnce();
});
it('shows five numeric positions and updates them through the clock formatter',()=>{
 const formatX=vi.fn((n:number)=>`${6200+n*20}`);
 const root=PlotAxes({children:null,x:[0,100],y:[-16,16],onX:vi.fn(),onY:vi.fn(),resetX:vi.fn(),resetY:vi.fn(),formatX});
 const axis=(root.props.children as any[])[2];
 const ticks=axis.props.children[0].props.children;
 expect(ticks.map((t:any)=>t.props.children)).toEqual(['6200','6700','7200','7700','8200']);
 expect(formatX.mock.calls.map(([n])=>n)).toEqual([0,25,50,75,100]);
 expect(ticks.map((t:any)=>t.props.style.left)).toEqual(['0%','25%','50%','75%','100%']);
});
