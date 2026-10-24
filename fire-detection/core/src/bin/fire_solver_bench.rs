//! fire_solver_bench: the camera-solver benchmark (`docs/research/SOLVER-BENCHMARK.md`). Every solver gets the same
//! clicked block corners and is scored on held-out points it never saw.
//!
//! - `cases OUT.json [--per N] [--real JOINED.jsonl --every K --limit M]...`: synthetic cases (`--per` per layout × n ×
//!   noise, default 20) and, per `--real`, cases from a labelled recording's keyed frames.
//! - `ours CASES.json DIR`: runs `camera::solve` (clicks alone) and `camera::solve_guided` (the app's path, from the
//!   case's simulated guess) and writes `DIR/answers-ours-solve.json` and `DIR/answers-ours-guided.json`.
//! - `score CASES.json ANSWERS.json... [--csv OUT.csv]`: per group and solver, answered %, held-out and click RMS,
//!   camera errors and time.
use fire_core::camera::{
    fit_label_frame, logged_blocks, logged_quad_worlds, solve, solve_guided, Camera, Guess,
};
use fire_core::json::{parse, Value};
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::BufRead;

// ---- cases

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
    fn range(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.next()
    }
    fn gauss(&mut self) -> f64 {
        let (u, v) = (self.next().max(1e-12), self.next());
        (-2.0 * u.ln()).sqrt() * (std::f64::consts::TAU * v).cos()
    }
}

struct Case {
    id: String,
    kind: &'static str,
    layout: String,
    n: usize,
    noise: f64,
    w: usize,
    h: usize,
    truth: Camera,
    guess: (f64, f64, f64),
    clicks: Vec<([f64; 3], [f64; 2])>,
    heldout: Vec<([f64; 3], [f64; 2])>,
}

const MARGIN: f64 = 20.0;

fn visible(c: &Camera, p: [f64; 3], w: usize, h: usize, near: f64, far: f64) -> Option<[f64; 2]> {
    let d =
        ((p[0] - c.pos[0]).powi(2) + (p[1] - c.pos[1]).powi(2) + (p[2] - c.pos[2]).powi(2)).sqrt();
    if d < near || d > far {
        return None;
    }
    let (x, y) = c.project(p, w, h)?;
    (x >= MARGIN && y >= MARGIN && x <= w as f64 - MARGIN && y <= h as f64 - MARGIN)
        .then_some([x, y])
}

/// `n` candidates spread out on screen, as a person clicks: each next one farthest from those chosen; `levels`
/// asks for at least that many heights among them.
fn spread(
    cands: &[([f64; 3], [f64; 2])],
    n: usize,
    levels: usize,
    rng: &mut Rng,
) -> Option<Vec<([f64; 3], [f64; 2])>> {
    if cands.len() < n {
        return None;
    }
    let mut chosen = vec![cands[(rng.next() * cands.len() as f64) as usize % cands.len()]];
    while chosen.len() < n {
        let heights: Vec<f64> = chosen.iter().map(|c| c.0[1]).collect();
        let distinct = |hs: &[f64]| {
            let mut v = hs.to_vec();
            v.sort_by(f64::total_cmp);
            v.dedup();
            v.len()
        };
        let need_level = distinct(&heights) < levels;
        let best = cands
            .iter()
            .filter(|c| !chosen.iter().any(|d| d.0 == c.0))
            .map(|c| {
                let near = chosen
                    .iter()
                    .map(|d| ((c.1[0] - d.1[0]).powi(2) + (c.1[1] - d.1[1]).powi(2)).sqrt())
                    .fold(f64::INFINITY, f64::min);
                let new_level = !heights.contains(&c.0[1]);
                (near + if need_level && new_level { 1e6 } else { 0.0 }, *c)
            })
            .max_by(|a, b| a.0.total_cmp(&b.0))?;
        chosen.push(best.1);
    }
    let mut v: Vec<f64> = chosen.iter().map(|c| c.0[1]).collect();
    v.sort_by(f64::total_cmp);
    v.dedup();
    (v.len() >= levels).then_some(chosen)
}

fn cell(c: [f64; 3]) -> Vec<[f64; 3]> {
    (0..8)
        .map(|i| {
            [
                c[0] + (i & 1) as f64,
                c[1] + ((i >> 1) & 1) as f64,
                c[2] + ((i >> 2) & 1) as f64,
            ]
        })
        .collect()
}

