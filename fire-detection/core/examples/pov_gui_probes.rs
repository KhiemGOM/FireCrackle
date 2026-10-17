//! Stream canonical probe observations once for offline mask/texture-cell experiments.
use fire_core::{
    gui_mask::{detect_gui, GuiOptions, GuiTextures},
    overlay::{ProbeLayout, SilhouetteMatcher},
    veil::detect_veil,
    video::parallel_frames,
};
use std::{
    io::{BufWriter, Write},
    process::{Command, Stdio},
    sync::atomic::AtomicBool,
};

const RADII: [usize; 4] = [0, 2, 4, 8];
fn layout_json(l: &ProbeLayout) -> String {
    format!(
        "{{\"offsets\":{:?},\"disc\":{:?},\"pred\":{:?},\"indices\":{:?},\"cells\":{:?}}}",
        l.offsets, l.disc, l.pred, l.colour_indices, l.colour_cells
    )
}
fn prefix(class: &[u8], piece: &[u8], w: usize, h: usize) -> Vec<[u32; 2]> {
    let mut out = vec![[0; 2]; (w + 1) * (h + 1)];
    for y in 0..h {
        let mut row = [0u32; 2];
        for x in 0..w {
            let k = y * w + x;
            row[0] += u32::from(class[k] == 1 || [4, 5, 11].contains(&piece[k]));
            row[1] += u32::from(class[k] == 2);
            let above = out[y * (w + 1) + x + 1];
            out[(y + 1) * (w + 1) + x + 1] = [above[0] + row[0], above[1] + row[1]];
        }
    }
    out
}
fn categories(l: &ProbeLayout, integral: &[[u32; 2]], w: usize, h: usize) -> (Vec<u8>, Vec<u8>) {
    let mut hard = vec![4; l.offsets.len()];
    let mut trans = vec![4; l.offsets.len()];
    if integral.is_empty() {
        return (hard, trans);
    }
    for (k, &o) in l.offsets.iter().enumerate() {
        let (x, y) = (o / 3 % w, o / 3 / w);
        for (i, &r) in RADII.iter().enumerate() {
            let (x0, x1) = (x.saturating_sub(r), (x + r + 1).min(w));
            let (y0, y1) = (y.saturating_sub(r), (y + r + 1).min(h));
            let (br, tl, bl, tr) = (
                integral[y1 * (w + 1) + x1],
                integral[y0 * (w + 1) + x0],
                integral[y1 * (w + 1) + x0],
                integral[y0 * (w + 1) + x1],
            );
            if hard[k] == 4 && br[0] + tl[0] > bl[0] + tr[0] {
                hard[k] = i as u8;
            }
            if trans[k] == 4 && br[1] + tl[1] > bl[1] + tr[1] {
                trans[k] = i as u8;
            }
        }
    }
    (hard, trans)
}
fn thumbnail(frame: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(32 * 18 * 3);
    for by in 0..18 {
        for bx in 0..32 {
            let mut sum = [0u64; 3];
            let mut count = 0;
            for y in by * h / 18..(by + 1) * h / 18 {
                for x in bx * w / 32..(bx + 1) * w / 32 {
                    for c in 0..3 {
                        sum[c] += frame[(y * w + x) * 3 + c] as u64;
                    }
                    count += 1;
                }
            }
            for value in sum {
                out.push((value / count.max(1)) as u8);
            }
        }
    }
    out
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<_> = std::env::args().collect();
    if a.len() != 7 {
        return Err("pov_gui_probes VIDEO WIDTH HEIGHT STRIDE SAMPLES FFMPEG".into());
    }
    let (w, h, stride, total): (usize, usize, u32, u32) =
        (a[2].parse()?, a[3].parse()?, a[4].parse()?, a[5].parse()?);
    if stride == 0 || total == 0 {
        return Err("positive sampling required".into());
    }
    let assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/assets");
    let sheet = std::fs::read(assets.join("fire_1.rgba"))?;
    let matchers = [
        SilhouetteMatcher::new(&sheet, w, h, 70.)?,
        SilhouetteMatcher::new(&sheet, w, h, 60.)?,
    ];
    let layouts = [
        matchers[0].research_layout(&sheet, 70.)?,
        matchers[1].research_layout(&sheet, 60.)?,
    ];
    let tex = GuiTextures::load(&assets.join("gui"))?;
    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    writeln!(
        out,
        "{{\"layout\":[{},{}],\"radii\":{:?}}}",
        layout_json(&layouts[0]),
        layout_json(&layouts[1]),
        RADII
    )?;
    let mut decoder = Command::new(&a[6])
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
    let cancel = AtomicBool::new(false);
    let mut count = 0;
    let mut write_error = None;
    let result = parallel_frames(
        decoder.stdout.take().unwrap(),
        w * h * 3,
        total,
        4,
        &cancel,
        |frame| {
            let veiled = detect_veil(frame, w, h, 16.min(h - 1))?;
            let gui = detect_gui(frame, w, h, &tex, &GuiOptions::default())?;
            let integral = if gui.reliable {
                prefix(&gui.class, &gui.piece, w, h)
            } else {
                Vec::new()
            };
            let mut stats = Vec::new();
            for f in 0..2 {
                let obs = matchers[f].research_observations(frame, veiled)?;
                let (hard, trans) = categories(&layouts[f], &integral, w, h);
                stats.push(format!(
                    "{{\"warm\":{:?},\"hits\":{:?},\"hard\":{:?},\"trans\":{:?}}}",
                    obs.warm, obs.colour_hits, hard, trans
                ));
            }
            Ok(format!(
                "\"reliable\":{},\"veiled\":{},\"thumb\":{:?},\"obs\":[{}]",
                gui.reliable,
                veiled,
                thumbnail(frame, w, h),
                stats.join(",")
            ))
        },
        |n, record| {
            if let Err(e) = writeln!(out, "{{\"n\":{}, {record}}}", n * stride) {
                write_error = Some(e);
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
    if let Some(e) = write_error {
        return Err(e.into());
    }
    out.flush()?;
    eprintln!("completed {count} probe frames");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expansion_uses_clipped_chebyshev_boxes() {
        let (w, h) = (9, 5);
        let mut c = vec![0; w * h];
        let p = vec![0; w * h];
        c[2 * w + 4] = 1;
        let l = ProbeLayout {
            offsets: (0..w * h).map(|i| i * 3).collect(),
            disc: vec![],
            pred: vec![],
            colour_indices: vec![],
            colour_cells: vec![],
        };
        let (hard, trans) = categories(&l, &prefix(&c, &p, w, h), w, h);
        assert_eq!(hard[2 * w + 4], 0);
        assert_eq!(hard[0], 2);
        assert_eq!(hard[2 * w + 2], 1);
        assert!(trans.iter().all(|&v| v == 4));
    }
}
