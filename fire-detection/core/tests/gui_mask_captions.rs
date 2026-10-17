//! Unified GUI mask: sound captions (PLAN-GUI-MASK.md 3.5). Bottom-right boxes of equal width, black at alpha 204,
//! stacked upward from y = H-35, with grey unshadowed text centred in them and an optional arrow.

use fire_core::gui_mask::*;
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn tex() -> GuiTextures {
    GuiTextures::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/assets/gui")).expect("textures")
}

fn rnd(seed: &mut u64) -> u32 {
    *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    (*seed >> 33) as u32
}

fn world(w: usize, h: usize, seed: u64) -> Vec<u8> {
    let mut s = seed;
    let mut f = vec![0u8; w * h * 3];
    for y in 0..h {
        for x in 0..w {
            let base = 128.0 + 110.0 * ((x as f64 / 37.0).sin() * (y as f64 / 23.0).cos());
            for k in 0..3 {
                f[(y * w + x) * 3 + k] = (base + (rnd(&mut s) % 17) as f64 - 8.0 + k as f64 * 5.0).clamp(0.0, 255.0) as u8;
            }
        }
    }
    f
}

struct Shot {
    w: usize,
    h: usize,
    frame: Vec<u8>,
    truth: Truth,
}

fn shot_on(fb_w: u32, fb_h: u32, g: u32, k: f64, st: &HudState, mut frame: Vec<u8>) -> Shot {
    let fit = GuiFit::framebuffer(fb_w, fb_h, g, k);
    let (w, h) = ((fb_w as f64 * k).round() as usize, (fb_h as f64 * k).round() as usize);
    assert_eq!(frame.len(), w * h * 3);
    let truth = compose_hud(&mut frame, w, h, &tex(), st, &fit);
    Shot { w, h, frame, truth }
}

fn shot_at(fb_w: u32, fb_h: u32, g: u32, k: f64, st: &HudState, seed: u64) -> Shot {
    let (w, h) = ((fb_w as f64 * k).round() as usize, (fb_h as f64 * k).round() as usize);
    shot_on(fb_w, fb_h, g, k, st, world(w, h, seed))
}

fn shot(st: &HudState, seed: u64) -> Shot {
    shot_at(1280, 720, 3, 1.0, st, seed)
}

fn detect(s: &Shot) -> GuiMask {
    detect_gui(&s.frame, s.w, s.h, &tex(), &GuiOptions::default()).expect("valid frame")
}

fn caps(m: &GuiMask) -> Vec<&PieceHit> {
    let mut v: Vec<&PieceHit> = m.hits.iter().filter(|h| h.piece == PieceId::SoundCaption).collect();
    v.sort_by_key(|h| h.index);
    v
}

fn cap(text: &str, grey: u8, arrow: Option<CaptionArrow>) -> Caption {
    Caption { text: text.into(), grey, arrow }
}

fn with(captions: Vec<Caption>) -> HudState {
    HudState { captions, ..HudState::default() }
}

const ID: u8 = PieceId::SoundCaption as u8;

/// Share of the truth's caption pixels of `class` that the mask gives to the caption piece.
fn recall(s: &Shot, m: &GuiMask, class: Option<PixelClass>) -> f64 {
    let (mut found, mut total) = (0usize, 0usize);
    for i in 0..s.w * s.h {
        if s.truth.piece[i] == ID && class.is_none_or(|c| s.truth.class[i] == c as u8) {
            total += 1;
            if m.piece[i] == ID {
                found += 1;
            }
        }
    }
    assert!(total > 0);
    found as f64 / total as f64
}

fn stray(s: &Shot, m: &GuiMask) -> usize {
    (0..s.w * s.h).filter(|&i| s.truth.piece[i] != ID && m.piece[i] == ID).count()
}

// ================================================================ found, read, boxed

