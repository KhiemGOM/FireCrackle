import {test} from 'node:test';
import assert from 'node:assert/strict';
import {animations,verifyAnimation} from './animation-assets.mjs';
function header(spec){const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(spec.side,16);png.writeUInt32BE(spec.side*spec.rows,20);return png;}
test('validates every shipped animation geometry, frame order and duration',()=>{
 for(const [name,spec] of Object.entries(animations))verifyAnimation(name,header(spec),{animation:{frametime:spec.hold,...(spec.order?{frames:spec.order}:{})}});
});
test('rejects a changed pack or version instead of silently misaligning phases',()=>{
 const name='soul_fire_0',png=header(animations[name]);
 assert.throws(()=>verifyAnimation(name,png,{animation:{}}));
 assert.throws(()=>verifyAnimation('lava_flow',header(animations.lava_flow),{animation:{frametime:1}}));
 assert.throws(()=>verifyAnimation('water_still',header(animations.water_still),{animation:{frametime:2,interpolate:true}}));
});
