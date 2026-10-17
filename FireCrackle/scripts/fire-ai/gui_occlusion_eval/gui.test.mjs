import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyGui} from '../occlusion_all_videos/evaluate.mjs';

const q=[[0,0],[1,0],[1,1],[0,1]],project=(_,u,v)=>[u,v];
const observation=()=>({probes:4,weights:new Float64Array(1024).fill(1),fire:new Uint8Array(1024).fill(1),valid:new Uint8Array(1024).fill(1),nativePixels:new Int32Array(1024)});

test('no GUI and unreliable fits preserve the original evidence',()=>{
 const o=observation(),empty=new Uint8Array(4096);
 assert.deepEqual(applyGui(o,q,64,64,empty,project).weights,o.weights);
 assert.equal(applyGui(o,q,64,64,new Uint8Array(4096).fill(1),project,false),o);
});

test('each GUI class vetoes bilinear taps, not a whole inferred rectangle',()=>{
 for(const cls of [1,2,3]){
  const o=observation(),mask=new Uint8Array(4096);mask[1]=cls;
  const after=applyGui(o,q,64,64,mask,project);
  assert.equal(after.weights[0],0);assert.equal(after.weights[1],1);
  assert.equal(after.nativePixels,o.nativePixels);assert.equal(o.weights[0],1);
 }
});

test('class buffers must agree with native frame dimensions and enum',()=>{
 assert.throws(()=>applyGui(observation(),q,64,64,new Uint8Array(1),project));
 assert.throws(()=>applyGui(observation(),q,64,64,new Uint8Array(4096).fill(4),project));
});

test('a moved quad samples GUI in native image coordinates',()=>{
 const o=observation(),mask=new Uint8Array(4096);mask[1]=1;
 assert.equal(applyGui(o,q,64,64,mask,project).weights[0],0);
 assert.equal(applyGui(o,q,64,64,mask,(_,u,v)=>[u+.25,v]).weights[0],1);
});
