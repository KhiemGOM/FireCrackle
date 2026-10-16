import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gradients,gridEvidence} from './edge-grid-eval.mjs';
const quad=[[0,0],[1,0],[1,1],[0,1]];
function image(colour){
 const width=192,height=192,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const value=colour(x,y);data.set([value,value,value,255],(y*width+x)*4);}
 return {width,height,data};
}
const mask=new Uint8Array(192*192).fill(1);
test('a flat image has no pixel-grid edge evidence',()=>{
 const result=gridEvidence(gradients(image(()=>100)),mask,quad);
 assert.equal(result.score,0);assert.equal(result.edges,0);
});
test('known 12-pixel blocks support the correct grid over a quarter-texel offset',()=>{
 const g=gradients(image((x,y)=>(Math.floor(x/12)+Math.floor(y/12))%2?220:40));
 const exact=gridEvidence(g,mask,quad),offset=quad.map(([x,y])=>[x+.25/16,y+.25/16]);
 assert.ok(exact.score>.5);assert.ok(exact.score>gridEvidence(g,mask,offset).score+.4);
 assert.equal(exact.vertical,15);assert.equal(exact.horizontal,15);
});
test('unknown fire mask contributes no votes even on a strong grid',()=>{
 const g=gradients(image((x,y)=>(Math.floor(x/12)+Math.floor(y/12))%2?220:40));
 assert.equal(gridEvidence(g,new Uint8Array(192*192),quad).score,0);
});
test('one long scene edge cannot establish both grid axes',()=>{
 const result=gridEvidence(gradients(image(x=>x<96?40:220)),mask,quad);
 assert.equal(result.vertical,1);assert.equal(result.horizontal,0);
});
test('wholly off-image grids have finite zero evidence',()=>{
 const g=gradients(image(()=>100));
 assert.equal(gridEvidence(g,mask,quad.map(([x,y])=>[x+2,y])).score,0);
});
test('projected grid directions follow a skewed plane rather than screen axes',()=>{
 const skew=[[.2,.1],[.8,.3],[.7,.9],[.1,.7]];
 const g=gradients(image((x,y)=>{
  const a=(x+.5)/192-.2,b=(y+.5)/192-.1,u=(.6*a+.1*b)/.38,v=(-.2*a+.6*b)/.38;
  if(u<0||u>=1||v<0||v>=1)return 100;
  return (Math.floor(u*16)+Math.floor(v*16))%2?220:40;
 }));
 const exact=gridEvidence(g,mask,skew),shifted=gridEvidence(g,mask,skew.map(([x,y])=>[x+.02,y+.02]));
 assert.ok(exact.score>shifted.score+.2);
 assert.ok(exact.vertical>=12&&exact.horizontal>=12);
});
test('repeated sampling of a native edge cannot manufacture hundreds of votes',()=>{
 const g=gradients(image(x=>x<96?40:220));
 const tiny=[[.499,.499],[.501,.499],[.501,.501],[.499,.501]],result=gridEvidence(g,mask,tiny);
 assert.ok(result.edges<=8);assert.ok(result.score<=8/480);
});
