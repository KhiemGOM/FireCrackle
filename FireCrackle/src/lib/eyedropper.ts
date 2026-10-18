import {waterColor} from './waterTint';
type ScreenPicker = {open(options?: {signal?: AbortSignal}): Promise<{sRGBHex: string}>};
type ScreenPickerConstructor = new () => ScreenPicker;
const constructor = () => (globalThis as typeof globalThis & {EyeDropper?: ScreenPickerConstructor}).EyeDropper;
export function hasScreenEyedropper(): boolean { return typeof constructor() === 'function'; }

/** Invert the viewer rotation/scale around its transformed centre, then remove letterboxing. */
export function imagePixelAt(x:number,y:number,box:{left:number;top:number;width:number;height:number},width:number,height:number,nativeWidth:number,nativeHeight:number,matrix:{a:number;b:number;c:number;d:number}) {
 const {a,b,c,d}=matrix,det=a*d-b*c;
 if(![x,y,box.left,box.top,box.width,box.height,width,height,nativeWidth,nativeHeight,det].every(Number.isFinite)||!det||Math.min(width,height,nativeWidth,nativeHeight)<=0)return null;
 const dx=x-box.left-box.width/2,dy=y-box.top-box.height/2;
 const localX=(d*dx-c*dy)/det+width/2,localY=(-b*dx+a*dy)/det+height/2;
 const scale=Math.min(width/nativeWidth,height/nativeHeight);
 const px=(localX-(width-nativeWidth*scale)/2)/scale,py=(localY-(height-nativeHeight*scale)/2)/scale;
 return px>=0&&py>=0&&px<nativeWidth&&py<nativeHeight?{x:Math.floor(px),y:Math.floor(py)}:null;
}

/** Portable fallback: samples the displayed image, and never clicks through into the app. */
export function pickImageColor(signal?:AbortSignal):Promise<string|null>{
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){resolve(null);return;}
  const images=Array.from(document.querySelectorAll<HTMLImageElement>('.video-frame .video-zoom > img')).filter(image=>image.complete&&image.naturalWidth&&image.getBoundingClientRect().width);
  if(!images.length){reject(new Error('Open a video frame or image before picking a colour.'));return;}
  const eventHost=window;
  const overlay=document.createElement('div');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','Pick image colour');
  Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'2147483647',cursor:'crosshair',background:'transparent'});
  const hint=document.createElement('div');hint.textContent='Click a colour in the video/image · Escape cancels';
  Object.assign(hint.style,{position:'absolute',bottom:'24px',left:'50%',transform:'translateX(-50%)',background:'#10151fee',color:'#fff',padding:'10px 16px',border:'1px solid #61e9ff',borderRadius:'7px',font:'14px sans-serif',pointerEvents:'none'});
  overlay.append(hint);document.body.append(overlay);
  let done=false;
  const blockClick=(event:MouseEvent)=>{event.preventDefault();event.stopImmediatePropagation();};
  const cleanup=()=>{overlay.remove();eventHost.removeEventListener('keydown',key,true);eventHost.removeEventListener('pointerdown',down,true);eventHost.removeEventListener('pointerup',up,true);signal?.removeEventListener('abort',abort);setTimeout(()=>eventHost.removeEventListener('click',blockClick,true),0);};
  const finish=(color:string|null)=>{if(done)return;done=true;cleanup();resolve(color);};
  const abort=()=>finish(null);
  const key=(event:KeyboardEvent)=>{event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape')finish(null);};
  const down=(event:PointerEvent)=>{event.preventDefault();event.stopImmediatePropagation();};
  const up=(event:PointerEvent)=>{
   event.preventDefault();event.stopImmediatePropagation();if(event.button!==0)return;
   try{
    for(const image of images){
     const parent=image.parentElement!;
     const style=getComputedStyle(parent);
     const matrix=style.transform==='none'?{a:1,b:0,c:0,d:1}:new DOMMatrix(style.transform);
     const pixel=imagePixelAt(event.clientX,event.clientY,parent.getBoundingClientRect(),parent.clientWidth,parent.clientHeight,image.naturalWidth,image.naturalHeight,matrix);
     const frame=image.closest('.video-frame')?.getBoundingClientRect();
     if(!pixel||!frame||event.clientX<frame.left||event.clientX>frame.right||event.clientY<frame.top||event.clientY>frame.bottom)continue;
     const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
     const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not read image colours.');
     ctx.drawImage(image,pixel.x,pixel.y,1,1,0,0,1,1);
     const rgb=ctx.getImageData(0,0,1,1).data;
     finish('#'+Array.from(rgb.slice(0,3)).map(value=>value.toString(16).padStart(2,'0')).join(''));return;
    }
    hint.textContent='Click inside the video/image · Escape cancels';
   }catch(error){done=true;cleanup();reject(error);}
  };
  window.addEventListener('keydown',key,true);window.addEventListener('pointerdown',down,true);window.addEventListener('pointerup',up,true);window.addEventListener('click',blockClick,true);signal?.addEventListener('abort',abort,{once:true});
 });
}
/** Call directly from a user gesture. Escape is a normal cancellation. */
export async function pickScreenColor(signal?: AbortSignal): Promise<string | null> {
 const Picker = constructor();
 if (!Picker) return pickImageColor(signal);
 try {
  const result = await new Picker().open({signal});
  const color = waterColor(result.sRGBHex);
  if (!color) throw new Error('The screen picker returned an invalid colour.');
  return color;
 } catch (error) {
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return null;
  if(error instanceof Error && error.name==='NotSupportedError') return pickImageColor(signal);
  throw error;
 }
}
