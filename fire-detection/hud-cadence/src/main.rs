//! hud-cadence sweep <video> [--ffmpeg PATH] [--scale 3] [--out sweep.json]
//!     Keyframes only: where is the FPS overlay visible and what does it read.
//! hud-cadence scan <video> --start SECONDS --duration SECONDS [--ffmpeg PATH] [--scale 3] [--fps 60] [--out scan.json]
//!     Every frame: change frames of the FPS value and their phase modulo one second.
use hud_cadence::font::Font;
use hud_cadence::phase::{analyse, Period};
use hud_cadence::reader::{Reading, Templates};
use std::io::Read;
use std::process::{Command, Stdio};

const STRIP_W: usize = 1500;
const STRIP_H: usize = 40;

struct Args {
    cmd: String,
    video: String,
    ffmpeg: String,
    scale: usize,
    fps: u32,
    start: f64,
    duration: f64,
    out: Option<String>,
}

fn args() -> Args {
    let mut a = Args { cmd: String::new(), video: String::new(), ffmpeg: "ffmpeg".into(), scale: 3, fps: 60, start: 0.0, duration: 60.0, out: None };
    let mut it = std::env::args().skip(1);
    a.cmd = it.next().unwrap_or_default();
    a.video = it.next().unwrap_or_default();
    while let Some(flag) = it.next() {
        let v = it.next().unwrap_or_default();
        match flag.as_str() {
            "--ffmpeg" => a.ffmpeg = v,
            "--scale" => a.scale = v.parse().expect("--scale"),
            "--fps" => a.fps = v.parse().expect("--fps"),
            "--start" => a.start = v.parse().expect("--start"),
            "--duration" => a.duration = v.parse().expect("--duration"),
            "--out" => a.out = Some(v),
            other => panic!("unknown flag {other}"),
        }
    }
    a
}

/// Streams the top-left strip of every frame ffmpeg emits as 8-bit grey. Returns (frames, ffmpeg stderr).
fn stream(a: &Args, keyframes_only: bool, mut each: impl FnMut(usize, &[u8])) -> String {
    let mut c = Command::new(&a.ffmpeg);
    c.args(["-v", "info", "-nostats", "-threads", "8"]);
    if keyframes_only {
        c.args(["-skip_frame", "nokey"]);
    }
    if a.cmd == "scan" {
        c.args(["-ss", &format!("{}", a.start), "-t", &format!("{}", a.duration)]);
    }
    c.arg("-i").arg(&a.video);
    c.args(["-vf", &format!("crop={STRIP_W}:{STRIP_H}:0:0,format=gray,showinfo"), "-fps_mode", "passthrough", "-f", "rawvideo", "-"]);
    c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c.spawn().expect("start ffmpeg");
    let mut err = child.stderr.take().unwrap();
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        err.read_to_string(&mut s).ok();
        s
    });
    let mut out = child.stdout.take().unwrap();
    let mut buf = vec![0u8; STRIP_W * STRIP_H];
    let mut n = 0;
    loop {
        let mut got = 0;
        while got < buf.len() {
            match out.read(&mut buf[got..]) {
                Ok(0) => break,
                Ok(k) => got += k,
                Err(e) => panic!("{e}"),
            }
        }
        if got < buf.len() {
            break;
        }
        each(n, &buf);
        n += 1;
    }
    child.wait().ok();
    err_thread.join().unwrap()
}

fn pts_times(stderr: &str) -> Vec<f64> {
    stderr.lines().filter_map(|l| l.split("pts_time:").nth(1)?.split_whitespace().next()?.parse().ok()).collect()
}

