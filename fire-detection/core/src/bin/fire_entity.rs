//! fire_entity <labels.jsonl> [--every N] [--limit N]
//!
//! Checks the entity fire model (`fire_model::entity_quads`) against the quads the label mod logged. The camera comes
//! from the frame's fire blocks (`camera::fit_label_frame`, kept when exact); the entity's feet are then fitted to
//! its logged quads under the model (rotation held at that camera: moving the entity is moving the camera the other
//! way, so `camera::solve_guided` does it). If the model is the game's, the logged corners come back to their 0.1 px
//! rounding. Logged quads are matched to model layers by sprite sheet and mirroring (layer mod 4), best fit kept.
use fire_core::camera::{fit_label_frame, logged_blocks, logged_quads, solve_guided, Guess};
use fire_core::fire_model::{entity_quads, entity_size};
use fire_core::json::{parse, Value};
use std::collections::BTreeMap;
use std::io::BufRead;

fn pct(v: &mut [f64], p: f64) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    v[((v.len() - 1) as f64 * p).round() as usize]
}

fn main() {
    let mut args = std::env::args().skip(1);
    let usage = "usage: fire_entity <labels.jsonl> [--every N] [--limit N]";
    let path = args.next().expect(usage);
    let (mut every, mut limit) = (1usize, usize::MAX);
    while let Some(f) = args.next() {
        let v = args.next().expect(usage);
        match f.as_str() {
            "--every" => every = v.parse().expect("--every"),
            "--limit" => limit = v.parse().expect("--limit"),
            other => panic!("unknown flag {other}"),
        }
    }
    let (mut rows, mut checked, mut unknown) = (0usize, 0usize, 0usize);
    let mut by_type: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    for line in std::io::BufReader::new(std::fs::File::open(&path).expect("open")).lines() {
        let line = line.expect("read");
        if !line.contains("\"src\":\"entity\"") {
            continue;
        }
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
        if checked >= limit {
            break;
        }
        let Some(key) = fit_label_frame(&blocks, w, h).filter(|f| f.rms <= 0.06 && !f.fov_fixed)
        else {
            continue;
        };
        let cam = key.camera;
        for s in label.get("fires").and_then(Value::arr).unwrap_or(&[]) {
            if s.get("src").and_then(Value::str) != Some("entity") {
                continue;
            }
            let kind = s
                .get("type")
                .and_then(Value::str)
                .unwrap_or("?")
                .to_string();
            let Some((ew, eh)) = entity_size(&kind) else {
                unknown += 1;
                continue;
            };
            let logged = logged_quads(s);
            let sheets: Vec<u8> = s
                .get("quads")
                .and_then(Value::arr)
                .unwrap_or(&[])
                .iter()
                .map(|q| q.get("s").and_then(Value::num).unwrap_or(0.0) as u8)
                .collect();
            if logged.is_empty() || sheets.len() != logged.len() {
                continue;
            }
            let model = entity_quads([0.0; 3], ew, eh, cam.yaw);
            // each logged quad: the model layers with its sheet and the same UV (mirroring)
            let options: Vec<Vec<usize>> = logged
                .iter()
                .zip(&sheets)
                .map(|(q, &sh)| {
                    (0..model.len())
                        .filter(|&l| {
                            model[l].sheet == sh && (model[l].uv[0][0] - q.uv[0][0]).abs() < 0.5
                        })
                        .collect()
                })
                .collect();
            if options.iter().any(|o| o.is_empty()) {
                by_type.entry(kind).or_default().push(f64::INFINITY);
                continue;
            }
            // try every assignment (few layers, few logged quads)
            let mut best = f64::INFINITY;
            let mut idx = vec![0usize; options.len()];
            loop {
                let mut points = Vec::new();
                for (q, (o, &i)) in logged.iter().zip(options.iter().zip(&idx)) {
                    let m = &model[o[i]];
                    // logged corners are in the game's corner order: match by UV
                    for c in 0..4 {
                        if let Some(k) = (0..4).find(|&k| {
                            (m.uv[k][0] - q.uv[c][0]).abs() < 0.5
                                && (m.uv[k][1] - q.uv[c][1]).abs() < 0.5
                        }) {
                            points.push((m.corners[k], q.corners[c]));
                        }
                    }
                }
                let guess = Guess {
                    yaw: cam.yaw,
                    pitch: cam.pitch,
                    roll: cam.roll,
                    fov: cam.fov,
                    yaw_mod_90: false,
                    fov_known: true,
                    roll_fixed: false,
                };
                if let Some(f) = solve_guided(&points, w, h, &guess, None).first() {
                    best = best.min(f.rms);
                }
                // next assignment
                let mut k = 0;
                while k < idx.len() {
                    idx[k] += 1;
                    if idx[k] < options[k].len() {
                        break;
                    }
                    idx[k] = 0;
                    k += 1;
                }
                if k == idx.len() {
                    break;
                }
            }
            by_type.entry(kind).or_default().push(best);
            checked += 1;
        }
    }
    println!(
        "{path}: {checked} entity fires checked against the model ({unknown} of unknown type)"
    );
    for (kind, v) in by_type.iter_mut() {
        let n = v.len();
        let exact = v.iter().filter(|&&e| e <= 0.1).count();
        let close = v.iter().filter(|&&e| e <= 1.0).count();
        println!(
            "  {kind:<26} {n:>5}: corner rms p50 {:.3}  p90 {:.3} px; <= 0.1 px {:.1} %, <= 1 px {:.1} %",
            pct(v, 0.5),
            pct(v, 0.9),
            100.0 * exact as f64 / n.max(1) as f64,
            100.0 * close as f64 / n.max(1) as f64
        );
    }
}
