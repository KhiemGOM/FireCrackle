import {describe,it,expect} from 'vitest';
import {ANIMATION_ATLASES,atlasIntervals,atlasTile,validAtlasRow} from './animationAtlases';
import {candidateConfirmation,candidateText} from './labelCandidate';
import {framePreview,previewSprite,spriteLabel,spriteWithSheet} from './firePreview';
import {labelsEqual} from './grid';
import {manualTexels,DEFAULT_QUAD} from './quadMask';

describe('vanilla alternative atlas clocks',()=>{
 it('normalizes soul sheet0 by the same16-frame offset as fire0',()=>{
  for(let row=0;row<32;row++){expect(atlasTile('soul_fire_0',row)).toBe((row+16)%32);expect(atlasIntervals('soul_fire_0',row)).toEqual([{start:row,duration:1}]);expect(atlasTile('soul_fire_1',row)).toBe(row);}
 });
 it('keeps fluid periods and within-frame uncertainty instead of folding into32',()=>{
  expect(ANIMATION_ATLASES.lava_flow.period).toBe(48);expect(atlasIntervals('lava_flow',15)).toEqual([{start:45,duration:3}]);
  expect(atlasIntervals('water_still',31)).toEqual([{start:62,duration:2}]);expect(atlasIntervals('water_flow',31)).toEqual([{start:31,duration:1}]);
  expect(atlasIntervals('lava_still',5)).toEqual([{start:10,duration:2},{start:66,duration:2}]);
  expect(atlasIntervals('lava_still',0)).toEqual([{start:0,duration:2}]);expect(atlasIntervals('lava_still',19)).toEqual([{start:38,duration:2}]);
  expect(validAtlasRow('lava_flow',16)).toBe(false);expect(atlasIntervals('lava_still',20)).toEqual([]);
 });
 it('persists explicit material and keeps first-person geometry fire-only',()=>{
  const sprite={atlas:'soul_fire_0',sheet:0,row:7,mirrored:true} as const,label=spriteLabel(sprite);
  expect(label).toEqual({texture:{atlas:'soul_fire_0',row:7,mirrored:true}});
  expect(candidateConfirmation({label,origin:'picked'})).toEqual({type:'setLabel',label});
  expect(candidateText(label)).toContain('Soul fire 0');expect(labelsEqual(label,JSON.parse(JSON.stringify(label)))).toBe(true);
  expect(labelsEqual(label,{texture:{atlas:'soul_fire_1',row:7,mirrored:true}})).toBe(false);
  expect(framePreview({label,suggestion:null})).toEqual(sprite);expect(previewSprite('firstPerson',sprite)).toBeNull();
 });
 it('projects all1024texels of a32px fluid frame without cropping/resizing',()=>{
  const pixels=new Uint8ClampedArray(32*32*16*4);for(let i=0;i<pixels.length;i+=4)pixels.set([30,70,180,255],i);
  expect(manualTexels(pixels,15,false,DEFAULT_QUAD,32,16)).toHaveLength(1024);
  expect(()=>manualTexels(pixels,16,false,DEFAULT_QUAD,32,16)).toThrow();
 });
 it('keeps material identity when switching sheets and bounds fluid rows',()=>{
  expect(spriteWithSheet({atlas:'soul_fire_0',sheet:0,row:9,mirrored:true},1)).toEqual({atlas:'soul_fire_1',sheet:1,row:9,mirrored:true});
  expect(spriteWithSheet({atlas:'lava_still',sheet:0,row:19,mirrored:false},1)).toEqual({atlas:'lava_flow',sheet:1,row:15,mirrored:false});
 });
});
