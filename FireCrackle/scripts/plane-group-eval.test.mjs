import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapQuad,fitFamily,familyCorners,edgePoints} from './plane-group-eval.mjs';
import {gradients} from './edge-grid-eval.mjs';
function points(slope=.04,spacing=.06,phase=.015){
 const out=[];
 for(const k of [1,2,4,7,9,12,15])for(let i=0;i<15;i++){
  const y=(i+.5)/15;out.push({x:slope*y+phase+k*spacing,y,slope,weight:1});
 }
 return out;
}
test('groups separated fragments despite missing lines and off-family clutter',()=>{
 const p=points();for(let i=0;i<40;i++)p.push({x:(i*73%101)/101,y:(i*31%97)/97,slope:.3,weight:1});
 const f=fitFamily(p);assert.ok(f);assert.ok(Math.abs(f.slope-.04)<.011);assert.ok(Math.abs(f.spacing-.06)<.001);assert.ok(Math.abs(f.phase-.015)<.003);assert.ok(f.lineCount>=6);
 assert.ok(fitFamily(p,true)?.lineCount>=6);
});
test('one strong line cannot establish periodic texel spacing',()=>{
 assert.equal(fitFamily(Array.from({length:100},(_,i)=>({x:.5,y:i/100,slope:0,weight:1}))),null);
});
test('two families reconstruct independent affine corner coordinates',()=>{
 const x={slope:.04,spacing:.06,phase:.015},y={slope:-.02,spacing:.063,phase:-.01},q=familyCorners(x,y);assert.ok(q);
 q.forEach(([a,b],i)=>{const [u,v]=[[0,0],[1,0],[1,1],[0,1]][i];assert.ok(Math.abs(a-x.slope*b-x.phase-16*x.spacing*u)<1e-10);assert.ok(Math.abs(b-y.slope*a-y.phase-16*y.spacing*v)<1e-10);});
});
test('rejects a grid escaping the supplied 120 percent envelope',()=>{
 assert.equal(familyCorners({slope:0,spacing:.08,phase:0},{slope:0,spacing:.06,phase:0}),null);
});
test('projective mapping preserves all four supplied corners',()=>{
 const q=[[.2,.1],[.8,.3],[.7,.9],[.1,.7]];[[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i)=>{const p=mapQuad(q,u,v);assert.ok(Math.hypot(p[0]-q[i][0],p[1]-q[i][1])<1e-10);});
});
test('flat and unknown-mask images contribute no native edge points',()=>{
 const image={width:64,height:64,data:new Uint8ClampedArray(64*64*4).fill(100)},g=gradients(image),q=[[0,0],[1,0],[1,1],[0,1]];
 assert.deepEqual(edgePoints(g,new Uint8Array(64*64).fill(1),q),[[],[]]);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++)image.data.set([x<32?40:220,100,10,255],(y*64+x)*4);
 assert.deepEqual(edgePoints(gradients(image),new Uint8Array(64*64),q),[[],[]]);
});
test('native edges recover a perturbed synthetic pixel plane without sprite labels',()=>{
 const width=256,height=256,data=new Uint8ClampedArray(width*height*4),mask=new Uint8Array(width*height).fill(1),truth=[[.125,.125],[.875,.125],[.875,.875],[.125,.875]];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const inside=x>=32&&x<224&&y>=32&&y<224,v=inside?((Math.floor((x-32)/12)+Math.floor((y-32)/12))%2?220:40):100;
  data.set([v,v,v,255],(y*width+x)*4);
 }
 const rough=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>mapQuad(truth,(u-.5)*1.12+.5+.03,(v-.5)*.92+.5-.02));
 const groups=edgePoints(gradients({width,height,data}),mask,rough),a=fitFamily(groups[0],true),b=fitFamily(groups[1],true),local=familyCorners(a,b);
 assert.ok(local,'two complete native-pixel line families must be found');
 const fitted=local.map(([u,v])=>mapQuad(rough,u,v));
 const error=q=>Math.sqrt(q.reduce((s,p,i)=>s+((p[0]-truth[i][0])*width)**2+((p[1]-truth[i][1])*height)**2,0)/4);
 assert.ok(error(fitted)<2,`corner RMS ${error(fitted)}`);assert.ok(error(fitted)<error(rough)/3);
});
