//! hud-cadence sweep <video> [--ffmpeg PATH] [--scale 3] [--out sweep.json]
//!     Keyframes only: where is the FPS overlay visible and what does it read.
//! hud-cadence scan <video> --start SECONDS --duration SECONDS [--ffmpeg PATH] [--scale 3] [--fps 60] [--out scan.json]
//!     Every frame: change frames of the FPS value and their phase modulo one second.
use hud_cadence::font::Font;
use hud_cadence::phase::{analyse, change_frames, Period};
use hud_cadence::reader::{Reading, Templates};
use hud_cadence::strip;
use hud_cadence::truth::{align, expected_changes, parse_log};
use std::io::Read;
use std::process::{Command, Stdio};

/// The overlay reader looks at the top-left 1500×40 px; with a strip, the crop widens to the full frame.
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
    /// "none" | "bottom-right" (mod-hud) | "top-right" (early mod-hud) | "left" (mod-gui): where the strip is.
    strip: String,
    /// Video width in pixels, needed to place a right-aligned strip.
    width: usize,
    log: Option<String>,
    /// "W:H": scale every frame to this size before reading (a 1080p recording or upload of a 1440p game).
    prescale: Option<String>,
}

fn args() -> Args {
    let mut a = Args { cmd: String::new(), video: String::new(), ffmpeg: "ffmpeg".into(), scale: 3, fps: 60, start: 0.0, duration: 60.0, out: None, strip: "none".into(), width: 2560, log: None, prescale: None };
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
            "--strip" => a.strip = v,
            "--width" => a.width = v.parse().expect("--width"),
            "--log" => a.log = Some(v),
            "--prescale" => a.prescale = Some(v),
            other => panic!("unknown flag {other}"),
        }
    }
    a
}

/// Streams the top-left strip of every frame ffmpeg emits as 8-bit grey. Returns (frames, ffmpeg stderr).
/// Crop (width, height) the scan decodes: the overlay area, widened/heightened to include the strip.
fn crop(a: &Args) -> (usize, usize) {
    match a.strip.as_str() {
        "bottom-right" => (a.width, STRIP_H + 3 * a.scale),
        "top-right" => (a.width, STRIP_H.max((strip::HUD_STRIP_Y + 3) * a.scale)),
        "left" => (STRIP_W.max(strip::width(a.scale)), STRIP_H),
        _ => (STRIP_W, STRIP_H),
    }
}

/// ffmpeg filter producing the crop: the top band, plus (bottom-right strip) the bottom 3 GUI rows stacked under it.
fn crop_filter(a: &Args) -> String {
    let (w, h) = crop(a);
    let pre = a.prescale.as_ref().map_or(String::new(), |wh| format!("scale={wh}:flags=lanczos,"));
    if a.strip == "bottom-right" {
        let sh = 3 * a.scale;
        format!("{pre}split=2[t][b];[t]crop={w}:{STRIP_H}:0:0[t];[b]crop={w}:{sh}:0:ih-{sh}[b];[t][b]vstack,format=gray,showinfo")
    } else {
        format!("{pre}crop={w}:{h}:0:0,format=gray,showinfo")
    }
}

