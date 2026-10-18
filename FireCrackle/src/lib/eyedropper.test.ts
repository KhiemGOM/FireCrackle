import {afterEach,expect,it,vi} from 'vitest';
import {imagePixelAt,pickImageColor} from './eyedropper';
afterEach(()=>vi.unstubAllGlobals());
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
 const {handlers,draw,remove}=imageRuntime();const selected=pickImageColor();
 const event={clientX:60,clientY:40,button:0,preventDefault:vi.fn(),stopImmediatePropagation:vi.fn()};
 handlers.get('pointerdown')!(event);expect(event.stopImmediatePropagation).toHaveBeenCalled();
 handlers.get('pointerup')!(event);
 expect(await selected).toBe('#123456');expect(draw).toHaveBeenCalledWith(expect.anything(),25,10,1,1,0,0,1,1);expect(remove).toHaveBeenCalled();
});
it('cancels fallback sampling on Escape without selecting a colour',async()=>{
 const {handlers,remove}=imageRuntime();const selected=pickImageColor();
 handlers.get('keydown')!({key:'Escape',preventDefault:vi.fn(),stopImmediatePropagation:vi.fn()});
 expect(await selected).toBeNull();expect(remove).toHaveBeenCalled();
});
it('maps zoomed, rotated and letterboxed images to native pixels',()=>{
 expect(imagePixelAt(110,70,{left:10,top:20,width:200,height:100},200,100,100,50,{a:1,b:0,c:0,d:1})).toEqual({x:50,y:25});
 expect(imagePixelAt(20,70,{left:10,top:20,width:200,height:100},200,100,100,100,{a:1,b:0,c:0,d:1})).toBeNull();
 expect(imagePixelAt(110,220,{left:10,top:20,width:200,height:400},200,100,100,50,{a:0,b:2,c:-2,d:0})).toEqual({x:50,y:25});
});
