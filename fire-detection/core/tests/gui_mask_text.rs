//! Unified GUI mask, phase 2: shadowed text (chat, held-item name, titles, boss names), the XP number, boss bars, mount
//! health and jump bar, F3 text. Evidence and failure cases: `FireCrackle/PLAN-GUI-MASK.md` 3.3.

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

fn shot_at(fb_w: u32, fb_h: u32, g: u32, k: f64, st: &HudState, seed: u64) -> Shot {
    let fit = GuiFit::framebuffer(fb_w, fb_h, g, k);
    let (w, h) = ((fb_w as f64 * k).round() as usize, (fb_h as f64 * k).round() as usize);
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

fn hits(m: &GuiMask, p: PieceId) -> Vec<&PieceHit> {
    m.hits.iter().filter(|h| h.piece == p).collect()
}

/// Share of the truth's opaque pixels of `p` that the mask gives to `p`.
fn recall(s: &Shot, m: &GuiMask, p: PieceId) -> f64 {
    let (mut found, mut total) = (0usize, 0usize);
    for i in 0..s.w * s.h {
        if s.truth.piece[i] == p as u8 && s.truth.class[i] == PixelClass::Opaque as u8 {
            total += 1;
            if m.piece[i] == p as u8 {
                found += 1;
            }
        }
    }
    assert!(total > 0, "{p:?} has no truth pixels");
    found as f64 / total as f64
}

/// Pixels the mask gives to one of `ps` although the truth has no GUI there at all.
fn stray(s: &Shot, m: &GuiMask, ps: &[PieceId]) -> usize {
    (0..s.w * s.h).filter(|&i| s.truth.piece[i] == 0 && ps.iter().any(|&p| m.piece[i] == p as u8)).count()
}

const TEXT: [PieceId; 6] = [PieceId::ChatLine, PieceId::ItemName, PieceId::XpLevel, PieceId::Title, PieceId::Subtitle, PieceId::BossName];

// ================================================================ textures

#[test]
fn the_font_and_boss_bar_textures_load() {
    let t = tex();
    let font = t.font.as_ref().expect("ascii.rgba");
    assert_eq!((font.width, font.height), (128, 128));
    assert_eq!(t.bars.as_ref().expect("bars.rgba").width, 256);
}

// ================================================================ chat

#[test]
fn chat_lines_are_found_line_by_line() {
    let st = HudState { chat: vec!["<Steve> hello there".into(), "Alex joined the game".into(), "<Alex> fire at spawn!".into()], ..HudState::default() };
    let s = shot(&st, 1);
    let m = detect(&s);
    let mut lines: Vec<u8> = hits(&m, PieceId::ChatLine).iter().map(|h| h.index).collect();
    lines.sort();
    assert_eq!(lines, vec![0, 1, 2]);
    assert!(recall(&s, &m, PieceId::ChatLine) > 0.95);
}

#[test]
fn text_pixels_are_opaque_in_the_mask() {
    let st = HudState { chat: vec!["the quick brown fox jumps".into()], ..HudState::default() };
    let s = shot(&st, 2);
    let m = detect(&s);
    let (mut opaque, mut total) = (0usize, 0usize);
    for i in 0..s.w * s.h {
        if s.truth.piece[i] == PieceId::ChatLine as u8 && s.truth.class[i] == PixelClass::Opaque as u8 {
            total += 1;
            if m.class[i] == PixelClass::Opaque as u8 {
                opaque += 1;
            }
        }
    }
    assert!(opaque as f64 / total as f64 > 0.8, "{opaque}/{total}");
}

#[test]
fn no_chat_no_chat_lines() {
    assert!(hits(&detect(&shot(&HudState::default(), 3)), PieceId::ChatLine).is_empty());
}

#[test]
fn chat_is_found_at_other_scales_and_resizes() {
    let st = HudState { chat: vec!["<Steve> testing at another scale".into()], ..HudState::default() };
    for (fb_w, fb_h, g, k) in [(1920, 1080, 2, 1.0), (1920, 1080, 4, 2.0 / 3.0), (2560, 1440, 6, 0.75)] {
        let s = shot_at(fb_w, fb_h, g, k, &st, 4);
        let m = detect(&s);
        assert_eq!(hits(&m, PieceId::ChatLine).len(), 1, "{fb_w}x{fb_h} g{g} k{k}: {:?}", m.notes);
    }
}

// ================================================================ things that must not be text

#[test]
fn bright_and_dark_world_pixels_are_not_text() {
    let (w, h) = (1280usize, 720usize);
    let mut s = shot(&HudState::default(), 5);
    // a harsh checkerboard of bright and darker blocks across the chat region (ratio 1/3, not 1/4)
    for y in 300..h - 130 {
        for x in 0..1000 {
            let v = if (x / 3 + y / 3) % 2 == 0 { 240 } else { 80 };
            s.frame[(y * w + x) * 3..(y * w + x) * 3 + 3].copy_from_slice(&[v, v, v]);
        }
    }
    let m = detect(&s);
    for p in TEXT {
        assert!(hits(&m, p).is_empty(), "{p:?}");
    }
}

#[test]
fn a_few_lone_quarter_pairs_are_not_a_line() {
    let (w, _) = (1280usize, 720usize);
    let mut s = shot(&HudState::default(), 6);
    // five isolated text-like pixel pairs (colour and its quarter one GUI pixel down-right) in the chat area
    for i in 0..5 {
        let (gx, gy) = (20 + 30 * i, 180);
        for (dx, dy, c) in [(0, 0, [200u8, 200, 200]), (1, 1, [50, 50, 50])] {
            for yy in 0..3 {
                for xx in 0..3 {
                    let (x, y) = ((gx + dx) * 3 + xx, (gy + dy) * 3 + yy);
                    s.frame[(y * w + x) * 3..(y * w + x) * 3 + 3].copy_from_slice(&c);
                }
            }
        }
    }
    assert!(hits(&detect(&s), PieceId::ChatLine).is_empty());
}

#[test]
fn text_is_never_labelled_far_from_where_it_is_drawn() {
    let st = HudState { chat: vec!["<Steve> hi".into()], item_name: Some("Flint and Steel".into()), xp_level: 12, ..HudState::default() };
    let s = shot(&st, 7);
    let m = detect(&s);
    // the mask may cover a line's whole box (unknown), but never pixels outside any drawn GUI box
    assert_eq!(stray(&s, &m, &TEXT), 0);
}

#[test]
fn nothing_is_reported_without_a_reliable_hud() {
    let st = HudState { hud_hidden: true, chat: vec!["<Steve> hidden".into()], ..HudState::default() };
    let m = detect(&shot(&st, 8));
    assert!(!m.reliable);
    assert!(m.hits.is_empty());
}

// ================================================================ held-item name, titles

#[test]
fn the_held_item_name_is_found_above_the_bars_and_lower_in_creative() {
    for st in [
        HudState { item_name: Some("Flint and Steel".into()), ..HudState::default() },
        HudState { item_name: Some("Lava Bucket".into()), status_bars: false, xp_bar: false, ..HudState::default() },
    ] {
        let s = shot(&st, 9);
        let m = detect(&s);
        assert_eq!(hits(&m, PieceId::ItemName).len(), 1, "{st:?}");
        assert!(recall(&s, &m, PieceId::ItemName) > 0.95);
    }
}

#[test]
fn titles_and_subtitles_are_found_with_their_scaled_shadows() {
    let st = HudState { title: Some("You Died!".into()), subtitle: Some("Score: 7".into()), ..HudState::default() };
    let s = shot(&st, 10);
    let m = detect(&s);
    assert_eq!(hits(&m, PieceId::Title).len(), 1);
    assert_eq!(hits(&m, PieceId::Subtitle).len(), 1);
    assert!(recall(&s, &m, PieceId::Title) > 0.95);
}

// ================================================================ XP number

#[test]
fn the_xp_number_is_found_for_one_to_three_digits_and_not_at_zero() {
    for level in [1u32, 37, 105] {
        let s = shot(&HudState { xp_level: level, ..HudState::default() }, 11);
        let m = detect(&s);
        assert_eq!(hits(&m, PieceId::XpLevel).len(), 1, "level {level}");
        assert!(recall(&s, &m, PieceId::XpLevel) > 0.95, "level {level}");
    }
    assert!(hits(&detect(&shot(&HudState::default(), 11)), PieceId::XpLevel).is_empty());
}

// ================================================================ boss bars

#[test]
fn boss_bars_of_every_colour_and_fill_are_found_with_their_names() {
    for color in 0..7u8 {
        for progress in [0.0f32, 1.0] {
            let st = HudState { boss_bars: vec![BossBar { color, progress, name: "Ender Dragon".into() }], ..HudState::default() };
            let m = detect(&shot(&st, 12));
            assert_eq!(hits(&m, PieceId::BossBar).len(), 1, "colour {color} progress {progress}");
            assert_eq!(hits(&m, PieceId::BossName).len(), 1, "colour {color} progress {progress}");
        }
    }
}

#[test]
fn two_stacked_boss_bars_are_both_found() {
    let st = HudState {
        boss_bars: vec![BossBar { color: 2, progress: 0.4, name: "Wither".into() }, BossBar { color: 5, progress: 0.9, name: "Raid".into() }],
        ..HudState::default()
    };
    let m = detect(&shot(&st, 13));
    assert_eq!(hits(&m, PieceId::BossBar).len(), 2);
    assert_eq!(hits(&m, PieceId::BossName).len(), 2);
}

// ================================================================ mount

#[test]
fn mount_health_replaces_food_and_the_jump_bar_replaces_xp() {
    let st = HudState { mount_hearts: 15, mount_health: 22.0, jump_bar: Some(0.6), xp_bar: false, ..HudState::default() };
    let m = detect(&shot(&st, 14));
    assert_eq!(hits(&m, PieceId::MountHealth).len(), 15);
    assert!(hits(&m, PieceId::Food).is_empty());
    assert_eq!(hits(&m, PieceId::JumpBar).len(), 1);
    assert!(hits(&m, PieceId::XpBar).is_empty());
}

// ================================================================ F3

#[test]
fn f3_lines_are_found_on_both_sides() {
    let st = HudState {
        debug_left: vec!["Minecraft 1.16.5 (vanilla)".into(), "60 fps T: 120".into(), "XYZ: 12.5 / 64 / -30.2".into(), "Block: 12 64 -31".into(), "Facing: north".into()],
        debug_right: vec!["Java: 1.8.0 64bit".into(), "Mem: 40% 800/2048MB".into(), "CPU: 8x".into()],
        ..HudState::default()
    };
    let m = detect(&shot(&st, 15));
    assert_eq!(hits(&m, PieceId::DebugText).len(), 8);
}

// ================================================================ compression

fn have_ffmpeg() -> bool {
    Command::new("ffmpeg").arg("-version").stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

#[test]
fn chat_survives_jpeg_compression() {
    if !have_ffmpeg() {
        return;
    }
    let st = HudState { chat: vec!["<Steve> compressed text still reads".into()], xp_level: 30, ..HudState::default() };
    let s = shot(&st, 16);
    let dir = std::env::temp_dir().join(format!("fc_guitext_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("f.rgb"), &s.frame).unwrap();
    let ok = Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1280x720", "-i"])
        .arg(dir.join("f.rgb"))
        .args(["-q:v", "3", "-frames:v", "1"])
        .arg(dir.join("f.jpg"))
        .status()
        .unwrap();
    assert!(ok.success());
    let back = Command::new("ffmpeg").args(["-loglevel", "error", "-i"]).arg(dir.join("f.jpg")).args(["-f", "rawvideo", "-pix_fmt", "rgb24", "-"]).output().unwrap();
    let _ = std::fs::remove_dir_all(&dir);
    let m = detect_gui(&back.stdout, 1280, 720, &tex(), &GuiOptions::default()).unwrap();
    assert!(m.reliable);
    assert_eq!(hits(&m, PieceId::ChatLine).len(), 1, "{:?}", m.notes);
    assert_eq!(hits(&m, PieceId::XpLevel).len(), 1);
}
