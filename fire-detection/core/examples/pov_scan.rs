//! Exercise the actual production entry point, with bounded parallel decoding.
use fire_core::{
    gui_mask::{GuiDetector, GuiOptions, GuiTextures},
    overlay::SilhouetteMatcher,
    pov::PovMatcher,
    veil::detect_veil,
    video::parallel_frames,
};
use std::{
    fs::File,
    io::{BufWriter, Write},
    process::{Command, Stdio},
    sync::atomic::AtomicBool,
    time::Instant,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<_> = std::env::args().collect();
    if a.len() != 10 {
        return Err("pov_scan VIDEO OUT WIDTH HEIGHT STRIDE COUNT FFMPEG old|new WORKERS".into());
    }
    let w: usize = a[3].parse()?;
    let h: usize = a[4].parse()?;
    let stride: u32 = a[5].parse()?;
    let total: u32 = a[6].parse()?;
    let workers: usize = a[9].parse()?;
    if stride == 0
        || total == 0
        || !(1..=4).contains(&workers)
        || !["old", "new", "gui"].contains(&a[8].as_str())
    {
        return Err("invalid scan arguments".into());
    }
    let assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/assets");
    let start = Instant::now();
    let sheet = std::fs::read(assets.join("fire_1.rgba"))?;
    let new = if a[8] == "new" {
        Some(PovMatcher::new(
            &sheet,
            GuiTextures::load(&assets.join("gui"))?,
            w,
            h,
        )?)
    } else {
        None
    };
    let old = if a[8] == "old" {
        Some([
            SilhouetteMatcher::new(&sheet, w, h, 70.)?,
            SilhouetteMatcher::new(&sheet, w, h, 60.)?,
        ])
    } else {
        None
    };
    let gui = if a[8] == "gui" {
        let d = GuiDetector::new(
            GuiTextures::load(&assets.join("gui"))?,
            GuiOptions::default(),
        )?;
        d.prepare(w, h);
        Some(d)
    } else {
        None
    };
    let setup_ms = start.elapsed().as_secs_f64() * 1000.;
    let mut child = Command::new(&a[7])
        .args(["-nostdin", "-v", "error", "-threads", "2", "-i"])
        .arg(&a[1])
        .args([
            "-vf",
            &format!("select=not(mod(n\\,{stride}))"),
            "-filter_threads",
            "2",
            "-fps_mode",
            "passthrough",
            "-frames:v",
            &total.to_string(),
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .spawn()?;
    let mut out = BufWriter::new(File::create(&a[2])?);
    let mut count = 0;
    let mut output_error = None;
    let start = Instant::now();
    let scan = parallel_frames(
        child.stdout.take().ok_or("decoder pipe")?,
        w * h * 3,
        total,
        workers,
        &AtomicBool::new(false),
        |frame| {
            let begin = Instant::now();
            if let Some(d) = &gui {
                let (mask, t) = d.detect_timed(frame, w, h)?;
                return Ok(format!(
                    "\"fit_ms\":{},\"pieces_ms\":{},\"text_ms\":{},\"reliable\":{}",
                    t.fit_ms, t.pieces_ms, t.text_ms, mask.reliable
                ));
            }
            let (row, gui, dual) = if let Some(m) = &new {
                let r = m.match_frame(frame)?;
                (r.row, r.used_gui, r.evaluated_alternate)
            } else {
                let veiled = detect_veil(frame, w, h, 16.min(h - 1))?;
                let m = old.as_ref().unwrap();
                let a = if veiled {
                    m[0].match_frame_veiled(frame)?
                } else {
                    m[0].match_frame(frame)?
                };
                let b = if veiled {
                    m[1].match_frame_veiled(frame)?
                } else {
                    m[1].match_frame(frame)?
                };
                let best = if b.colour_evidence > a.colour_evidence {
                    b
                } else {
                    a
                };
                (
                    (best.colour_evidence >= 0.5).then_some(best.ranked_colour[0].0),
                    false,
                    false,
                )
            };
            Ok(format!(
                "\"row\":{},\"gui\":{gui},\"dual\":{dual},\"ms\":{}",
                row.map_or("null".into(), |r| r.to_string()),
                begin.elapsed().as_secs_f64() * 1000.
            ))
        },
        |n, result| {
            if let Err(e) = writeln!(out, "{{\"n\":{}, {result}}}", n * stride) {
                output_error = Some(e);
            }
            count += 1;
            if count % 200 == 0 {
                eprintln!("{count}/{total}");
            }
        },
    );
    if scan.is_err() {
        let _ = child.kill();
        let _ = child.wait();
        scan?;
    }
    if !child.wait()?.success() || count != total {
        return Err("incomplete scan".into());
    }
    if let Some(e) = output_error {
        return Err(e.into());
    }
    out.flush()?;
    eprintln!(
        "{{\"frames\":{count},\"setup_ms\":{setup_ms},\"scan_seconds\":{},\"workers\":{workers}}}",
        start.elapsed().as_secs_f64()
    );
    Ok(())
}
