//! Benchmark adapter for mc-locate's mode 5 (camera pose). Wraps `pose::solve_pose_full` unchanged.
//!
//! usage: mc-locate-bench-adapter CASES.json OUT.json --variant unknown|known|guess [--name NAME]
//!   unknown: FOV prompt left at its default (70); "solve for the FOV as well" = yes when n >= 6 (the tool only
//!            offers it from 6 tags), else the FOV stays at 70.
//!   known:   the true vertical FOV typed in, FOV solve off (the prompt's default answer).
//!   guess:   the case's simulated guess FOV typed in, FOV solve off.
//!
//! Pixels for clicks/held-out come from the tool's own model (`pose::intrinsics`-style K with the solved focal,
//! `pose::project_point`). As a conversion check the converted benchmark camera is also projected with the
//! benchmark's formula (a copy of fire_core `Camera::to_view` + `overlay::project`), and the tool's own residuals
//! are compared with ours; both maxima go to stderr.

#[allow(dead_code)]
mod pose;

use nalgebra::{Matrix3, Vector3};
use serde_json::{Value, json};
use std::time::Instant;

fn num(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(Value::as_f64).unwrap_or(f64::NAN)
}

fn pt(v: &Value) -> [f64; 3] {
    let a = v.as_array().expect("world point");
    [a[0].as_f64().unwrap(), a[1].as_f64().unwrap(), a[2].as_f64().unwrap()]
}

/// The benchmark's projection (fire_core camera.rs `to_view` + overlay.rs `project`), only for the conversion check.
fn bench_project(c: &[f64; 7], p: [f64; 3], w: f64, h: f64) -> Option<(f64, f64)> {
    let (x, y, z, yaw, pitch, roll, fov) = (c[0], c[1], c[2], c[3], c[4], c[5], c[6]);
    let d = [p[0] - x, p[1] - y, p[2] - z];
    let (sy, cy) = (yaw + 180.0).to_radians().sin_cos();
    let (x1, y1, z1) = (d[0] * cy + d[2] * sy, d[1], -d[0] * sy + d[2] * cy);
    let (sp, cp) = pitch.to_radians().sin_cos();
    let (y2, z2) = (y1 * cp - z1 * sp, y1 * sp + z1 * cp);
    let (sr, cr) = roll.to_radians().sin_cos();
    let v = [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2];
    if v[2] >= -1e-9 {
        return None;
    }
    let f = 1.0 / (fov.to_radians() / 2.0).tan();
    let nx = f / (w / h) * v[0] / -v[2];
    let ny = f * v[1] / -v[2];
    Some(((nx + 1.0) / 2.0 * w, (1.0 - ny) / 2.0 * h))
}

