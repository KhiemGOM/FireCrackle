// The shared-phase vote (src/lib/phaseConsensus.ts) on real labelled quads: every quad of a frame matched on its own
// (actual-quad-eval.mjs ... fixed 1 --full-table) versus all of a frame's quads constrained to one animation phase.
// Usage: node scripts/phase-consensus-eval.mjs DIR TAG [--grid] [--low L --high H --margin M]
//   DIR: the prepared dataset (src-tauri/target/actual-quad1); reads TAG-fixed-tune.json and TAG-fixed-validation.json.
//   --grid: try clip bounds on the tune split (validation is reported once, with the chosen bounds).
//   --by-block: vote within each fire block's (or entity's) own quads instead of the whole frame (what the 3D quad has).
import fs from "node:fs";
import path from "node:path";
import {loadLibs} from "./lib-runtime.mjs";

const [dirArg,tag="consensus"]=process.argv.slice(2);
const dir=path.resolve(dirArg);
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:Number(process.argv[i+1]);};
const {modules}=await loadLibs(["phaseConsensus"],{runtime:path.resolve(import.meta.dirname,"../src-tauri/target/phase-consensus-runtime")});
const {phaseConsensus,spritePhase,CONSENSUS_DEFAULTS}=modules.phaseConsensus;

function load(split){
 const rows=JSON.parse(fs.readFileSync(path.join(dir,`${tag}-fixed-${split}.json`))).rows.filter(r=>r.table?.length);
 const frames=new Map();
 // ids are frame-fire-quad: --by-block groups a fire's own quads
 const byBlock=process.argv.includes("--by-block");
 for(const r of rows){const key=byBlock?r.id.split("-").slice(0,2).join("-"):r.frame;if(!frames.has(key))frames.set(key,[]);frames.get(key).push(r);}
 return [...frames.values()];
}

function evaluate(frames,options){
 const t={quads:0,frames:0,indepExact:0,indepPhase:0,consExact:0,consPhase:0,confQuads:0,confRight:0,framePhase:0,inconsistent:0};
 const bySize=new Map();
 for(const quads of frames){
  const truth=quads.map(q=>spritePhase(q.expected[0],q.expected[1]));
  if(new Set(truth).size>1){t.inconsistent++;continue;} // the premise: one phase per frame
  const phase=truth[0],c=phaseConsensus(quads.map(q=>q.table),options);
  t.frames++;
  if(c?.phase===phase)t.framePhase++;
  const size=quads.length>=4?"4+":quads.length>=2?"2-3":"1";
  if(!bySize.has(size))bySize.set(size,{quads:0,indep:0,cons:0});
  const s=bySize.get(size);
  quads.forEach((q,i)=>{
   t.quads++;s.quads++;
   const top=q.candidates[0],label=c?.labels[i];
   const exact=x=>!!x&&x.sheet===q.expected[0]&&x.row===q.expected[1]&&x.mirrored===q.expected[2];
   if(exact(top)){t.indepExact++;s.indep++;}
   if(top&&spritePhase(top.sheet,top.row)===phase)t.indepPhase++;
   if(exact(label)){t.consExact++;s.cons++;}
   if(c?.phase===phase)t.consPhase++;
   if(c?.confident){t.confQuads++;if(c.phase===phase)t.confRight++;}
  });
 }
 return {...t,bySize:Object.fromEntries(bySize)};
}

const pct=(a,b)=>b?`${(100*a/b).toFixed(1)} %`:"-";
function report(name,r){
 console.log(`${name}: ${r.quads} quads in ${r.frames} frames (${r.inconsistent} frames with more than one true phase skipped)`);
 console.log(`  exact sprite (sheet+row+mirror): alone ${r.indepExact} (${pct(r.indepExact,r.quads)}) -> shared phase ${r.consExact} (${pct(r.consExact,r.quads)})`);
 console.log(`  right phase per quad:            alone ${r.indepPhase} (${pct(r.indepPhase,r.quads)}) -> shared phase ${r.consPhase} (${pct(r.consPhase,r.quads)})`);
 console.log(`  frames with the right phase: ${r.framePhase}/${r.frames} (${pct(r.framePhase,r.frames)}); confident: ${r.confQuads} quads, ${pct(r.confRight,r.confQuads)} right`);
 for(const [size,s] of Object.entries(r.bySize).sort())console.log(`    frames with ${size} quads: ${s.quads} quads, exact alone ${pct(s.indep,s.quads)} -> shared ${pct(s.cons,s.quads)}`);
}

const tune=load("tune"),validation=load("validation");
let chosen={...CONSENSUS_DEFAULTS,low:arg("--low",CONSENSUS_DEFAULTS.low),high:arg("--high",CONSENSUS_DEFAULTS.high),margin:arg("--margin",CONSENSUS_DEFAULTS.margin)};
if(process.argv.includes("--grid")){
 let best=null;
 for(const low of [-0.5,-1,-2,-4])for(const high of [1,2,4,8,1e9]){
  const r=evaluate(tune,{...chosen,low,high});
  console.log(`tune low ${low} high ${high===1e9?"none":high}: exact ${pct(r.consExact,r.quads)}, phase ${pct(r.consPhase,r.quads)}`);
  if(!best||r.consExact>best.r.consExact)best={low,high,r};
 }
 chosen={...chosen,low:best.low,high:best.high};
 console.log(`chosen on tune: low ${chosen.low}, high ${chosen.high}`);
}
report("tune",evaluate(tune,chosen));
report("validation",evaluate(validation,chosen));
