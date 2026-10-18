import {expect,it,vi} from 'vitest';
import {createWaterRenderer,getWaterTint,setWaterTint,subscribeWaterTint,tintWaterPixels,waterColor} from './waterTint';

it('matches normalized RGB multiplication without changing alpha or source pixels',()=>{
 const pixels=new Uint8ClampedArray([255,255,255,170,128,64,32,255,20,40,60,0]);
 const copy=pixels.slice();
 expect([...tintWaterPixels(pixels,'#3f76e4')]).toEqual([63,118,228,170,32,30,29,255,5,19,54,0]);
 expect(pixels).toEqual(copy);expect(tintWaterPixels(pixels,'#ffffff')).toEqual(pixels);
 expect([...tintWaterPixels(pixels,'#000000')]).toEqual([0,0,0,170,0,0,0,255,0,0,0,0]);
});
it('validates hex colors, shares changes, and supports neutral reset',()=>{
 expect(waterColor(' #AABBCC ')).toBe('#aabbcc');expect(waterColor('#123')).toBeNull();
 expect(()=>tintWaterPixels(new Uint8ClampedArray(4),'nope')).toThrow();
 const listener=vi.fn(),stop=subscribeWaterTint(listener);
 expect(setWaterTint('#123456')).toBe(true);expect(getWaterTint()).toBe('#123456');expect(listener).toHaveBeenCalledOnce();
 expect(setWaterTint('nope')).toBe(false);expect(getWaterTint()).toBe('#123456');stop();setWaterTint('#ffffff');
});
it('prerenders every water frame once per color, deduplicates in-flight work and bounds the cache',async()=>{
 const load=vi.fn(async(atlas:string)=>{const width=atlas==='water_still'?16:32,height=width*32;const rgba=new Uint8ClampedArray(width*height*4).fill(255);return {width,height,rgba};});
 const encode=vi.fn(p=>`data:image/png;base64,${p.width}:${p.rgba[0]}`),render=createWaterRenderer(load,encode,2);
 const a=render('#123456');expect(render('#123456')).toBe(a);
 const sheets=await a;expect(load).toHaveBeenCalledTimes(2);expect(encode).toHaveBeenCalledTimes(2);
 expect(sheets.water_still.rgba).toHaveLength(16*16*32*4);expect(sheets.water_flow.rgba).toHaveLength(32*32*32*4);
 expect(sheets.water_still.rgba[0]).toBe(18);expect(sheets.water_flow.rgba[3]).toBe(255);
 await render('#abcdef');await render('#000000');await render('#123456');
 expect(load).toHaveBeenCalledTimes(2);expect(encode).toHaveBeenCalledTimes(8);
 await expect(render('invalid')).rejects.toThrow();
});
it('retries a failed original load instead of caching a permanent failure',async()=>{
 let fail=true;const load=vi.fn(async()=>{if(fail)throw new Error('not ready');return {width:1,height:1,rgba:new Uint8ClampedArray([255,255,255,255])};});
 const render=createWaterRenderer(load,()=> 'data:image/png;base64,test');
 await expect(render('#123456')).rejects.toThrow('not ready');fail=false;
 expect((await render('#123456')).water_still.rgba[0]).toBe(18);
});