fn main() {
    let a = args();
    let font = Font::load(include_bytes!("../assets/ascii.png")).unwrap();
    let tpl = Templates::new(&font, a.scale);
    let t0 = std::time::Instant::now();
    match a.cmd.as_str() {
        "sweep" => {
            let mut rows: Vec<Option<Reading>> = Vec::new();
            let mut near = None;
            let err = stream(&a, true, |_, g| {
                let r = tpl.read(g, STRIP_W, STRIP_H, near);
                near = r.as_ref().map(|r| r.anchor);
                rows.push(r);
            });
            let pts = pts_times(&err);
            let visible = rows.iter().filter(|r| r.is_some()).count();
            eprintln!("{} keyframes in {:.0}s, overlay readable in {visible}", rows.len(), t0.elapsed().as_secs_f64());
            // Contiguous readable spans.
            let mut spans: Vec<(f64, f64, usize)> = Vec::new();
            let mut open = false;
            for (i, r) in rows.iter().enumerate() {
                let t = pts.get(i).copied().unwrap_or(f64::NAN);
                match (r.is_some(), open) {
                    (true, true) => {
                        let s = spans.last_mut().unwrap();
                        s.1 = t;
                        s.2 += 1;
                    }
                    (true, false) => {
                        spans.push((t, t, 1));
                        open = true;
                    }
                    (false, _) => open = false,
                }
            }
            for (s, e, n) in &spans {
                println!("overlay {s:9.1}s – {e:9.1}s  ({:.0}s, {n} keyframes)", e - s);
            }
            if let Some(path) = &a.out {
                let json: Vec<serde_json::Value> = rows
                    .iter()
                    .enumerate()
                    .map(|(i, r)| serde_json::json!({"t": pts.get(i), "fps": r.as_ref().map(|r| &r.value), "anchor": r.as_ref().map(|r| r.anchor)}))
                    .collect();
                std::fs::write(path, serde_json::to_string(&json).unwrap()).unwrap();
            }
        }
        "scan" => {
            let mut values: Vec<Option<String>> = Vec::new();
            let mut near = None;
            let mut worst = 0usize;
            stream(&a, false, |_, g| {
                let r = tpl.read(g, STRIP_W, STRIP_H, near);
                near = r.as_ref().map(|r| r.anchor);
                if let Some(r) = &r {
                    worst = worst.max(r.mismatches.iter().copied().max().unwrap_or(0));
                }
                values.push(r.map(|r| r.value));
            });
            let total = values.len();
            let readable = values.iter().filter(|v| v.is_some()).count();
            // Change frames: value differs from the previous readable value.
            let mut changes: Vec<u32> = Vec::new();
            let mut prev: Option<&String> = None;
            for (i, v) in values.iter().enumerate() {
                if let Some(v) = v {
                    if prev.is_some_and(|p| p != v) {
                        changes.push(i as u32);
                    }
                    prev = Some(v);
                }
            }
            let an = analyse(&changes, Period::Frames(a.fps));
            eprintln!(
                "{total} frames in {:.0}s ({:.0} fps); readable {readable}; worst digit mismatch {worst} px; {} changes, {} missing boundaries",
                t0.elapsed().as_secs_f64(),
                total as f64 / t0.elapsed().as_secs_f64(),
                changes.len(),
                an.missing
            );
            let mut hist = vec![0u32; a.fps as usize];
            for &c in &changes {
                hist[(c % a.fps) as usize] += 1;
            }
            let used: Vec<String> = hist.iter().enumerate().filter(|(_, &n)| n > 0).map(|(k, n)| format!("{k}:{n}")).collect();
            println!("phase histogram (frame mod {}): {}", a.fps, used.join(" "));
            println!("first phase {}; events: {}", an.phase, an.events.len());
            for e in &an.events {
                let t = a.start + e.frame as f64 / a.fps as f64;
                println!("  {:?} at frame {} ({t:.2}s): shift {:+} frames", e.kind, e.frame, e.shift);
            }
            if let Some(path) = &a.out {
                let json = serde_json::json!({"start": a.start, "fps": a.fps, "frames": total, "readable": readable, "worst_mismatch": worst, "changes": changes, "values": values, "phase": an.phase, "missing": an.missing, "events": an.events.iter().map(|e| serde_json::json!({"kind": format!("{:?}", e.kind), "frame": e.frame, "shift": e.shift})).collect::<Vec<_>>()});
                std::fs::write(path, serde_json::to_string(&json).unwrap()).unwrap();
            }
        }
        _ => eprintln!("usage: hud-cadence sweep|scan <video> [--ffmpeg PATH] [--scale N] [--fps N] [--start S] [--duration S] [--out FILE]"),
    }
}
