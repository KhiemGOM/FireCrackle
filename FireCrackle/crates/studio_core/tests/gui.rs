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

#[test]
fn open_screen_pixels_are_flagged_apart_from_the_hud() {
    // Inventory/menu/recipe panels (ids 24..26) would collide with Armor/Food/Air in the low nibble.
    for screen in [24, 25, 26] {
        let b = pack(screen, 3);
        assert!(is_screen(b), "piece {screen}");
        assert_eq!(unpack(b).1, 3, "class survives the flag");
    }
    for hud in [1, 4, 8, 9, 10, 11, 15] {
        assert!(!is_screen(pack(hud, 1)), "piece {hud}");
        assert!(!is_screen(pack(hud, 3)), "piece {hud}");
    }
    assert!(!is_screen(0));
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
        } else if name == "screen_recipe" {
            // inventory shifted right by the open recipe book, the book two GUI px to its left
            let (x, y) = ((sw - 176) / 2 + 77, (sh - 166) / 2);
            draw(x, y, 176, 166, true);
            let recipe = tex.recipe_book.as_ref().expect("recipe_book.rgba");
            for v in 0..166 {
                for u in 0..147 {
                    let p = (v * recipe.width + u) * 4;
                    let c = &recipe.rgba[p..p + 4];
                    if c[3] != 255 {
                        continue;
                    }
                    for dy in 0..3 {
                        for dx in 0..3 {
                            let p = (((y + v) * 3 + dy) * w + (x - 149 + u) * 3 + dx) * 3;
                            f[p..p + 3].copy_from_slice(&c[..3]);
                        }
                    }
                }
            }
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
    // The open recipe book is a screen too: its pixels are flagged like the inventory's.
    let (reply, packed) = analyzer
        .analyze_jpeg(&jpeg(1280, 720, true, "screen_recipe"))
        .unwrap();
    assert!(
        reply
            .pieces
            .iter()
            .any(|p| p.piece == "RecipeBookPanel" && p.count > 0),
        "{:?}",
        reply.pieces
    );
    // middle of the book: GUI x = (427-176)/2 + 77 - 149 + 70, y = (240-166)/2 + 80, at 3 px per GUI px
    let (bx, by) = (
        (((427 - 176) / 2 + 77 - 149 + 70) * 3) as usize,
        (((240 - 166) / 2 + 80) * 3) as usize,
    );
    assert!(is_screen(packed[by * 1280 + bx]));
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
        mask_available: true,
        scale: Some(3.0),
        scaled_width: Some(427),
        scaled_height: Some(240),
        notes: vec![],
        pieces: vec![PieceCount {
            piece: "Hotbar".into(),
            count: 1,
        }],
        screen_veil: None,
    };
    let v = serde_json::to_value(&r).unwrap();
    assert_eq!(v["scale"], 3.0);
    assert_eq!(v["pieces"][0]["piece"], "Hotbar");
    assert_eq!(v["scaled_width"], 427);
}

#[test]
fn an_item_tooltip_is_an_open_screen_piece() {
    use fire_core::gui_mask::PieceId;
    let packed = studio_core::gui::pack(PieceId::ItemTooltip as u8, 3);
    assert!(studio_core::gui::is_screen(packed));
    assert!(!studio_core::gui::is_screen(studio_core::gui::pack(
        PieceId::SoundCaption as u8,
        3
    )));
}

/// An engine result for a 1280x720 picture: an inventory panel at (500, 200), 300 x 280.
fn screens(width: usize, height: usize) -> fire_core::gui_interaction::Detection {
    let panel = fire_core::gui_interaction::PanelMatch {
        screen_type: "inventory.inventory_screen".into(),
        version: "test".into(),
        variant: "base".into(),
        bounds: fire_core::gui_interaction::Rect {
            x: 500.,
            y: 200.,
            width: 300.,
            height: 280.,
        },
        scale_x: 1.5,
        scale_y: 1.5,
        score: 0.9,
        border_score: 0.9,
        structure_score: 0.9,
        presence_only: true,
        visible_probes: [1, 1, 0],
        recipe_book: false,
    };
    fire_core::gui_interaction::Detection {
        image_width: width,
        image_height: height,
        gui_detected: true,
        candidate_types: vec![],
        matched: None,
        alternatives: vec![panel],
        reason: "known_panel_presence".into(),
        tooltips: vec![],
    }
}

