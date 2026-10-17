//! Read RGB frames from stdin; audit canonical veil On/Off, never change a decision.
use fire_core::{
    gui_mask::{add_screen_masks, detect_gui, GuiOptions, GuiTextures},
    overlay::SilhouetteMatcher,
    veil::detect_veil,
};
use std::io::{Read, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 && args.len() != 4 {
        return Err("pov_miss_counterfactual WIDTH HEIGHT [screens] < frames.rgb".into());
    }
    let w: usize = args[1].parse()?;
    let h: usize = args[2].parse()?;
    let assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/assets");
    let sheet = std::fs::read(assets.join("fire_1.rgba"))?;
    let textures = GuiTextures::load(&assets.join("gui"))?;
    let matchers = [
        SilhouetteMatcher::new(&sheet, w, h, 70.)?,
        SilhouetteMatcher::new(&sheet, w, h, 60.)?,
    ];
    let mut input = std::io::stdin().lock();
    let mut output = std::io::BufWriter::new(std::io::stdout().lock());
    let mut frame = vec![
        0;
        w.checked_mul(h)
            .and_then(|n| n.checked_mul(3))
            .ok_or("size overflow")?
    ];
    let mut index = 0;
    loop {
        // Distinguish clean EOF from a truncated frame.
        if input.read(&mut frame[..1])? == 0 {
            break;
        }
        input.read_exact(&mut frame[1..])?;
        let auto = detect_veil(&frame, w, h, 16.min(h - 1))?;
        let mut gui = detect_gui(&frame, w, h, &textures, &GuiOptions::default())?;
        if args.len() == 4 {
            if args[3] != "screens" {
                return Err("unknown mode".into());
            }
            add_screen_masks(&frame, w, h, &textures, &mut gui)?;
        }
        let screen_pixels = gui
            .piece
            .iter()
            .filter(|&&p| [24, 25, 26].contains(&p))
            .count();
        let screen_hits = gui
            .hits
            .iter()
            .filter(|p| [24, 25, 26].contains(&(p.piece as u8)))
            .map(|p| {
                format!(
                    "[{},{},{},{},{},{}]",
                    p.piece as u8, p.x, p.y, p.w, p.h, p.score
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let mask: Vec<u8> = gui
            .class
            .iter()
            .zip(&gui.piece)
            .map(|(&c, &p)| {
                u8::from(gui.reliable && (c == 1 || c == 2 || [4, 5, 11, 24, 25, 26].contains(&p)))
            })
            .collect();
        let mut modes = Vec::new();
        for veiled in [false, true] {
            let mut fovs = Vec::new();
            for matcher in &matchers {
                let raw = matcher
                    .inspect_frame(&frame, None, veiled)?
                    .diagnostics
                    .unwrap();
                let masked = matcher
                    .inspect_frame(&frame, Some(&mask), veiled)?
                    .diagnostics
                    .unwrap();
                fovs.push(format!(
                    "{{\"raw_sz\":{:?},\"raw_cz\":{:?},\"raw_sum\":{:?},\"raw_used\":{:?},\"mask_sz\":{:?},\"mask_cz\":{:?},\"mask_sum\":{:?},\"mask_used\":{:?}}}",
                    raw.silhouette_z,raw.colour_z,raw.colour_sum,raw.colour_used,
                    masked.silhouette_z,masked.colour_z,masked.colour_sum,masked.colour_used));
            }
            modes.push(format!("[{}]", fovs.join(",")));
        }
        writeln!(
            output,
            "{{\"index\":{index},\"auto\":{auto},\"gui_reliable\":{},\"screen_pixels\":{screen_pixels},\"screen_hits\":[{screen_hits}],\"modes\":[{}]}}",
            gui.reliable,
            modes.join(",")
        )?;
        output.flush()?;
        index += 1;
    }
    Ok(())
}
