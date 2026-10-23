//! fire_locate <labels.jsonl> [--every N] [--limit N]
//!
//! Held-out check of `fire_locate::locate` on labelled frames: the camera is solved from the OTHER fire blocks of the
//! frame (`camera::fit_label_frame`, kept only when it reproduces their quads exactly), then the held-out fire is
//! located from its logged box alone. Only fully visible fires (vis >= 0.95) with a box clear of the screen edges are
//! held out, because a partly hidden fire's box is smaller than its outline.
use fire_core::camera::{fit_label_frame, LoggedBlock, LoggedQuad};
use fire_core::fire_locate::{locate, predicted_box};
use fire_core::json::{parse, Value};
use std::io::BufRead;

fn quads(source: &Value) -> Vec<LoggedQuad> {
    let mut out = Vec::new();
    for q in source.get("quads").and_then(Value::arr).unwrap_or(&[]) {
        let (Some(c), Some(uv)) = (
            q.get("c").and_then(Value::arr),
            q.get("uv").and_then(Value::arr),
        ) else {
            continue;
        };
        if c.len() != 8 || uv.len() != 8 {
            continue;
        }
        let n = |a: &[Value], i: usize| a[i].num().unwrap_or(f64::NAN);
        let mut lq = LoggedQuad {
            corners: [[0.0; 2]; 4],
            uv: [[0.0; 2]; 4],
        };
        for i in 0..4 {
            lq.corners[i] = [n(c, 2 * i), n(c, 2 * i + 1)];
            lq.uv[i] = [n(uv, 2 * i), n(uv, 2 * i + 1)];
        }
        if lq.corners.iter().flatten().all(|v| v.is_finite()) {
            out.push(lq);
        }
    }
    out
}

struct Source {
    block: LoggedBlock,
    vis: f64,
    bbox: [f64; 4],
}

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .expect("usage: fire_locate <labels.jsonl> [--every N] [--limit N]");
    let (mut every, mut limit) = (1usize, usize::MAX);
    while let Some(f) = args.next() {
        let v = args.next().unwrap_or_default();
        match f.as_str() {
            "--every" => every = v.parse().expect("--every"),
            "--limit" => limit = v.parse().expect("--limit"),
            other => panic!("unknown flag {other}"),
        }
    }
    let t0 = std::time::Instant::now();
    let (mut rows, mut tested, mut top1, mut top3, mut no_camera) =
        (0usize, 0usize, 0usize, 0usize, 0usize);
    // same outline: the located fire's full outline within 1 px of the outline of the quads the game drew
    let (mut same, mut same_by_dist) = (0usize, [0usize; 5]);
    // by distance: (tested, top-1 right)
    let mut by_dist = [(0usize, 0usize); 5];
    let bucket = |d: f64| match d {
        d if d < 4.0 => 0,
        d if d < 8.0 => 1,
        d if d < 16.0 => 2,
        d if d < 32.0 => 3,
        _ => 4,
    };
    let mut misses: Vec<String> = Vec::new();
    for line in std::io::BufReader::new(std::fs::File::open(&path).expect("open")).lines() {
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
        let sources: Vec<Source> = label
            .get("fires")
            .and_then(Value::arr)
            .unwrap_or(&[])
            .iter()
            .filter(|s| s.get("src").and_then(Value::str) == Some("block"))
            .filter_map(|s| {
                let p = s.get("pos")?.arr()?;
                let b = s.get("box")?.arr()?;
                Some(Source {
                    block: LoggedBlock {
                        pos: [p[0].num()? as i32, p[1].num()? as i32, p[2].num()? as i32],
                        dist: s.get("dist")?.num()?,
                        quads: quads(s),
                    },
                    vis: s.get("vis")?.num()?,
                    bbox: [b[0].num()?, b[1].num()?, b[2].num()?, b[3].num()?],
                })
            })
            .filter(|s| !s.block.quads.is_empty())
            .collect();
        if sources.len() < 3 {
            continue;
        }
        rows += 1;
        if (rows - 1) % every != 0 {
            continue;
        }
        if tested >= limit {
            break;
        }
        // at most two held-out fires per frame
        let held: Vec<usize> = (0..sources.len())
            .filter(|&i| {
                let b = sources[i].bbox;
                sources[i].vis >= 0.95
                    && b[0] > 2.0
                    && b[1] > 2.0
                    && b[2] < w as f64 - 2.0
                    && b[3] < h as f64 - 2.0
            })
            .take(2)
            .collect();
        for i in held {
            let others: Vec<LoggedBlock> = sources
                .iter()
                .enumerate()
                .filter(|(j, _)| *j != i)
                .map(|(_, s)| s.block.clone())
                .collect();
            let Some(f) = fit_label_frame(&others, w, h) else {
                continue;
            };
            if f.rms > 0.06 || f.fov_fixed {
                no_camera += 1;
                continue;
            }
            let found = locate(&f.camera, sources[i].bbox, w, h);
            let truth = sources[i].block.pos;
            tested += 1;
            let k = bucket(sources[i].block.dist);
            by_dist[k].0 += 1;
            if found.first().is_some_and(|c| c.pos == truth) {
                top1 += 1;
                by_dist[k].1 += 1;
            } else if misses.len() < 12 {
                let top = found.first().map_or("none".to_string(), |c| {
                    format!("{:?} {:?} err {:.1}px", c.pos, c.attach, c.error)
                });
                let rank = found.iter().position(|c| c.pos == truth);
                misses.push(format!(
                    "  truth {truth:?} dist {:.1}: top {top}; truth rank {rank:?}",
                    sources[i].block.dist
                ));
            }
            if found.iter().take(3).any(|c| c.pos == truth) {
                top3 += 1;
            }
            // the outline the game drew (logged corners, clamped like predicted_box) against the located fire's
            let mut ob = [
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ];
            for q in &sources[i].block.quads {
                for c in q.corners {
                    ob = [
                        ob[0].min(c[0]),
                        ob[1].min(c[1]),
                        ob[2].max(c[0]),
                        ob[3].max(c[1]),
                    ];
                }
            }
            let ob = [
                ob[0].max(0.0),
                ob[1].max(0.0),
                ob[2].min(w as f64),
                ob[3].min(h as f64),
            ];
            if let Some(p) = found
                .first()
                .and_then(|c| predicted_box(&f.camera, c.pos, c.attach, w, h))
            {
                if (0..4).all(|e| (p[e] - ob[e]).abs() < 1.0) {
                    same += 1;
                    same_by_dist[k] += 1;
                }
            }
        }
    }
    let pc = |a: usize, b: usize| 100.0 * a as f64 / b.max(1) as f64;
    println!("{path}: {tested} held-out fires located ({:.0} s); {no_camera} skipped (camera from the others not exact)", t0.elapsed().as_secs_f64());
    println!(
        "  same drawn outline as the real fire (every edge within 1 px): {:.1} %",
        pc(same, tested)
    );
    println!(
        "  right block first: {:.1} %   in top 3: {:.1} %  (a side fire and the neighbour's opposite side fire draw the same plane)",
        pc(top1, tested),
        pc(top3, tested)
    );
    for (k, name) in ["< 4", "4-8", "8-16", "16-32", ">= 32"].iter().enumerate() {
        println!(
            "  distance {name:>6} blocks: {:>5} fires, same outline {:.1} %, right block {:.1} %",
            by_dist[k].0,
            pc(same_by_dist[k], by_dist[k].0),
            pc(by_dist[k].1, by_dist[k].0)
        );
    }
    println!("some misses:");
    for m in misses {
        println!("{m}");
    }
}
