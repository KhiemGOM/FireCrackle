// Reuse the common geometry criterion on an existing, quality-screened recording.
import fs from 'node:fs';
import path from 'node:path';
import {quadReadability} from '../../soul-quad-size-audit.mjs';
const [source,out]=process.argv.slice(2),d=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
const rows=d.samples.filter(x=>quadReadability(x.quad,1920,1080).eligible);
fs.writeFileSync(out,JSON.stringify(rows));console.log(JSON.stringify({eligible:rows.length,all:d.samples.length}));