/// World->camera rotation rebuilt from the tool's reported yaw/pitch/roll (the `Solution` exposes no matrix). Inverse
/// of `pose::yaw_pitch_roll_from_rotation`: right = cos(roll)·level_right + sin(roll)·level_down, rows right/down/fwd.
fn rotation_from_ypr(yaw: f64, pitch: f64, roll: f64) -> Matrix3<f64> {
    let l = pose::rotation_from_yaw_pitch(yaw, pitch);
    let lr = Vector3::new(l[(0, 0)], l[(0, 1)], l[(0, 2)]);
    let ld = Vector3::new(l[(1, 0)], l[(1, 1)], l[(1, 2)]);
    let fw = Vector3::new(l[(2, 0)], l[(2, 1)], l[(2, 2)]);
    let (s, c) = roll.to_radians().sin_cos();
    let r = lr * c + ld * s;
    let d = -lr * s + ld * c;
    Matrix3::from_rows(&[r.transpose(), d.transpose(), fw.transpose()])
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let usage = "usage: CASES.json OUT.json --variant unknown|known|guess [--name NAME]";
    let cases_path = args.first().expect(usage);
    let out_path = args.get(1).expect(usage);
    let flag = |f: &str| args.iter().position(|a| a == f).map(|i| args[i + 1].clone());
    let variant = flag("--variant").expect(usage);
    let name = flag("--name").unwrap_or_else(|| match variant.as_str() {
        "unknown" => "mc-locate".into(),
        "known" => "mc-locate-knownfov".into(),
        "guess" => "mc-locate-guessfov".into(),
        _ => panic!("{usage}"),
    });

    let cases: Value = serde_json::from_str(&std::fs::read_to_string(cases_path).unwrap()).unwrap();
    let mut answers = Vec::new();
    let (mut worst_bench, mut worst_resid, mut worst_spread0) = (0.0f64, 0.0f64, 0.0f64);
    let mut refused: std::collections::BTreeMap<String, usize> = Default::default();
    let mut total_ms = 0.0;

    for c in cases["cases"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        let (w, h) = (c["w"].as_u64().unwrap() as u32, c["h"].as_u64().unwrap() as u32);
        let clicks: Vec<([f64; 3], [f64; 2])> = c["clicks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| (pt(&k["world"]), { let p = k["px"].as_array().unwrap(); [p[0].as_f64().unwrap(), p[1].as_f64().unwrap()] }))
            .collect();
        let held: Vec<[f64; 3]> = c["heldout"].as_array().unwrap().iter().map(|k| pt(&k["world"])).collect();
        let tags: Vec<pose::Correspondence> = clicks
            .iter()
            .map(|(wp, px)| pose::Correspondence { u: px[0], v: px[1], x: wp[0], y: wp[1], z: wp[2] })
            .collect();

        let (fov_in, solve_focal) = match variant.as_str() {
            "unknown" => (pose::DEFAULT_FOV_DEG, tags.len() >= pose::MIN_FOR_FOCAL),
            "known" => (num(&c["truth"], "fov"), false),
            "guess" => (num(&c["guess"], "fov"), false),
            _ => panic!("{usage}"),
        };
        // The CLI's own check on the typed FOV (pose::run).
        if !(fov_in > 1.0 && fov_in < 179.0) {
            answers.push(json!({"id": id, "ok": false, "ms": 0.0, "note": format!("FOV {fov_in} rejected by the CLI")}));
            continue;
        }
        let k = pose::intrinsics(w, h, fov_in);
        let t0 = Instant::now();
        let res = pose::solve_pose_full(&tags, &k, solve_focal);
        let ms = t0.elapsed().as_secs_f64() * 1e3;
        total_ms += ms;

        let sol = match res {
            Ok(s) => s,
            Err(e) => {
                let msg = format!("{e:#}");
                let key = format!("{} {} n={}: {}", c["layout"].as_str().unwrap(), variant, tags.len(), msg.split(['.', '(', ',']).next().unwrap_or(""));
                *refused.entry(key).or_default() += 1;
                answers.push(json!({"id": id, "ok": false, "ms": ms, "note": msg}));
                continue;
            }
        };

        let p = sol.pose;
        let r = rotation_from_ypr(p.yaw_deg, p.pitch_deg, sol.roll_deg);
        let centre = Vector3::new(p.x, p.y, p.z);
        let t = pose::translation_from_position(&r, &centre);
        let mut kk = k;
        kk[(0, 0)] = sol.focal_px;
        kk[(1, 1)] = sol.focal_px;
        let proj = |q: &[f64; 3]| pose::project_point(&kk, &r, &t, &Vector3::new(q[0], q[1], q[2]));
        let cam = [p.x, p.y, p.z, pose::yaw_f3_style(p.yaw_deg), p.pitch_deg, sol.roll_deg, sol.vfov_deg];

        let mut clicks_px = Vec::new();
        for (i, (wp, px)) in clicks.iter().enumerate() {
            match proj(wp) {
                Some((u, v)) => {
                    clicks_px.push(json!([u, v]));
                    let e = (u - px[0]).hypot(v - px[1]);
                    worst_resid = worst_resid.max((e - sol.residuals_px[i]).abs());
                    if c["layout"] == "spread" && num(c, "noise") == 0.0 {
                        worst_spread0 = worst_spread0.max(e);
                    }
                    if let Some((bu, bv)) = bench_project(&cam, *wp, w as f64, h as f64) {
                        worst_bench = worst_bench.max((bu - u).hypot(bv - v));
                    } else {
                        worst_bench = f64::INFINITY;
                    }
                }
                None => clicks_px.push(Value::Null),
            }
        }
        let mut heldout_px = Vec::new();
        let mut behind = 0;
        for q in &held {
            match proj(q) {
                Some((u, v)) => {
                    heldout_px.push(json!([u, v]));
                    if let Some((bu, bv)) = bench_project(&cam, *q, w as f64, h as f64) {
                        worst_bench = worst_bench.max((bu - u).hypot(bv - v));
                    }
                }
                None => {
                    behind += 1;
                    heldout_px.push(Value::Null)
                }
            }
        }
        let mut note = format!(
            "init {}, {} LM iters, rms {:.3} px, roll {:.3}°, fov {} {:.2}",
            sol.init,
            sol.iterations,
            p.rms_px,
            sol.roll_deg,
            if sol.focal_was_solved { "solved" } else { "fixed at" },
            sol.vfov_deg
        );
        if behind > 0 {
            note += &format!(", {behind} held-out point(s) behind the camera");
        }
        answers.push(json!({
            "id": id, "ok": true, "ms": ms,
            "camera": {"x": cam[0], "y": cam[1], "z": cam[2], "yaw": cam[3], "pitch": cam[4], "roll": cam[5], "fov": cam[6]},
            "clicks_px": clicks_px, "heldout_px": heldout_px, "note": note
        }));
    }

    let ok = answers.iter().filter(|a| a["ok"] == true).count();
    let out = json!({"solver": name, "version": "LAOUUUUU/mc-locate@ca0d694 src/pose.rs solve_pose_full (mode 5)", "answers": answers});
    let mut s = String::from("{\"solver\":");
    s += &serde_json::to_string(&out["solver"]).unwrap();
    s += ",\"version\":";
    s += &serde_json::to_string(&out["version"]).unwrap();
    s += ",\"answers\":[\n";
    let n = out["answers"].as_array().unwrap().len();
    for (i, a) in out["answers"].as_array().unwrap().iter().enumerate() {
        s += &serde_json::to_string(a).unwrap();
        s += if i + 1 < n { ",\n" } else { "\n" };
    }
    s += "]}\n";
    std::fs::write(out_path, s).unwrap();
    eprintln!("{name}: {ok}/{n} answered, solve time total {total_ms:.1} ms");
    eprintln!("check: noise-free spread click error max {worst_spread0:.3e} px");
    eprintln!("check: tool-model vs benchmark-model projection of converted camera, max {worst_bench:.3e} px");
    eprintln!("check: our reprojection vs the tool's own residuals, max diff {worst_resid:.3e} px");
    for (k, v) in &refused {
        eprintln!("refused {v}: {k}");
    }
}
