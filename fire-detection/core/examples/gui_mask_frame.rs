//! `cargo run --release --example gui_mask_frame -- FRAME.rgb WIDTH HEIGHT OUT.rgb [PIECE_MIN_SCORE]`
//! Runs the GUI mask on one raw RGB24 frame, prints the fit and the pieces, and writes the frame with the mask painted
//! over it (opaque = red, translucent = blue, unknown = yellow, half-transparent) for eyeballing.

use fire_core::gui_mask::*;
use std::collections::BTreeMap;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() != 5 && a.len() != 6 {
        eprintln!("usage: gui_mask_frame FRAME.rgb WIDTH HEIGHT OUT.rgb [PIECE_MIN_SCORE]");
        std::process::exit(2);
    }
    let (w, h): (usize, usize) = (a[2].parse().unwrap(), a[3].parse().unwrap());
    let frame = std::fs::read(&a[1]).expect("frame");
    let tex = GuiTextures::load(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../data/assets/gui"
    )))
    .expect("textures");
    let t = std::time::Instant::now();
    let mut opts = GuiOptions::default();
    if let Some(v) = a.get(5) {
        opts.piece_min_score = v.parse().expect("score");
    }
    let m = detect_gui(&frame, w, h, &tex, &opts).expect("detect");
    if a.len() == 6 {
        for hit in m.hits.iter().filter(|h| {
            h.piece == PieceId::Food || h.piece == PieceId::Armor || h.piece == PieceId::Air
        }) {
            println!(
                "  {:?} #{} at {},{} score {:.3}",
                hit.piece, hit.index, hit.x, hit.y, hit.score
            );
        }
    }
    println!(
        "{} in {:.0} ms: reliable {} fit {:?}",
        a[1],
        t.elapsed().as_secs_f64() * 1000.0,
        m.reliable,
        m.fit
    );
    for n in &m.notes {
        println!("  note: {n}");
    }
    let mut count: BTreeMap<String, (usize, f64)> = BTreeMap::new();
    for hit in &m.hits {
        let e = count.entry(format!("{:?}", hit.piece)).or_insert((0, 1.0));
        e.0 += 1;
        e.1 = e.1.min(hit.score);
    }
    for (k, (n, worst)) in count {
        println!("  {k}: {n} (lowest score {worst:.3})");
    }
    let mut out = frame.clone();
    for i in 0..w * h {
        let tint = match m.class[i] {
            1 => [255, 0, 0],
            2 => [0, 80, 255],
            3 => [255, 220, 0],
            _ => continue,
        };
        for k in 0..3 {
            out[i * 3 + k] = ((out[i * 3 + k] as u16 + tint[k] as u16) / 2) as u8;
        }
    }
    std::fs::write(&a[4], out).expect("write");
}