#[test]
fn one_caption_is_found_read_and_boxed() {
    let s = shot(&with(vec![cap("Fire crackles", 255, Some(CaptionArrow::Right))]), 1);
    let m = detect(&s);
    let c = caps(&m);
    assert_eq!(c.len(), 1, "{:?}", m.notes);
    assert_eq!(c[0].text.as_deref(), Some("Fire crackles"));
    assert!(recall(&s, &m, Some(PixelClass::Translucent)) > 0.98);
    assert!(recall(&s, &m, Some(PixelClass::Opaque)) > 0.95);
    assert_eq!(stray(&s, &m), 0);
    // text pixels are opaque, the box behind them translucent
    let opaque_text = (0..s.w * s.h)
        .filter(|&i| s.truth.piece[i] == ID && s.truth.class[i] == PixelClass::Opaque as u8)
        .filter(|&i| m.class[i] == PixelClass::Opaque as u8)
        .count();
    assert!(opaque_text > 0);
    let box_translucent = (0..s.w * s.h)
        .filter(|&i| s.truth.piece[i] == ID && s.truth.class[i] == PixelClass::Translucent as u8)
        .filter(|&i| m.class[i] == PixelClass::Translucent as u8)
        .count();
    assert!(box_translucent > 0);
}

#[test]
fn a_stack_of_six_with_mixed_greys_and_arrows_is_read_line_by_line() {
    let lines = vec![
        cap("Lava pops", 255, Some(CaptionArrow::Right)),
        cap("Footsteps", 200, None),
        cap("Block broken", 140, Some(CaptionArrow::Left)),
        cap("Strider chirps", 90, Some(CaptionArrow::Right)),
        cap("Fire crackles", 255, None),
        cap("Item plops", 75, Some(CaptionArrow::Left)),
    ];
    let s = shot(&with(lines.clone()), 2);
    let m = detect(&s);
    let c = caps(&m);
    assert_eq!(c.len(), 6, "{:?}", m.notes);
    for (i, l) in lines.iter().enumerate() {
        assert_eq!(c[i].index as usize, i);
        assert_eq!(c[i].text.as_deref(), Some(l.text.as_str()), "line {i}");
    }
    assert!(recall(&s, &m, None) > 0.97);
    assert_eq!(stray(&s, &m), 0);
}

#[test]
fn over_bright_lava_every_box_pixel_is_labelled() {
    let (w, h) = (1280usize, 720usize);
    let mut seed = 3u64;
    let mut lava = vec![0u8; w * h * 3];
    for p in lava.chunks_mut(3) {
        let n = (rnd(&mut seed) % 40) as i32 - 20;
        p[0] = (230 + n / 2).clamp(0, 255) as u8;
        p[1] = (120 + n).clamp(0, 255) as u8;
        p[2] = (30 + n / 2).clamp(0, 255) as u8;
    }
    let st = with(vec![cap("Lava pops", 255, Some(CaptionArrow::Left)), cap("Fire crackles", 220, None), cap("Lava pops", 160, None)]);
    let s = shot_on(1280, 720, 3, 1.0, &st, lava);
    let m = detect(&s);
    assert_eq!(caps(&m).len(), 3, "{:?}", m.notes);
    assert!(recall(&s, &m, None) > 0.98);
    assert_eq!(stray(&s, &m), 0);
}

#[test]
fn on_a_dark_night_world_it_is_found_through_the_text() {
    let (w, h) = (1280usize, 720usize);
    let night: Vec<u8> = world(w, h, 4).iter().map(|&v| v / 6).collect();
    let s = shot_on(1280, 720, 3, 1.0, &with(vec![cap("Zombie groans", 255, Some(CaptionArrow::Left)), cap("Footsteps", 180, None)]), night);
    let m = detect(&s);
    assert_eq!(caps(&m).len(), 2, "{:?}", m.notes);
    assert_eq!(stray(&s, &m), 0);
}

#[test]
fn it_is_found_at_other_scales_and_resizes() {
    let st = with(vec![cap("Fire crackles", 255, None), cap("Lava pops", 200, Some(CaptionArrow::Right)), cap("Footsteps", 120, None)]);
    for (fb_w, fb_h, g, k) in [(1920, 1080, 2, 1.0), (1920, 1080, 4, 2.0 / 3.0), (2560, 1440, 6, 0.75)] {
        let m = detect(&shot_at(fb_w, fb_h, g, k, &st, 5));
        assert_eq!(caps(&m).len(), 3, "{fb_w}x{fb_h} g{g} k{k} {:?}", m.notes);
    }
}

