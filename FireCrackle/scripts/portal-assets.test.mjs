import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {zipEntry} from './portal-assets.mjs';

function archive(method){
  const name=Buffer.from('assets/minecraft/textures/block/nether_portal.png'),plain=Buffer.from('test texture bytes');
  const payload=method===8?deflateRawSync(plain):plain;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(method,8);local.writeUInt16LE(name.length,26);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(method,10);directory.writeUInt32LE(payload.length,20);directory.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,10);end.writeUInt32LE(30+name.length+payload.length,16);
  return {zip:Buffer.concat([local,name,payload,directory,name,end]),plain};
}
for(const method of [0,8])test(`extracts portal entry with ZIP method ${method}`,()=>{
  const {zip,plain}=archive(method);assert.deepEqual(zipEntry(zip,'assets/minecraft/textures/block/nether_portal.png'),plain);
});
test('fails on missing textures and invalid archives',()=>{
  assert.throws(()=>zipEntry(archive(8).zip,'missing.png'),/Missing/);
  assert.throws(()=>zipEntry(Buffer.alloc(30),'missing.png'),/Invalid/);
});