#[test]
fn screens_found_by_the_scan_join_this_pictures_own_hud_mask() {
    if !have_ffmpeg() {
        return;
    }
    let a = GuiAnalyzer::new().unwrap();
    let frame = jpeg(1280, 720, true, "hud_only");
    let (own, _) = a.analyze_jpeg(&frame).unwrap();
    let (reply, packed) = a
        .analyze_jpeg_with_screens(&frame, Some(&screens(1280, 720)))
        .unwrap();
    assert!(reply.reliable, "the HUD is still read from this picture");
    assert_eq!(reply.scale, own.scale);
    assert!(
        studio_core::gui::is_screen(packed[300 * 1280 + 650]),
        "inside the scanned panel"
    );
    assert!(!studio_core::gui::is_screen(packed[50 * 1280 + 50]));
    // without a scan answer it is the picture's own detection
    let (alone, alone_packed) = a.analyze_jpeg_with_screens(&frame, None).unwrap();
    assert_eq!(alone.pieces.len(), own.pieces.len());
    assert!(!studio_core::gui::is_screen(alone_packed[300 * 1280 + 650]));
    // the scan's native 2560x1440 result is scaled to this 1280x720 picture: its panel at (500, 200) lands at (250, 100)
    let native = screens(2560, 1440);
    let (_, scaled) = a.analyze_jpeg_with_screens(&frame, Some(&native)).unwrap();
    assert!(studio_core::gui::is_screen(scaled[150 * 1280 + 300]));
    assert!(!studio_core::gui::is_screen(scaled[300 * 1280 + 650]));
    // a result of another shape is an error, never a misplaced mask
    assert!(a
        .analyze_jpeg_with_screens(&frame, Some(&screens(1000, 1000)))
        .is_err());
}

/// A JPEG fixture's pixels as a PNG: the same picture, losslessly, like the app's exact native frame.
fn png_of(jpeg: &[u8]) -> (Vec<u8>, usize, usize) {
    let mut d = jpeg_decoder::Decoder::new(jpeg);
    let rgb = d.decode().unwrap();
    let info = d.info().unwrap();
    let (w, h) = (info.width as usize, info.height as usize);
    let mut out = Vec::new();
    {
        let mut e = png::Encoder::new(&mut out, w as u32, h as u32);
        e.set_color(png::ColorType::Rgb);
        e.set_depth(png::BitDepth::Eight);
        e.write_header().unwrap().write_image_data(&rgb).unwrap();
    }
    (out, w, h)
}

#[test]
fn the_mask_of_the_native_png_is_the_mask_of_those_pixels() {
    if !have_ffmpeg() {
        return;
    }
    let a = GuiAnalyzer::new().unwrap();
    let (png, w, h) = png_of(&jpeg(1280, 720, true, "hud_native_png"));
    let (reply, packed) = a.analyze_png(&png, None).unwrap();
    assert_eq!((reply.width, reply.height), (w, h));
    assert!(reply.reliable, "the HUD is read from the native picture");
    // the scan's screens join it, and a non-PNG is an error
    let (_, with) = a.analyze_png(&png, Some(&screens(1280, 720))).unwrap();
    assert!(studio_core::gui::is_screen(with[300 * 1280 + 650]));
    assert!(!studio_core::gui::is_screen(packed[300 * 1280 + 650]));
    assert!(a.analyze_png(b"not a png", None).is_err());
}

