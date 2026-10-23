//! Detecting the vanilla GUI background veil (pause menu, inventory, ...) from pixels alone.
//! The game draws fillGradient(0xC0101010 -> 0xD0101010): colour (16,16,16), alpha 192/255 at the top to 208/255 at the bottom.
//! So every veiled pixel is >= 16*alpha (about 12) and <= 16*alpha + 255*(1 - alpha) (about 76 at the top, 60 at the bottom).

// Existing exhaustive tests specify the historical strict primitive. Production
// GUI-aware regressions below exercise the shared normal entry point separately.
use fire_core::veil::{detect_veil_strict as detect_veil, A_BOTTOM, A_TOP};

#[test]
fn shared_default_ignores_known_gui_panels_and_tooltips() {
    let (w, h) = (100, 100);
    let mut rgb = vec![20u8; w * h * 3];
    for y in 0..h {
        for x in (0..5).chain(95..100) {
            let p = (y * w + x) * 3;
            rgb[p..p + 3].copy_from_slice(&[16, 0, 16]);
        }
    }
    assert!(!detect_veil(&rgb, w, h, 0).unwrap());
    assert!(fire_core::veil::detect_veil(&rgb, w, h, 0).unwrap());
    rgb.fill(139);
    assert!(!fire_core::veil::detect_veil(&rgb, w, h, 0).unwrap());
    rgb.fill(0);
    assert!(!fire_core::veil::detect_veil(&rgb, w, h, 0).unwrap());
}

const W: usize = 320;
const H: usize = 180;

#[test]
fn shared_detector_accepts_quantized_shadow_floor_without_accepting_true_blacks() {
    // Real compressed menu frame 12482: >10% of the margins have a channel at
    // 10. Rounding the theoretical 12.047 floor up before applying slack=2
    // incorrectly requires 11 instead of allowing the quantized floor 12 - 2.
    let mut rgb = vec![20u8; W * H * 3];
    for y in 0..H / 3 {
        for x in 0..W {
            let i = (y * W + x) * 3;
            rgb[i..i + 3].copy_from_slice(&[14, 11, 10]);
        }
    }
    assert!(!detect_veil(&rgb, W, H, 0).unwrap()); // historical strict bounds
    assert!(fire_core::veil::detect_veil(&rgb, W, H, 0).unwrap());
    for pixel in rgb.chunks_mut(3).take(W * H / 3) {
        pixel.copy_from_slice(&[0, 0, 0]);
    }
    assert!(!fire_core::veil::detect_veil(&rgb, W, H, 0).unwrap());
    assert!(!fire_core::veil::detect_veil(&scene(201, 0, 70), W, H, 0).unwrap());
}

#[test]
fn optimized_bounds_and_short_circuit_match_exhaustive_original() {
    fn reference(rgb: &[u8], w: usize, h: usize, y0: usize) -> bool {
        let lo = 16. * A_TOP - 2.;
        let margin = ((w as f64 * 0.2).floor() as usize).max(1).min(w / 2);
        let (mut inside, mut total) = (0usize, 0usize);
        for y in y0..h {
            let a = A_TOP + (A_BOTTOM - A_TOP) * (y as f64 + 0.5) / h as f64;
            let hi = 16. * a + 255. * (1. - a) + 2.;
            for x in (0..margin).chain(w - margin..w) {
                total += 1;
                let i = (y * w + x) * 3;
                if rgb[i..i + 3]
                    .iter()
                    .all(|&c| c as f64 >= lo && c as f64 <= hi)
                {
                    inside += 1;
                }
            }
        }
        inside as f64 >= 0.9 * total as f64
    }
    let mut seed = 1123;
    for (w, h) in [(1, 9), (2, 11), (7, 17), (80, 45), (320, 180)] {
        for percent in [0, 10, 89, 90, 91, 100] {
            let mut f = vec![0; w * h * 3];
            for px in f.chunks_mut(3) {
                let good = rnd(&mut seed) % 100 < percent;
                px.fill(if good {
                    16 + (rnd(&mut seed) % 30) as u8
                } else {
                    (rnd(&mut seed) % 256) as u8
                });
            }
            for y0 in [0, h / 2] {
                assert_eq!(
                    detect_veil(&f, w, h, y0).unwrap(),
                    reference(&f, w, h, y0),
                    "{w}x{h}, {percent}%, y0={y0}"
                );
            }
        }
    }
}

fn rnd(seed: &mut u64) -> u32 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    (*seed >> 33) as u32
}

/// A natural-ish scene: smooth gradients plus noise, values spread over 0..255.
fn scene(seed: u64, lo: u8, hi: u8) -> Vec<u8> {
    let mut s = seed;
    let mut f = vec![0u8; W * H * 3];
    for y in 0..H {
        for x in 0..W {
            let base = lo as f64
                + (hi - lo) as f64
                    * (0.5 + 0.5 * ((x as f64 / 23.0).sin() * (y as f64 / 17.0).cos()));
            for k in 0..3 {
                let v = base + (rnd(&mut s) % 21) as f64 - 10.0 + k as f64 * 4.0;
                f[(y * W + x) * 3 + k] = v.clamp(lo as f64, hi as f64) as u8;
            }
        }
    }
    f
}

