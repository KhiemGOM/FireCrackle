//! fire_camera <labels.jsonl> [--every N] [--limit N] [--csv out.csv] [--grid VIDEO_FRAME grid.json]
//!
//! Solves the camera of every labelled frame from its fire blocks alone (`fire_core::camera::fit_label_frame`) and
//! reports how well the solved camera reproduces the logged quad corners, plus an independent check: the distance
//! from the solved eye to each block centre against the distance the mod logged. Reads label-mod rows or joined rows
//! (`{"label": {...}}`). `--grid N out.json`: solve only joined row `n` = N and write the block grid of the ground the
//! player stands on (lines at every block edge, ±10 blocks around the camera), projected through the solved camera, to draw over that
//! video frame as a check that does not involve the fire.
use fire_core::camera::{fit_label_frame, logged_blocks};
use fire_core::json::{parse, Value};
use std::io::{BufRead, Write};

fn pct(v: &mut [f64], p: f64) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    v[((v.len() - 1) as f64 * p).round() as usize]
}

/// Polylines of the block grid on the ground under the player (y = block surface below the feet, eye − 1.62), ±10
/// blocks around the camera, projected through the camera.
fn write_grid(path: &str, f: &fire_core::camera::Fit, w: usize, h: usize) {
    let y = (f.camera.pos[1] - 1.62).floor();
    let pos = [
        f.camera.pos[0].floor() as i32,
        0,
        f.camera.pos[2].floor() as i32,
    ];
    let mut lines = Vec::new();
    let mut add = |a: [f64; 3], b: [f64; 3]| {
        let mut line: Vec<String> = Vec::new();
        for i in 0..=64 {
            let t = i as f64 / 64.0;
            let p = [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t];
            // only points comfortably in front of the camera
            if f.camera.to_view(p)[2] < -0.3 {
                if let Some((x, yy)) = f.camera.project(p, w, h) {
                    line.push(format!("[{x:.2},{yy:.2}]"));
                    continue;
                }
            }
            if line.len() > 1 {
                lines.push(format!("[{}]", line.join(",")));
            }
            line.clear();
        }
        if line.len() > 1 {
            lines.push(format!("[{}]", line.join(",")));
        }
    };
    for k in -10..=11 {
        let (x, z) = ((pos[0] + k) as f64, (pos[2] + k) as f64);
        add([x, y, pos[2] as f64 - 10.0], [x, y, pos[2] as f64 + 11.0]);
        add([pos[0] as f64 - 10.0, y, z], [pos[0] as f64 + 11.0, y, z]);
    }
    let c = f.camera;
    std::fs::write(
        path,
        format!(
            "{{\"w\":{w},\"h\":{h},\"rms\":{},\"camera\":[{},{},{},{},{},{},{}],\"lines\":[{}]}}",
            f.rms,
            c.pos[0],
            c.pos[1],
            c.pos[2],
            c.yaw,
            c.pitch,
            c.roll,
            c.fov,
            lines.join(",")
        ),
    )
    .expect("write grid");
}

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .expect("usage: fire_camera <labels.jsonl> [--every N] [--limit N] [--csv out.csv]");
    let (mut every, mut limit, mut csv, mut grid) = (1usize, usize::MAX, None, None);
    while let Some(f) = args.next() {
        let v = args.next().unwrap_or_default();
        match f.as_str() {
            "--every" => every = v.parse().expect("--every"),
            "--limit" => limit = v.parse().expect("--limit"),
            "--csv" => csv = Some(v),
            "--grid" => {
                grid = Some((
                    v.parse::<f64>().expect("--grid N"),
                    args.next().expect("--grid N out.json"),
                ))
            }
            other => panic!("unknown flag {other}"),
        }
    }
    let mut out = csv.map(|p| {
        let mut f = std::io::BufWriter::new(std::fs::File::create(p).expect("create csv"));
        writeln!(
            f,
            "frame,blocks,quads,rms,x,y,z,yaw,pitch,roll,fov,one_plane,dropped,max_dist_err"
        )
        .unwrap();
        f
    });
    let file = std::io::BufReader::new(std::fs::File::open(&path).expect("open labels"));
    let t0 = std::time::Instant::now();
    let (mut rows, mut fitted, mut one_plane) = (0usize, 0usize, 0usize);
    let (mut rms, mut fovs, mut dist_err) = (Vec::new(), Vec::new(), Vec::new());
    for line in file.lines() {
        let line = line.expect("read");
        let Ok(v) = parse(&line) else { continue };
        if let Some((n, _)) = &grid {
            if v.get("n").and_then(Value::num) != Some(*n) {
                continue;
            }
        }
        let label = v.get("label").unwrap_or(&v);
        let (Some(w), Some(h)) = (
            label.get("w").and_then(Value::num),
            label.get("h").and_then(Value::num),
        ) else {
            continue;
        };
        let blocks = logged_blocks(label);
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
        if let Some((_, gp)) = &grid {
            let f =
                fit_label_frame(&blocks, w as usize, h as usize).expect("no fit for this frame");
            write_grid(gp, &f, w as usize, h as usize);
            println!(
                "frame fitted: rms {:.4} px, camera {:?}; grid written to {gp}",
                f.rms, f.camera
            );
            return;
        }
        let Some(f) = fit_label_frame(&blocks, w as usize, h as usize) else {
            continue;
        };
        fitted += 1;
        one_plane += f.one_plane as usize;
        rms.push(f.rms);
        if !f.one_plane {
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
                f.one_plane,
                f.dropped_quads,
                worst
            )
            .unwrap();
        }
    }
    let s = t0.elapsed().as_secs_f64();
    println!("{path}: {rows} rows with logged block quads; fitted {fitted} ({:.1} ms each), one plane (FOV from its perspective alone) on {one_plane}", 1000.0 * s / fitted.max(1) as f64);
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
