// Build-only format decoding, not GUI detection or veil arithmetic.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';
import {minecraftClientBytes,zipEntry} from './portal-assets.mjs';

function paeth(a,b,c){
  const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
  return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
}

// Vanilla recipe_book.png is 256x256, non-interlaced, eight-bit RGBA.
// Reject other PNG formats instead of silently changing the asset.
export function decodeGuiRgba(png){
  if(png.length<33||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid GUI PNG');
  let width,height,ended=false;const blocks=[];
  for(let p=8;p<png.length;){
    if(p+12>png.length)throw Error('Truncated GUI PNG');
    const length=png.readUInt32BE(p),type=png.subarray(p+4,p+8).toString();
    if(p+12+length>png.length)throw Error('Truncated GUI PNG chunk');
    const data=png.subarray(p+8,p+8+length);
    if(type==='IHDR'){
      if(length!==13||width!==undefined)throw Error('Invalid GUI PNG header');
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      if(width!==256||height!==256||data[8]!==8||data[9]!==6||data[10]!==0||data[11]!==0||data[12]!==0)throw Error('Unsupported GUI PNG format');
    } else if(type==='IDAT') blocks.push(data);
    else if(type==='IEND'){ended=true;break;}
    p+=length+12;
  }
  if(width===undefined||!ended||blocks.length===0)throw Error('Incomplete GUI PNG');
  const stride=width*4,raw=inflateSync(Buffer.concat(blocks),{maxOutputLength:(stride+1)*height});
  if(raw.length!==(stride+1)*height)throw Error('Invalid GUI PNG scanline size');
  const rgba=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];
    if(filter>4)throw Error('Invalid GUI PNG filter');
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=4?rgba[i-4]:0,b=y?rgba[i-stride]:0,c=y&&x>=4?rgba[i-stride-4]:0;
      const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
      rgba[i]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  return rgba;
}

export async function prepareGuiAssets(){
  const output=fileURLToPath(new URL('../../fire-detection/data/assets/gui/recipe_book.rgba',import.meta.url));
  if(fs.existsSync(output)){
    if(fs.statSync(output).size!==256*256*4)throw Error('Invalid local recipe-book RGBA');
    return;
  }
  const jar=await minecraftClientBytes();
  const rgba=decodeGuiRgba(zipEntry(jar,'assets/minecraft/textures/gui/recipe_book.png'));
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,rgba);
}
