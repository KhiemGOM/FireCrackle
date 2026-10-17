//! Dumps per-frame presence features and the label truth as CSV, for offline analysis.
//!
//! Usage: fire-features VIDEO JOINED.jsonl --out features.csv [--stride N] [--assets DIR]
//! Columns: truth (n, fire, area, mind, veil, f0, f1), global (mean_luma, dark) and, for the frame as is ("r_") and with
//! the GUI veil reversed ("u_"): loose palette count, strict palette count, bright count, blobs>=20, largest blob,
//! share of mask pixels in blobs>=50, texture roughness (mean |dluma|, share of big steps).

use fire_core::features::{blob_stats, mask_edge_stats, mean_luma_and_dark, unveil_rows};
use fire_core::json::{parse, Value};
use fire_core::presence::Palette;
use fire_core::video::{parse_probe, read_frame};
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::process::{Command, Stdio};

const STRIP_ROWS: usize = 16;
const LOOSE: f64 = 24.0;
const STRICT: f64 = 8.0;

fn die(msg: String) -> ! {
    eprintln!("error: {msg}");
    std::process::exit(1);
}

fn luma_plane(rgb: &[u8]) -> Vec<f64> {
    rgb.as_chunks::<3>()
        .0
        .iter()
        .map(|p| 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64)
        .collect()
}

fn features(
    loose: &Palette,
    strict: &Palette,
    rgb: &[u8],
    w: usize,
    h: usize,
) -> Result<Vec<String>, String> {
    let rows = h - STRIP_ROWS;
    let mask = loose.mask(rgb, w, h, STRIP_ROWS, h)?;
    let cnt = mask.iter().filter(|&&b| b).count();
    let strict_cnt = strict.count_rows(rgb, w, h, STRIP_ROWS, h)?;
    let luma = luma_plane(&rgb[STRIP_ROWS * w * 3..]);
    let bright = mask
        .iter()
        .zip(&luma)
        .filter(|(m, l)| **m && **l >= 170.0)
        .count();
    let blobs = blob_stats(&mask, w, rows, 20)?;
    let big = blob_stats(&mask, w, rows, 50)?;
    let e = mask_edge_stats(&mask, &luma, w, rows)?;
    Ok(vec![
        cnt.to_string(),
        strict_cnt.to_string(),
        bright.to_string(),
        blobs.blobs_ge_min.to_string(),
        blobs.largest.to_string(),
        format!(
            "{:.4}",
            if cnt > 0 {
                big.in_big as f64 / cnt as f64
            } else {
                0.0
            }
        ),
        format!("{:.2}", e.mean_abs_diff),
        format!("{:.4}", e.share_big),
    ])
}

