//! Unified GUI mask: the action bar (FireCrackle/docs/PLAN-GUI-MASK.md 3.4). Unshadowed, so it is accepted only when its pixels parse
//! as real font glyphs, centred at y = H-72.

use fire_core::gui_mask::*;
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn tex() -> GuiTextures {
    GuiTextures::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/assets/gui"))
        .expect("textures")
}

fn rnd(seed: &mut u64) -> u32 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    (*seed >> 33) as u32
}

fn world(w: usize, h: usize, seed: u64) -> Vec<u8> {
    let mut s = seed;
    let mut f = vec![0u8; w * h * 3];
    for y in 0..h {
        for x in 0..w {
            let base = 128.0 + 110.0 * ((x as f64 / 37.0).sin() * (y as f64 / 23.0).cos());
            for k in 0..3 {
                f[(y * w + x) * 3 + k] = (base + (rnd(&mut s) % 17) as f64 - 8.0 + k as f64 * 5.0)
                    .clamp(0.0, 255.0) as u8;
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

fn shot_at(fb_w: u32, fb_h: u32, g: u32, k: f64, st: &HudState, seed: u64) -> Shot {
    let fit = GuiFit::framebuffer(fb_w, fb_h, g, k);
    let (w, h) = (
        (fb_w as f64 * k).round() as usize,
        (fb_h as f64 * k).round() as usize,
    );
    let mut frame = world(w, h, seed);
    let truth = compose_hud(&mut frame, w, h, &tex(), st, &fit);
    Shot { w, h, frame, truth }
}

fn shot(st: &HudState, seed: u64) -> Shot {
    shot_at(1280, 720, 3, 1.0, st, seed)
}

fn detect(s: &Shot) -> GuiMask {
    detect_gui(&s.frame, s.w, s.h, &tex(), &GuiOptions::default()).expect("valid frame")
}

fn bars(m: &GuiMask) -> Vec<&PieceHit> {
    m.hits
        .iter()
        .filter(|h| h.piece == PieceId::ActionBar)
        .collect()
}

fn msg(text: &str) -> HudState {
    HudState {
        action_bar: Some(text.into()),
        ..HudState::default()
    }
}

fn recall(s: &Shot, m: &GuiMask) -> f64 {
    let (mut found, mut total) = (0usize, 0usize);
    for i in 0..s.w * s.h {
        if s.truth.piece[i] == PieceId::ActionBar as u8 {
            total += 1;
            if m.piece[i] == PieceId::ActionBar as u8 {
                found += 1;
            }
        }
    }
    assert!(total > 0);
    found as f64 / total as f64
}

fn stray(s: &Shot, m: &GuiMask) -> usize {
    (0..s.w * s.h)
        .filter(|&i| s.truth.piece[i] == 0 && m.piece[i] == PieceId::ActionBar as u8)
        .count()
}

// ================================================================ found and read

#[test]
fn survival_bed_and_mount_messages_are_found_and_read_back() {
    for text in [
        "You can only sleep at night",
        "You may not rest now; there are monsters nearby",
        "You may not rest now; the bed is too far away",
        "This bed is occupied",
        "Press Left Shift to Dismount",
    ] {
        let s = shot(&msg(text), 1);
        let m = detect(&s);
        let b = bars(&m);
        assert_eq!(b.len(), 1, "{text}");
        assert_eq!(b[0].text.as_deref(), Some(text));
        assert!(recall(&s, &m) > 0.95, "{text}");
        assert_eq!(stray(&s, &m), 0, "{text}");
    }
}

#[test]
fn a_tinted_jukebox_line_is_found() {
    let st = HudState {
        action_bar: Some("Now Playing: C418 - cat".into()),
        action_bar_color: [153, 46, 120],
        ..HudState::default()
    };
    let m = detect(&shot(&st, 2));
    assert_eq!(bars(&m).len(), 1);
    assert_eq!(bars(&m)[0].text.as_deref(), Some("Now Playing: C418 - cat"));
}

#[test]
fn a_red_message_is_found() {
    let st = HudState {
        action_bar: Some("Spectators cannot open containers".into()),
        action_bar_color: [255, 85, 85],
        ..HudState::default()
    };
    assert_eq!(bars(&detect(&shot(&st, 3))).len(), 1);
}

#[test]
fn it_is_found_together_with_the_held_item_name() {
    let st = HudState {
        action_bar: Some("This bed is occupied".into()),
        item_name: Some("Red Bed".into()),
        ..HudState::default()
    };
    let m = detect(&shot(&st, 4));
    assert_eq!(bars(&m).len(), 1);
    assert_eq!(
        m.hits
            .iter()
            .filter(|h| h.piece == PieceId::ItemName)
            .count(),
        1
    );
}

#[test]
fn it_is_found_at_other_scales_and_resizes() {
    for (fb_w, fb_h, g, k) in [
        (1920, 1080, 2, 1.0),
        (1920, 1080, 4, 2.0 / 3.0),
        (2560, 1440, 6, 0.75),
    ] {
        let m = detect(&shot_at(
            fb_w,
            fb_h,
            g,
            k,
            &msg("You can only sleep at night"),
            5,
        ));
        assert_eq!(bars(&m).len(), 1, "{fb_w}x{fb_h} g{g} k{k}");
    }
}

// ================================================================ not an action bar

#[test]
fn no_message_no_action_bar() {
    assert!(bars(&detect(&shot(&HudState::default(), 6))).is_empty());
}

fn paint(s: &mut Shot, gx: usize, gy: usize, rgb: [u8; 3]) {
    // one GUI pixel at scale 3
    for yy in 0..3 {
        for xx in 0..3 {
            let i = ((gy * 3 + yy) * s.w + gx * 3 + xx) * 3;
            s.frame[i..i + 3].copy_from_slice(&rgb);
        }
    }
}

#[test]
fn a_bright_rectangle_in_the_band_is_not_text() {
    let mut s = shot(&HudState::default(), 7);
    let (_, sh) = (427usize, 240usize);
    for gy in sh - 73..sh - 63 {
        for gx in 150..277 {
            paint(&mut s, gx, gy, [240, 240, 240]);
        }
    }
    assert!(bars(&detect(&s)).is_empty());
}

#[test]
fn random_bright_strokes_centred_in_the_band_are_not_text() {
    let mut s = shot(&HudState::default(), 8);
    let mut seed = 42u64;
    let sh = 240usize;
    for gy in sh - 72..sh - 64 {
        for gx in 170..257 {
            if rnd(&mut seed).is_multiple_of(3) {
                paint(&mut s, gx, gy, [255, 255, 255]);
            }
        }
    }
    assert!(bars(&detect(&s)).is_empty());
}

#[test]
fn glyph_like_blocks_that_are_not_the_font_are_not_text() {
    let mut s = shot(&HudState::default(), 9);
    let sh = 240usize;
    // centred 5x7 "glyphs" with one empty column between them: font-like rhythm, wrong shapes
    for c in 0..12 {
        let x0 = 177 + c * 6;
        for gy in sh - 72..sh - 65 {
            for gx in x0..x0 + 5 {
                if (gx + gy) % 2 == 0 {
                    paint(&mut s, gx, gy, [255, 255, 255]);
                }
            }
        }
    }
    assert!(bars(&detect(&s)).is_empty());
}

#[test]
fn a_fading_line_never_labels_world_pixels() {
    let st = HudState {
        action_bar: Some("You can only sleep at night".into()),
        action_bar_alpha: 0.4,
        ..HudState::default()
    };
    let s = shot(&st, 10);
    let m = detect(&s);
    assert_eq!(stray(&s, &m), 0);
}

#[test]
fn earlier_pieces_are_unchanged_by_an_action_bar() {
    let st = HudState {
        action_bar: Some("You can only sleep at night".into()),
        chat: vec!["<Steve> zzz".into()],
        ..HudState::default()
    };
    let m = detect(&shot(&st, 11));
    assert_eq!(
        m.hits
            .iter()
            .filter(|h| h.piece == PieceId::ChatLine)
            .count(),
        1
    );
    assert_eq!(
        m.hits.iter().filter(|h| h.piece == PieceId::Hotbar).count(),
        1
    );
    assert_eq!(
        m.hits.iter().filter(|h| h.piece == PieceId::Food).count(),
        10
    );
}

// ================================================================ compression

#[test]
fn it_survives_jpeg_compression() {
    let ok = Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        return;
    }
    let s = shot(&msg("You can only sleep at night"), 12);
    let dir = std::env::temp_dir().join(format!("fc_actionbar_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("f.rgb"), &s.frame).unwrap();
    assert!(Command::new("ffmpeg")
        .args([
            "-y",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            "1280x720",
            "-i"
        ])
        .arg(dir.join("f.rgb"))
        .args(["-q:v", "3", "-frames:v", "1"])
        .arg(dir.join("f.jpg"))
        .status()
        .unwrap()
        .success());
    let back = Command::new("ffmpeg")
        .args(["-loglevel", "error", "-i"])
        .arg(dir.join("f.jpg"))
        .args(["-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&dir);
    let m = detect_gui(&back.stdout, 1280, 720, &tex(), &GuiOptions::default()).unwrap();
    assert_eq!(bars(&m).len(), 1, "{:?}", m.notes);
}
