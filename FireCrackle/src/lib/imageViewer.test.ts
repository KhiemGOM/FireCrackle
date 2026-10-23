import {expect,it} from 'vitest';
import {centredView,fitScale,imagePixel,limitScale,nativePercent,pictureFilename,scaleForPercent,stepZoom,viewerAction,zoomViewAt} from './imageViewer';

const frame={w:2560,h:1440},pane={w:1400,h:800};
it('fits the whole picture inside the pane with a margin, keeping its aspect',()=>{
  const s=fitScale(frame,pane,0);
  expect(s).toBeCloseTo(1400/2560); // the width limits first
  expect(fitScale(frame,pane,20)).toBeCloseTo(760/1440);
  // a small picture is enlarged to fill the pane too (pixel art stays crisp)
  expect(fitScale({w:16,h:16},pane,0)).toBeCloseTo(50);
});
it('a picture or pane without size fits at 1 instead of zero, infinity or NaN',()=>{
  expect(fitScale({w:0,h:0},pane)).toBe(1);
  expect(fitScale(frame,{w:0,h:0})).toBe(1);
  expect(fitScale({w:NaN,h:10},pane)).toBe(1);
});
it('centres the picture at a scale',()=>{
  const v=centredView(frame,pane,.5);
  expect(v).toEqual({scale:.5,x:(1400-1280)/2,y:(800-720)/2});
});
it('100 % means one picture pixel per screen pixel, also on a high-DPI screen',()=>{
  expect(nativePercent(1,1)).toBe(100);
  expect(nativePercent(1/1.5,1.5)).toBeCloseTo(100);
  expect(scaleForPercent(200,1.25)).toBeCloseTo(1.6);
  expect(nativePercent(scaleForPercent(37,2),2)).toBeCloseTo(37);
});
it('zoom buttons step through round levels and never stick on the current one',()=>{
  expect(nativePercent(stepZoom(1,1,1),1)).toBe(150);
  expect(nativePercent(stepZoom(1,-1,1),1)).toBeCloseTo(200/3,0);
  // from an odd level, go to the next round one in that direction
  expect(nativePercent(stepZoom(scaleForPercent(110,1),1,1),1)).toBe(150);
  expect(nativePercent(stepZoom(scaleForPercent(110,1),-1,1),1)).toBe(100);
  // at the ends, stay at the end
  expect(nativePercent(stepZoom(scaleForPercent(6400,1),1,1),1)).toBe(6400);
  expect(nativePercent(stepZoom(scaleForPercent(5,1),-1,1),1)).toBe(5);
});
it('zoom is limited to the fit (or 5 %) at the low end and 6400 % at the high end',()=>{
  const fit=.3;
  expect(limitScale(.001,fit,1)).toBeCloseTo(.05);
  expect(limitScale(.001,.01,1)).toBeCloseTo(.01);
  expect(limitScale(1000,fit,1)).toBe(64);
  expect(limitScale(64,fit,2)).toBe(32);
  expect(limitScale(NaN,fit,1)).toBe(fit);
});
it('wheel zoom keeps the picture point under the cursor still and respects the limits',()=>{
  const v={scale:1,x:100,y:50};
  const z=zoomViewAt(v,300,250,2,.3,1);
  expect(z.scale).toBe(2);
  expect(imagePixel(z,300,250,frame)).toEqual(imagePixel(v,300,250,frame));
  const capped=zoomViewAt({scale:60,x:0,y:0},10,10,4,.3,1);
  expect(capped.scale).toBe(64);
  expect(zoomViewAt(v,300,250,NaN,.3,1)).toEqual(v);
});
it('the picture pixel under the cursor, or null outside the picture',()=>{
  const v={scale:2,x:10,y:20};
  expect(imagePixel(v,10,20,frame)).toEqual({x:0,y:0});
  expect(imagePixel(v,13.9,25.9,frame)).toEqual({x:1,y:2});
  expect(imagePixel(v,9,20,frame)).toBeNull();
  expect(imagePixel(v,10+2*2560,20,frame)).toBeNull();
  expect(imagePixel(v,10+2*2560-1,20+2*1440-1,frame)).toEqual({x:2559,y:1439});
});
const key=(key:string,mods:Partial<{ctrlKey:boolean;metaKey:boolean;altKey:boolean;shiftKey:boolean}>={})=>viewerAction({key,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...mods});
it('maps the viewer keys',()=>{
  expect(key('Escape')).toBe('close');
  expect(key('+')).toBe('zoomIn');expect(key('=')).toBe('zoomIn');
  expect(key('-')).toBe('zoomOut');
  expect(key('0')).toBe('fit');expect(key('1')).toBe('actual');
  expect(key('ArrowLeft')).toBe('previous');expect(key('ArrowRight')).toBe('next');
  expect(key('c',{ctrlKey:true})).toBe('copy');expect(key('C',{metaKey:true})).toBe('copy');
  expect(key('s',{ctrlKey:true})).toBe('save');
});
it('other keys and modified letters are not the viewer\'s',()=>{
  expect(key('c')).toBeNull();
  expect(key('s')).toBeNull();
  expect(key('x',{ctrlKey:true})).toBeNull();
  expect(key('ArrowLeft',{altKey:true})).toBeNull();
  expect(key('c',{ctrlKey:true,shiftKey:true})).toBeNull();
});
it('saves under a clean file name made from the title',()=>{
  expect(pictureFilename('After: frame 162963')).toBe('After-frame-162963.png');
  expect(pictureFilename('  a/b\\c:*?"<>|  ')).toBe('a-b-c.png');
  expect(pictureFilename('')).toBe('picture.png');
  expect(pictureFilename('x'.repeat(300)).length).toBeLessThanOrEqual(124);
});
