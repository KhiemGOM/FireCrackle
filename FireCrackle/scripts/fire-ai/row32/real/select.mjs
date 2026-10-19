import fs from 'node:fs';
import {quadReadability, READABLE_QUAD} from '../../../soul-quad-size-audit.mjs';
const root=process.argv[2]??'.board/row32-real';
const rows=JSON.parse(fs.readFileSync(`${root}/candidates.json`));
const selected=rows.map(r=>({...r,readability:quadReadability(r.quad,r.width,r.height)})).filter(r=>r.readability.eligible);
// Freeze geometry eligibility before pixels are decoded. Include all phases.
fs.writeFileSync(`${root}/selected.json`,JSON.stringify(selected));
console.log(JSON.stringify({criteria:READABLE_QUAD,counts:Object.fromEntries([...new Set(rows.map(r=>r.video))].map(v=>[v,{candidates:rows.filter(r=>r.video===v).length,selected:selected.filter(r=>r.video===v).length,frames:new Set(selected.filter(r=>r.video===v).map(r=>r.frame)).size,phases:new Set(selected.filter(r=>r.video===v).map(r=>r.phase)).size}]))},null,2));
