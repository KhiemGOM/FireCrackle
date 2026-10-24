// node summarize.js full-score.csv : per (kind/layout) and overall, per solver: held-out RMS p50/p90, <=2px %, ms p50
const fs = require("fs");
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
const q = (a, p) => { a = a.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
const groups = new Map();
for (const r of rows) {
    const [solver, , kind, layout, n, noise, ok, h, , , , , ms] = r;
    for (const g of [`${kind} ${layout}`, "ALL"]) {
        const k = g + "|" + solver;
        if (!groups.has(k)) groups.set(k, { h: [], ms: [], n: 0, ok: 0 });
        const e = groups.get(k); e.n++;
        if (ok === "true") { e.ok++; e.h.push(Number.isFinite(Number(h)) ? Number(h) : Infinity); e.ms.push(Number(ms)); } else e.h.push(Infinity);
    }
}
console.log("| group | solver | answered | held-out p50 / p90 px | <= 2 px | ms p50 |\n|---|---|---|---|---|---|");
for (const [k, e] of groups) {
    const [g, s] = k.split("|");
    console.log(`| ${g} | ${s} | ${e.ok}/${e.n} | ${q(e.h, .5).toFixed(2)} / ${q(e.h, .9).toFixed(1)} | ${(100 * e.h.filter((x) => x <= 2).length / e.n).toFixed(0)} % | ${q(e.ms, .5).toFixed(1)} |`);
}
