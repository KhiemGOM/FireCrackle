import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jointScores} from './pixel-pair-eval.mjs';
function fixture(){
 const rgb=new Float64Array(256*3),alpha=new Uint8Array(256).fill(255);
 for(let i=0;i<256;i++){const r=(i%16+Math.floor(i/16))%2?80:240;rgb.set([r,r/2,r/10],i*3);}
 return {model:{rgb,alpha},o:{probes:1,rgb:Float64Array.from(rgb,x=>x*.7),valid:new Uint8Array(256).fill(1),fire:new Uint8Array(256).fill(1),weights:new Float64Array(256).fill(1)}};
}
test('matching boundaries beat a same-chromaticity flat candidate under uniform dimming',()=>{
 const {o,model}=fixture(),flat={rgb:new Float64Array(768),alpha:model.alpha};for(let i=0;i<256;i++)flat.rgb.set([160,80,16],i*3);
 assert.ok(jointScores(o,model,[4])[0]>jointScores(o,flat,[4])[0]);
});
test('unknown and transparent samples cannot add boundary evidence',()=>{
 const {o,model}=fixture();o.fire.fill(0);assert.equal(jointScores(o,model,[4])[0],0);o.fire.fill(1);model.alpha.fill(0);assert.equal(jointScores(o,model,[4])[0],0);
});
test('revealing independent matching samples cannot dilute existing evidence',()=>{
 const {o,model}=fixture();o.fire.fill(0,128);const before=jointScores(o,model,[4])[0];o.fire.fill(1);assert.ok(jointScores(o,model,[4])[0]>=before);
});
test('unrelated colours contribute zero rather than subtracting prior votes',()=>{
 const {o,model}=fixture();o.fire.fill(0,128);const before=jointScores(o,model,[4])[0];for(let i=0;i<128;i++)o.rgb.set([200,30,0],i*3);o.fire.fill(1);assert.equal(jointScores(o,model,[4])[0],before);
});
test('zero native-pixel weights produce no manufactured votes',()=>{
 const {o,model}=fixture();o.weights.fill(0);assert.equal(jointScores(o,model,[4])[0],0);
});