fn noisy(
    points: Vec<([f64; 3], [f64; 2])>,
    sigma: f64,
    rng: &mut Rng,
) -> Vec<([f64; 3], [f64; 2])> {
    points
        .into_iter()
        .map(|(p, px)| {
            (
                p,
                [px[0] + sigma * rng.gauss(), px[1] + sigma * rng.gauss()],
            )
        })
        .collect()
}

fn guess(t: &Camera, rng: &mut Rng) -> (f64, f64, f64) {
    (
        t.yaw + 0.7 * rng.gauss(),
        t.pitch + 0.7 * rng.gauss(),
        t.fov + 2.0 * rng.gauss(),
    )
}

fn synthetic(layout: &str, n: usize, noise: f64, k: usize, rng: &mut Rng) -> Case {
    let (w, h) = (2560, 1440);
    for _ in 0..100_000 {
        let truth = Camera {
            pos: [
                rng.range(-20.0, 20.0),
                1.62 + rng.range(0.0, 6.0),
                rng.range(-20.0, 20.0),
            ],
            yaw: rng.range(-180.0, 180.0),
            pitch: rng.range(-30.0, 55.0),
            roll: 0.0,
            fov: [70.0, 90.0, 110.0, 126.5][(rng.next() * 4.0) as usize % 4],
        };
        let (ex, ez) = (truth.pos[0].round() as i32, truth.pos[2].round() as i32);
        let lattice =
            |ys: &[i32], xs: std::ops::RangeInclusive<i32>, zs: std::ops::RangeInclusive<i32>| {
                let mut out = Vec::new();
                for y in ys {
                    for x in xs.clone() {
                        for z in zs.clone() {
                            let p = [x as f64, *y as f64, z as f64];
                            if let Some(px) = visible(&truth, p, w, h, 3.0, 28.0) {
                                out.push((p, px));
                            }
                        }
                    }
                }
                out
            };
        let (clicks, held) = match layout {
            "spread" | "plane" => {
                let ys: Vec<i32> = if layout == "spread" {
                    (-6..=3).collect()
                } else {
                    vec![0]
                };
                let cands = lattice(&ys, ex - 24..=ex + 24, ez - 24..=ez + 24);
                let Some(clicks) = spread(&cands, n, if layout == "spread" { 3 } else { 1 }, rng)
                else {
                    continue;
                };
                // a fire on the ground among the clicks
                let (lo, hi) = clicks
                    .iter()
                    .fold(([f64::MAX; 2], [f64::MIN; 2]), |(lo, hi), c| {
                        (
                            [lo[0].min(c.0[0]), lo[1].min(c.0[2])],
                            [hi[0].max(c.0[0]), hi[1].max(c.0[2])],
                        )
                    });
                let at = [
                    rng.range(lo[0], hi[0] - 1.0).floor(),
                    0.0,
                    rng.range(lo[1], hi[1] - 1.0).floor(),
                ];
                (clicks, cell(at))
            }
            "plane-far" => {
                let ground = lattice(&[0], ex - 24..=ex + 24, ez - 24..=ez + 24);
                if ground.is_empty() {
                    continue;
                }
                let p = ground[(rng.next() * ground.len() as f64) as usize % ground.len()].0;
                let patch: Vec<_> = ground
                    .iter()
                    .filter(|c| (c.0[0] - p[0]).abs() <= 4.0 && (c.0[2] - p[2]).abs() <= 4.0)
                    .copied()
                    .collect();
                let Some(clicks) = spread(&patch, n, 1, rng) else {
                    continue;
                };
                let (a, d) = (rng.range(0.0, std::f64::consts::TAU), rng.range(15.0, 20.0));
                let at = [
                    (p[0] + d * a.cos()).floor(),
                    -5.0,
                    (p[2] + d * a.sin()).floor(),
                ];
                (clicks, cell(at))
            }
            _ => panic!("layout {layout}"),
        };
        let far = if layout == "plane-far" { 45.0 } else { 28.0 };
        let Some(heldout) = held
            .iter()
            .map(|p| visible(&truth, *p, w, h, 2.0, far).map(|px| (*p, px)))
            .collect::<Option<Vec<_>>>()
        else {
            continue;
        };
        return Case {
            id: format!("{layout}-{n}-n{noise}-{k:03}"),
            kind: "synthetic",
            layout: layout.to_string(),
            n,
            noise,
            w,
            h,
            guess: guess(&truth, rng),
            truth,
            clicks: noisy(clicks, noise, rng),
            heldout,
        };
    }
    panic!("no {layout} case found");
}

