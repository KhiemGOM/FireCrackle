import fs from "node:fs";
import path from "node:path";
import {loadLibs} from "./lib-runtime.mjs";
import {execFileSync} from "node:child_process";

const root=path.resolve(import.meta.dirname,".."),dir=path.resolve(process.argv[2]),split=process.argv[3]??"tune",tag=process.argv[4]??"baseline";
if(!["tune","validation"].includes(split))throw Error("Use tune or validation split");
const runtime=path.join(root,"src-tauri/target/actual-quad-runtime",tag);
const hashes={};
const frozen=process.argv.includes("--frozen"),refIndex=process.argv.indexOf("--source-ref"),sourceRef=refIndex<0?null:process.argv[refIndex+1];
if(frozen){const prior=path.join(dir,`${tag}-tune.json`);if(fs.existsSync(prior))Object.assign(hashes,JSON.parse(fs.readFileSync(prior)).hashes);}
// the app's own matcher, loaded through Node's type stripping (scripts/lib-runtime.mjs)
const read=sourceRef?name=>execFileSync("git",["-c",`safe.directory=${path.resolve(root,"..").replaceAll("\\","/")}`,"show",`${sourceRef}:FireCrackle/src/lib/${name}.ts`],{cwd:root,stdio:["ignore","pipe","pipe"]}).toString():undefined;
const loaded=await loadLibs(["quadMatch","quadMask"],{runtime,...(read?{read}:{})});
if(!frozen)Object.assign(hashes,loaded.hashes);
const {matchFireQuad}=loaded.modules.quadMatch,{projectQuad}=loaded.modules.quadMask;
const sheets=[0,1].map(i=>new Uint8ClampedArray(fs.readFileSync(path.join(root,`../fire-detection/data/assets/fire_${i}.rgba`))));
const mode=process.argv[5]??"fixed",every=Number(process.argv[6]??1);
// --full-table: also keep every candidate's score at the supplied outline (for the shared-phase vote, phase-consensus-eval.mjs)
const fullTable=process.argv.includes("--full-table");
const idsIndex=process.argv.indexOf("--only-ids"),ids=idsIndex<0?null:new Set(process.argv[idsIndex+1].split(","));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,"manifest.json"))),samples=manifest.samples.filter(r=>r.split===split&&(!ids||ids.has(r.id))).filter((_,i)=>i%every===0),rows=[];
let frame=-1,image;const start=performance.now();
for(const item of samples){
 if(item.frame!==frame){frame=item.frame;const rgb=fs.readFileSync(path.join(dir,`${frame}.rgb`)),data=new Uint8ClampedArray(manifest.width*manifest.height*4);if(rgb.length*4!==data.length*3)throw Error("Bad native frame");for(let i=0;i<rgb.length/3;i++){data[i*4]=rgb[i*3];data[i*4+1]=rgb[i*3+1];data[i*4+2]=rgb[i*3+2];data[i*4+3]=255;}image={width:manifest.width,height:manifest.height,data};}
 const outline=mode==="rough"?[[0,0],[1,0],[1,1],[0,1]].map(([u,v],i)=>projectQuad(item.quad,(u-.5)*1.12+.5+.03+(i===1?.02:0),(v-.5)*.92+.5-.02+(i===2?.02:0))):item.quad;
 const result=matchFireQuad(image,sheets,outline,{refineGeometry:mode!=="fixed",phaseEvidence:fullTable}),top=result.candidates[0];
 const fixed=mode==="fixed"?result:matchFireQuad(image,sheets,outline,{refineGeometry:false});
 const correct=c=>!!c&&c.sheet===item.expected[0]&&c.row===item.expected[1]&&c.mirrored===item.expected[2];
 rows.push({...item,...(fullTable?{table:(result.phaseCandidates??[]).map(({sheet,row,mirrored,score})=>({sheet,row,mirrored,score}))}:{}),fixedScore:fixed.candidates[0]?.score??0,optimizedScore:top?.score??0,status:result.status,searched:result.searched,correct:correct(top),top3:result.candidates.slice(0,3).some(correct),margin:result.margin,candidates:result.candidates.map(({sheet,row,mirrored,score,support,maskSamples,regions})=>({sheet,row,mirrored,score,support,maskSamples,regions}))});
 if(rows.length%25===0)console.error(`${tag} ${split}: ${rows.length}/${samples.length}`);
}
function summary(items){const accepted=items.filter(r=>r.status==="clear");return {quads:items.length,top1:items.filter(r=>r.correct).length,top3:items.filter(r=>r.top3).length,accepted:accepted.length,accepted_correct:accepted.filter(r=>r.correct).length,accepted_wrong:accepted.filter(r=>!r.correct).length,abstained:items.length-accepted.length};}
const groups={};for(const source of ["block","entity","overlay"])groups[source]=summary(rows.filter(r=>r.source===source));
for(const [name,test] of [["vis_lt_0.25",r=>r.visibility<.25],["vis_ge_0.75",r=>r.visibility>=.75],["veiled",r=>r.veil>.5]])groups[name]=summary(rows.filter(test));
const report={tag,split,mode,every,hashes,joined_sha256:manifest.joined_sha256,elapsed_seconds:(performance.now()-start)/1000,summary:summary(rows),groups,rows};
fs.writeFileSync(path.join(dir,`${tag}-${mode}-${split}.json`),JSON.stringify(report));console.log(JSON.stringify({...report,rows:undefined}));
