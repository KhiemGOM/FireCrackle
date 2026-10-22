// Cross-match hud-cadence findings with FireCrackle's fire-phase flags for the same video.
// usage: node crossmatch.js find_full.json flags.json
const [,, findPath, flagsPath] = process.argv;
const find = require(findPath), flags = require(flagsPath);
const hms = t => { const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = (t % 60).toFixed(2); return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(5, '0')}`; };
const items = find.findings.filter(f => f.kind === 'Jump' || f.kind === 'Drift');
const PAD = 3; // seconds either side of a flag: a shift flag is a single frame, the cadence jump lands at the next 1-s boundary
console.log(`hud-cadence: ${find.findings.length} findings (${items.filter(i => i.kind === 'Jump').length} Jump, ${items.filter(i => i.kind === 'Drift').length} Drift); FireCrackle: ${flags.length} flags\n`);
console.log('FireCrackle flag                                    | cadence findings within ±' + PAD + ' s');
for (const fl of flags) {
  const lo = fl.time - PAD, hi = fl.end_time + PAD;
  const hits = items.filter(i => i.time >= lo && i.time <= hi);
  const tag = `${fl.kind.padEnd(14)} ${fl.severity.padEnd(4)} ${hms(fl.time)}${fl.end_time - fl.time > 0.1 ? '-' + hms(fl.end_time) : ''} d=${fl.phase_delta.toFixed(1)}`;
  console.log(tag.padEnd(52) + '| ' + (hits.length ? hits.map(h => `${h.kind} ${h.shift >= 0 ? '+' : ''}${h.shift}f @ ${hms(h.time)} (${h.before}->${h.after})`).join('; ') : '-'));
}
console.log('\nAll cadence Jumps (>=3 frames), with the nearest FireCrackle flag:');
for (const j of items.filter(i => i.kind === 'Jump').sort((a, b) => a.time - b.time)) {
  let best = null;
  for (const fl of flags) { const d = Math.max(0, fl.time - j.time, j.time - fl.end_time); if (best === null || d < best.d) best = { d, fl }; }
  const near = best && best.d <= PAD ? `MATCH ${best.fl.kind}` : best ? `nearest flag ${best.d.toFixed(0)} s away` : 'no flags';
  console.log(`  ${hms(j.time)} shift ${j.shift >= 0 ? '+' : ''}${j.shift} (${j.before}->${j.after}) — ${near}`);
}

// Optional third argument: a JoltCracker JSON report. Its events (from/to in seconds, kind, jump_seconds) are matched
// the same way: any cadence Jump/Drift inside [from-PAD, to+PAD].
const joltPath = process.argv[4];
if (joltPath) {
  const jolt = require(joltPath);
  const events = (jolt.breaks || jolt.events || []).map(e => ({ from: +e.from, to: +e.to, kind: String(e.kind), jump: e.jump_seconds }));
  console.log(`\nJoltCracker ${jolt.version || ''}: ${(jolt.anchors || []).length} anchors, ${events.length} events`);
  console.log('Jolt event                                          | cadence findings within ±' + PAD + ' s');
  for (const e of events) {
    const hits = items.filter(i => i.time >= e.from - PAD && i.time <= e.to + PAD);
    const tag = `${e.kind.padEnd(18)} ${hms(e.from)}-${hms(e.to)}${e.jump !== undefined ? ' jump=' + Number(e.jump).toFixed(2) + 's' : ''}`;
    console.log(tag.padEnd(52) + '| ' + (hits.length ? hits.map(h => `${h.kind} ${h.shift >= 0 ? '+' : ''}${h.shift}f @ ${hms(h.time)} (${h.before}->${h.after})`).join('; ') : '-'));
  }
  console.log('\nCadence Jumps vs Jolt events:');
  for (const j of items.filter(i => i.kind === 'Jump').sort((a, b) => a.time - b.time)) {
    let best = null;
    for (const e of events) { const d = Math.max(0, e.from - j.time, j.time - e.to); if (best === null || d < best.d) best = { d, e }; }
    console.log(`  ${hms(j.time)} shift ${j.shift >= 0 ? '+' : ''}${j.shift} — ${best && best.d <= PAD ? 'INSIDE Jolt ' + best.e.kind : best ? 'nearest Jolt event ' + best.d.toFixed(0) + ' s away' : 'no Jolt events'}`);
  }
}