fn real_cases(path: &str, every: usize, limit: usize, rng: &mut Rng, out: &mut Vec<Case>) {
    let name = std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("real")
        .to_string();
    let file = std::io::BufReader::new(std::fs::File::open(path).expect("open joined"));
    let (mut rows, mut frames) = (0usize, 0usize);
    for line in file.lines() {
        let line = line.expect("read");
        let Ok(v) = parse(&line) else { continue };
        let label = v.get("label").unwrap_or(&v);
        let (Some(w), Some(h)) = (
            label.get("w").and_then(Value::num),
            label.get("h").and_then(Value::num),
        ) else {
            continue;
        };
        let (w, h) = (w as usize, h as usize);
        let blocks = logged_blocks(label);
        if blocks.is_empty() {
            continue;
        }
        rows += 1;
        if (rows - 1) % every != 0 {
            continue;
        }
        if frames >= limit {
            break;
        }
        let Some(fit) = fit_label_frame(&blocks, w, h) else {
            continue;
        };
        if fit.rms > 0.06 || fit.fov_fixed || fit.dropped_quads > 0 {
            continue;
        }
        let truth = fit.camera;
        let mut cands: Vec<([f64; 3], [f64; 2])> = Vec::new();
        for b in &blocks {
            for p in cell([b.pos[0] as f64, b.pos[1] as f64, b.pos[2] as f64]) {
                if cands.iter().any(|c| c.0 == p) {
                    continue;
                }
                if let Some(px) = visible(&truth, p, w, h, 0.5, 64.0) {
                    cands.push((p, px));
                }
            }
        }
        let mut heldout = Vec::new();
        for (b, worlds) in blocks.iter().zip(logged_quad_worlds(&blocks, &truth, w, h)) {
            for (q, world) in b.quads.iter().zip(worlds) {
                let Some(world) = world else { continue };
                for (p, px) in world.into_iter().zip(q.corners) {
                    if px[0] >= 0.0 && px[1] >= 0.0 && px[0] <= w as f64 && px[1] <= h as f64 {
                        heldout.push((p, px));
                    }
                }
            }
        }
        if heldout.len() < 4 {
            continue;
        }
        let frame = v.get("n").and_then(Value::num).unwrap_or(rows as f64) as usize;
        let mut any = false;
        for n in [4usize, 8] {
            let Some(clicks) = spread(&cands, n, 2, rng) else {
                continue;
            };
            any = true;
            out.push(Case {
                id: format!("{name}-{frame}-{n}"),
                kind: "real",
                layout: name.clone(),
                n,
                noise: 1.0,
                w,
                h,
                guess: guess(&truth, rng),
                truth,
                clicks: noisy(clicks, 1.0, rng),
                heldout: heldout.clone(),
            });
        }
        frames += usize::from(any);
    }
    eprintln!("{name}: {frames} frames, {rows} rows with fire blocks");
}

fn cam_json(c: &Camera) -> String {
    format!(
        "{{\"x\":{},\"y\":{},\"z\":{},\"yaw\":{},\"pitch\":{},\"roll\":{},\"fov\":{}}}",
        c.pos[0], c.pos[1], c.pos[2], c.yaw, c.pitch, c.roll, c.fov
    )
}
fn points_json(p: &[([f64; 3], [f64; 2])]) -> String {
    let items: Vec<String> = p
        .iter()
        .map(|(w, px)| {
            format!(
                "{{\"world\":[{},{},{}],\"px\":[{},{}]}}",
                w[0], w[1], w[2], px[0], px[1]
            )
        })
        .collect();
    format!("[{}]", items.join(","))
}

fn write_cases(path: &str, cases: &[Case]) {
    let mut s = String::from("{\"cases\":[\n");
    for (i, c) in cases.iter().enumerate() {
        writeln!(
            s,
            "{{\"id\":\"{}\",\"kind\":\"{}\",\"layout\":\"{}\",\"n\":{},\"noise\":{},\"w\":{},\"h\":{},\"truth\":{},\"guess\":{{\"yaw\":{},\"pitch\":{},\"fov\":{}}},\"clicks\":{},\"heldout\":{}}}{}",
            c.id, c.kind, c.layout, c.n, c.noise, c.w, c.h, cam_json(&c.truth), c.guess.0, c.guess.1, c.guess.2,
            points_json(&c.clicks), points_json(&c.heldout), if i + 1 < cases.len() { "," } else { "" }
        )
        .unwrap();
    }
    s.push_str("]}\n");
    std::fs::write(path, s).expect("write cases");
}

