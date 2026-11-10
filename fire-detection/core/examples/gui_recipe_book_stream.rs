//! Stream raw RGB frames through the production GUI interaction detector (the app's GUI scan engine) and print, per
//! frame, whether a panel is open with the recipe book. The GUI scale is given (one scale per recording).
//! gui_recipe_book_stream BUNDLE WIDTH HEIGHT GUI_SCALE FIRST_FRAME STEP < frames.rgb > results.csv
use fire_core::gui_interaction::InteractionDetector;
use std::io::{Read, Write};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    if args.len() != 7 {
        return Err(
            "usage: gui_recipe_book_stream BUNDLE WIDTH HEIGHT GUI_SCALE FIRST_FRAME STEP < RGB24"
                .into(),
        );
    }
    let detector = InteractionDetector::from_bundle(&std::fs::read(&args[1])?)?;
    let (width, height): (usize, usize) = (args[2].parse()?, args[3].parse()?);
    let scale: f64 = args[4].parse()?;
    let (first, step): (u64, u64) = (args[5].parse()?, args[6].parse()?);
    detector.prepare(width, height)?;
    let mut buffer = vec![0; width * height * 3];
    let mut input = std::io::stdin().lock();
    let mut output = std::io::BufWriter::new(std::io::stdout().lock());
    writeln!(
        output,
        "frame,gui,recipe_book,screen_type,presence_only,score"
    )?;
    let mut index = 0u64;
    while input.read_exact(&mut buffer).is_ok() {
        let d = detector.detect_at_hud_scale(&buffer, width, height, || Ok(Some(scale)))?;
        let frame = first + index * step;
        match d.alternatives.first() {
            Some(p) => writeln!(
                output,
                "{frame},1,{},{},{},{:.3}",
                p.recipe_book as u8, p.screen_type, p.presence_only as u8, p.score
            )?,
            None => writeln!(output, "{frame},0,0,,,")?,
        }
        index += 1;
    }
    output.flush()?;
    Ok(())
}
