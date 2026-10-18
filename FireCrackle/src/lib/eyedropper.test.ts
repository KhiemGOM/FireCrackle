import {afterEach,expect,it,vi} from 'vitest';
import {hasScreenEyedropper,imagePixelAt,pickScreenColor} from './eyedropper';
afterEach(()=>vi.unstubAllGlobals());
it('opens the screen sampler and normalizes its selected colour',async()=>{
 const open=vi.fn().mockResolvedValue({sRGBHex:'#12ABEF'});
 vi.stubGlobal('EyeDropper',class {open=open;});
 expect(hasScreenEyedropper()).toBe(true);
 expect(await pickScreenColor()).toBe('#12abef');expect(open).toHaveBeenCalledOnce();
});
it('keeps the current colour on Escape',async()=>{
 vi.stubGlobal('EyeDropper',class {async open(){throw new DOMException('cancel','AbortError');}});
 expect(await pickScreenColor()).toBeNull();
});
it('asks for an image rather than disabling the tool in unsupported runtimes',async()=>{
 vi.stubGlobal('EyeDropper',undefined);
 vi.stubGlobal('document',{querySelectorAll:()=>[]});
 expect(hasScreenEyedropper()).toBe(false);
 await expect(pickScreenColor()).rejects.toThrow('Open a video frame or image');
});
it('passes cancellation through to the native sampler',async()=>{
 const controller=new AbortController();
 const open=vi.fn().mockResolvedValue({sRGBHex:'#ffffff'});
 vi.stubGlobal('EyeDropper',class {open=open;});
 await pickScreenColor(controller.signal);expect(open).toHaveBeenCalledWith({signal:controller.signal});
});

function imageRuntime(){
 const handlers=new Map<string,(event:any)=>void>();
 const draw=vi.fn();const remove=vi.fn();
 const parent={clientWidth:200,clientHeight:100,getBoundingClientRect:()=>({left:10,top:20,width:200,height:100})};
 const image={complete:true,naturalWidth:100,naturalHeight:50,parentElement:parent,getBoundingClientRect:parent.getBoundingClientRect,closest:()=>parent};
 vi.stubGlobal('EyeDropper',undefined);
 vi.stubGlobal('window',{addEventListener:(name:string,handler:any)=>handlers.set(name,handler),removeEventListener:(name:string)=>handlers.delete(name)});
 vi.stubGlobal('getComputedStyle',()=>({transform:'none'}));
 vi.stubGlobal('document',{querySelectorAll:()=>[image],body:{append:vi.fn()},createElement:(tag:string)=>tag==='canvas'?{getContext:()=>({drawImage:draw,getImageData:()=>({data:new Uint8ClampedArray([18,52,86,255])})})}:{style:{},setAttribute:vi.fn(),append:vi.fn(),remove}});
 return{handlers,draw,remove};
}
it('samples a video pixel in a runtime without EyeDropper and blocks pointer actions',async()=>{
 const {handlers,draw,remove}=imageRuntime();const selected=pickScreenColor();
 const event={clientX:60,clientY:40,button:0,preventDefault:vi.fn(),stopImmediatePropagation:vi.fn()};
 handlers.get('pointerdown')!(event);expect(event.stopImmediatePropagation).toHaveBeenCalled();
 handlers.get('pointerup')!(event);
 expect(await selected).toBe('#123456');expect(draw).toHaveBeenCalledWith(expect.anything(),25,10,1,1,0,0,1,1);expect(remove).toHaveBeenCalled();
});
it('cancels fallback sampling on Escape without selecting a colour',async()=>{
 const {handlers,remove}=imageRuntime();const selected=pickScreenColor();
 handlers.get('keydown')!({key:'Escape',preventDefault:vi.fn(),stopImmediatePropagation:vi.fn()});
 expect(await selected).toBeNull();expect(remove).toHaveBeenCalled();
});
it('maps zoomed, rotated and letterboxed images to native pixels',()=>{
 expect(imagePixelAt(110,70,{left:10,top:20,width:200,height:100},200,100,100,50,{a:1,b:0,c:0,d:1})).toEqual({x:50,y:25});
 expect(imagePixelAt(20,70,{left:10,top:20,width:200,height:100},200,100,100,100,{a:1,b:0,c:0,d:1})).toBeNull();
 expect(imagePixelAt(110,220,{left:10,top:20,width:200,height:400},200,100,100,50,{a:0,b:2,c:-2,d:0})).toEqual({x:50,y:25});
});
