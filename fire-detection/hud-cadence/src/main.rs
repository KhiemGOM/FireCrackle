//! hud-cadence sweep <video> [--ffmpeg PATH] [--scale 3] [--out sweep.json]
//!     Keyframes only: where is the FPS overlay visible and what does it read.
//! hud-cadence scan <video> --start SECONDS --duration SECONDS [--ffmpeg PATH] [--scale 3] [--fps 60] [--out scan.json]
//!     Every frame: change frames of the FPS value and their phase modulo one second.
use hud_cadence::find::{findings, Finding, Kind};
use hud_cadence::jolt::{breaks, window, Window, AGREE_FRAMES};
use hud_cadence::font::Font;
use hud_cadence::phase::{analyse, change_frames, Period};
use hud_cadence::reader::{Reading, Templates};
use hud_cadence::strip;
use hud_cadence::truth::{align, expected_changes, labels, parse_log, segments};
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
    /// labels: the source video to cut segments from.
    source: Option<String>,
    /// find: also store every frame's reading in `<out>.values.json`.
    dump_values: bool,
    /// find/report: a JoltCracker JSON report; adds the cadence pairs inside each of its breaks.
    jolt: Option<String>,
    /// find/report: write the readable Markdown report here (`--out` is the JSON).
    report: Option<String>,
}

