//! fire_reversal VIDEO JOINED.jsonl [--every N] [--limit N] [--gui DIR] [--csv out.csv] [--draw N out.json]
//!
//! Scores automatic perspective reversal (`fire_core::reversal::orientation`) on a labelled recording. The reversal
//! reads only the video frame (plus the GUI mask, which also comes from the frame). The answer key is the camera that
//! `camera::fit_label_frame` solves from the logged fire quads, used only on frames where it reproduces every logged
//! corner (rms ≤ 0.06 px, not a single plane). Row n of JOINED is video frame n (fire-decode output).
//! Also scores the guided solve (`camera::solve_guided`): the automatic guess plus two simulated clicks (fire-block base
//! corners projected through the answer key, ±1 px), against every logged fire quad corner of the frame.
//! `--draw N out.json`: for frame N only, write its segments with the axis each supports under the found answer and
//! under the answer key, and the GUI mask's box, to draw over the frame (`out.json` + `out.rgb`, the raw frame).
use fire_core::camera::{
    fit_label_frame, logged_blocks, solve, solve_guided, Camera, Guess, LoggedBlock,
};
use fire_core::gui_mask::{add_screen_masks, GuiDetector, GuiOptions, GuiTextures};
use fire_core::json::{parse, Value};
use fire_core::reversal::{explain, orientation, rotation_error, Orientation};
use fire_core::video::{parse_probe, read_frame};
use std::io::{BufRead, Write};
use std::process::{Command, Stdio};

fn pct(v: &mut [f64], p: f64) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    v[((v.len() - 1) as f64 * p).round() as usize]
}