// ---- reading cases and answers back

fn num(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(Value::num).unwrap_or(f64::NAN)
}
fn camera(v: &Value) -> Option<Camera> {
    let c = Camera {
        pos: [num(v, "x"), num(v, "y"), num(v, "z")],
        yaw: num(v, "yaw"),
        pitch: num(v, "pitch"),
        roll: num(v, "roll"),
        fov: num(v, "fov"),
    };
    [c.pos[0], c.pos[1], c.pos[2], c.yaw, c.pitch, c.fov]
        .iter()
        .all(|x| x.is_finite())
        .then_some(Camera {
            roll: if c.roll.is_finite() { c.roll } else { 0.0 },
            ..c
        })
}
fn points(v: Option<&Value>) -> Vec<([f64; 3], [f64; 2])> {
    v.and_then(Value::arr)
        .unwrap_or(&[])
        .iter()
        .map(|p| {
            let w = p.get("world").and_then(Value::arr).unwrap_or(&[]);
            let px = p.get("px").and_then(Value::arr).unwrap_or(&[]);
            let n = |a: &[Value], i: usize| a.get(i).and_then(Value::num).unwrap_or(f64::NAN);
            ([n(w, 0), n(w, 1), n(w, 2)], [n(px, 0), n(px, 1)])
        })
        .collect()
}
fn read_cases(path: &str) -> Vec<Case> {
    let v = parse(&std::fs::read_to_string(path).expect("read cases")).expect("parse cases");
    v.get("cases")
        .and_then(Value::arr)
        .expect("cases")
        .iter()
        .map(|c| {
            let g = c.get("guess").expect("guess");
            Case {
                id: c.get("id").and_then(Value::str).unwrap_or("").to_string(),
                kind: if c.get("kind").and_then(Value::str) == Some("real") {
                    "real"
                } else {
                    "synthetic"
                },
                layout: c
                    .get("layout")
                    .and_then(Value::str)
                    .unwrap_or("")
                    .to_string(),
                n: num(c, "n") as usize,
                noise: num(c, "noise"),
                w: num(c, "w") as usize,
                h: num(c, "h") as usize,
                truth: camera(c.get("truth").expect("truth")).expect("truth camera"),
                guess: (num(g, "yaw"), num(g, "pitch"), num(g, "fov")),
                clicks: points(c.get("clicks")),
                heldout: points(c.get("heldout")),
            }
        })
        .collect()
}

// ---- our solvers

fn run_ours(cases_path: &str, dir: &str) {
    let cases = read_cases(cases_path);
    for mode in ["solve", "guided"] {
        let mut s = format!(
            "{{\"solver\":\"ours-{mode}\",\"version\":\"fire_core::camera\",\"answers\":[\n"
        );
        for (i, c) in cases.iter().enumerate() {
            let t0 = std::time::Instant::now();
            let fit = if mode == "solve" {
                solve(&c.clicks, c.w, c.h)
            } else {
                let g = Guess {
                    yaw: c.guess.0,
                    pitch: c.guess.1,
                    roll: 0.0,
                    fov: c.guess.2,
                    yaw_mod_90: true,
                    fov_known: false,
                    roll_fixed: true,
                };
                solve_guided(&c.clicks, c.w, c.h, &g, None)
                    .into_iter()
                    .next()
                    .or_else(|| solve(&c.clicks, c.w, c.h))
            };
            let ms = t0.elapsed().as_secs_f64() * 1e3;
            let proj = |cam: &Camera, pts: &[([f64; 3], [f64; 2])]| {
                let items: Vec<String> = pts
                    .iter()
                    .map(|(p, _)| {
                        cam.project(*p, c.w, c.h)
                            .map_or("null".into(), |(x, y)| format!("[{x},{y}]"))
                    })
                    .collect();
                format!("[{}]", items.join(","))
            };
            let body = match &fit {
                Some(f) => format!(
                    "\"ok\":true,\"ms\":{ms},\"camera\":{},\"clicks_px\":{},\"heldout_px\":{},\"note\":\"{}\"",
                    cam_json(&f.camera),
                    proj(&f.camera, &c.clicks),
                    proj(&f.camera, &c.heldout),
                    if f.fov_fixed { "fov held" } else { "" }
                ),
                None => format!("\"ok\":false,\"ms\":{ms},\"camera\":null,\"note\":\"no answer\""),
            };
            writeln!(
                s,
                "{{\"id\":\"{}\",{body}}}{}",
                c.id,
                if i + 1 < cases.len() { "," } else { "" }
            )
            .unwrap();
        }
        s.push_str("]}\n");
        std::fs::write(format!("{dir}/answers-ours-{mode}.json"), s).expect("write answers");
    }
}

