//! Paired offline ablation. Truth is read only by the separate reporting script.
use fire_core::{
    gui_mask::{detect_gui, GuiOptions, GuiTextures},
    overlay::SilhouetteMatcher,
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
    let a: Vec<String> = std::env::args().collect();
    if a.len() != 8 {
        return Err("pov_gui_ablation VIDEO OUT.csv WIDTH HEIGHT STRIDE SAMPLES FFMPEG".into());
    }
    let w: usize = a[3].parse()?;
    let h: usize = a[4].parse()?;
    let stride: u32 = a[5].parse()?;
    let total: u32 = a[6].parse()?;
    if stride == 0 || total == 0 {
        return Err("positive stride and samples required".into());
    }
    let assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/assets");
    let sheet = std::fs::read(assets.join("fire_1.rgba"))?;
    let m70 = SilhouetteMatcher::new(&sheet, w, h, 70.)?;
    let m60 = SilhouetteMatcher::new(&sheet, w, h, 60.)?;
    let textures = GuiTextures::load(&assets.join("gui"))?;
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
    writeln!(out,"n,base_row,base_ev,mask_row,mask_ev,gui_reliable,gui_fraction,veiled,base_ms,gui_ms,mask_ms")?;
    let cancel = AtomicBool::new(false);
    let mut count = 0;
    let mut write_error = None;
    let result = parallel_frames(
        child.stdout.take().unwrap(),
        w * h * 3,
        total,
        4,
        &cancel,
        |frame| {
            let veiled = detect_veil(frame, w, h, 16.min(h - 1))?;
            let t = Instant::now();
            let b70 = if veiled {
                m70.match_frame_veiled(frame)?
            } else {
                m70.match_frame(frame)?
            };
            let b60 = if veiled {
                m60.match_frame_veiled(frame)?
            } else {
                m60.match_frame(frame)?
            };
            let base = if b60.colour_evidence > b70.colour_evidence {
                b60
            } else {
                b70
            };
            let base_ms = t.elapsed().as_secs_f64() * 1000.;
            let t = Instant::now();
            let gui = detect_gui(frame, w, h, &textures, &GuiOptions::default())?;
            let excluded: Vec<u8> = gui
                .class
                .iter()
                .zip(&gui.piece)
                .map(|(&c, &p)| {
                    u8::from(gui.reliable && (c == 1 || c == 2 || [4, 5, 11].contains(&p)))
                })
                .collect();
            let frac = excluded.iter().map(|&v| v as usize).sum::<usize>() as f64 / (w * h) as f64;
            let gui_ms = t.elapsed().as_secs_f64() * 1000.;
            let t = Instant::now();
            let x70 = m70.match_frame_excluding(frame, &excluded, veiled)?;
            let x60 = m60.match_frame_excluding(frame, &excluded, veiled)?;
            let masked = if x60.colour_evidence > x70.colour_evidence {
                x60
            } else {
                x70
            };
            Ok((
                base.ranked_colour[0].0,
                base.colour_evidence,
                masked.ranked_colour[0].0,
                masked.colour_evidence,
                gui.reliable,
                frac,
                veiled,
                base_ms,
                gui_ms,
                t.elapsed().as_secs_f64() * 1000.,
            ))
        },
        |n, (br, be, mr, me, reliable, frac, veiled, bms, gms, mms)| {
            if let Err(e)=writeln!(out,"{},{br},{be:.9},{mr},{me:.9},{reliable},{frac:.6},{veiled},{bms:.3},{gms:.3},{mms:.3}",n*stride){write_error=Some(e);}
            count += 1;
            if count % 200 == 0 {
                eprintln!("{count}/{total}");
            }
        },
    );
    let _ = child.kill();
    let _ = child.wait();
    result?;
    if let Some(e) = write_error {
        return Err(e.into());
    }
    out.flush()?;
    eprintln!("completed {count} paired frames");
    Ok(())
}
