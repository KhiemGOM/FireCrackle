import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import fs from 'node:fs';
import {decodeGuiRgba} from './gui-assets.mjs';

function pngFixture(){
  const rgba=Buffer.alloc(256*256*4),raw=Buffer.alloc(256*(1024+1));
  for(let i=0;i<rgba.length;i++)rgba[i]=(i*19+Math.floor(i/1031)*57)&255;
  for(let y=0;y<256;y++){
    const f=y%5;raw[y*1025]=f;
    for(let x=0;x<1024;x++){
      const i=y*1024+x,left=x>=4?rgba[i-4]:0,up=y?rgba[i-1024]:0,corner=y&&x>=4?rgba[i-1028]:0;
      let predicted=0;
      if(f===1)predicted=left;
      if(f===2)predicted=up;
      if(f===3)predicted=Math.floor((left+up)/2);
      if(f===4){
        const p=left+up-corner,dist=[Math.abs(p-left),Math.abs(p-up),Math.abs(p-corner)];
        predicted=[left,up,corner][dist.indexOf(Math.min(...dist))];
      }
      raw[y*1025+1+x]=(rgba[i]-predicted)&255;
    }
  }
  const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);return b;};
  const header=Buffer.alloc(13);header.writeUInt32BE(256);header.writeUInt32BE(256,4);header[8]=8;header[9]=6;
  return {rgba,png:Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])};
}
test('decodes all five PNG scanline filters, including left/top boundaries',()=>{
  const {rgba,png}=pngFixture();assert.deepEqual(decodeGuiRgba(png),rgba);
});
test('rejects unsupported, truncated and oversized formats',()=>{
  const {png}=pngFixture();
  assert.throws(()=>decodeGuiRgba(png.subarray(0,40)),/Truncated/);
  const wrong=Buffer.from(png);wrong[25]=2;assert.throws(()=>decodeGuiRgba(wrong),/Unsupported/);
  const huge=Buffer.from(png);huge.writeUInt32BE(0x7fffffff,16);assert.throws(()=>decodeGuiRgba(huge),/Unsupported/);
  assert.throws(()=>decodeGuiRgba(Buffer.alloc(33)),/Invalid/);
});
test('optional local vanilla fixture exactly reproduces measured RGBA',()=>{
  const png=new URL('../../.board/pov-dual-veil-v2/recipe_book.png',import.meta.url);
  const rgba=new URL('../../fire-detection/data/assets/gui/recipe_book.rgba',import.meta.url);
  if(fs.existsSync(png)&&fs.existsSync(rgba))assert.deepEqual(decodeGuiRgba(fs.readFileSync(png)),fs.readFileSync(rgba));
});
