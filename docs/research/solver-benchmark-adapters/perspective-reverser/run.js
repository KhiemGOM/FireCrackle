// Runs PerspectiveReverser's own solver (tool_verbatim.js, copied from main.js) on bench cases.
// Usage: node run.js CASES.json OUT.json --mode default|converged [--start tool|guess] [--every N] [--cap N]
//
// One case = what a user does in the page: load the w x h screenshot (screen size defaults to the image size,
// scale 1, no crop), paste the clicks as points (exact pixel coordinates, precision 1), start from the camera in
// the state, press Reverse (defaults: per-parameter descent, 1000 iterations; free: eye x y z, yaw, pitch, FOV).
//   --start tool  : the page's default state: eye (0, 0, 0), yaw 0, pitch 0, FOV 70 (main.js 417-441).
//   --start guess : yaw/pitch/FOV from the case's guess; eye = centroid of the clicked world points minus
//                   10 blocks along the guessed look direction (the same rule for every case).
//   --mode default   : one press.
//   --mode converged : press until a press lowers the page's error (mean squared click px, the "error" label)
//                      by less than 1e-9 of itself, or the error is 0; at most --cap presses (default 3000).
// clicks_px / heldout_px come from the tool's project() at the answer (as its redraw does, main.js 3661).
const fs = require("fs");
const tool = require("./tool_verbatim.js");
const conv = require("./conv.js");

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : def; };
const [casesFile, outFile] = args;
const mode = opt("mode", "default");
const start = opt("start", "tool");
const every = Number(opt("every", "1"));
const cap = Number(opt("cap", "3000"));
const REL_STOP = 1e-9;

let cases = JSON.parse(fs.readFileSync(casesFile)).cases;
if (every > 1) {
    // every Nth case within each (kind, layout, n, noise) group, so every group stays represented
    const seen = new Map();
    cases = cases.filter((c) => {
        const g = [c.kind, c.layout, c.n, c.noise].join("/");
        const i = seen.get(g) ?? 0; seen.set(g, i + 1);
        return i % every === 0;
    });
}

// --shard i/N: this process takes cases i, i+N, ... (wall time only; merge.js joins the parts in case order)
const shard = opt("shard", null);
if (shard) { const [i0, n0] = shard.split("/").map(Number); cases = cases.filter((_, i) => i % n0 === i0); }

function startState(c, state) {
    if (start === "tool") return; // defaultState as is
    const g = c.guess;
    const yaw = g.yaw * Math.PI / 180, pitch = g.pitch * Math.PI / 180;
    const fwd = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const cen = [0, 1, 2].map((k) => c.clicks.reduce((s, p) => s + p.world[k], 0) / c.clicks.length);
    conv.benchToState({ x: cen[0] - 10 * fwd[0], y: cen[1] - 10 * fwd[1], z: cen[2] - 10 * fwd[2], yaw: g.yaw, pitch: g.pitch, fov: g.fov }, state);
}

const answers = [];
const t0 = Date.now();
const pressCounts = [];
let capped = 0;
for (const c of cases) {
    const ts = process.hrtime.bigint();
    let answer;
    try {
        const t = tool.createTool(c.w, c.h);
        startState(c, t.state);
        for (const p of c.clicks) t.createPoint(0, p.world[0], p.world[1], p.world[2], p.px[0], p.px[1]);
        const err = () => tool.projectedError(t.projectConstants(), t.projectVariables(), t.projectFrames());
        let presses = 0, e = err(), note = "";
        while (true) {
            t.pressReverse();
            presses++;
            if (t.alerts.length) break;
            const e2 = err();
            if (mode === "default") { e = e2; break; }
            const done = e2 === 0 || !(e - e2 > REL_STOP * e);
            e = e2;
            if (done) break;
            if (presses >= cap) { note = `cap ${cap} presses reached; `; capped++; break; }
        }
        const ms = Number(process.hrtime.bigint() - ts) / 1e6;
        if (t.alerts.length) {
            answer = { id: c.id, ok: false, ms, camera: null, clicks_px: [], heldout_px: [], note: "refused: " + t.alerts.join("; ") };
        } else {
            const k = t.projectConstants(), v = t.projectVariables();
            const clicks_px = c.clicks.map((p) => tool.project(k, v, 0, p.world));
            const heldout_px = c.heldout.map((p) => tool.project(k, v, 0, p.world));
            const camera = conv.stateToBench(t.state);
            const finite = [...clicks_px, ...heldout_px].flat().every(Number.isFinite);
            note += `${presses} press(es), click error ${Math.sqrt(e).toFixed(4)} px RMS`;
            if (!camera) note += `; camera not expressible (yaw ${t.state.cameraYaw}, pitch ${t.state.cameraPitch}, fov ${t.state.cameraFov})`;
            answer = finite
                ? { id: c.id, ok: true, ms, camera, clicks_px, heldout_px, note }
                : { id: c.id, ok: false, ms, camera: null, clicks_px: [], heldout_px: [], note: "non-finite projection; " + note };
        }
        pressCounts.push(presses);
    } catch (ex) {
        answer = { id: c.id, ok: false, ms: Number(process.hrtime.bigint() - ts) / 1e6, camera: null, clicks_px: [], heldout_px: [], note: "crashed: " + ex.message };
    }
    answers.push(answer);
}
const name = `perspective-reverser-${start === "guess" ? "guess-" : ""}${mode}`;
fs.writeFileSync(outFile, JSON.stringify({
    solver: name,
    version: "gaider10/PerspectiveReverser@7cba395 (js/main.js 14-282 etc. verbatim), perparam x1000 per press" +
        (mode === "converged" ? `, pressed until rel. improvement < ${REL_STOP} (cap ${cap})` : ", one press") +
        `, start ${start}` + (every > 1 ? `, every ${every}th case per group` : ""),
    answers,
}));
pressCounts.sort((a, b) => a - b);
console.log(`${name}: ${answers.length} cases, ${answers.filter((a) => a.ok).length} ok, ${((Date.now() - t0) / 1000).toFixed(1)} s; ` +
    `presses p50 ${pressCounts[pressCounts.length >> 1]} max ${pressCounts[pressCounts.length - 1]}; capped ${capped}`);