/// The game's forward veil: out = c * a + p * (1 - a), a growing from the top row to the bottom row.
fn veil(frame: &[u8]) -> Vec<u8> {
    let mut out = frame.to_vec();
    for y in 0..H {
        let a = A_TOP + (A_BOTTOM - A_TOP) * (y as f64 + 0.5) / H as f64;
        for x in 0..W {
            for k in 0..3 {
                let i = (y * W + x) * 3 + k;
                out[i] = (16.0 * a + frame[i] as f64 * (1.0 - a)).round() as u8;
            }
        }
    }
    out
}

// ---- basics ----

#[test]
fn a_veiled_scene_is_detected() {
    for seed in 0..5 {
        let f = veil(&scene(seed, 0, 255));
        assert!(detect_veil(&f, W, H, 0).unwrap(), "seed {seed}");
    }
}

#[test]
fn a_normal_bright_scene_is_not_veiled() {
    for seed in 0..5 {
        let f = scene(100 + seed, 0, 255);
        assert!(!detect_veil(&f, W, H, 0).unwrap(), "seed {seed}");
    }
}

#[test]
fn a_dark_scene_with_black_pixels_is_not_veiled() {
    // a dark Nether cave: nothing above 70, but real blacks, which a veil can never produce
    for seed in 0..5 {
        let f = scene(200 + seed, 0, 70);
        assert!(!detect_veil(&f, W, H, 0).unwrap(), "seed {seed}");
    }
}

#[test]
fn a_veiled_totally_black_scene_is_detected() {
    // black through the veil = (16 * a): every pixel at the floor
    let f = veil(&vec![0u8; W * H * 3]);
    assert!(detect_veil(&f, W, H, 0).unwrap());
}

#[test]
fn a_plain_black_frame_is_not_veiled() {
    assert!(!detect_veil(&vec![0u8; W * H * 3], W, H, 0).unwrap());
}

// ---- GUI widgets over the veil ----

#[test]
fn bright_buttons_and_text_over_the_veil_do_not_hide_it() {
    let mut f = veil(&scene(7, 0, 255));
    // a pause-menu-like block of bright widgets (about 6% of the frame)
    for y in 60..90 {
        for x in 100..220 {
            for k in 0..3 {
                f[(y * W + x) * 3 + k] = 200;
            }
        }
    }
    assert!(detect_veil(&f, W, H, 0).unwrap());
}

#[test]
fn a_big_bright_area_means_it_is_not_a_veil() {
    let mut f = veil(&scene(8, 0, 255));
    for y in 0..H / 2 {
        for x in 0..W {
            for k in 0..3 {
                f[(y * W + x) * 3 + k] = 220; // half the frame is bright: no veil can do that
            }
        }
    }
    assert!(!detect_veil(&f, W, H, 0).unwrap());
}

// ---- compression noise, strip rows ----

#[test]
fn small_compression_noise_keeps_the_detection() {
    let mut s = 3u64;
    let mut f = veil(&scene(9, 0, 255));
    for b in f.iter_mut() {
        *b = (*b as i32 + (rnd(&mut s) % 5) as i32 - 2).clamp(0, 255) as u8;
    }
    assert!(detect_veil(&f, W, H, 0).unwrap());
}

#[test]
fn the_sync_strip_rows_are_ignored() {
    let mut f = veil(&scene(10, 0, 255));
    // a 24-row strip of black and white cells is 13% of this frame: too many out-of-range pixels unless it is skipped
    for y in 0..24 {
        for x in 0..W {
            let v = if (x / 4) % 2 == 0 { 255 } else { 0 };
            for k in 0..3 {
                f[(y * W + x) * 3 + k] = v;
            }
        }
    }
    assert!(
        !detect_veil(&f, W, H, 0).unwrap(),
        "premise: 13% bad pixels break the veil test"
    );
    assert!(
        detect_veil(&f, W, H, 24).unwrap(),
        "with y0 = 24 the strip is skipped"
    );
}

// ---- errors ----

#[test]
fn bad_input_is_an_error() {
    assert!(detect_veil(&[0u8; 5], 2, 1, 0).is_err());
    assert!(detect_veil(&[], 0, 0, 0).is_err());
    assert!(detect_veil(&vec![0u8; W * H * 3], W, H, H).is_err()); // no rows left
    assert!(detect_veil(&vec![0u8; W * H * 3], W, H, H + 1).is_err());
}

#[test]
fn a_tiny_frame_does_not_panic() {
    let _ = detect_veil(&[20u8; 3 * 4 * 4], 4, 4, 0);
}

// ---- a big GUI panel in the middle (inventory, creative inventory, crafting) ----

fn with_centre_panel(mut f: Vec<u8>, x0: usize, x1: usize, y0: usize, y1: usize, v: u8) -> Vec<u8> {
    for y in y0..y1 {
        for x in x0..x1 {
            for k in 0..3 {
                f[(y * W + x) * 3 + k] = v;
            }
        }
    }
    f
}

