//! fire_camera <labels.jsonl> [--every N] [--limit N] [--csv out.csv]
//!
//! Solves the camera of every labelled frame from its fire blocks alone (`fire_core::camera::fit_label_frame`) and
//! reports how well the solved camera reproduces the logged quad corners, plus an independent check: the distance
//! from the solved eye to each block centre against the distance the mod logged. Reads label-mod rows or joined rows
//! (`{"label": {...}}`).
use fire_core::camera::{fit_label_frame, LoggedBlock, LoggedQuad};
use fire_core::json::{parse, Value};
use std::io::{BufRead, Write};

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

fn pct(v: &mut [f64], p: f64) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    v[((v.len() - 1) as f64 * p).round() as usize]
}

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .expect("usage: fire_camera <labels.jsonl> [--every N] [--limit N] [--csv out.csv]");
    let (mut every, mut limit, mut csv) = (1usize, usize::MAX, None);
    while let Some(f) = args.next() {
        let v = args.next().unwrap_or_default();
        match f.as_str() {
            "--every" => every = v.parse().expect("--every"),
            "--limit" => limit = v.parse().expect("--limit"),
            "--csv" => csv = Some(v),
            other => panic!("unknown flag {other}"),
        }
    }
    let mut out = csv.map(|p| {
        let mut f = std::io::BufWriter::new(std::fs::File::create(p).expect("create csv"));
        writeln!(
            f,
            "frame,blocks,quads,rms,x,y,z,yaw,pitch,roll,fov,fov_fixed,dropped,max_dist_err"
        )
        .unwrap();
        f
    });
    let file = std::io::BufReader::new(std::fs::File::open(&path).expect("open labels"));
    let t0 = std::time::Instant::now();
    let (mut rows, mut fitted, mut fov_fixed) = (0usize, 0usize, 0usize);
    let (mut rms, mut fovs, mut dist_err) = (Vec::new(), Vec::new(), Vec::new());
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
        let blocks: Vec<LoggedBlock> = label
            .get("fires")
            .and_then(Value::arr)
            .unwrap_or(&[])
            .iter()
            .filter(|s| s.get("src").and_then(Value::str) == Some("block"))
            .filter_map(|s| {
                let p = s.get("pos")?.arr()?;
                let pos = [p[0].num()? as i32, p[1].num()? as i32, p[2].num()? as i32];
                Some(LoggedBlock {
                    pos,
                    dist: s.get("dist")?.num()?,
                    quads: quads(s),
                })
            })
            .filter(|b| !b.quads.is_empty())
            .collect();
        if blocks.is_empty() {
            continue;
        }
        rows += 1;
        if (rows - 1) % every != 0 {
            continue;
        }
        if fitted >= limit {
            break;
        }
        let Some(f) = fit_label_frame(&blocks, w as usize, h as usize) else {
            continue;
        };
        fitted += 1;
        fov_fixed += f.fov_fixed as usize;
        rms.push(f.rms);
        if !f.fov_fixed {
            fovs.push(f.camera.fov);
        }
        let mut worst: f64 = 0.0;
        for b in &blocks {
            let c = [
                b.pos[0] as f64 + 0.5,
                b.pos[1] as f64 + 0.5,
                b.pos[2] as f64 + 0.5,
            ];
            let d = ((c[0] - f.camera.pos[0]).powi(2)
                + (c[1] - f.camera.pos[1]).powi(2)
                + (c[2] - f.camera.pos[2]).powi(2))
            .sqrt();
            worst = worst.max((d - b.dist).abs());
        }
        dist_err.push(worst);
        if let Some(o) = out.as_mut() {
            let c = f.camera;
            let frame = label.get("f").and_then(Value::num).unwrap_or(-1.0);
            let nq: usize = blocks.iter().map(|b| b.quads.len()).sum();
            writeln!(
                o,
                "{frame},{},{nq},{:.4},{:.4},{:.4},{:.4},{:.3},{:.3},{:.3},{:.3},{},{},{:.4}",
                blocks.len(),
                f.rms,
                c.pos[0],
                c.pos[1],
                c.pos[2],
                c.yaw,
                c.pitch,
                c.roll,
                c.fov,
                f.fov_fixed,
                f.dropped_quads,
                worst
            )
            .unwrap();
        }
    }
    let s = t0.elapsed().as_secs_f64();
    println!("{path}: {rows} rows with logged block quads; fitted {fitted} ({:.1} ms each), FOV held (one plane) on {fov_fixed}", 1000.0 * s / fitted.max(1) as f64);
    let line = |name: &str, v: &mut Vec<f64>, unit: &str| {
        println!(
            "  {name:<28} p50 {:.4}  p90 {:.4}  p99 {:.4}  max {:.4} {unit}",
            pct(v, 0.5),
            pct(v, 0.9),
            pct(v, 0.99),
            pct(v, 1.0)
        );
    };
    line("corner rms", &mut rms, "px");
    line("|solved - logged| distance", &mut dist_err, "blocks");
    line("fov (multi-plane frames)", &mut fovs, "deg");
    for t in [0.06, 0.5, 2.0] {
        println!(
            "  frames with corner rms <= {t} px: {:.1} %",
            100.0 * rms.iter().filter(|&&r| r <= t).count() as f64 / rms.len().max(1) as f64
        );
    }
}
