import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rank} from './evaluate.mjs';
import {boundaryFeatures,featureScore} from '../../boundary-robust-eval.mjs';
import {applyMask} from '../../occlusion-mask-eval.mjs';

function fixture(){
 const rgb=new Float64Array(768*4),model={rgb:new Float64Array(768),alpha:new Uint8Array(256).fill(255)};
 for(let cell=0;cell<256;cell++){
  const colour=[180+(cell%5)*10,90+(cell%3)*10,20];model.rgb.set(colour,cell*3);
  for(let sub=0;sub<4;sub++)rgb.set(colour.map(x=>x*.8),(cell*4+sub)*3);
 }
 return {model,o:{probes:4,rgb,weights:new Float64Array(1024).fill(1),valid:new Uint8Array(1024).fill(1),fire:new Uint8Array(1024).fill(1),count:1024,nativePixels:Int32Array.from({length:1024},(_,i)=>i)}};
}

test('identity field preserves all boundary scores and native-pixel provenance',()=>{
 const {model,o}=fixture(),after=applyMask(o,new Float32Array(4096).fill(1));
 assert.equal(after.nativePixels,o.nativePixels);
 const a=boundaryFeatures(o,model),b=boundaryFeatures(after,model);
 for(const [kind,w] of [['aggregate',4],['facing',1],['facing',4]])assert.deepEqual(featureScore(a,kind,w),featureScore(b,kind,w));
});

test('masking can only remove evidence from each fixed boundary hypothesis',()=>{
 const {model,o}=fixture(),field=Float32Array.from({length:4096},(_,i)=>(i*17%101)/100);
 const a=boundaryFeatures(o,model),b=boundaryFeatures(applyMask(o,field),model);
 for(const [kind,w] of [['aggregate',1],['aggregate',4],['facing',1],['facing',4]])assert.ok(featureScore(b,kind,w).score<=featureScore(a,kind,w).score+1e-12);
});

test('jitter field is sampled in the original quad coordinates',()=>{
 const {o}=fixture(),field=Float32Array.from({length:4096},(_,i)=>(i%64+.5)/64);
 const direct=applyMask(o,field),shifted=applyMask(o,field,(u,v)=>[u+1/32,v]);
 const interior=(4*16+4)*4;
 assert.ok(Math.abs(shifted.weights[interior]-direct.weights[interior]-1/32)<1e-6);
 assert.ok(shifted.weights[(4*16+15)*4+1]===0);
});

test('ranking uses stable candidate ties and respects insufficient evidence',()=>{
 assert.deepEqual(rank([.2,.5,.5]),[1,2,0]);assert.deepEqual(rank([.2,.5],false),[]);
});