#[test]
fn a_big_inventory_panel_over_the_veil_does_not_hide_it() {
    // vanilla inventory: 176x166 GUI px; at GUI scale 3 on a 1920x1080 screen that is 27% x 46% of the frame (12% of the pixels)
    let f = with_centre_panel(
        veil(&scene(21, 0, 255)),
        W * 365 / 1000,
        W * 635 / 1000,
        H * 27 / 100,
        H * 73 / 100,
        198,
    );
    assert!(detect_veil(&f, W, H, 0).unwrap());
}

#[test]
fn a_wide_creative_panel_over_the_veil_does_not_hide_it() {
    // creative inventory: 195x136 GUI px, about 30% x 38% of the frame, plus a tab strip: well over 10% of the pixels
    let f = with_centre_panel(
        veil(&scene(22, 0, 255)),
        W * 35 / 100,
        W * 65 / 100,
        H * 22 / 100,
        H * 78 / 100,
        190,
    );
    assert!(detect_veil(&f, W, H, 0).unwrap());
}

#[test]
fn a_bright_centre_panel_on_an_unveiled_scene_is_still_not_a_veil() {
    let f = with_centre_panel(
        scene(23, 0, 255),
        W * 35 / 100,
        W * 65 / 100,
        H * 22 / 100,
        H * 78 / 100,
        190,
    );
    assert!(!detect_veil(&f, W, H, 0).unwrap());
}

#[test]
fn only_the_margins_count_so_a_veil_in_the_middle_alone_is_not_enough() {
    // a normal scene whose centre happens to be veil-dark (a dark room in the middle) must not be called veiled
    let mut f = scene(24, 0, 255);
    let dark = veil(&scene(25, 0, 255));
    for y in 0..H {
        for x in W * 20 / 100..W * 80 / 100 {
            f[(y * W + x) * 3..(y * W + x) * 3 + 3]
                .copy_from_slice(&dark[(y * W + x) * 3..(y * W + x) * 3 + 3]);
        }
    }
    assert!(!detect_veil(&f, W, H, 0).unwrap());
}

#[test]
fn chat_over_the_left_margin_and_a_hotbar_do_not_hide_the_veil() {
    let mut f = veil(&scene(26, 0, 255));
    // chat box in the bottom-left corner: bright text lines over a dark box, about 8% of the left margin band
    for y in H * 70 / 100..H * 90 / 100 {
        for x in 0..W * 18 / 100 {
            if (y + x) % 5 == 0 {
                f[(y * W + x) * 3..(y * W + x) * 3 + 3].copy_from_slice(&[240, 240, 240]);
            }
        }
    }
    assert!(detect_veil(&f, W, H, 0).unwrap());
}

// 1.21 menus (pause, options, ... every screen that is not a container, sign or book) draw the
// tiled inworld_menu_background.png over the (optionally blurred) world: solid black at alpha 64.
// out = p(1 - 64/255). Container screens keep the flat gradient in both versions.
fn menu_veil(frame: &[u8], channels: usize) -> Vec<u8> {
    frame
        .chunks_exact(channels)
        .flat_map(|p| {
            let mut q = p.to_vec();
            for v in &mut q[..3] {
                *v = (*v as f64 * (1.0 - 64.0 / 255.0)).round() as u8;
            }
            q
        })
        .collect()
}

#[test]
fn the_menu_inverse_undoes_the_1_21_menu_background() {
    let frame = scene(7, 0, 255);
    let mut out = menu_veil(&frame, 3);
    fire_core::veil::unveil_style_in_place(&mut out, W, H, 3, fire_core::veil::VeilStyle::Menu).unwrap();
    // only 8-bit rounding of the darkened picture is lost: at most one level after the inverse
    for (a, b) in frame.iter().zip(&out) {
        assert!(a.abs_diff(*b) <= 1, "{a} came back as {b}");
    }
    assert!((fire_core::veil::MENU_ALPHA - 64.0 / 255.0).abs() < 1e-12);
}

#[test]
fn the_menu_inverse_keeps_black_clips_bright_and_keeps_alpha() {
    let mut px = vec![0, 0, 0, 7, 191, 192, 255, 99];
    fire_core::veil::unveil_style_in_place(&mut px, 2, 1, 4, fire_core::veil::VeilStyle::Menu).unwrap();
    assert_eq!(px, vec![0, 0, 0, 7, 255, 255, 255, 99]);
}

#[test]
fn the_flat_style_is_the_existing_inverse() {
    let frame = veil(&scene(3, 0, 255));
    let mut out = frame.clone();
    fire_core::veil::unveil_style_in_place(&mut out, W, H, 3, fire_core::veil::VeilStyle::Flat).unwrap();
    assert_eq!(out, fire_core::veil::unveil_rgb(&frame, W, H).unwrap());
}

#[test]
fn the_styled_inverse_rejects_bad_frames() {
    let mut px = vec![0; 5];
    assert!(fire_core::veil::unveil_style_in_place(&mut px, 2, 1, 3, fire_core::veil::VeilStyle::Menu).is_err());
}
