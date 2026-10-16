import { expect, it } from "vitest";
import { matchFireBox, matchFireQuad } from "./quadMatch";
import { rasterizeFire } from "./quadRaster";
import type { ManualQuad } from "./quadMask";

function sheets():[Uint8ClampedArray,Uint8ClampedArray] {
  return [0,1].map(sheet=> {
    let seed=sheet+19;
    const data=new Uint8ClampedArray(16*512*4);
    for(let y=0;y<512;y++)for(let x=0;x<16;x++) {
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const bright=(seed>>>24)/255,i=(y*16+x)*4;
      data.set([120+135*bright,45+200*bright,15+220*bright,(y%16>4||x>3&&x<12)?255:0],i);
    }
    return data;
  }) as [Uint8ClampedArray,Uint8ClampedArray];
}
const q:ManualQuad=[[0.2,0.1],[0.8,0.1],[0.8,0.9],[0.2,0.9]];
function frame(sheet:Uint8ClampedArray,row:number,mirrored:boolean,quad=q,width=160,height=100) {
  const data=rasterizeFire(sheet,row,mirrored,quad,width,height);
  for(let i=0;i<data.length;i+=4)if(!data[i+3])data.set([20,10,5,255],i);
  return {data,width,height};
}

it("finds the selected sheet, row and mirror among all128 possibilities",()=> {
  const atlas=sheets(),result=matchFireQuad(frame(atlas[1],23,true),atlas,q);
  expect(result.searched).toBe(128);
  expect(result.candidates[0]).toMatchObject({sheet:1,row:23,mirrored:true});
  expect(result.status).toBe("clear");
});
it("tolerates brightness changes without mistaking the other sheet",()=> {
  const atlas=sheets(),image=frame(atlas[0],6,false);
  for(let i=0;i<image.data.length;i+=4)for(let c=0;c<3;c++)image.data[i+c]=image.data[i+c]*0.65+7;
  const result=matchFireQuad(image,atlas,q);
  expect(result.candidates[0]).toMatchObject({sheet:0,row:6,mirrored:false});
  expect(result.status).toBe("clear");
});
it("can refine a slightly displaced rough outline",()=> {
  const atlas=sheets();
  const rough=q.map(([x,y])=>[x+0.03,y]) as ManualQuad;
  const result=matchFireQuad(frame(atlas[0],12,true),atlas,rough);
  expect(result.candidates[0]).toMatchObject({sheet:0,row:12,mirrored:true});
  expect(Math.abs(result.candidates[0].quad[0][0]-q[0][0])).toBeLessThan(0.02);
  const fixed=matchFireQuad(frame(atlas[0],12,true),atlas,rough,{refineGeometry:false});
  expect(result.candidates[0].score).toBeGreaterThanOrEqual(fixed.candidates[0].score);
});
it("keeps every corner unchanged when geometry adjustment is disabled",()=> {
  const atlas=sheets(),image=frame(atlas[1],23,true);
  const rough=q.map(([x,y])=>[x+0.03,y+0.02]) as ManualQuad;
  const result=matchFireQuad(image,atlas,rough,{refineGeometry:false});
  expect(result.searched).toBe(128);
  expect(result.candidates.length).toBeGreaterThan(0);
  for(const candidate of result.candidates) expect(candidate.quad).toBe(rough);
  const exact=matchFireQuad(image,atlas,q,{refineGeometry:false});
  expect(exact.candidates[0]).toMatchObject({sheet:1,row:23,mirrored:true});
});
it("uses the flat texel brightness pattern rather than giving every texel its own gain",()=> {
  const atlas:[Uint8ClampedArray,Uint8ClampedArray]=[new Uint8ClampedArray(16*512*4),new Uint8ClampedArray(16*512*4)];
  for(const sheet of atlas)for(let i=0;i<sheet.length;i+=4)sheet.set([160,80,16,255],i);
  // Both patterns have exactly the same chromaticity at every position. Only
  // the correct row can explain the bright/dim blocks with one lighting gain.
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const r=(x+y)%2?80:240;
    atlas[1].set([r,r/2,r/10,255],((7*16+y)*16+x)*4);
  }
  const image=frame(atlas[1],7,false);
  for(let i=0;i<image.data.length;i+=4)for(let c=0;c<3;c++)image.data[i+c]*=.7;
  const result=matchFireQuad(image,atlas,q,{refineGeometry:false});
  expect(result.candidates[0]).toMatchObject({sheet:1,row:7,mirrored:false});
  expect(result.status).toBe("clear");
});
it("filters appearances before scoring, including mirrored edges and a single survivor",()=> {
  const atlas=sheets();
  for(let y=0;y<16;y++) {
    atlas[0][((7*16+y)*16)*4+3]=y<1?255:0;
    atlas[0][((7*16+y)*16+15)*4+3]=y<2?255:0;
  }
  const image=frame(atlas[1],23,true);
  const result=matchFireQuad(image,atlas,q,{refineGeometry:false,filter:{left:2,right:1}});
  expect(result.searched).toBe(1);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({sheet:0,row:7,mirrored:true});
  expect(matchFireQuad(image,atlas,q,{refineGeometry:false,filter:{left:2,right:1,excluded:[39]}}).status).toBe("filtered");
  expect(Number.isFinite(result.margin)).toBe(true);
  expect(matchFireQuad(image,atlas,q,{filter:{left:16,right:0}})).toEqual({status:"filtered",candidates:[],margin:0,searched:0});
  expect(matchFireQuad(image,atlas,q,{refineGeometry:false,filter:{left:null,right:null}}).searched).toBe(128);
});
it("does not automatically select a winner when two sheets are indistinguishable",()=> {
  const [atlas]=sheets();
  const result=matchFireQuad(frame(atlas,4,false),[atlas,atlas],q);
  expect(result.status).toBe("ambiguous");
  expect(result.margin).toBeCloseTo(0);
});
it("abstains on a flat background, tiny patch or entirely off-frame quad",()=> {
  const atlas=sheets(),blank={width:160,height:100,data:new Uint8ClampedArray(160*100*4).fill(100)};
  expect(matchFireQuad(blank,atlas,q).status).toBe("weak");
  const tiny:ManualQuad=[[0.1,0.1],[0.11,0.1],[0.11,0.12],[0.1,0.12]];
  expect(matchFireQuad(blank,atlas,tiny).status).toBe("insufficient");
  const outside=q.map(([x,y])=>[x+2,y]) as ManualQuad;
  expect(matchFireQuad(blank,atlas,outside).status).toBe("insufficient");
});

