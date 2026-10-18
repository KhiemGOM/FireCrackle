import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {ReactElement} from 'react';
const hooks=vi.hoisted(()=>({values:[] as any[],i:0,refs:[] as any[],r:0}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:any)=>{const i=hooks.i++;if(!(i in hooks.values))hooks.values[i]=typeof initial==='function'?initial():initial;return[hooks.values[i],(v:any)=>{hooks.values[i]=typeof v==='function'?v(hooks.values[i]):v;}];},
 useRef:(initial:any)=>hooks.refs[hooks.r++]??={current:initial},useEffect:()=>{},
}));
vi.mock('react-dom',()=>({createPortal:(children:any)=>children}));
import {WaterTintControl} from './WaterTintControl';
type Element=ReactElement<Record<string,any>>;
function all(node:any):Element[]{return Array.isArray(node)?node.flatMap(all):node&&typeof node==='object'&&'props'in node?[node,...all(node.props.children)]:[];}
const changed=vi.fn();
function render(){hooks.i=hooks.r=0;const tree=WaterTintControl({color:'#3f76e4',onChange:changed});return{tree,find:(label:string)=>all(tree).find(e=>e.props['aria-label']===label)!};}
beforeEach(()=>{hooks.values=[];hooks.refs=[];changed.mockClear();vi.stubGlobal('window',{innerWidth:1200,innerHeight:800});vi.stubGlobal('document',{body:{}});});
afterEach(()=>vi.unstubAllGlobals());
it('does not disable the eyedropper when the desktop runtime has no browser API',()=>{
 vi.stubGlobal('EyeDropper',undefined);
 expect(render().find('Pick water color from screen').props.disabled).toBe(false);
 expect(render().find('Pick water color from screen').props.title).toContain('video/image');
});
it('applies a screen-selected colour and exits sampling mode',async()=>{
 vi.stubGlobal('EyeDropper',class{async open(){return{sRGBHex:'#12ABEF'};}});
 render().find('Pick water color from screen').props.onClick();
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 expect(changed).toHaveBeenCalledWith('#12abef');
 expect(render().find('Pick water color from screen').props.disabled).toBe(false);
});
it('cancellation leaves the tint untouched and re-enables the sampler',async()=>{
 vi.stubGlobal('EyeDropper',class{async open(){throw new DOMException('cancel','AbortError');}});
 render().find('Pick water color from screen').props.onClick();
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 expect(changed).not.toHaveBeenCalled();expect(render().find('Pick water color from screen').props.disabled).toBe(false);
});
it('opens the full colour popover and supports saturation/brightness clicks',()=>{
 let ui=render();ui.find('Pick water color').props.onClick({currentTarget:{getBoundingClientRect:()=>({right:1180,bottom:200})}});
 ui=render();expect(ui.find('Choose water color').props.className).toBe('water-color-popup');
 const square=ui.find('Water saturation and brightness');
 square.props.onPointerDown({button:0,pointerId:1,clientX:50,clientY:100,preventDefault:vi.fn(),currentTarget:{setPointerCapture:vi.fn(),getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})}});
 expect(changed).toHaveBeenLastCalledWith('#000000');
 ui.find('Close water color picker').props.onClick();expect(render().find('Choose water color')).toBeUndefined();
});
