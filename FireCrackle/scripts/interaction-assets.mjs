// Build inputs only: client archives and extracted game assets are never committed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {minecraftClientBytes} from './portal-assets.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const cache=path.join(root,'FireCrackle/.release-cache/interaction-gui');
const generator=path.join(root,'fire-detection/bench/gui_interaction/prepare_assets.py');
const output=path.join(root,'fire-detection/data/assets/gui/interaction.bundle');
const hash=data=>createHash('sha256').update(data).digest('hex');

async function sourceClient(version){
  const local=(version==='1.21.11'?process.env.MINECRAFT_GUI_CLIENT_JAR:undefined)??path.join(os.homedir(),`.gradle/caches/fabric-loom/${version}/minecraft-client.jar`);
  if(fs.existsSync(local))return local;
  const target=path.join(cache,`client-${version}.jar`),receipt=target+'.sha1';
  if(fs.existsSync(target)&&fs.existsSync(receipt)&&createHash('sha1').update(fs.readFileSync(target)).digest('hex')===fs.readFileSync(receipt,'utf8'))return target;
  const get=async url=>{const r=await fetch(url);if(!r.ok)throw Error(`GUI source download failed: ${r.status}`);return Buffer.from(await r.arrayBuffer());};
  const versions=JSON.parse(await get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'));
  const entry=versions.versions.find(v=>v.id===version);if(!entry)throw Error(`Missing Minecraft ${version} metadata`);
  const metadata=await get(entry.url);
  if(createHash('sha1').update(metadata).digest('hex')!==entry.sha1)throw Error('GUI source metadata hash mismatch');
  const client=JSON.parse(metadata).downloads.client,bytes=await get(client.url);
  if(createHash('sha1').update(bytes).digest('hex')!==client.sha1)throw Error('GUI source client hash mismatch');
  fs.writeFileSync(target,bytes);fs.writeFileSync(receipt,client.sha1);return target;
}
export async function prepareInteractionAssets(){
  fs.mkdirSync(cache,{recursive:true});
  const stamp=hash(Buffer.concat([fs.readFileSync(generator),fs.readFileSync(fileURLToPath(import.meta.url))])),marker=path.join(cache,'generator.sha256');
  if(fs.existsSync(output)&&fs.existsSync(marker)&&fs.readFileSync(marker,'utf8')===stamp)return;
  const old=path.join(cache,'client-1.16.5.jar');
  if(!fs.existsSync(old))fs.writeFileSync(old,await minecraftClientBytes());
  const [modern,v117,v118]=await Promise.all(['1.21.11','1.17','1.18'].map(sourceClient));
  const result=spawnSync(process.env.PYTHON??(process.platform==='win32'?'python':'python3'),[
    generator,'--output',path.join(cache,'templates'),'--client-1165',old,'--client-12111',modern,'--bundle',output,
    '--variant-client',`1.17=${v117}`,'--variant-client',`1.18=${v118}`,
  ],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('GUI template preparation failed. Install Python Pillow for build-time image decoding.');
  fs.writeFileSync(marker,stamp);
}
