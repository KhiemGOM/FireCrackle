// node merge.js CASES.json OUT.json PART.json... : joins shard outputs into one answers file in case order.
const fs = require("fs");
const [casesFile, outFile, ...parts] = process.argv.slice(2);
const order = new Map(JSON.parse(fs.readFileSync(casesFile)).cases.map((c, i) => [c.id, i]));
const files = parts.map((p) => JSON.parse(fs.readFileSync(p)));
const answers = files.flatMap((f) => f.answers).sort((a, b) => order.get(a.id) - order.get(b.id));
if (new Set(answers.map((a) => a.id)).size !== answers.length) throw new Error("duplicate ids across parts");
fs.writeFileSync(outFile, JSON.stringify({ solver: files[0].solver, version: files[0].version, answers }));
console.log(`${outFile}: ${answers.length} answers`);