it("builds a colour mask first and matches visible fire despite dark particles covering half the quad",()=> {
  const atlas=sheets(),image=frame(atlas[1],23,true);
  for(let y=10;y<90;y++)for(let x=32;x<80;x++)image.data.set([8,8,8,255],(y*image.width+x)*4);
  const result=matchFireQuad(image,atlas,q);
  expect(result.candidates[0]).toMatchObject({sheet:1,row:23,mirrored:true});
  expect(result.status).toBe("clear");
  expect(result.candidates[0].support).toBeGreaterThanOrEqual(32);
  expect(result.candidates[0].maskSamples).toBeLessThan(180);
});
it("abstains when almost all fire is covered rather than inventing a row",()=> {
  const atlas=sheets(),image=frame(atlas[0],12,false);
  for(let y=10;y<90;y++)for(let x=32;x<122;x++)image.data.set([8,8,8,255],(y*image.width+x)*4);
  expect(matchFireQuad(image,atlas,q).status).not.toBe("clear");
});

it("adds positive evidence without diluting existing votes with masked colour mismatches",()=> {
  const atlas=sheets(),covered=frame(atlas[1],23,true);
  for(let y=10;y<90;y++)for(let x=32;x<80;x++)covered.data.set([8,8,8,255],(y*160+x)*4);
  const partial=matchFireQuad(covered,atlas,q,{refineGeometry:false}).candidates.find(c=>c.sheet===1&&c.row===23&&c.mirrored)!;
  expect(partial).toBeDefined();
  // Reveal unrelated but fire-coloured pixels on the hidden side. They may
  // support rivals, but cannot subtract this candidate's existing evidence.
  const unrelated=frame(atlas[0],3,false);
  for(let y=10;y<90;y++)for(let x=32;x<80;x++)covered.data.set(unrelated.data.subarray((y*160+x)*4,(y*160+x)*4+4),(y*160+x)*4);
  const extra=matchFireQuad(covered,atlas,q,{refineGeometry:false}).candidates.find(c=>c.sheet===1&&c.row===23&&c.mirrored)!;
  expect(extra).toBeDefined();expect(extra.score).toBeGreaterThanOrEqual(partial.score);
  const full=matchFireQuad(frame(atlas[1],23,true),atlas,q,{refineGeometry:false}).candidates[0];
  expect(full.score).toBeGreaterThan(partial.score);
});

it("uses each candidate's opaque hull for old bbox labels, without knowing the truth row",()=> {
  const atlas=sheets();
  for(const sheet of atlas)for(let row=0;row<32;row++)for(let y=0;y<5;y++)for(let x=0;x<16;x++)sheet[((row*16+y)*16+x)*4+3]=0;
  const image=frame(atlas[1],23,true);
  const box:ManualQuad=[[0.2,0.35],[0.8,0.35],[0.8,0.9],[0.2,0.9]];
  const result=matchFireBox(image,atlas,box);
  expect(result.candidates[0]).toMatchObject({sheet:1,row:23,mirrored:true});
  expect(result.status).toBe("clear");
});

it("searches independent width and height stretches for a misproportioned outline",()=> {
  const atlas=sheets();
  const rough:ManualQuad=[[0.125,0.18],[0.875,0.18],[0.875,0.82],[0.125,0.82]];
  // The true fire needs narrower width and taller height than the rough quad.
  const result=matchFireQuad(frame(atlas[1],23,true),atlas,rough);
  expect(result.candidates[0]).toMatchObject({sheet:1,row:23,mirrored:true});
  expect(result.candidates[0].quad[1][0]-result.candidates[0].quad[0][0]).toBeLessThan(0.75);
  expect(result.candidates[0].quad[3][1]-result.candidates[0].quad[0][1]).toBeGreaterThan(0.64);
});

it("cannot manufacture hundreds of votes from repeated probes of a tiny native patch",()=> {
  const solid=new Uint8ClampedArray(16*512*4);
  for(let i=0;i<solid.length;i+=4)solid.set([200,100,10,255],i);
  const data=new Uint8ClampedArray(8*8*4);
  for(let i=0;i<data.length;i+=4)data.set([200,100,10,255],i);
  const outline:ManualQuad=[[0,0],[1,0],[1,1],[0,1]];
  const result=matchFireQuad({data,width:8,height:8},[solid,solid],outline,{refineGeometry:false});
  expect(result.candidates[0].score).toBeLessThanOrEqual(64/256+1e-9);
  expect(result.status).not.toBe("clear");
});
