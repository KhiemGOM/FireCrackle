//! Thin research runner; all GUI detection lives in the canonical module.
#![allow(dead_code)]
#[path = "../../../../fire-detection/core/src/gui_mask.rs"]
mod gui_mask;
use gui_mask::{detect_gui, GuiOptions, GuiTextures};
use std::{collections::BTreeMap, fs, path::Path};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<String> = std::env::args().collect();
    if a.len() != 3 {
        return Err("usage: batch ASSET_DIR INPUT.tsv".into());
    }
    let tex = GuiTextures::load(Path::new(&a[1]))?;
    let opts = GuiOptions::default();
    for line in fs::read_to_string(&a[2])?.lines() {
        let p: Vec<&str> = line.split('\t').collect();
        if p.len() != 4 {
            return Err("Expected width, height, RGB path, output stem".into());
        }
        let w: usize = p[0].parse()?;
        let h: usize = p[1].parse()?;
        let rgb = fs::read(p[2])?;
        let start = std::time::Instant::now();
        let mask = detect_gui(&rgb, w, h, &tex, &opts)?;
        let ms = start.elapsed().as_secs_f64() * 1000.;
        fs::write(format!("{}.classes", p[3]), &mask.class)?;
        fs::write(format!("{}.pieces", p[3]), &mask.piece)?;
        fs::write(
            format!("{}.reliable", p[3]),
            if mask.reliable { b"1" } else { b"0" },
        )?;
        fs::write(
            format!("{}.notes.txt", p[3]),
            format!(
                "fit: {:?}\nnotes: {:?}\nhits: {:?}\n",
                mask.fit, mask.notes, mask.hits
            ),
        )?;
        let counts: Vec<usize> = (0..4)
            .map(|c| mask.class.iter().filter(|v| **v == c).count())
            .collect();
        let mut pieces = BTreeMap::new();
        for id in &mask.piece {
            if *id != 0 {
                *pieces.entry(*id).or_insert(0usize) += 1;
            }
        }
        println!(
            "{}\t{}\t{}\t{:.3}\t{}\t{}\t{}\t{}\t{:?}",
            p[3],
            mask.reliable,
            mask.fit.as_ref().map(|f| f.scale).unwrap_or(0.),
            ms,
            counts[0],
            counts[1],
            counts[2],
            counts[3],
            pieces
        );
    }
    Ok(())
}
