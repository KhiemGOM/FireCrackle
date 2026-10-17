//! Research: both canonical veil hypotheses, sharing one GUI fit per frame.
use fire_core::{
    gui_mask::{add_screen_masks, detect_gui, GuiOptions, GuiTextures},
    overlay::{MatchDiagnostics, SilhouetteMatcher},
    veil::{detect_pixels, Options},
    video::parallel_frames,
};
use std::{
    fs::File,
    io::{BufWriter, Write},
    process::{Command, Stdio},
    sync::atomic::AtomicBool,
    time::Instant,
};

fn evidence(d: &MatchDiagnostics, row: usize) -> f64 {
    if d.colour_used[row] >= 5 {
        d.colour_sum[row] / d.colour_used[row] as f64
    } else {
        0.
    }
}
fn branch(
    frame: &[u8],
    m: &[SilhouetteMatcher; 2],
    masks: &[Vec<u8>; 2],
    veiled: bool,
) -> Result<String, String> {
    let start = Instant::now();
    let mut fovs = Vec::new();
    let mut raw_ev = [0.; 2];
    for (f, matcher) in m.iter().enumerate() {
        let raw = matcher
            .inspect_frame(frame, None, veiled)?
            .diagnostics
            .unwrap();
        let opaque = matcher
            .inspect_frame(frame, Some(&masks[0]), veiled)?
            .diagnostics
            .unwrap();
        let broad = matcher
            .inspect_frame(frame, Some(&masks[1]), veiled)?
            .diagnostics
            .unwrap();
        let scores: Vec<_> = raw
            .silhouette_z
            .iter()
            .zip(&raw.colour_z)
            .map(|(s, c)| s + raw.colour_weight * c)
            .collect();
        let row = (0..32)
            .max_by(|&a, &b| scores[a].total_cmp(&scores[b]).then_with(|| b.cmp(&a)))
            .unwrap();
        raw_ev[f] = evidence(&raw, row);
        let masked_scores: Vec<_> = broad
            .silhouette_z
            .iter()
            .zip(&broad.colour_z)
            .map(|(s, c)| s + broad.colour_weight * c)
            .collect();
        let margin = masked_scores[row]
            - (0..32)
                .filter(|&r| r != row)
                .map(|r| masked_scores[r])
                .fold(f64::NEG_INFINITY, f64::max);
        let mut cols = Vec::new();
        for x in 0..4 {
            if (0..4).any(|y| {
                let k = y * 4 + x;
                let used = broad.colour_spatial_used[row][k] as f64;
                let hits = broad.colour_spatial_hits[row][k] as f64;
                hits >= 5. && 2. * hits - used >= 0.5 * used
            }) {
                cols.push(x);
            }
        }
        let span = cols.last().zip(cols.first()).map_or(0, |(a, b)| a - b + 1);
        fovs.push(format!("{{\"row\":{row},\"raw\":{},\"opaque\":{},\"broad\":{},\"margin\":{margin},\"span\":{span}}}",raw_ev[f],evidence(&opaque,row),evidence(&broad,row)));
    }
    Ok(format!(
        "{{\"fov\":{},\"ms\":{},\"fovs\":[{}]}}",
        usize::from(raw_ev[1] > raw_ev[0]),
        start.elapsed().as_secs_f64() * 1000.,
        fovs.join(",")
    ))
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<_> = std::env::args().collect();
    if a.len() != 8 {
        return Err("pov_dual_veil VIDEO OUT WIDTH HEIGHT STRIDE SAMPLES FFMPEG".into());
    }
    let w: usize = a[3].parse()?;
    let h: usize = a[4].parse()?;
    let stride: u32 = a[5].parse()?;
    let total: u32 = a[6].parse()?;
    if stride == 0 || total == 0 || w == 0 || h == 0 {
        return Err("positive dimensions/stride/count required".into());
    }
    let assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/assets");
    let sheet = std::fs::read(assets.join("fire_1.rgba"))?;
    let matchers = [
        SilhouetteMatcher::new(&sheet, w, h, 70.)?,
        SilhouetteMatcher::new(&sheet, w, h, 60.)?,
    ];
    let tex = GuiTextures::load(&assets.join("gui"))?;
    let mut decoder = Command::new(&a[7])
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
    let mut error = None;
    let result = parallel_frames(
        decoder.stdout.take().unwrap(),
        w * h * 3,
        total,
        4,
        &AtomicBool::new(false),
        |frame| {
            let t = Instant::now();
            let (auto, share) = detect_pixels(frame, w, h, 3, 16.min(h - 1), Options::default())?;
            let veil_ms = t.elapsed().as_secs_f64() * 1000.;
            let t = Instant::now();
            let mut gui = detect_gui(frame, w, h, &tex, &GuiOptions::default())?;
            let mut masks = [Vec::with_capacity(w * h), Vec::with_capacity(w * h)];
            for (&c, &p) in gui.class.iter().zip(&gui.piece) {
                let hard = gui.reliable && (c == 1 || [4, 5, 11].contains(&p));
                masks[0].push(u8::from(gui.reliable && c == 1));
                masks[1].push(u8::from(hard || (gui.reliable && c == 2)));
            }
            let gui_ms = t.elapsed().as_secs_f64() * 1000.;
            let off = branch(frame, &matchers, &masks, false)?;
            let on = branch(frame, &matchers, &masks, true)?;
            let t = Instant::now();
            add_screen_masks(frame, w, h, &tex, &mut gui)?;
            let screen_ms = t.elapsed().as_secs_f64() * 1000.;
            let mut screen_pixels = 0;
            for (i, &piece) in gui.piece.iter().enumerate() {
                if [24, 25, 26].contains(&piece) {
                    masks[0][i] = 1;
                    masks[1][i] = 1;
                    screen_pixels += 1;
                }
            }
            let screen_hits: Vec<_> = gui
                .hits
                .iter()
                .filter(|hit| [24, 25, 26].contains(&(hit.piece as u8)))
                .map(|hit| {
                    format!(
                        "[{},{},{},{},{},{}]",
                        hit.piece as u8, hit.x, hit.y, hit.w, hit.h, hit.score
                    )
                })
                .collect();
            let (screen_off, screen_on) = if screen_pixels > 0 {
                (
                    branch(frame, &matchers, &masks, false)?,
                    branch(frame, &matchers, &masks, true)?,
                )
            } else {
                (off.clone(), on.clone())
            };
            let threshold = Options::default().min_share;
            Ok(format!("\"auto\":{auto},\"share\":{share},\"threshold\":{threshold},\"veil_ms\":{veil_ms},\"gui_ms\":{gui_ms},\"screen_ms\":{screen_ms},\"screen_pixels\":{screen_pixels},\"screen_hits\":[{}],\"modes\":[{off},{on}],\"screen_modes\":[{screen_off},{screen_on}]",screen_hits.join(",")))
        },
        |n, r| {
            if let Err(e) = writeln!(out, "{{\"n\":{}, {r}}}", n * stride) {
                error = Some(e);
            }
            count += 1;
            if count % 200 == 0 {
                eprintln!("{count}/{total}");
            }
        },
    );
    if result.is_err() {
        let _ = decoder.kill();
        let _ = decoder.wait();
        result?;
    }
    if !decoder.wait()?.success() || count != total {
        return Err("incomplete decode".into());
    }
    if let Some(e) = error {
        return Err(e.into());
    }
    out.flush()?;
    Ok(())
}
