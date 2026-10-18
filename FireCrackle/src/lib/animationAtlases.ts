/** Vanilla 1.16.5 block-atlas playback, verified against Sprite.java and .mcmeta. */
export const ANIMATION_ATLASES = {
  soul_fire_0: {name:"Soul fire 0",side:16,rows:32,hold:1,period:32,offset:16},
  soul_fire_1: {name:"Soul fire 1",side:16,rows:32,hold:1,period:32,offset:0},
  lava_still: {name:"Still lava",side:16,rows:20,hold:2,period:76,offset:0},
  lava_flow: {name:"Flowing lava",side:32,rows:16,hold:3,period:48,offset:0},
  water_still: {name:"Still water",side:16,rows:32,hold:2,period:64,offset:0},
  water_flow: {name:"Flowing water",side:32,rows:32,hold:1,period:32,offset:0},
} as const;
export type AnimationAtlas = keyof typeof ANIMATION_ATLASES;
export interface TextureSprite {atlas:AnimationAtlas;row:number;mirrored:boolean}
export interface TextureObservation extends TextureSprite {frame:number;pts:number}
export function validAtlasRow(atlas:AnimationAtlas,row:number):boolean {
  return !!ANIMATION_ATLASES[atlas] && Number.isInteger(row)&&row>=0&&row<ANIMATION_ATLASES[atlas].rows;
}
export function atlasSource(atlas:AnimationAtlas):string {return `${import.meta.env.BASE_URL}animation-atlases/${atlas}.png`;}
/** Soul-fire rows are animation indices, just like the existing normalized fire sheets. */
export function atlasTile(atlas:AnimationAtlas,row:number):number {return (row+ANIMATION_ATLASES[atlas].offset)%ANIMATION_ATLASES[atlas].rows;}
/** Half-open possible tick intervals. A still-lava image does not identify playback direction. */
export function atlasIntervals(atlas:AnimationAtlas,row:number):{start:number;duration:number}[] {
  if(!validAtlasRow(atlas,row))return [];
  const a=ANIMATION_ATLASES[atlas],starts=[row*a.hold];
  if(atlas==="lava_still"&&row>0&&row<19)starts.push((38-row)*2);
  return starts.map(start=>({start,duration:a.hold}));
}
export function soulFire(atlas:AnimationAtlas):boolean {return atlas==="soul_fire_0"||atlas==="soul_fire_1";}
