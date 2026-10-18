import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {minecraftClientBytes,zipEntry} from './portal-assets.mjs';

export const animations={
  soul_fire_0:{side:16,rows:32,hold:1,order:[...Array.from({length:16},(_,i)=>i+16),...Array.from({length:16},(_,i)=>i)]},
  soul_fire_1:{side:16,rows:32,hold:1},
  lava_still:{side:16,rows:20,hold:2,order:[...Array.from({length:20},(_,i)=>i),...Array.from({length:18},(_,i)=>18-i)]},
  lava_flow:{side:32,rows:16,hold:3},
  water_still:{side:16,rows:32,hold:2},
  water_flow:{side:32,rows:32,hold:1},
};
export function verifyAnimation(name,png,metadata){
  const spec=animations[name],a=metadata.animation;
  if(!spec||!a||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.length<24)throw Error('Invalid animation atlas');
  if(png.readUInt32BE(16)!==spec.side||png.readUInt32BE(20)!==spec.side*spec.rows||(a.frametime??1)!==spec.hold||a.interpolate||a.width||a.height)throw Error(`Unexpected ${name} geometry/timing`);
  const order=a.frames??Array.from({length:spec.rows},(_,i)=>i),expected=spec.order??Array.from({length:spec.rows},(_,i)=>i);
  if(JSON.stringify(order)!==JSON.stringify(expected))throw Error(`Unexpected ${name} playback order`);
}
export async function prepareAnimationAssets(){
  const output=fileURLToPath(new URL('../public/animation-atlases/',import.meta.url));
  const jar=await minecraftClientBytes();
  fs.mkdirSync(output,{recursive:true});
  for(const name of Object.keys(animations)){
    const root=`assets/minecraft/textures/block/${name}.png`,png=zipEntry(jar,root),metadata=JSON.parse(zipEntry(jar,root+'.mcmeta'));
    verifyAnimation(name,png,metadata);
    const target=output+name+'.png';
    if(!fs.existsSync(target)||!fs.readFileSync(target).equals(png))fs.writeFileSync(target,png);
  }
}