fn stream(a: &Args, keyframes_only: bool, mut each: impl FnMut(usize, &[u8])) -> String {
    let (w, h) = crop(a);
    let mut c = Command::new(&a.ffmpeg);
    c.args(["-v", "info", "-nostats", "-threads", "8"]);
    if keyframes_only {
        c.args(["-skip_frame", "nokey"]);
    }
    if a.cmd == "scan" {
        c.args(["-ss", &format!("{}", a.start), "-t", &format!("{}", a.duration)]);
    }
    c.arg("-i").arg(&a.video);
    c.args(["-vf", &crop_filter(a), "-fps_mode", "passthrough", "-f", "rawvideo", "-"]);
    c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c.spawn().expect("start ffmpeg");
    let mut err = child.stderr.take().unwrap();
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        err.read_to_string(&mut s).ok();
        s
    });
    let mut out = child.stdout.take().unwrap();
    let mut buf = vec![0u8; w * h];
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
            let (w, h) = crop(&a);
            let strip_pos = match a.strip.as_str() {
                "bottom-right" => Some((w - strip::width(a.scale), STRIP_H)), // stacked under the top band
                "top-right" => Some((w - strip::width(a.scale), strip::HUD_STRIP_Y * a.scale)),
                "left" => Some((0, 0)),
                _ => None,
            };
            let mut values: Vec<Option<String>> = Vec::new();
            let mut ids: Vec<Option<u32>> = Vec::new();
            let mut near = None;
            let mut worst = 0usize;
            stream(&a, false, |_, g| {
                let r = tpl.read(g, w, h, near);
                near = r.as_ref().map(|r| r.anchor);
                if let Some(r) = &r {
                    worst = worst.max(r.mismatches.iter().copied().max().unwrap_or(0));
                }
                values.push(r.map(|r| r.value));
                if let Some((x0, y0)) = strip_pos {
                    ids.push(strip::decode(g, w, a.scale, x0, y0));
                }
            });
            if strip_pos.is_some() {
                let al = align(&ids);
                println!(
                    "strip: readable {} of {}; new {}, duplicates {}, skipped renderer frames {}, backwards {}",
                    al.readable, ids.len(), al.new, al.duplicates, al.skipped_renderer_frames, al.backwards
                );
            }
            let total = values.len();
            let readable = values.iter().filter(|v| v.is_some()).count();
            let changes = change_frames(&values, 20);
            let an = analyse(&changes, Period::Frames(a.fps));
            eprintln!(
                "{total} frames in {:.0}s ({:.0} fps); readable {readable}; worst digit mismatch {worst} px; {} changes, {} missing boundaries, {} outlier samples",
                t0.elapsed().as_secs_f64(),
                total as f64 / t0.elapsed().as_secs_f64(),
                changes.len(),
                an.missing,
                an.outliers
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
                let json = serde_json::json!({"start": a.start, "fps": a.fps, "frames": total, "readable": readable, "worst_mismatch": worst, "changes": changes, "values": values, "ids": ids, "phase": an.phase, "missing": an.missing, "events": an.events.iter().map(|e| serde_json::json!({"kind": format!("{:?}", e.kind), "frame": e.frame, "shift": e.shift})).collect::<Vec<_>>()});
                std::fs::write(path, serde_json::to_string(&json).unwrap()).unwrap();
            }
        }
        "truth" => {
            // hud-cadence truth <scan.json> --log <hudinfo.jsonl>: compare detected changes with the mod's log.
            let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&a.video).unwrap()).unwrap();
            let ids: Vec<Option<u32>> = json["ids"].as_array().expect("scan was run with --strip").iter().map(|v| v.as_u64().map(|v| v as u32)).collect();
            let detected: Vec<u32> = json["changes"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u32).collect();
            let fps = json["fps"].as_u64().unwrap() as u32;
            let rows = parse_log(&std::fs::read_to_string(a.log.as_ref().expect("--log")).unwrap());
            let al = align(&ids);
            println!("strip: readable {} of {}; new {}, duplicates {}, skipped renderer frames {}, backwards {}", al.readable, ids.len(), al.new, al.duplicates, al.skipped_renderer_frames, al.backwards);
            let expected = expected_changes(&rows, &ids);
            println!("log: {} frame rows, {} FPS changes inside the captured range; detected {} changes", rows.len(), expected.len(), detected.len());
            let (mut exact, mut off_by_one, mut missed) = (0, 0, 0);
            for e in &expected {
                match detected.iter().map(|&d| (d as i64 - e.video_frame as i64).abs()).min() {
                    Some(0) => exact += 1,
                    Some(1) => off_by_one += 1,
                    _ => missed += 1,
                }
            }
            println!("detected vs truth: exact {exact}, off by one frame {off_by_one}, missed {missed}; spurious {}", detected.len().saturating_sub(exact + off_by_one));
            // The game's own grid: nanoTime of each change mod 1 s, in ms, should be constant.
            let game_phase: Vec<i64> = expected.iter().map(|e| e.nanos.rem_euclid(1_000_000_000) / 1_000_000).collect();
            let video_phase: Vec<u32> = expected.iter().map(|e| e.video_frame % fps).collect();
            println!("game phase (ms mod 1000) per change: {}", game_phase.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(" "));
            println!("video phase (frame mod {fps}) per true change: {}", video_phase.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(" "));
        }
        "replay" => {
            let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&a.video).unwrap()).unwrap();
            let values: Vec<Option<String>> = json["values"].as_array().unwrap().iter().map(|v| v.as_str().map(str::to_string)).collect();
            let fps = json["fps"].as_u64().unwrap() as u32;
            let start = json["start"].as_f64().unwrap();
            let changes = change_frames(&values, 20);
            let an = analyse(&changes, Period::Frames(fps));
            println!("{} frames, {} changes, {} missing, {} outliers, first phase {}", values.len(), changes.len(), an.missing, an.outliers, an.phase);
            let per_min: Vec<String> = changes.chunks(60).map(|c| format!("{}", c[c.len() / 2] % fps)).collect();
            println!("phase per minute: {}", per_min.join(" "));
            for e in &an.events {
                if e.kind == hud_cadence::phase::Kind::Jump {
                    println!("  Jump at frame {} ({:.2}s): shift {:+}", e.frame, start + e.frame as f64 / fps as f64, e.shift);
                }
            }
            println!("drift events: {}", an.events.iter().filter(|e| e.kind == hud_cadence::phase::Kind::Drift).count());
        }
        _ => eprintln!("usage: hud-cadence sweep|scan <video> [--ffmpeg PATH] [--scale N] [--fps N] [--start S] [--duration S] [--strip none|bottom-right|top-right|left] [--width PX] [--prescale W:H] [--out FILE]\n       hud-cadence replay <scan.json>\n       hud-cadence truth <scan.json> --log <hudinfo.jsonl>"),
    }
}