fn main() {
    let mut args = std::env::args().skip(1);
    let usage = "usage: fire_reversal VIDEO JOINED.jsonl [--every N] [--limit N] [--gui DIR] [--csv out.csv]";
    let video = args.next().expect(usage);
    let joined = args.next().expect(usage);
    let (mut every, mut limit, mut gui_dir, mut csv, mut draw) = (
        1usize,
        usize::MAX,
        "../data/assets/gui".to_string(),
        None,
        None,
    );
    while let Some(f) = args.next() {
        let v = args.next().expect(usage);
        match f.as_str() {
            "--every" => every = v.parse().expect("--every"),
            "--limit" => limit = v.parse().expect("--limit"),
            "--gui" => gui_dir = v,
            "--csv" => csv = Some(v),
            "--draw" => {
                draw = Some((
                    v.parse::<u64>().expect("--draw N"),
                    args.next().expect("--draw N out.json"),
                ))
            }
            other => panic!("unknown flag {other}"),
        }
    }
    let gui = GuiDetector::new(
        GuiTextures::load(std::path::Path::new(&gui_dir)).expect("gui textures"),
        GuiOptions::default(),
    )
    .expect("gui detector");
    let probe = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate",
        ])
        .args(["-of", "default=noprint_wrappers=1"])
        .arg(&video)
        .output()
        .expect("ffprobe");
    let info = parse_probe(&String::from_utf8_lossy(&probe.stdout)).expect("probe");
    let (w, h) = (info.width, info.height);
    let mut child = Command::new("ffmpeg")
        .args(["-nostdin", "-loglevel", "error", "-nostats", "-i"])
        .arg(&video)
        .args([
            fire_core::video::PASSTHROUGH_ARGS[0],
            fire_core::video::PASSTHROUGH_ARGS[1],
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "-",
        ])
        .stdout(Stdio::piped())
        .spawn()
        .expect("ffmpeg");
    let mut pipe = child.stdout.take().expect("piped");
    let mut frame = vec![0u8; w * h * 3];
    let mut out = csv.map(|p| {
        let mut f = std::io::BufWriter::new(std::fs::File::create(p).expect("create csv"));
        writeln!(f, "n,true_yaw,true_pitch,true_roll,true_fov,yaw,pitch,roll,fov,fov_known,ambiguous,margin,support,segments,rot_err,fov_err,ms").unwrap();
        f
    });
    let t0 = std::time::Instant::now();
    let (mut keyed, mut tried, mut answered, mut ambiguous, mut fov_known) =
        (0usize, 0usize, 0usize, 0usize, 0usize);
    let (mut rot, mut rot_clear, mut fov_err, mut ms) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut worst: Vec<(f64, u64)> = Vec::new();
    // guided solve: quad corner error (px) with 2 clicks, 1 click + eye height, and 4 clicks unguided
    let (mut g2, mut g3, mut g4, mut g1, mut u4) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for (row, line) in std::io::BufReader::new(std::fs::File::open(&joined).expect("joined"))
        .lines()
        .enumerate()
    {
        let row = row as u64;
        let line = line.expect("read");
        if !read_frame(&mut pipe, &mut frame).expect("frame") {
            break;
        }
        let Ok(v) = parse(&line) else { continue };
        let label = v.get("label").unwrap_or(&v);
        let (Some(lw), Some(lh)) = (
            label.get("w").and_then(Value::num),
            label.get("h").and_then(Value::num),
        ) else {
            continue;
        };
        let blocks = logged_blocks(label);
        if blocks.is_empty() {
            continue;
        }
        keyed += 1;
        if let Some((d, _)) = &draw {
            if row != *d {
                continue;
            }
        } else if (keyed - 1) % every != 0 {
            continue;
        }
        if tried >= limit {
            break;
        }
        let Some(key) = fit_label_frame(&blocks, lw as usize, lh as usize) else {
            continue;
        };
        if key.rms > 0.06 || key.fov_fixed {
            continue;
        }
        tried += 1;
        let t = std::time::Instant::now();
        // HUD, then menus and inventories (the same two steps as `pov`)
        let mask = gui.detect(&frame, w, h).ok().map(|mut m| {
            let _ = add_screen_masks(&frame, w, h, gui.textures(), &mut m);
            m
        });
        let ignore: Option<Vec<bool>> = mask.map(|m| m.piece.iter().map(|&p| p != 0).collect());
        let found = orientation(&frame, w, h, ignore.as_deref());
        let took = t.elapsed().as_secs_f64() * 1000.0;
        if let Some((_, path)) = &draw {
            let c = key.camera;
            let truth = Orientation {
                yaw: c.yaw,
                pitch: c.pitch,
                roll: c.roll,
                fov: c.fov,
                ..found.unwrap_or(Orientation {
                    yaw: 0.0,
                    pitch: 0.0,
                    roll: 0.0,
                    fov: 70.0,
                    fov_known: false,
                    ambiguous: false,
                    margin: 0.0,
                    support: 0.0,
                    edges: 0,
                })
            };
            let seg = |o: &Orientation| -> String {
                explain(&frame, w, h, ignore.as_deref(), o)
                    .iter()
                    .map(|(s, k)| {
                        format!(
                            "[{:.1},{:.1},{:.4},{:.4},{:.1},{}]",
                            s.centre[0] + w as f64 / 2.0,
                            h as f64 / 2.0 - s.centre[1],
                            s.dir[0],
                            -s.dir[1],
                            s.length,
                            k.map_or(-1, |k| k as i64)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",")
            };
            let found_json = found.map_or("[]".to_string(), |o| format!("[{}]", seg(&o)));
            let gui_px = ignore
                .as_ref()
                .map_or(0, |m| m.iter().filter(|&&b| b).count());
            std::fs::write(
                path,
                format!(
                    "{{\"w\":{w},\"h\":{h},\"truth\":\"{:?}\",\"found\":\"{:?}\",\"gui_pixels\":{gui_px},\"under_found\":{found_json},\"under_truth\":[{}]}}",
                    c, found, seg(&truth)
                ),
            )
            .expect("write draw json");
            std::fs::write(format!("{path}.rgb"), &frame).expect("write frame");
            if let Some(m) = &ignore {
                std::fs::write(
                    format!("{path}.mask"),
                    m.iter().map(|&b| b as u8).collect::<Vec<u8>>(),
                )
                .expect("mask");
            }
            println!("frame {row}: truth {c:?}\n  found {found:?}\n  written {path}");
            let _ = child.kill();
            let _ = child.wait();
            return;
        }
        ms.push(took);
        let c = key.camera;
        let Some(o) = found else {
            if let Some(f) = out.as_mut() {
                writeln!(
                    f,
                    "{row},{:.3},{:.3},{:.3},{:.3},,,,,,,,,,,,{took:.0}",
                    c.yaw, c.pitch, c.roll, c.fov
                )
                .unwrap();
            }
            continue;
        };
        answered += 1;
        let (lw, lh) = (lw as usize, lh as usize);
        let g = Guess {
            yaw: o.yaw,
            pitch: o.pitch,
            roll: o.roll,
            fov: o.fov,
            yaw_mod_90: true,
            fov_known: o.fov_known,
            roll_fixed: false,
        };
        let clicks = simulated_clicks(&blocks, &c, lw, lh);
        let err = |f: Option<&fire_core::camera::Fit>| {
            f.map_or(f64::INFINITY, |f| quad_error(&blocks, &f.camera, lw, lh))
        };
        if clicks.len() >= 4 {
            g2.push(err(solve_guided(&clicks[..2], lw, lh, &g, None).first()));
            g3.push(err(solve_guided(&clicks[..3], lw, lh, &g, None).first()));
            g4.push(err(solve_guided(&clicks[..4], lw, lh, &g, None).first()));
            // one click + eye height fits every quarter turn: the user picks among them, so score the best
            g1.push(
                solve_guided(&clicks[..1], lw, lh, &g, Some(c.pos[1]))
                    .iter()
                    .map(|f| err(Some(f)))
                    .fold(f64::INFINITY, f64::min),
            );
            u4.push(err(solve(&clicks[..4], lw, lh).as_ref()));
        }
        ambiguous += o.ambiguous as usize;
        fov_known += o.fov_known as usize;
        let e = rotation_error(&o, &c);
        rot.push(e);
        if !o.ambiguous {
            rot_clear.push(e);
            worst.push((e, row));
        }
        let fe = (o.fov - c.fov).abs();
        if o.fov_known && !o.ambiguous {
            fov_err.push(fe);
        }
        if let Some(f) = out.as_mut() {
            writeln!(
                f,
                "{row},{:.3},{:.3},{:.3},{:.3},{:.3},{:.3},{:.3},{:.3},{},{},{:.4},{:.3},{},{e:.3},{fe:.3},{took:.0}",
                c.yaw, c.pitch, c.roll, c.fov, o.yaw, o.pitch, o.roll, o.fov, o.fov_known, o.ambiguous, o.margin, o.support, o.edges
            )
            .unwrap();
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    let p = |a: usize, b: usize| 100.0 * a as f64 / b.max(1) as f64;
    let share = |v: &[f64], t: f64| {
        100.0 * v.iter().filter(|&&e| e <= t).count() as f64 / v.len().max(1) as f64
    };
    println!(
        "{joined}: {tried} frames with an exact answer key ({:.0} s, {:.0} ms/frame median)",
        t0.elapsed().as_secs_f64(),
        pct(&mut ms, 0.5)
    );
    println!(
        "  answered {:.1} %, of those ambiguous {:.1} %, FOV known {:.1} %",
        p(answered, tried),
        p(ambiguous, answered),
        p(fov_known, answered)
    );
    println!(
        "  rotation error, clear answers (yaw mod 90): p50 {:.2}  p90 {:.2}  p99 {:.2} deg; <= 0.5 deg {:.1} %, <= 2 deg {:.1} %",
        pct(&mut rot_clear, 0.5), pct(&mut rot_clear, 0.9), pct(&mut rot_clear, 0.99), share(&rot_clear, 0.5), share(&rot_clear, 2.0)
    );
    println!(
        "  rotation error, all answers: p50 {:.2}  p90 {:.2} deg",
        pct(&mut rot, 0.5),
        pct(&mut rot, 0.9)
    );
    println!(
        "  FOV error (FOV known, clear): p50 {:.2}  p90 {:.2}  p99 {:.2} deg",
        pct(&mut fov_err, 0.5),
        pct(&mut fov_err, 0.9),
        pct(&mut fov_err, 0.99)
    );
    let report = |name: &str, v: &mut Vec<f64>| {
        let n = v.len();
        let ok = v.iter().filter(|&&e| e <= 2.0).count();
        println!(
            "  {name}: {n} frames, quad corner error p50 {:.2}  p90 {:.2} px; <= 2 px {:.1} %",
            pct(v, 0.5),
            pct(v, 0.9),
            100.0 * ok as f64 / n.max(1) as f64
        );
    };
    report("guess + 2 clicks", &mut g2);
    report("guess + 3 clicks", &mut g3);
    report("guess + 4 clicks", &mut g4);
    report(
        "guess + 1 click + eye height (best of the quarter turns)",
        &mut g1,
    );
    report("4 clicks, no guess", &mut u4);
    worst.sort_by(|a, b| b.0.total_cmp(&a.0));
    println!(
        "  worst clear answers (deg, frame): {:?}",
        &worst[..worst.len().min(10)]
    );
}

/// Block corners the user could click: corners of the logged fire blocks (base and top, not all on one plane), projected through the answer key
/// with a deterministic ±1 px wobble, farthest-apart pair first. Corners off screen or behind are skipped.
fn simulated_clicks(
    blocks: &[LoggedBlock],
    c: &Camera,
    w: usize,
    h: usize,
) -> Vec<([f64; 3], [f64; 2])> {
    let mut pts: Vec<([f64; 3], [f64; 2])> = Vec::new();
    for b in blocks {
        for (dx, dy, dz) in [
            (0, 0, 0),
            (1, 1, 0),
            (0, 1, 1),
            (1, 0, 1),
            (1, 0, 0),
            (0, 1, 0),
        ] {
            let p = [
                (b.pos[0] + dx) as f64,
                (b.pos[1] + dy) as f64,
                (b.pos[2] + dz) as f64,
            ];
            if pts.iter().any(|q| q.0 == p) {
                continue;
            }
            if let Some((x, y)) = c.project(p, w, h) {
                if c.to_view(p)[2] < 0.0 && x > 0.0 && y > 0.0 && x < w as f64 && y < h as f64 {
                    let k = pts.len() as f64;
                    pts.push((p, [x + (k * 0.7).sin(), y + (k * 1.3).cos()]));
                }
            }
        }
    }
    // farthest-apart pair first
    let mut best = (0, 1, -1.0);
    for i in 0..pts.len() {
        for j in i + 1..pts.len() {
            let d = (pts[i].1[0] - pts[j].1[0]).hypot(pts[i].1[1] - pts[j].1[1]);
            if d > best.2 {
                best = (i, j, d);
            }
        }
    }
    if pts.len() >= 2 {
        let (i, j, _) = best;
        let (a, b) = (pts[i], pts[j]);
        pts.retain(|p| p.0 != a.0 && p.0 != b.0);
        pts.insert(0, b);
        pts.insert(0, a);
    }
    pts
}

/// RMS pixel distance between every logged fire quad corner and the same model corner under `cam`.
fn quad_error(blocks: &[LoggedBlock], cam: &Camera, w: usize, h: usize) -> f64 {
    fire_core::camera::corner_rms(blocks, cam, w, h).unwrap_or(f64::INFINITY)
}
