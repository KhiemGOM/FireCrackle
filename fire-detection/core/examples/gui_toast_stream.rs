//! Stream raw RGB24 frames through the production GUI mask and print every settled toast it finds, for whole-video
//! toast review. `MIN` lowers the piece acceptance score (toast rows only are printed), so near misses can be audited.
//! gui_toast_stream WIDTH HEIGHT FIRST_FRAME STEP [MIN] < frames.rgb > toasts.csv
use fire_core::gui_mask::{GuiDetector, GuiFitHint, GuiOptions, GuiTextures, PieceId};
use std::io::{Read, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    if !(5..=6).contains(&args.len()) {
        return Err("usage: gui_toast_stream WIDTH HEIGHT FIRST_FRAME STEP [MIN] < RGB24".into());
    }
    let (width, height): (usize, usize) = (args[1].parse()?, args[2].parse()?);
    let (first, step): (u64, u64) = (args[3].parse()?, args[4].parse()?);
    let mut options = GuiOptions::default();
    if let Some(min) = args.get(5) {
        options.piece_min_score = min.parse()?;
    }
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/assets/gui");
    let textures = GuiTextures::load(&dir)?;
    if textures.toasts.is_none() {
        return Err(
            "toasts.rgba missing: run FireCrackle/scripts/gui-assets.mjs prepareGuiAssets".into(),
        );
    }
    let detector = GuiDetector::new(textures, options)?;
    detector.prepare(width, height);
    let mut hint = GuiFitHint::default();
    let mut buffer = vec![0; width * height * 3];
    let mut input = std::io::stdin().lock();
    let mut output = std::io::BufWriter::new(std::io::stdout().lock());
    writeln!(output, "frame,reliable,piece,slot,x,y,score")?;
    let mut index = 0u64;
    while input.read_exact(&mut buffer).is_ok() {
        let frame = first + index * step;
        let mask = detector.detect_with_hint(&buffer, width, height, &mut hint)?;
        let mut any = false;
        for hit in &mask.hits {
            let kind = match hit.piece {
                PieceId::RecipeToast => "recipe",
                PieceId::AdvancementToast => "advancement",
                _ => continue,
            };
            any = true;
            writeln!(
                output,
                "{frame},1,{kind},{},{},{},{:.4}",
                hit.index, hit.x, hit.y, hit.score
            )?;
        }
        if !any {
            writeln!(output, "{frame},{},,,,,", mask.reliable as u8)?;
        }
        index += 1;
    }
    output.flush()?;
    Ok(())
}