fn main() {
    let mut video = None;
    let mut joined = None;
    let mut out = None;
    let mut stride = 1u64;
    let mut assets = "data/assets".to_string();
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--stride" => {
                stride = it
                    .next()
                    .and_then(|v| v.parse().ok())
                    .filter(|&s| s > 0)
                    .unwrap_or_else(|| die("--stride needs a positive number".into()))
            }
            "--out" => out = it.next(),
            "--assets" => {
                assets = it
                    .next()
                    .unwrap_or_else(|| die("--assets needs a directory".into()))
            }
            _ if video.is_none() => video = Some(a),
            _ if joined.is_none() => joined = Some(a),
            _ => die(format!("unexpected argument {a}")),
        }
    }
    let (Some(video), Some(joined), Some(out)) = (video, joined, out) else {
        die("usage: fire-features VIDEO JOINED.jsonl --out features.csv [--stride N] [--assets DIR]".into())
    };
    let s0 = std::fs::read(format!("{assets}/fire_0.rgba"))
        .unwrap_or_else(|e| die(format!("fire_0.rgba: {e}")));
    let s1 = std::fs::read(format!("{assets}/fire_1.rgba"))
        .unwrap_or_else(|e| die(format!("fire_1.rgba: {e}")));
    let loose = Palette::from_rgba(&[&s0, &s1], LOOSE).unwrap_or_else(|e| die(e));
    let strict = Palette::from_rgba(&[&s0, &s1], STRICT).unwrap_or_else(|e| die(e));

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
        .unwrap_or_else(|e| die(format!("ffprobe: {e}")));
    let info = parse_probe(&String::from_utf8_lossy(&probe.stdout)).unwrap_or_else(|e| die(e));
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
        .unwrap_or_else(|e| die(format!("ffmpeg: {e}")));
    let mut pipe = child.stdout.take().expect("stdout was piped");
    let (w, h) = (info.width, info.height);
    let mut frame = vec![0u8; w * h * 3];

    let mut csv = BufWriter::new(File::create(&out).unwrap_or_else(|e| die(format!("{out}: {e}"))));
    let names = [
        "cnt", "strict", "bright", "blobs20", "largest", "inbig50", "rough", "roughbig",
    ];
    let mut header = "n,fire,area,mind,veil,f0,f1,mean_luma,dark".to_string();
    for p in ["r_", "u_"] {
        for n in names {
            header.push_str(&format!(",{p}{n}"));
        }
    }
    writeln!(csv, "{header}").unwrap();

    let rows =
        BufReader::new(File::open(&joined).unwrap_or_else(|e| die(format!("{joined}: {e}"))));
    let mut n = 0u64;
    let mut written = 0u64;
    for line in rows.lines() {
        let line = line.unwrap_or_else(|e| die(format!("reading {joined}: {e}")));
        match read_frame(&mut pipe, &mut frame) {
            Ok(true) => {}
            Ok(false) => die(format!(
                "video ended at frame {n} but {joined} has more rows"
            )),
            Err(e) => die(format!("reading video: {e}")),
        }
        let this = n;
        n += 1;
        if !this.is_multiple_of(stride) {
            continue;
        }
        let Ok(row) = parse(&line) else { continue };
        let Some(label) = row.get("label") else {
            continue;
        };
        let (Some(lw), Some(fire), Some(f0), Some(f1)) = (
            label.get("w").and_then(Value::num),
            label.get("fire").and_then(Value::bool),
            label.get("f0").and_then(Value::num),
            label.get("f1").and_then(Value::num),
        ) else {
            continue;
        };
        let scale = w as f64 / lw;
        let (mut area, mut mind, mut veil) = (0.0f64, f64::INFINITY, 0.0f64);
        for f in label.get("fires").and_then(Value::arr).unwrap_or(&[]) {
            let d = f.get("dist").and_then(Value::num).unwrap_or(0.0);
            let mut seen = false;
            for p in f.get("parts").and_then(Value::arr).unwrap_or(&[]) {
                let b: Vec<f64> = p
                    .get("box")
                    .and_then(Value::arr)
                    .unwrap_or(&[])
                    .iter()
                    .filter_map(Value::num)
                    .collect();
                let vis = p.get("vis").and_then(Value::num).unwrap_or(0.0);
                if b.len() == 4 {
                    area += (b[2] - b[0]) * scale * (b[3] - b[1]) * scale * vis;
                    seen = true;
                    veil = veil.max(p.get("veil").and_then(Value::num).unwrap_or(0.0));
                }
            }
            if seen {
                mind = mind.min(d);
            }
        }
        let (mean_luma, dark) = mean_luma_and_dark(&frame, w, h, 30.0).unwrap_or_else(|e| die(e));
        let raw = features(&loose, &strict, &frame, w, h).unwrap_or_else(|e| die(e));
        let unv = unveil_rows(
            &frame,
            w,
            h,
            fire_core::veil::A_TOP,
            fire_core::veil::A_BOTTOM,
            [fire_core::veil::COLOUR as u8; 3],
        )
        .unwrap_or_else(|e| die(e));
        let unv = features(&loose, &strict, &unv, w, h).unwrap_or_else(|e| die(e));
        writeln!(
            csv,
            "{this},{},{:.1},{},{:.3},{},{},{:.2},{:.4},{},{}",
            fire as u8,
            area,
            if mind.is_finite() {
                format!("{mind:.2}")
            } else {
                String::new()
            },
            veil,
            f0,
            f1,
            mean_luma,
            dark,
            raw.join(","),
            unv.join(",")
        )
        .unwrap();
        written += 1;
    }
    let _ = child.kill();
    let _ = child.wait();
    csv.flush().unwrap();
    println!("fire-features: frames={n} written={written} stride={stride} -> {out}");
}
