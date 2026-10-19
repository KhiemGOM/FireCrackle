import fs from 'node:fs';
import {quadReadability,READABLE_QUAD} from '../soul-quad-size-audit.mjs';
const out='.board/soul-12m',raw=JSON.parse(fs.readFileSync(`${out}/candidates.json`));
const grouped=new Map(),rejected={},all=[];
for(const row of raw.candidates){
 const readability=quadReadability(row.quad,row.width,row.height);
 if(!readability.eligible){const key=`${row.material}_${readability.reason}`;rejected[key]=(rejected[key]??0)+1;continue;}
 const item={...row,readability};all.push(item);const key=`${row.material}-${row.frame}`;
 if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(item);
}
const selected=[...grouped.values()].flatMap(rs=>rs.sort((a,b)=>b.readability.minPixelsPerTexel-a.readability.minPixelsPerTexel||a.id.localeCompare(b.id)).slice(0,8));
function summarize(rows){
 const phases=Array(32).fill(0),per_minute={};for(const r of rows){phases[r.phase]++;const m=Math.floor(r.frame/3600);per_minute[m]=(per_minute[m]??0)+1;}
 return {quads:rows.length,frames:new Set(rows.map(r=>r.frame)).size,phases,phase_coverage:phases.filter(x=>x>0).length,min_phase_count:Math.min(...phases),max_phase_count:Math.max(...phases),per_minute,groups:Object.fromEntries([...new Set(rows.map(r=>r.source))].map(s=>[s,rows.filter(r=>r.source===s).length]))};
}
const summary={...raw,candidates:undefined,geometry:READABLE_QUAD,rejected,all_eligible:Object.fromEntries(['soul','normal'].map(m=>[m,summarize(all.filter(r=>r.material===m))])),capped8_per_frame:Object.fromEntries(['soul','normal'].map(m=>[m,summarize(selected.filter(r=>r.material===m))])),split:'Not assigned; fresh recording audit only, owner agreement required before fitting',correlation:'One recording, repeated nearby quads; selected counts are not independent scenes.'};
fs.writeFileSync(`${out}/selected.json`,JSON.stringify({criteria:READABLE_QUAD,samples:selected}));fs.writeFileSync(`${out}/audit.json`,JSON.stringify(summary,null,2));
fs.writeFileSync('FireCrackle/scripts/soul-recording-audit/results.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
