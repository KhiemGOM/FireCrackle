import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldAt,applyMask} from '../../occlusion-mask-eval.mjs';
const observation=()=>({probes:4,weights:new Float64Array(1024).fill(.25),fire:new Uint8Array(1024).fill(1),valid:new Uint8Array(1024).fill(1)});
test('identity mask preserves native duplicate caps and evidence',()=>{
 const o=observation(),m=applyMask(o,new Float32Array(4096).fill(1));assert.deepEqual(m.weights,o.weights);assert.equal(m.fire,o.fire);assert.equal(m.valid,o.valid);
});
test('a mask removes votes without renormalizing remaining observations',()=>{
 const o=observation(),field=new Float32Array(4096);field.fill(1,0,2048);const m=applyMask(o,field);
 assert.equal(m.weights.reduce((a,b)=>a+b,0),128);assert.equal(m.weights[0],.25);assert.equal(m.weights[1023],0);
 assert.equal(o.weights[1023],.25);
});
test('probabilities attenuate every candidate through the same fixed field',()=>{
 const o=observation(),m=applyMask(o,new Float32Array(4096).fill(.5));assert.ok(m.weights.every(v=>v===.125));
});
test('bilinear field lookup uses pixel-centre coordinates and rejects off-image points',()=>{
 assert.equal(fieldAt([0,1,0,1],.5,.5,2,2),.5);assert.equal(fieldAt([0,1,0,1],.75,.75,2,2),1);assert.equal(fieldAt([1,1,1,1],-1,.5,2,2),0);
});
test('oracle lookup follows native projective coordinates, not known target alpha',()=>{
 const o=observation(),m=applyMask(o,new Float32Array(4096).fill(1),(u,v)=>[u/2+.25,v/2+.25]);assert.deepEqual(m.weights,o.weights);
});
test('invalid probabilities are rejected',()=>{
 assert.throws(()=>applyMask(observation(),new Float32Array(4096).fill(NaN)),/Invalid/);
 assert.throws(()=>applyMask(observation(),new Float32Array(4096).fill(2)),/Invalid/);
});