#[test]
fn it_is_found_together_with_the_action_bar() {
    let st = HudState {
        action_bar: Some("Press Left Shift to Dismount".into()),
        captions: vec![cap("Horse breathes", 255, Some(CaptionArrow::Right))],
        ..HudState::default()
    };
    let m = detect(&shot(&st, 6));
    assert_eq!(caps(&m).len(), 1);
    assert_eq!(m.hits.iter().filter(|h| h.piece == PieceId::ActionBar).count(), 1);
}

#[test]
fn earlier_pieces_are_unchanged_by_captions() {
    let m = detect(&shot(&with(vec![cap("Lava pops", 255, None), cap("Footsteps", 200, None)]), 7));
    assert_eq!(m.hits.iter().filter(|h| h.piece == PieceId::Hotbar).count(), 1);
    assert_eq!(m.hits.iter().filter(|h| h.piece == PieceId::Food).count(), 10);
    assert_eq!(m.hits.iter().filter(|h| h.piece == PieceId::Health).count(), 10);
}

// ================================================================ not captions

#[test]
fn no_captions_no_caption_hits() {
    assert!(caps(&detect(&shot(&HudState::default(), 8))).is_empty());
}

/// Dim the world in a GUI rectangle (scale 3) the way a caption box would.
fn dim(s: &mut Shot, gx0: usize, gx1: usize, gy0: usize, gy1: usize) {
    for y in gy0 * 3..gy1 * 3 {
        for x in gx0 * 3..gx1 * 3 {
            for k in 0..3 {
                let i = (y * s.w + x) * 3 + k;
                s.frame[i] = (s.frame[i] as f64 * 0.2).round() as u8;
            }
        }
    }
}

#[test]
fn a_dark_box_without_text_is_not_a_caption() {
    let mut s = shot(&HudState::default(), 9);
    dim(&mut s, 360, 426, 240 - 45, 240 - 25);
    assert!(caps(&detect(&s)).is_empty());
}

#[test]
fn a_dark_box_with_random_grey_strokes_is_not_a_caption() {
    let mut s = shot(&HudState::default(), 10);
    dim(&mut s, 360, 426, 240 - 45, 240 - 25);
    let mut seed = 77u64;
    for gy in 240 - 44..240 - 26 {
        for gx in 368..418 {
            if rnd(&mut seed) % 4 == 0 {
                for yy in 0..3 {
                    for xx in 0..3 {
                        let i = ((gy * 3 + yy) * s.w + gx * 3 + xx) * 3;
                        s.frame[i..i + 3].copy_from_slice(&[220, 220, 220]);
                    }
                }
            }
        }
    }
    assert!(caps(&detect(&s)).is_empty());
}

#[test]
fn chat_lines_are_not_captions() {
    let st = HudState { chat: vec!["<Alex> fire crackles".into(), "<Steve> lava pops".into()], ..HudState::default() };
    let m = detect(&shot(&st, 11));
    assert!(caps(&m).is_empty());
    assert_eq!(m.hits.iter().filter(|h| h.piece == PieceId::ChatLine).count(), 2);
}

// ================================================================ compression

#[test]
fn it_survives_jpeg_compression() {
    let ok = Command::new("ffmpeg").arg("-version").stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false);
    if !ok {
        return;
    }
    let st = with(vec![cap("Fire crackles", 255, Some(CaptionArrow::Left)), cap("Lava pops", 200, None), cap("Footsteps", 120, Some(CaptionArrow::Right))]);
    let s = shot(&st, 12);
    let dir = std::env::temp_dir().join(format!("fc_captions_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("f.rgb"), &s.frame).unwrap();
    assert!(Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1280x720", "-i"])
        .arg(dir.join("f.rgb"))
        .args(["-q:v", "3", "-frames:v", "1"])
        .arg(dir.join("f.jpg"))
        .status()
        .unwrap()
        .success());
    let back = Command::new("ffmpeg").args(["-loglevel", "error", "-i"]).arg(dir.join("f.jpg")).args(["-f", "rawvideo", "-pix_fmt", "rgb24", "-"]).output().unwrap();
    let _ = std::fs::remove_dir_all(&dir);
    let m = detect_gui(&back.stdout, 1280, 720, &tex(), &GuiOptions::default()).unwrap();
    assert_eq!(caps(&m).len(), 3, "{:?}", m.notes);
}
