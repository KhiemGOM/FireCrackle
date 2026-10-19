import test from 'node:test';
import assert from 'node:assert/strict';
import {quadReadability} from './soul-quad-size-audit.mjs';

const quad=(x,y,u,v)=>[[x,y],[x+u[0],y+u[1]],[x+u[0]+v[0],y+u[1]+v[1]],[x+v[0],y+v[1]]].map(p=>p.map(c=>c/256));
test('64px square has four native pixels per texel',()=>{
 const r=quadReadability(quad(64,64,[64,0],[0,64]),256,256);
 assert.equal(r.eligible,true);assert.ok(Math.abs(r.minPixelsPerTexel-4)<1e-10);
});
test('32px square is too small despite a regular shape',()=>{
 const r=quadReadability(quad(64,64,[32,0],[0,32]),256,256);
 assert.equal(r.eligible,false);assert.equal(r.reason,'small_or_squashed');
});
test('long edges cannot hide a compressed diagonal direction',()=>{
 const r=quadReadability(quad(50,50,[70,0],[69,10]),256,256);
 assert.equal(r.eligible,false);assert.ok(r.minPixelsPerTexel<1);
});
test('rotation does not change square eligibility or pixel scale',()=>{
 const r=quadReadability(quad(128,40,[48,48],[-48,48]),256,256);
 assert.equal(r.eligible,true);assert.ok(Math.abs(r.maxAnisotropy-1)<1e-10);
});
test('large but strongly stretched quad is rejected',()=>{
 const r=quadReadability(quad(20,20,[192,0],[0,48]),256,256);
 assert.equal(r.eligible,false);assert.equal(r.reason,'anisotropic');
});
test('clipped or invalid quad never becomes readable',()=>{
 assert.equal(quadReadability(quad(-1,50,[64,0],[0,64]),256,256).reason,'clipped');
 assert.equal(quadReadability([[0,0],[0,0],[0,0],[0,0]],256,256).eligible,false);
});
