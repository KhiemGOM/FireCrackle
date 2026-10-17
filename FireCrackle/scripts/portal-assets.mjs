// Build-only extraction. Never commit upstream game textures or client archives.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';

export function zipEntry(zip, name) {
  let end=zip.length-22;
  for(;end>=Math.max(0,zip.length-65557);end--)if(zip.readUInt32LE(end)===0x06054b50)break;
  if(end<0)throw Error('Invalid client archive');
  let p=zip.readUInt32LE(end+16);
  const count=zip.readUInt16LE(end+10);
  for(let i=0;i<count;i++){
    if(zip.readUInt32LE(p)!==0x02014b50)throw Error('Invalid ZIP directory');
    const method=zip.readUInt16LE(p+10),size=zip.readUInt32LE(p+20),n=zip.readUInt16LE(p+28),extra=zip.readUInt16LE(p+30),comment=zip.readUInt16LE(p+32);
    if(zip.subarray(p+46,p+46+n).toString()===name){
      const local=zip.readUInt32LE(p+42),start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28),data=zip.subarray(start,start+size);
      if(method===0)return data;
      if(method===8)return inflateRawSync(data);
      throw Error('Unsupported client ZIP compression');
    }
    p+=46+n+extra+comment;
  }
  throw Error(`Missing vanilla texture: ${name}`);
}

export async function preparePortalAsset(){
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const output=path.join(root,'FireCrackle/public/portal.png');
  if(fs.existsSync(output))return;
  let jar=process.env.MINECRAFT_CLIENT_JAR;
  if(!jar){
    const cache=path.join(root,'fire-detection/mod/.gradle/loom-cache/minecraftMaven');
    if(fs.existsSync(cache))jar=[...fs.globSync('**/*1.16.5*.jar',{cwd:cache})].map(p=>path.join(cache,p)).find(p=>/minecraft-merged/.test(p)&&!p.endsWith('-sources.jar'));
  }
  let bytes;
  if(jar)bytes=fs.readFileSync(jar);
  else {
    // Official version metadata pins the client hash; the downloaded archive is only a build input.
    const get=async url=>{const r=await fetch(url);if(!r.ok)throw Error(`Minecraft asset download: ${r.status}`);return Buffer.from(await r.arrayBuffer());};
    const manifest=JSON.parse(await get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'));
    const entry=manifest.versions.find(v=>v.id==='1.16.5');
    if(!entry)throw Error('Minecraft 1.16.5 version metadata unavailable');
    const meta=await get(entry.url);
    if(createHash('sha1').update(meta).digest('hex')!==entry.sha1)throw Error('Minecraft version metadata hash mismatch');
    const client=JSON.parse(meta).downloads.client;bytes=await get(client.url);
    if(createHash('sha1').update(bytes).digest('hex')!==client.sha1)throw Error('Minecraft client hash mismatch');
  }
  const png=zipEntry(bytes,'assets/minecraft/textures/block/nether_portal.png');
  if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid portal PNG');
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,png);
}
