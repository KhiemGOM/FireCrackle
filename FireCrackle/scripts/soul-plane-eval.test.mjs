import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interiorSpread,connectedVotes,clusterScore} from './soul-plane-eval.mjs';
test('flat interior has no spread; crossing edge does',()=>{
 assert.equal(interiorSpread(Array.from({length:25},()=>[10,80,90])),0);
 assert.equal(interiorSpread(Array.from({length:25},(_,i)=>i<12?[10,80,90]:[10,160,180])),90);
 assert.equal(interiorSpread([]),Infinity);
});
test('isolated compression outlier does not dominate robust span',()=>{
 assert.equal(interiorSpread([...Array.from({length:24},()=>[10,80,90]),[255,255,255]]),0);
});
test('components connect orthogonally without wrapping rows',()=>{
 const a=new Float64Array(256);a[15]=2;a[16]=3;a[17]=4;
 assert.deepEqual(connectedVotes(a),[7,2]);
});
test('diagonal connection is explicit',()=>{
 const a=new Float64Array(256);a[0]=2;a[17]=3;
 assert.deepEqual(connectedVotes(a),[3,2]);assert.deepEqual(connectedVotes(a,true),[5]);
});
test('cluster scoring uses one common gain and fixed denominator',()=>{
 const m={alpha:new Uint8Array(256).fill(255),rgb:new Float64Array(768).fill(100)},o={probes:4,rgb:new Float64Array(3072).fill(100),fire:new Uint8Array(1024).fill(1),valid:new Uint8Array(1024).fill(1),weights:new Float64Array(1024).fill(1)};
 assert.equal(clusterScore(o,m),1);o.fire.fill(0);assert.equal(clusterScore(o,m),0);
 o.fire.fill(1,0,3);assert.equal(clusterScore(o,m,{coherent:true}),3/1024);
 o.fire[2]=0;assert.equal(clusterScore(o,m,{coherent:true}),0);
});
test('separate brightness hypotheses cannot manufacture a connected match',()=>{
 const m={alpha:new Uint8Array(256).fill(255),rgb:new Float64Array(768).fill(100)},o={probes:4,rgb:new Float64Array(3072),fire:new Uint8Array(1024).fill(1),valid:new Uint8Array(1024).fill(1),weights:new Float64Array(1024).fill(1)};
 for(let c=0;c<256;c++)for(let s=0;s<4;s++)for(let ch=0;ch<3;ch++)o.rgb[(c*4+s)*3+ch]=(c%16+Math.floor(c/16))%2?50:100;
 assert.equal(clusterScore(o,m),1/256);assert.equal(clusterScore(o,m,{diagonal:true}),.5);
 o.weights.fill(0);assert.equal(clusterScore(o,m,{diagonal:true}),0);
});