// ---- scoring

fn rotation(c: &Camera) -> [[f64; 3]; 3] {
    [
        c.view_dir_to_world([1.0, 0.0, 0.0]),
        c.view_dir_to_world([0.0, 1.0, 0.0]),
        c.view_dir_to_world([0.0, 0.0, 1.0]),
    ]
}
fn rotation_error(a: &Camera, b: &Camera) -> f64 {
    let (ra, rb) = (rotation(a), rotation(b));
    let trace: f64 = (0..3)
        .map(|i| (0..3).map(|k| ra[i][k] * rb[i][k]).sum::<f64>())
        .sum();
    ((trace - 1.0) / 2.0).clamp(-1.0, 1.0).acos().to_degrees()
}
fn rms(pred: Option<&[Value]>, truth: &[([f64; 3], [f64; 2])]) -> f64 {
    let Some(pred) = pred else { return f64::NAN };
    if pred.len() != truth.len() || truth.is_empty() {
        return f64::NAN;
    }
    let mut s = 0.0;
    for (p, t) in pred.iter().zip(truth) {
        let Some(a) = p.arr() else {
            return f64::INFINITY;
        };
        let (x, y) = (
            a.first().and_then(Value::num).unwrap_or(f64::NAN),
            a.get(1).and_then(Value::num).unwrap_or(f64::NAN),
        );
        if !(x.is_finite() && y.is_finite()) {
            return f64::INFINITY;
        }
        s += (x - t.1[0]).powi(2) + (y - t.1[1]).powi(2);
    }
    (s / truth.len() as f64).sqrt()
}
fn pct(v: &[f64], p: f64) -> f64 {
    let mut v: Vec<f64> = v.iter().copied().filter(|x| !x.is_nan()).collect();
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    v[((v.len() - 1) as f64 * p).round() as usize]
}

#[derive(Default)]
struct Tally {
    cases: usize,
    ok: usize,
    held: Vec<f64>,
    clicks: Vec<f64>,
    eye: Vec<f64>,
    rot: Vec<f64>,
    fov: Vec<f64>,
    ms: Vec<f64>,
}