fn args() -> Args {
    let mut a = Args { cmd: String::new(), video: String::new(), ffmpeg: "ffmpeg".into(), scale: 3, fps: 60, start: 0.0, duration: 0.0, out: None, strip: "none".into(), width: 2560, log: None, prescale: None, source: None, dump_values: false, jolt: None, report: None };
    let mut it = std::env::args().skip(1);
    a.cmd = it.next().unwrap_or_default();
    a.video = it.next().unwrap_or_default();
    while let Some(flag) = it.next() {
        if flag == "--dump-values" {
            a.dump_values = true;
            continue;
        }
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
            "--source" => a.source = Some(v),
            "--jolt" => a.jolt = Some(v),
            "--report" => a.report = Some(v),
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

/// 8-bit grey of the cropped band. A bare `format=gray` after `crop` made ffmpeg insert the conversion *before* the
/// crop (crop accepts gray), i.e. on the full frame, costing ~30 % of the pipeline. Pinning `format=yuv420p` first
/// keeps the conversion on the cropped band; the output bytes are identical (including the tv→full range expansion
/// the reader's thresholds were set on), which `extractplanes=y` is not.
const GRAY: &str = "format=yuv420p,format=gray";

/// ffmpeg filter producing the crop: the top band, plus (bottom-right strip) the bottom 3 GUI rows stacked under it.
/// `showinfo` (per-frame timestamps on stderr) is only added for `sweep`, the one command that reads them.
fn crop_filter(a: &Args) -> String {
    let info = if a.cmd == "sweep" { ",showinfo" } else { "" };
    let (w, h) = crop(a);
    let pre = a.prescale.as_ref().map_or(String::new(), |wh| format!("scale={wh}:flags=lanczos,"));
    if a.strip == "bottom-right" {
        let sh = 3 * a.scale;
        format!("{pre}split=2[t][b];[t]crop={w}:{STRIP_H}:0:0[t];[b]crop={w}:{sh}:0:ih-{sh}[b];[t][b]vstack,{GRAY}{info}")
    } else {
        format!("{pre}crop={w}:{h}:0:0,{GRAY}{info}")
    }
}

fn stream(a: &Args, keyframes_only: bool, mut each: impl FnMut(usize, &[u8])) -> String {
    let (w, h) = crop(a);
    let mut c = Command::new(&a.ffmpeg);
    // `-threads 0` lets the decoder (dav1d for AV1) use every core; audio/subtitles/data are never decoded.
    c.args(["-v", if a.cmd == "sweep" { "info" } else { "error" }, "-nostats", "-threads", "0"]);
    if keyframes_only {
        c.args(["-skip_frame", "nokey"]);
    }
    if a.cmd == "scan" || (a.cmd == "find" && a.duration > 0.0) {
        c.args(["-ss", &format!("{}", a.start), "-t", &format!("{}", a.duration)]);
    }
    c.arg("-i").arg(&a.video);
    c.args(["-an", "-sn", "-dn", "-vf", &crop_filter(a), "-fps_mode", "passthrough", "-f", "rawvideo", "-"]);
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

fn hms(t: f64) -> String {
    format!("{:02}:{:02}:{:06.3}", (t / 3600.0) as u32, ((t % 3600.0) / 60.0) as u32, t % 60.0)
}

/// One finding's explanation in the ranked table.
fn note(x: &Finding, fps: u32) -> String {
    let mut note = match x.kind {
        Kind::Jump => format!("phase moved {:+} frames and stayed: not continuous here", x.shift),
        Kind::Drift => format!("phase moved {:+} frame(s): recorder drift or a cut within 2 frames of a whole second", x.shift),
        Kind::Value => "largest value swings (top 1 %): no phase change, listed for cross-checking".into(),
        Kind::Gap => format!("overlay unreadable for {} frames ({:.1} s)", x.length, x.length as f64 / fps as f64),
    };
    if x.partial {
        note = format!("POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); {note}");
    }
    if x.unstable {
        note = format!("UNSTABLE READINGS (digits flicker here, not reliable); {note}");
    }
    note
}

/// Everything a run produced, as written to `--out` and read back by `report`.
struct Report {
    video: serde_json::Value,
    fps: u32,
    start: f64,
    frames: usize,
    readable: usize,
    findings: Vec<Finding>,
    /// (change frame, reading); None for findings-only files from older builds.
    changes: Option<Vec<(u32, String)>>,
    /// `--jolt`: the file name and one window per break.
    jolt: Option<(String, Vec<Window>)>,
}

fn signed(d: i32) -> String {
    if d == 0 { "0".into() } else { format!("{d:+}") }
}

/// The readable report (Markdown): Jumps in time order, one table per Jolt break, then everything ranked by |ΔFPS|.
fn markdown(r: &Report) -> String {
    use std::fmt::Write;
    let time = |frame: u32| r.start + frame as f64 / r.fps as f64;
    let mut s = String::new();
    writeln!(s, "# hud-cadence report: {}\n", r.video.as_str().unwrap_or("?")).unwrap();
    writeln!(
        s,
        "{} frames at {} fps; overlay readable on {} ({:.1} %); {} findings.\n",
        r.frames, r.fps, r.readable, 100.0 * r.readable as f64 / r.frames.max(1) as f64, r.findings.len()
    ).unwrap();

    let mut jumps: Vec<&Finding> = r.findings.iter().filter(|x| x.kind == Kind::Jump).collect();
    jumps.sort_by_key(|x| x.frame);
    writeln!(s, "## Jumps (phase moved >= 3 frames and stayed), in time order\n").unwrap();
    if jumps.is_empty() {
        writeln!(s, "None.").unwrap();
    } else {
        writeln!(s, "| time | frame | shift | before | after | \\|d\\| | flags |\n|---|---|---|---|---|---|---|").unwrap();
        for x in &jumps {
            let flags = [(x.unstable, "UNSTABLE READINGS (flickering digits): not reliable"), (x.partial, "PARTIAL READ (a digit covered)")]
                .iter().filter(|f| f.0).map(|f| f.1).collect::<Vec<_>>().join("; ");
            writeln!(s, "| {} | {} | {:+} | {} | {} | {} | {flags} |", hms(time(x.frame)), x.frame, x.shift, x.before.clone().unwrap_or_default(), x.after.clone().unwrap_or_default(), x.delta).unwrap();
        }
    }
    writeln!(s).unwrap();

    if let Some((path, windows)) = &r.jolt {
        writeln!(s, "## Inside each Jolt break\n").unwrap();
        writeln!(s, "Jolt report: `{path}`. Each break lists every pair of consecutive FPS changes overlapping Jolt's bracket, plus one").unwrap();
        writeln!(s, "pair of context on each side. A pair should be a whole number of seconds ({} frames); the deviation is the", r.fps).unwrap();
        writeln!(s, "remainder (negative = frames missing). Cadence missing = minus the sum over the inside pairs, counted modulo one").unwrap();
        writeln!(s, "second (±2 frames read error). Agree = the two counts match modulo one second within ±{AGREE_FRAMES} frames.\n").unwrap();
        if r.changes.is_none() {
            writeln!(s, "no change frames in this file: re-run `find` (or give a `--dump-values` file) to get these tables.\n").unwrap();
        } else {
            writeln!(s, "| # | kind | bracket (frames) | time | Jolt missing | cadence missing | agree |\n|---|---|---|---|---|---|---|").unwrap();
            for (i, w) in windows.iter().enumerate() {
                writeln!(
                    s,
                    "| {} | {} | {} – {} | {} | {} | {} | {} |",
                    i + 1, w.brk.kind, w.brk.from, w.brk.to, hms(time(w.brk.from)),
                    w.jolt_missing.map_or("?".into(), |j| format!("{j} f")),
                    match (w.cadence_missing, w.cadence_nearest_jolt) {
                        (Some(c), Some(n)) if n != c => format!("{n} f (±2; {} modulo 1 s)", signed(-c)),
                        (Some(c), _) => format!("{c} f (±2)"),
                        _ => "no readings".into(),
                    },
                    w.agree.map_or("n/a", |a| if a { "yes" } else { "no" })
                ).unwrap();
            }
            writeln!(s).unwrap();
            for (i, w) in windows.iter().enumerate() {
                writeln!(s, "### Break {}: {}, frames {} – {} ({} – {})\n", i + 1, w.brk.kind, w.brk.from, w.brk.to, hms(time(w.brk.from)), hms(time(w.brk.to))).unwrap();
                if w.pairs.is_empty() {
                    writeln!(s, "No FPS readings around this bracket (overlay off or hidden).\n").unwrap();
                    continue;
                }
                writeln!(s, "| from | to | spacing | deviation | before | after | where | note |\n|---|---|---|---|---|---|---|---|").unwrap();
                for p in &w.pairs {
                    let note = if p.long {
                        format!("spans {:.1} s: crosses an unreadable stretch, not counted", p.spacing as f64 / r.fps as f64)
                    } else if p.deviation.abs() >= 3 {
                        format!("**{} frames {}**", p.deviation.abs(), if p.deviation < 0 { "missing" } else { "added" })
                    } else if p.deviation != 0 {
                        "jitter (within read error)".into()
                    } else {
                        String::new()
                    };
                    writeln!(s, "| {} | {} | {} | {} | {} | {} | {} | {note} |", p.from, p.to, p.spacing, signed(p.deviation), p.before, p.after, if p.inside { "inside" } else { "context" }).unwrap();
                }
                writeln!(s).unwrap();
            }
        }
    }

    writeln!(s, "## Ranked by |ΔFPS|\n").unwrap();
    writeln!(s, "| rank | kind | time | frame | shift | before | after | \\|d\\| | note |\n|---|---|---|---|---|---|---|---|---|").unwrap();
    for (i, x) in r.findings.iter().enumerate() {
        writeln!(
            s,
            "| {} | {:?} | {} | {} | {} | {} | {} | {} | {} |",
            i + 1, x.kind, hms(time(x.frame)), x.frame,
            if matches!(x.kind, Kind::Jump | Kind::Drift) { format!("{:+}", x.shift) } else { String::new() },
            x.before.clone().unwrap_or_default(), x.after.clone().unwrap_or_default(),
            if x.kind == Kind::Gap { String::new() } else { x.delta.to_string() },
            note(x, r.fps)
        ).unwrap();
    }
    s
}

/// `--out`: the machine-readable JSON (findings, change frames, Jolt windows), nothing per-frame.
fn report_json(r: &Report, scale: usize, prescale: &Option<String>) -> serde_json::Value {
    let time = |frame: u32| r.start + frame as f64 / r.fps as f64;
    let findings: Vec<serde_json::Value> = r.findings.iter().map(|x| serde_json::json!({
        "kind": format!("{:?}", x.kind), "time": time(x.frame), "hms": hms(time(x.frame)), "frame": x.frame, "shift": x.shift,
        "before": x.before, "after": x.after, "delta": x.delta, "gap_frames": x.length, "partial_read": x.partial, "unstable": x.unstable
    })).collect();
    let jolt = r.jolt.as_ref().filter(|_| r.changes.is_some()).map(|(path, ws)| {
        let windows: Vec<serde_json::Value> = ws.iter().map(|w| serde_json::json!({
            "kind": w.brk.kind, "from": w.brk.from, "to": w.brk.to, "jump_seconds": w.brk.jump_seconds,
            "jolt_missing": w.jolt_missing, "cadence_missing": w.cadence_missing, "cadence_nearest_jolt": w.cadence_nearest_jolt, "agree": w.agree,
            "pairs": w.pairs.iter().map(|p| serde_json::json!({"from": p.from, "to": p.to, "before": p.before, "after": p.after,
                "spacing": p.spacing, "deviation": p.deviation, "inside": p.inside, "long": p.long})).collect::<Vec<_>>(),
        })).collect();
        (path.clone(), windows)
    });
    serde_json::json!({
        "video": r.video, "fps": r.fps, "scale": scale, "prescale": prescale, "start": r.start, "frames": r.frames, "readable": r.readable,
        "findings": findings,
        "changes": r.changes.as_ref().map(|c| c.iter().map(|(f, v)| serde_json::json!([f, v])).collect::<Vec<_>>()),
        "jolt_report": jolt.as_ref().map(|j| &j.0), "jolt": jolt.map(|j| j.1),
    })
}

/// Prints the Markdown and writes `--out` (JSON) / `--report` (Markdown) when asked.
fn emit(a: &Args, r: &Report) {
    let md = markdown(r);
    print!("{md}");
    if let Some(path) = &a.out {
        std::fs::write(path, serde_json::to_string_pretty(&report_json(r, a.scale, &a.prescale)).unwrap()).unwrap();
        eprintln!("wrote {path}");
    }
    if let Some(path) = &a.report {
        std::fs::write(path, &md).unwrap();
        eprintln!("wrote {path}");
    }
}

/// `--jolt`: one window per break, from the change frames.
fn jolt_windows(a: &Args, changes: &Option<Vec<(u32, String)>>, fps: u32) -> Option<(String, Vec<Window>)> {
    let path = a.jolt.as_ref()?;
    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).expect("read --jolt")).expect("--jolt is not JSON");
    let ws = changes.as_ref().map_or(Vec::new(), |c| breaks(&json, fps).iter().map(|b| window(c, b, fps)).collect());
    Some((path.clone(), ws))
}

fn change_list(values: &[Option<String>]) -> Vec<(u32, String)> {
    change_frames(values, 20).into_iter().map(|c| (c, values[c as usize].clone().unwrap_or_default())).collect()
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
        "report" | "refind" => {
            // hud-cadence report <report.json> [--jolt jolt.json] [--report report.md] [--out report2.json]: the readable
            // report from a saved JSON. A file that still holds every frame's reading (`values`: old format, or a
            // `--dump-values` file) is re-analysed with the current rules; otherwise the saved findings are formatted.
            let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&a.video).unwrap()).unwrap();
            let fps = json["fps"].as_u64().map_or(a.fps, |f| f as u32);
            let start = json["start"].as_f64().unwrap_or(0.0);
            let (f, frames, readable, changes) = match json["values"].as_array() {
                Some(arr) => {
                    let values: Vec<Option<String>> = arr.iter().map(|v| v.as_str().map(str::to_string)).collect();
                    let readable = values.iter().filter(|v| v.is_some()).count();
                    (findings(&values, fps, 3 * fps, 20), values.len(), readable, Some(change_list(&values)))
                }
                None => {
                    let f = json["findings"].as_array().expect("neither values nor findings in this file").iter().map(|x| Finding {
                        kind: match x["kind"].as_str().unwrap_or("") { "Jump" => Kind::Jump, "Drift" => Kind::Drift, "Gap" => Kind::Gap, _ => Kind::Value },
                        frame: x["frame"].as_u64().unwrap_or(0) as u32,
                        shift: x["shift"].as_i64().unwrap_or(0) as i32,
                        before: x["before"].as_str().map(str::to_string),
                        after: x["after"].as_str().map(str::to_string),
                        delta: x["delta"].as_u64().unwrap_or(0) as u32,
                        length: x["gap_frames"].as_u64().unwrap_or(0) as u32,
                        partial: x["partial_read"].as_bool().unwrap_or(false),
                        unstable: x["unstable"].as_bool().unwrap_or(false),
                    }).collect();
                    let changes = json["changes"].as_array().map(|c| c.iter().map(|p| (p[0].as_u64().unwrap_or(0) as u32, p[1].as_str().unwrap_or("").to_string())).collect());
                    (f, json["frames"].as_u64().unwrap_or(0) as usize, json["readable"].as_u64().unwrap_or(0) as usize, changes)
                }
            };
            let jolt = jolt_windows(&a, &changes, fps);
            emit(&a, &Report { video: json["video"].clone(), fps, start, frames, readable, findings: f, changes, jolt });
        }
        "find" => {
            // hud-cadence find <video> [--ffmpeg F] [--scale 3] [--fps 60] [--prescale W:H] [--start S --duration S] [--jolt jolt.json]
            //     [--out report.json] [--report report.md] [--dump-values]
            // Reads the whole video, lists every cadence jump / drift / unreadable gap and the largest value swings,
            // ranked by |ΔFPS| so each item can be checked by other means.
            let (w, h) = crop(&a);
            let mut values: Vec<Option<String>> = Vec::new();
            let mut near = None;
            let mut last_report = std::time::Instant::now();
            stream(&a, false, |n, g| {
                let r = tpl.read(g, w, h, near);
                near = r.as_ref().map(|r| r.anchor);
                values.push(r.map(|r| r.value));
                if last_report.elapsed().as_secs() >= 30 {
                    last_report = std::time::Instant::now();
                    eprintln!("  {n} frames ({:.0} s of video) in {:.0} s", n as f64 / a.fps as f64, t0.elapsed().as_secs_f64());
                }
            });
            let total = values.len();
            let readable = values.iter().filter(|v| v.is_some()).count();
            let f = findings(&values, a.fps, 3 * a.fps, 20);
            eprintln!(
                "{total} frames in {:.0} s; overlay readable on {readable} ({:.1} %); {} findings",
                t0.elapsed().as_secs_f64(),
                100.0 * readable as f64 / total.max(1) as f64,
                f.len()
            );
            let changes = Some(change_list(&values));
            let jolt = jolt_windows(&a, &changes, a.fps);
            emit(&a, &Report { video: serde_json::Value::String(a.video.clone()), fps: a.fps, start: a.start, frames: total, readable, findings: f, changes, jolt });
            if a.dump_values {
                let path = format!("{}.values.json", a.out.as_ref().expect("--dump-values needs --out"));
                let json = serde_json::json!({ "video": a.video, "fps": a.fps, "scale": a.scale, "prescale": a.prescale, "start": a.start, "values": values });
                std::fs::write(&path, serde_json::to_string(&json).unwrap()).unwrap();
                eprintln!("wrote {path}");
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
        "labels" => {
            // hud-cadence labels <scan.json> --log <hudinfo.jsonl> --out <dir> [<video> --ffmpeg F]: per-frame
            // label files for every usable segment (strip readable on consecutive frames), and, with a video, the
            // matching cut of each segment (re-encoded so the frame count is exact).
            let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&a.video).unwrap()).unwrap();
            let ids: Vec<Option<u32>> = json["ids"].as_array().expect("scan was run with --strip").iter().map(|v| v.as_u64().map(|v| v as u32)).collect();
            let values: Vec<Option<String>> = json["values"].as_array().unwrap().iter().map(|v| v.as_str().map(str::to_string)).collect();
            let fps = json["fps"].as_u64().unwrap() as u32;
            let start = json["start"].as_f64().unwrap();
            let rows = parse_log(&std::fs::read_to_string(a.log.as_ref().expect("--log")).unwrap());
            let all = labels(&rows, &ids, fps);
            let dir = std::path::PathBuf::from(a.out.as_ref().expect("--out <dir>"));
            std::fs::create_dir_all(&dir).unwrap();
            let min_len = 2 * fps as usize;
            let segs = segments(&ids, min_len);
            println!("{} frames; {} usable segments of >= {min_len} frames:", ids.len(), segs.len());
            for (n, &(s, len)) in segs.iter().enumerate() {
                let t0 = start + s as f64 / fps as f64;
                let path = dir.join(format!("segment-{n:02}.jsonl"));
                let mut text = String::new();
                for l in &all[s..s + len] {
                    let row = serde_json::json!({
                        "segment_frame": l.video_frame - s as u32, "source_frame": l.video_frame, "source_time": start + l.time,
                        "renderer_frame": l.renderer_frame, "nanos": l.nanos, "fps": l.fps, "fps_changed": l.fps_changed,
                        "fps_read": values[l.video_frame as usize],
                    });
                    text.push_str(&row.to_string());
                    text.push('\n');
                }
                std::fs::write(&path, text).unwrap();
                let with_log = all[s..s + len].iter().filter(|l| l.nanos.is_some()).count();
                println!("  segment {n:02}: source {t0:.3}s +{:.3}s ({len} frames, {with_log} with log rows) -> {}", len as f64 / fps as f64, path.display());
                if let Some(video) = &a.source {
                    let clip = dir.join(format!("segment-{n:02}.mkv"));
                    let status = Command::new(&a.ffmpeg)
                        .args(["-v", "error", "-y", "-ss", &format!("{t0:.6}"), "-i"]).arg(video)
                        .args(["-frames:v", &len.to_string(), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-r", &fps.to_string()])
                        .arg(&clip).status().expect("ffmpeg");
                    println!("    video {} ({})", clip.display(), if status.success() { "ok" } else { "FAILED" });
                }
            }
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
        _ => eprintln!("usage: hud-cadence find <video> [--ffmpeg PATH] [--scale N] [--fps N] [--prescale W:H] [--jolt jolt.json] [--out report.json] [--report report.md] [--dump-values]\n       hud-cadence report <report.json> [--jolt jolt.json] [--report report.md] [--out report2.json]   (the readable report from a saved JSON)\n       hud-cadence sweep|scan <video> [--ffmpeg PATH] [--scale N] [--fps N] [--start S] [--duration S] [--strip none|bottom-right|top-right|left] [--width PX] [--prescale W:H] [--out FILE]\n       hud-cadence replay <scan.json>\n       hud-cadence truth <scan.json> --log <hudinfo.jsonl>
       hud-cadence labels <scan.json> --log <hudinfo.jsonl> --out <dir> [--source <video> --ffmpeg F]"),
    }
}
