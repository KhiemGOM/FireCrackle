//! Cache canonical per-row diagnostics, not labels, for independent stage combinations.
use fire_core::{
    gui_mask::{detect_gui, GuiOptions, GuiTextures},
    overlay::{MatchDiagnostics, SilhouetteMatcher},
    veil::detect_veil,
    video::parallel_frames,
};
use std::{
    fs::File,
    io::{BufWriter, Write},
    process::{Command, Stdio},
    sync::atomic::AtomicBool,
};
fn encode(d: &MatchDiagnostics) -> String {
    format!(
        "{{\"sz\":{:?},\"cz\":{:?},\"sum\":{:?},\"used\":{:?},\"total\":{:?},\"weight\":{}}}",
        d.silhouette_z, d.colour_z, d.colour_sum, d.colour_used, d.colour_total, d.colour_weight
    )
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<_> = std::env::args().collect();
    if a.len() != 8 {
        return Err("pov_gui_stages VIDEO OUT.jsonl WIDTH HEIGHT STRIDE SAMPLES FFMPEG".into());
    }
    let w: usize = a[3].parse()?;
    let h: usize = a[4].parse()?;
    let stride: u32 = a[5].parse()?;
    let total: u32 = a[6].parse()?;
    if stride == 0 || total == 0 {
        return Err("positive stride/samples required".into());
    }
    let assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/assets");
    let sheet = std::fs::read(assets.join("fire_1.rgba"))?;
    let m = [
        SilhouetteMatcher::new(&sheet, w, h, 70.)?,
        SilhouetteMatcher::new(&sheet, w, h, 60.)?,
    ];
    let tex = GuiTextures::load(&assets.join("gui"))?;
    let mut child = Command::new(&a[7])
        .args(["-nostdin", "-v", "error", "-threads", "2", "-i"])
        .arg(&a[1])
        .args([
            "-vf",
            &format!("select=not(mod(n\\,{stride}))"),
            "-filter_threads",
            "2",
            fire_core::video::PASSTHROUGH_ARGS[0],
            fire_core::video::PASSTHROUGH_ARGS[1],
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
    let mut err = None;
    let cancel = AtomicBool::new(false);
    let result = parallel_frames(
        child.stdout.take().unwrap(),
        w * h * 3,
        total,
        4,
        &cancel,
        |frame| {
            let veiled = detect_veil(frame, w, h, 16.min(h - 1))?;
            let mut stats = Vec::new();
            for matcher in &m {
                stats.push(encode(
                    matcher
                        .inspect_frame(frame, None, veiled)?
                        .diagnostics
                        .as_ref()
                        .unwrap(),
                ));
            }
            let gui = detect_gui(frame, w, h, &tex, &GuiOptions::default())?;
            let mut fractions = Vec::new();
            for policy in 0..3 {
                let excluded: Vec<u8> = gui
                    .class
                    .iter()
                    .zip(&gui.piece)
                    .map(|(&c, &p)| {
                        u8::from(
                            gui.reliable
                                && (c == 1
                                    || (policy >= 1 && [4, 5, 11].contains(&p))
                                    || (policy == 2 && c == 2)),
                        )
                    })
                    .collect();
                fractions.push(
                    excluded.iter().map(|&v| v as usize).sum::<usize>() as f64 / (w * h) as f64,
                );
                for matcher in &m {
                    stats.push(encode(
                        matcher
                            .inspect_frame(frame, Some(&excluded), veiled)?
                            .diagnostics
                            .as_ref()
                            .unwrap(),
                    ));
                }
            }
            Ok((stats.join(","), gui.reliable, fractions, veiled))
        },
        |n, (stats, reliable, fractions, veiled)| {
            if let Err(e)=writeln!(out,"{{\"n\":{},\"reliable\":{reliable},\"fractions\":{fractions:?},\"veiled\":{veiled},\"stats\":[{stats}]}}",n*stride){err=Some(e);}
            count += 1;
            if count % 200 == 0 {
                eprintln!("{count}/{total}");
            }
        },
    );
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
        result?;
    }
    if !child.wait()?.success() {
        return Err("ffmpeg failed".into());
    }
    if let Some(e) = err {
        return Err(e.into());
    }
    out.flush()?;
    eprintln!("completed {count} stage-cache frames");
    Ok(())
}