fn score(cases_path: &str, answer_paths: &[String], csv: Option<&str>) {
    let cases = read_cases(cases_path);
    let mut table: BTreeMap<(String, String), Tally> = BTreeMap::new();
    let mut solvers = Vec::new();
    let mut rows = String::from(
        "solver,id,kind,layout,n,noise,ok,heldout_rms,click_rms,eye_err,rot_err,fov_err,ms\n",
    );
    for path in answer_paths {
        let v =
            parse(&std::fs::read_to_string(path).expect("read answers")).expect("parse answers");
        let solver = v
            .get("solver")
            .and_then(Value::str)
            .unwrap_or(path)
            .to_string();
        solvers.push(solver.clone());
        let mut by_id: BTreeMap<String, &Value> = BTreeMap::new();
        for a in v.get("answers").and_then(Value::arr).unwrap_or(&[]) {
            by_id.insert(
                a.get("id").and_then(Value::str).unwrap_or("").to_string(),
                a,
            );
        }
        for c in &cases {
            let group = format!("{} {} n={} σ={}", c.kind, c.layout, c.n, c.noise);
            let t = table.entry((group, solver.clone())).or_default();
            t.cases += 1;
            let a = by_id.get(&c.id);
            let ok = a.and_then(|a| a.get("ok")).and_then(Value::bool) == Some(true);
            let (mut held, mut click, mut eye, mut rot, mut fov) =
                (f64::INFINITY, f64::NAN, f64::NAN, f64::NAN, f64::NAN);
            if let (true, Some(a)) = (ok, a) {
                t.ok += 1;
                held = rms(a.get("heldout_px").and_then(Value::arr), &c.heldout);
                click = rms(a.get("clicks_px").and_then(Value::arr), &c.clicks);
                if let Some(cam) = a.get("camera").and_then(camera) {
                    eye = ((cam.pos[0] - c.truth.pos[0]).powi(2)
                        + (cam.pos[1] - c.truth.pos[1]).powi(2)
                        + (cam.pos[2] - c.truth.pos[2]).powi(2))
                    .sqrt();
                    rot = rotation_error(&cam, &c.truth);
                    fov = (cam.fov - c.truth.fov).abs();
                }
                t.ms.push(num(a, "ms"));
            }
            // no answer counts as a miss in the held-out column
            t.held.push(held);
            t.clicks.push(click);
            t.eye.push(eye);
            t.rot.push(rot);
            t.fov.push(fov);
            writeln!(
                rows,
                "{solver},{},{},{},{},{},{ok},{held},{click},{eye},{rot},{fov},{}",
                c.id,
                c.kind,
                c.layout,
                c.n,
                c.noise,
                a.map_or(f64::NAN, |a| num(a, "ms"))
            )
            .unwrap();
        }
    }
    if let Some(p) = csv {
        std::fs::write(p, rows).expect("write csv");
    }
    println!("| group | solver | answered | held-out px p50 / p90 | ≤ 2 px | clicks px p50 | eye err p50 | rot ° p50 | FOV ° p50 | ms p50 |");
    println!("|---|---|---|---|---|---|---|---|---|---|");
    let mut groups: Vec<String> = table.keys().map(|k| k.0.clone()).collect();
    groups.dedup();
    for g in groups {
        for s in &solvers {
            let Some(t) = table.get(&(g.clone(), s.clone())) else {
                continue;
            };
            let within = t.held.iter().filter(|x| **x <= 2.0).count();
            println!(
                "| {g} | {s} | {}/{} | {:.2} / {:.1} | {:.0} % | {:.2} | {:.3} | {:.2} | {:.2} | {:.1} |",
                t.ok, t.cases, pct(&t.held, 0.5), pct(&t.held, 0.9), 100.0 * within as f64 / t.cases as f64,
                pct(&t.clicks, 0.5), pct(&t.eye, 0.5), pct(&t.rot, 0.5), pct(&t.fov, 0.5), pct(&t.ms, 0.5)
            );
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let usage = "usage: fire_solver_bench cases OUT.json [--per N] [--real JOINED --every K --limit M]... | ours CASES DIR | score CASES ANSWERS... [--csv OUT]";
    match args.first().map(String::as_str) {
        Some("cases") => {
            let out = args.get(1).expect(usage);
            let mut per = 20;
            let mut reals: Vec<(String, usize, usize)> = Vec::new();
            let mut i = 2;
            while i < args.len() {
                match args[i].as_str() {
                    "--per" => per = args[i + 1].parse().expect("--per"),
                    "--real" => reals.push((args[i + 1].clone(), 1, usize::MAX)),
                    "--every" => {
                        reals.last_mut().expect("--every after --real").1 =
                            args[i + 1].parse().expect("--every")
                    }
                    "--limit" => {
                        reals.last_mut().expect("--limit after --real").2 =
                            args[i + 1].parse().expect("--limit")
                    }
                    _ => panic!("{usage}"),
                }
                i += 2;
            }
            let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
            let mut cases = Vec::new();
            for (layout, ns) in [
                ("spread", &[4, 6, 8, 12][..]),
                ("plane", &[4, 6, 8][..]),
                ("plane-far", &[4, 6][..]),
            ] {
                for &n in ns {
                    for noise in [0.0, 0.5, 1.0] {
                        for k in 0..per {
                            cases.push(synthetic(layout, n, noise, k, &mut rng));
                        }
                    }
                }
            }
            for (path, every, limit) in &reals {
                real_cases(path, *every, *limit, &mut rng, &mut cases);
            }
            write_cases(out, &cases);
            eprintln!("{} cases", cases.len());
        }
        Some("ours") => run_ours(args.get(1).expect(usage), args.get(2).expect(usage)),
        Some("score") => {
            let csv = args
                .iter()
                .position(|a| a == "--csv")
                .map(|i| args[i + 1].clone());
            let files: Vec<String> = args[2..]
                .iter()
                .filter(|a| *a != "--csv" && Some(*a) != csv.as_ref())
                .cloned()
                .collect();
            score(args.get(1).expect(usage), &files, csv.as_deref());
        }
        _ => panic!("{usage}"),
    }
}
