import {initPortalRuntime,undoPortal,undoPortalManual,type PortalImage,type PortalManual} from './portal';
import { failureMessage } from './appErrors';
self.onmessage=async(e:MessageEvent<{image:PortalImage;world?:Uint8Array;manual?:PortalManual}>)=>{
  try{
    await initPortalRuntime();
    const response=await fetch('/portal.png');if(!response.ok)throw Error('Portal texture is unavailable; rebuild the app assets');
    const bitmap=await createImageBitmap(await response.blob());
    let atlas:Uint8ClampedArray;
    const side=bitmap.width;
    try{
      if(bitmap.height%side!==0)throw Error('Invalid portal animation atlas');
      const canvas=new OffscreenCanvas(side,bitmap.height),g=canvas.getContext('2d');
      if(!g)throw Error('Portal worker canvas unavailable');g.drawImage(bitmap,0,0);
      atlas=g.getImageData(0,0,side,bitmap.height).data;
    }finally{bitmap.close();}
    const {image,world,manual}=e.data;
    self.postMessage(manual?undoPortalManual(image,atlas,side,manual.phase,manual.opacity,world):undoPortal(image,atlas,side,world));
  }catch(e){self.postMessage({error:failureMessage(e)});}
};
