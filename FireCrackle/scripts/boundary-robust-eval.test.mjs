import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundaryFeatures,featureScore,stricterObservation,chooseShortlist} from './boundary-robust-eval.mjs';
import {jointScores} from './pixel-pair-eval.mjs';
function fixture(){
 const model={rgb:new Float64Array(768),alpha:new Uint8Array(256).fill(255)},o={probes:4,rgb:new Float64Array(3072),valid:new Uint8Array(1024).fill(1),fire:new Uint8Array(1024).fill(1),weights:new Float64Array(1024).fill(1),nativePixels:Int32Array.from({length:1024},(_,i)=>i)};
 for(let c=0;c<256;c++){const r=(c%16+Math.floor(c/16))%2?80:240;model.rgb.set([r,r/2,r/10],c*3);for(let s=0;s<4;s++)o.rgb.set([r*.7,r*.35,r*.07],(c*4+s)*3);}
 return {o,model};
}
test('aggregate scores reproduce frozen boundary scorer at all declared weights',()=>{
 const {o,model}=fixture(),f=boundaryFeatures(o,model),weights=[.25,1,4];
 jointScores(o,model,weights).forEach((value,i)=>assert.equal(featureScore(f,'aggregate',weights[i]).score,value));
});
test('all feature variants are finite, nonnegative, and neutral for unknown samples',()=>{
 const {o,model}=fixture();o.fire.fill(0);const f=boundaryFeatures(o,model);
 for(const kind of Object.keys(f.edge))assert.equal(featureScore(f,kind).score,0);
});
test('revealing independent matches never subtracts evidence in any feature variant',()=>{
 const {o,model}=fixture();o.fire.fill(0,0,128);const before=boundaryFeatures(o,model);o.fire.fill(1);const after=boundaryFeatures(o,model);
 for(const kind of Object.keys(before.edge))assert.ok(featureScore(after,kind).score>=featureScore(before,kind).score);
});
test('new mismatching samples never dilute previous votes',()=>{
 const {o,model}=fixture();o.fire.fill(0,0,128);const before=boundaryFeatures(o,model);
 for(let i=0;i<128;i++)o.rgb.set([200,20,0],i*3);o.fire.fill(1);const after=boundaryFeatures(o,model);
 for(const kind of Object.keys(before.edge))assert.equal(featureScore(after,kind).score,featureScore(before,kind).score);
});
test('one aliased native pixel cannot manufacture independent or paired boundary evidence',()=>{
 const {o,model}=fixture();o.nativePixels.fill(5);const f=boundaryFeatures(o,model);
 assert.ok(f.edge.aggregate.some(x=>x>0));
 for(const kind of ['distinct','matched','facing','gradient'])assert.ok(f.edge[kind].every(x=>x===0));
});
test('unrelated subprobe corners do not establish a spatially corresponding boundary',()=>{
 const {o,model}=fixture();o.fire.fill(0);o.fire[0]=1;o.fire[7]=1;const f=boundaryFeatures(o,model);
 assert.ok(f.edge.aggregate.some(x=>x>0));assert.ok(f.edge.matched.every(x=>x===0));assert.ok(f.edge.facing.every(x=>x===0));
});
test('transparent templates and zero-weight observations add no evidence',()=>{
 const {o,model}=fixture();model.alpha.fill(0);assert.equal(featureScore(boundaryFeatures(o,model)).score,0);
 model.alpha.fill(255);o.weights.fill(0);assert.equal(featureScore(boundaryFeatures(o,model)).score,0);
});
test('stricter masks retain exact warm matches but cannot distinguish identical fire/occluder RGB',()=>{
 const {o}=fixture(),palette=[[240,120,24],[255,255,255]];o.rgb.set([168,84,16.8],0);o.rgb.set([145,145,145],3);o.rgb.set([145,145,145],6);
 const strict=stricterObservation(o,palette,'strict'),neutral=stricterObservation(o,palette,'neutral');
 assert.equal(strict.fire[0],1);assert.equal(strict.fire[1],strict.fire[2]);
 assert.equal(neutral.fire[1],0);assert.equal(neutral.fire[2],0);
});
test('shortlisting uses declared colour ranks and stable colour tie preference',()=>{
 assert.deepEqual(chooseShortlist([3,2,1,0],[100,2,2,1],3),[2,1,3]);assert.deepEqual(chooseShortlist([],[],3),[]);
});