#[test]
fn a_mask_from_the_scans_result_alone_runs_no_detector_and_has_only_the_screens() {
    // the gallery: a preview-sized mask straight from the scan's native result
    let (reply, packed) = studio_core::gui::screens_mask(&screens(2560, 1440), 1024, 576).unwrap();
    assert_eq!((reply.width, reply.height), (1024, 576));
    assert!(reply.mask_available && !reply.reliable, "no HUD was read");
    assert!(reply.pieces.iter().any(|p| p.piece == "InventoryPanel"));
    // the 2560x1440 panel at (500, 200) is at (200, 80) on the 1024 preview
    assert!(studio_core::gui::is_screen(packed[120 * 1024 + 300]));
    assert!(!studio_core::gui::is_screen(packed[10 * 1024 + 10]));
    let (none, empty) = studio_core::gui::screens_mask(
        &fire_core::gui_interaction::Detection::none(2560, 1440),
        1024,
        576,
    )
    .unwrap();
    assert!(none.pieces.is_empty() && empty.iter().all(|&b| b == 0));
    assert!(
        studio_core::gui::screens_mask(&screens(2560, 1440), 1000, 1000).is_err(),
        "another shape"
    );
}

#[test]
fn the_reply_says_which_veil_the_open_screen_draws() {
    let with = |screen_type: &str, version: &str| {
        let mut d = screens(2560, 1440);
        d.alternatives[0].screen_type = screen_type.into();
        d.alternatives[0].version = version.into();
        studio_core::gui::screens_mask(&d, 1024, 576).unwrap().0.screen_veil
    };
    assert_eq!(with("inventory.inventory_screen", "1.21.11"), Some("flat"));
    assert_eq!(with("inventory.sign_edit_screen", "1.21.11"), Some("flat"));
    assert_eq!(with("options.options_screen", "1.21.11"), Some("menu"));
    assert_eq!(with("options.options_screen", "1.16.5"), Some("flat"));
    assert_eq!(with("pause_screen", "1.16.5"), Some("unclear"));
    // no open screen, no veil to name
    let none = studio_core::gui::screens_mask(&fire_core::gui_interaction::Detection::none(2560, 1440), 1024, 576);
    assert_eq!(none.unwrap().0.screen_veil, None);
    let v = serde_json::to_value(studio_core::gui::screens_mask(&screens(2560, 1440), 1024, 576).unwrap().0).unwrap();
    assert_eq!(v["screen_veil"], "flat");
}

// ---- the native frame's pixels from its PNG, shared by the GUI mask and the first-person match

fn encode(w: u32, h: u32, colour: png::ColorType, depth: png::BitDepth, data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut e = png::Encoder::new(&mut out, w, h);
        e.set_color(colour);
        e.set_depth(depth);
        e.write_header().unwrap().write_image_data(data).unwrap();
    }
    out
}

#[test]
fn an_rgb_or_rgba_png_gives_the_same_rgb_pixels_and_its_size() {
    let rgb: Vec<u8> = (0..3 * 4 * 2).map(|i| (i * 11) as u8).collect();
    let rgba: Vec<u8> = rgb
        .chunks(3)
        .flat_map(|p| [p[0], p[1], p[2], 200])
        .collect();
    for png in [
        encode(4, 2, png::ColorType::Rgb, png::BitDepth::Eight, &rgb),
        encode(4, 2, png::ColorType::Rgba, png::BitDepth::Eight, &rgba),
    ] {
        assert_eq!(png_rgb(&png).unwrap(), (rgb.clone(), 4, 2));
    }
}

#[test]
fn a_non_png_or_an_unsupported_png_is_an_error() {
    assert!(png_rgb(b"not a png").is_err());
    let grey16 = encode(
        2,
        2,
        png::ColorType::Grayscale,
        png::BitDepth::Sixteen,
        &[0; 8],
    );
    assert!(png_rgb(&grey16).is_err());
}
