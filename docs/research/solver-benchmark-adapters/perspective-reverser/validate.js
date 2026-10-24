// Checks for the PerspectiveReverser adapter (written before the adapter).
// Usage: node validate.js CASES.json [ANSWERS.json ...]
//  1. conventions: the tool's own project() at the truth camera reproduces every noise-free synthetic click and
//     held-out pixel to 1e-6 px (pixel origin, y down, yaw sign, vertical FOV, aspect);
//  2. the bench <-> tool camera mapping round-trips;
//  3. each answers file: one answer per case, right array lengths, finite numbers, and on noise-free `spread`
//     cases (if the file is a converged run) clicks reproduced to <= 0.01 px.
const fs = require("fs");
const tool = require("./tool_verbatim.js");
const conv = require("./conv.js");

const cases = JSON.parse(fs.readFileSync(process.argv[2])).cases;
let failures = 0;
const fail = (m) => { failures++; console.log("FAIL " + m); };

// 1. conventions
let worst = 0, realWorst = 0;
for (const c of cases) {
    const t = tool.createTool(c.w, c.h);
    conv.benchToState(c.truth, t.state);
    const k = t.projectConstants(), v = t.projectVariables();
    const pts = c.kind === "synthetic" && c.noise === 0 ? [...c.clicks, ...c.heldout] : c.heldout;
    for (const p of pts) {
        const q = tool.project(k, v, 0, p.world);
        const e = Math.hypot(q[0] - p.px[0], q[1] - p.px[1]);
        if (c.kind === "synthetic") worst = Math.max(worst, e); else realWorst = Math.max(realWorst, e);
    }
}
console.log(`conventions: synthetic max |tool.project(truth) - px| = ${worst.toExponential(3)} px; ` +
    `real held-out max = ${realWorst.toFixed(3)} px (truth has roll, the tool has none; log rounding 0.05 px)`);
if (!(worst <= 1e-6)) fail("tool projection at the truth camera does not reproduce the synthetic pixels");

// 2. mapping round trip
for (const c of cases.slice(0, 20)) {
    const t = tool.createTool(c.w, c.h);
    conv.benchToState(c.truth, t.state);
    const back = conv.stateToBench(t.state);
    for (const key of ["x", "y", "z", "yaw", "pitch", "fov"]) {
        let d = back[key] - c.truth[key];
        if (key === "yaw") d = ((d % 360) + 540) % 360 - 180;
        if (Math.abs(d) > 1e-9) fail(`round trip ${c.id} ${key}: ${back[key]} vs ${c.truth[key]}`);
    }
}

// 3. answers files
for (const file of process.argv.slice(3)) {
    const a = JSON.parse(fs.readFileSync(file));
    const byId = new Map(a.answers.map((x) => [x.id, x]));
    const converged = /converged/.test(file);
    let missing = 0, spreadWorst = 0, spreadN = 0;
    for (const c of cases) {
        const x = byId.get(c.id);
        if (!x) { missing++; continue; }
        if (!x.ok) continue;
        if (x.clicks_px.length !== c.clicks.length || x.heldout_px.length !== c.heldout.length) fail(`${file} ${c.id} lengths`);
        if (![...x.clicks_px, ...x.heldout_px].flat().every(Number.isFinite)) fail(`${file} ${c.id} non-finite px`);
        if (c.layout === "spread" && c.noise === 0) {
            const rms = Math.sqrt(c.clicks.reduce((s, p, i) => s + (x.clicks_px[i][0] - p.px[0]) ** 2 + (x.clicks_px[i][1] - p.px[1]) ** 2, 0) / c.clicks.length);
            spreadWorst = Math.max(spreadWorst, rms); spreadN++;
            if (converged && rms > 0.01) fail(`${file} ${c.id}: noise-free spread click RMS ${rms.toFixed(4)} px > 0.01`);
        }
    }
    if (missing) fail(`${file}: ${missing} cases without an answer`);
    console.log(`${file}: ${a.answers.length} answers, noise-free spread worst click RMS ${spreadWorst.toExponential(3)} px over ${spreadN}`);
}
console.log(failures ? `${failures} FAILURES` : "all checks passed");
process.exitCode = failures ? 1 : 0;
