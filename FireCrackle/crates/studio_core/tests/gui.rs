//! The app side of the GUI mask: legacy project-answer compatibility, and running the
//! mask on the JPEG frame the app shows.

use fire_core::gui_mask::{compose_hud, GuiFit, GuiTextures, HudState};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use studio_core::gui::*;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fc_gui_{}_{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

// ================================================================ the answer

#[test]
fn no_answer_yet_is_none() {
    let d = scratch("none");
    assert_eq!(read_answer(&d), None);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn an_answer_is_saved_and_can_be_changed() {
    let d = scratch("save");
    write_answer(&d, GuiAnswer::Yes).unwrap();
    assert_eq!(read_answer(&d), Some(GuiAnswer::Yes));
    write_answer(&d, GuiAnswer::NotSure).unwrap();
    assert_eq!(read_answer(&d), Some(GuiAnswer::NotSure));
    assert!(d.join("gui.json").is_file());
    assert!(
        std::fs::read_dir(&d).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")),
        "no temp file left"
    );
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn a_corrupt_or_unknown_answer_is_treated_as_unanswered_never_as_yes() {
    let d = scratch("corrupt");
    for body in [
        "",
        "{",
        "{\"answer\":\"maybe\"}",
        "{\"answer\":true}",
        "[]",
        "{\"answer\":\"YES\"}",
    ] {
        std::fs::write(d.join("gui.json"), body).unwrap();
        assert_eq!(read_answer(&d), None, "{body:?}");
    }
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn writing_into_a_missing_folder_is_an_error() {
    assert!(write_answer(Path::new("definitely/not/here/at/all"), GuiAnswer::Yes).is_err());
}

#[test]
fn the_answer_has_stable_json_names() {
    assert_eq!(
        serde_json::to_string(&GuiAnswer::NotSure).unwrap(),
        "\"not_sure\""
    );
    assert_eq!(serde_json::to_string(&GuiAnswer::Yes).unwrap(), "\"yes\"");
    assert_eq!(
        serde_json::from_str::<GuiAnswer>("\"no\"").unwrap(),
        GuiAnswer::No
    );
}

// ================================================================ packing

#[test]
fn a_pixel_packs_class_and_piece_into_one_byte() {
    assert_eq!(pack(1, 1), 0x11);
    assert_eq!(pack(7, 3), 0x37);
    assert_eq!(pack(0, 0), 0);
    assert_eq!(unpack(pack(11, 2)), (11, 2));
}

// ================================================================ analysing a frame

#[test]
fn the_embedded_vanilla_textures_load() {
    assert!(GuiAnalyzer::new().is_ok());
}

#[test]
fn bytes_that_are_not_a_jpeg_are_an_error() {
    let a = GuiAnalyzer::new().unwrap();
    assert!(a.analyze_jpeg(&[]).is_err());
    assert!(a.analyze_jpeg(b"definitely not a jpeg").is_err());
}

fn have_ffmpeg() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn rnd(seed: &mut u64) -> u32 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    (*seed >> 33) as u32
}

/// A JPEG (via ffmpeg, quality 2) of a world frame, with the vanilla HUD composed on it when `hud`.
fn jpeg(w: usize, h: usize, hud: bool, name: &str) -> Vec<u8> {
    let mut s = 5u64;
    let mut f = vec![0u8; w * h * 3];
    for y in 0..h {
        for x in 0..w {
            let base = 128.0 + 120.0 * ((x as f64 / 37.0).sin() * (y as f64 / 23.0).cos());
            for k in 0..3 {
                f[(y * w + x) * 3 + k] =
                    (base + (rnd(&mut s) % 17) as f64 - 8.0).clamp(0.0, 255.0) as u8;
            }
        }
    }
    if hud {
        let tex = GuiTextures::load(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fire-detection/data/assets/gui"),
        )
        .unwrap();
        compose_hud(
            &mut f,
            w,
            h,
            &tex,
            &HudState::default(),
            &GuiFit::framebuffer(w as u32, h as u32, 3, 1.0),
        );
        // Texture-confirmed open screens must reach the app's reply, not only
        // the core screen-mask tests. Bright world pixels deliberately make
        // pixel-only veil detection insufficient for these fixtures.
        let fit = GuiFit::framebuffer(w as u32, h as u32, 3, 1.0);
        let (sw, sh) = (fit.scaled_width as usize, fit.scaled_height as usize);
        let mut draw = |x: usize, y: usize, width: usize, height: usize, inventory: bool| {
            for v in 0..height {
                for u in 0..width {
                    let sheet = if inventory {
                        &tex.inventory
                    } else {
                        &tex.widgets
                    };
                    let tx = if inventory || u < width / 2 {
                        u
                    } else {
                        200 + u - width
                    };
                    let ty = if inventory { v } else { 46 + v };
                    let p = (ty * sheet.width + tx) * 4;
                    let c = &sheet.rgba[p..p + 4];
                    if c[3] != 255 {
                        continue;
                    }
                    for dy in 0..3 {
                        for dx in 0..3 {
                            let p = (((y + v) * 3 + dy) * w + (x + u) * 3 + dx) * 3;
                            f[p..p + 3].copy_from_slice(&c[..3]);
                        }
                    }
                }
            }
        };
        if name == "screen_inventory" {
            draw((sw - 176) / 2, (sh - 166) / 2, 176, 166, true);
        } else if name == "screen_menu" {
            for row in 0..3 {
                draw(sw / 2 - 102, sh / 4 + 8 + row * 24, 204, 20, false);
            }
        }
    }
    let d = scratch(name);
    std::fs::write(d.join("f.rgb"), &f).unwrap();
    let ok = Command::new("ffmpeg")
        .args([
            "-y",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            &format!("{w}x{h}"),
            "-i",
        ])
        .arg(d.join("f.rgb"))
        .args(["-q:v", "2", "-frames:v", "1"])
        .arg(d.join("f.jpg"))
        .status()
        .unwrap();
    assert!(ok.success());
    let bytes = std::fs::read(d.join("f.jpg")).unwrap();
    let _ = std::fs::remove_dir_all(&d);
    bytes
}

#[test]
fn a_frame_with_the_vanilla_hud_is_found_and_packed() {
    if !have_ffmpeg() {
        return;
    }
    let a = GuiAnalyzer::new().unwrap();
    let (reply, packed) = a.analyze_jpeg(&jpeg(1280, 720, true, "hud")).unwrap();
    assert!(reply.reliable, "{:?}", reply.notes);
    assert_eq!((reply.width, reply.height), (1280, 720));
    assert_eq!(packed.len(), 1280 * 720);
    let scale = reply.scale.unwrap();
    assert!((scale - 3.0).abs() < 0.03, "scale {scale}");
    let count = |n: &str| {
        reply
            .pieces
            .iter()
            .find(|p| p.piece == n)
            .map_or(0, |p| p.count)
    };
    assert_eq!(count("Hotbar"), 1);
    assert_eq!(count("Health"), 10);
    assert_eq!(count("Food"), 10);
    assert!(
        packed.iter().any(|&b| unpack(b) == (1, 1)),
        "opaque hotbar pixels expected"
    );
}

#[test]
fn a_frame_without_hud_is_unreliable_and_empty() {
    if !have_ffmpeg() {
        return;
    }
    let a = GuiAnalyzer::new().unwrap();
    let (reply, packed) = a.analyze_jpeg(&jpeg(1280, 720, false, "nohud")).unwrap();
    assert!(!reply.reliable);
    assert!(reply.scale.is_none());
    assert!(!reply.notes.is_empty());
    assert!(packed.iter().all(|&b| b == 0));
}

#[test]
fn known_open_screens_are_reported_separately_from_the_hud() {
    if !have_ffmpeg() {
        return;
    }
    let analyzer = GuiAnalyzer::new().unwrap();
    for (fixture, piece) in [
        ("screen_inventory", "InventoryPanel"),
        ("screen_menu", "MenuButton"),
    ] {
        let (reply, _) = analyzer
            .analyze_jpeg(&jpeg(1280, 720, true, fixture))
            .unwrap();
        assert!(reply.reliable, "{:?}", reply.notes);
        assert!(
            reply.pieces.iter().any(|p| p.piece == piece && p.count > 0),
            "{fixture}: {:?}",
            reply.pieces
        );
    }
    let (reply, _) = analyzer
        .analyze_jpeg(&jpeg(1280, 720, true, "hud_only"))
        .unwrap();
    assert!(!reply
        .pieces
        .iter()
        .any(|p| p.piece == "InventoryPanel" || p.piece == "MenuButton"));
}

#[test]
fn the_reply_serialises_for_the_ui() {
    let r = GuiMaskReply {
        width: 2,
        height: 1,
        reliable: true,
        scale: Some(3.0),
        scaled_width: Some(427),
        scaled_height: Some(240),
        notes: vec![],
        pieces: vec![PieceCount {
            piece: "Hotbar".into(),
            count: 1,
        }],
    };
    let v = serde_json::to_value(&r).unwrap();
    assert_eq!(v["scale"], 3.0);
    assert_eq!(v["pieces"][0]["piece"], "Hotbar");
    assert_eq!(v["scaled_width"], 427);
}
