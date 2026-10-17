import {beforeAll,expect,it,vi} from 'vitest';
import {initPortalRuntime,undoPortal} from './portal';
import {portalWorldMask} from './portalPreview';

beforeAll(async()=>{
  const {readFile}=await vi.importActual<{readFile(p:URL):Promise<Uint8Array<ArrayBuffer>>}>('node:fs/promises');
  await initPortalRuntime(await readFile(new URL('./veil.wasm',import.meta.url)));
});

function scene(overlay:boolean){
  const width=160,height=112,side=8,atlas=new Uint8ClampedArray(side*side*4*3),world=new Uint8Array(width*height).fill(1);
  for(let f=0;f<3;f++)for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    const p=((f*side+y)*side+x)*4,v=(x*31+y*19+f*47+x*y*13)%100;
    atlas.set([100+v,12+v/4,200+v/2,80+v*1.6],p);
  }
  const data=new Uint8ClampedArray(width*height*4),original=new Uint8ClampedArray(data.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,p=i*4,t=((2*side+Math.floor((y+.5)*side/height))*side+Math.floor((x+.5)*side/width))*4;
    const a=overlay?.7*atlas[t+3]/255:0;
    for(let c=0;c<3;c++){original[p+c]=80+x*.2+y*.15+c*7;data[p+c]=Math.round(original[p+c]*(1-a)+atlas[t+c]*a);}
    original[p+3]=data[p+3]=255;
    // Unrelated opaque HUD content must not enter fitting or get inverted.
    if(x>55&&x<95&&y>42&&y<70){world[i]=0;data.set([250,35,20,255],p);}
  }
  return {image:{data,width,height},atlas,side,world,original};
}

it('shared WASM fits a known portal and preserves every protected GUI pixel',()=>{
  const s=scene(true),r=undoPortal(s.image,s.atlas,s.side,s.world);
  expect(r.applied).toBe(true);expect(r.phase).toBe(2);expect(r.opacity).toBeCloseTo(.7,1);
  let error=0,count=0;
  for(let i=0;i<s.world.length;i++){
    if(!s.world[i]){expect(r.valid[i]).toBe(0);expect(r.data.slice(i*4,i*4+4)).toEqual(s.image.data.slice(i*4,i*4+4));}
    else if(r.valid[i])for(let c=0;c<3;c++){error+=Math.abs(r.data[i*4+c]-s.original[i*4+c]);count++;}
  }
  expect(count).toBeGreaterThan(10000);expect(error/count).toBeLessThan(4);
});

it('a normal scene stays byte-identical instead of forcing correction',()=>{
  const s=scene(false),r=undoPortal(s.image,s.atlas,s.side,s.world);
  expect(r.applied).toBe(false);expect(r.data).toBe(s.image.data);
});

it('mismatched masks and insufficient evidence fail rather than leaking into GUI',()=>{
  const s=scene(true);
  expect(()=>undoPortal(s.image,s.atlas,s.side,new Uint8Array(1))).toThrow();
  expect(()=>undoPortal(s.image,s.atlas,s.side,new Uint8Array(s.world.length))).toThrow(/unobstructed/);
});

it('excludes opaque, translucent and uncertain GUI coverage regardless of tint',()=>{
  const gui=new Uint8ClampedArray([0,0,0,0,255,0,0,120,0,0,255,120,255,255,0,110]);
  expect([...portalWorldMask(gui)]).toEqual([1,0,0,0]);
  expect(()=>portalWorldMask(new Uint8ClampedArray(3))).toThrow();
});
