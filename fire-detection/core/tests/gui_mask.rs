//! Unified GUI mask, phase 1: scale fit and the neutral HUD. Geometry from Yarn 1.16.5 (`InGameHud`, `Window`), see
//! `FireCrackle/docs/PLAN-GUI-MASK.md`. Synthetic frames are composed from the real vanilla textures with that geometry, so the
//! truth is known per pixel.

use fire_core::gui_mask::*;
use std::path::PathBuf;

fn tex() -> GuiTextures {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/assets/gui");
    GuiTextures::load(&dir).expect("vanilla GUI textures in data/assets/gui")
}

fn rnd(seed: &mut u64) -> u32 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    (*seed >> 33) as u32
}

/// A natural-ish RGB world: smooth gradients plus noise over `lo..=hi`.
fn world(w: usize, h: usize, seed: u64, lo: u8, hi: u8) -> Vec<u8> {
    let mut s = seed;
    let mut f = vec![0u8; w * h * 3];
    for y in 0..h {
        for x in 0..w {
            let base = lo as f64
                + (hi - lo) as f64
                    * (0.5 + 0.5 * ((x as f64 / 37.0).sin() * (y as f64 / 23.0).cos()));
            for k in 0..3 {
                let v = base + (rnd(&mut s) % 17) as f64 - 8.0 + k as f64 * 5.0;
                f[(y * w + x) * 3 + k] = v.clamp(lo as f64, hi as f64) as u8;
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
    fit: GuiFit,
}

/// A frame of the given framebuffer size and GUI scale, uniformly resized by `k`, with the HUD of `st` composed on it.
fn shot(fb_w: u32, fb_h: u32, gui_scale: u32, k: f64, st: &HudState, seed: u64) -> Shot {
    let fit = GuiFit::framebuffer(fb_w, fb_h, gui_scale, k);
    let w = (fb_w as f64 * k).round() as usize;
    let h = (fb_h as f64 * k).round() as usize;
    let mut frame = world(w, h, seed, 0, 255);
    let truth = compose_hud(&mut frame, w, h, &tex(), st, &fit);
    Shot {
        w,
        h,
        frame,
        truth,
        fit,
    }
}

fn detect(s: &Shot) -> GuiMask {
    detect_gui(&s.frame, s.w, s.h, &tex(), &GuiOptions::default()).expect("valid frame")
}

fn hits(m: &GuiMask, p: PieceId) -> Vec<&PieceHit> {
    m.hits.iter().filter(|h| h.piece == p).collect()
}

/// IoU of piece `id`, over the pixels where the mask commits to a class (edge pixels the mask calls `unknown` are its
/// stated uncertainty, FireCrackle/docs/PLAN-GUI-MASK.md 3.1, and are checked separately).
fn iou(m: &GuiMask, b: &[u8], id: u8) -> f64 {
    let (mut inter, mut uni) = (0usize, 0usize);
    for ((&x, &y), &c) in m.piece.iter().zip(b).zip(&m.class) {
        if c == PixelClass::Unknown as u8 && x == id {
            continue;
        }
        let (p, q) = (x == id, y == id);
        if p && q {
            inter += 1;
        }
        if p || q {
            uni += 1;
        }
    }
    if uni == 0 {
        1.0
    } else {
        inter as f64 / uni as f64
    }
}

fn placed(l: &[Placed], p: PieceId, index: u8) -> &Placed {
    l.iter()
        .find(|q| q.piece == p && q.index == index)
        .unwrap_or_else(|| panic!("{p:?} #{index} not placed"))
}

fn rect(p: &Placed) -> (i32, i32, u32, u32) {
    (p.x, p.y, p.w, p.h)
}

// ================================================================ textures

#[test]
fn the_vanilla_textures_load() {
    let t = tex();
    assert_eq!(t.widgets.width, 256);
    assert_eq!(t.icons.height, 256);
    assert_eq!(t.inventory.rgba.len(), 256 * 256 * 4);
}

#[test]
fn a_texture_of_the_wrong_size_is_an_error() {
    let ok = vec![0u8; 256 * 256 * 4];
    assert!(GuiTextures::from_rgba(vec![0u8; 100], ok.clone(), ok.clone()).is_err());
    assert!(GuiTextures::from_rgba(ok.clone(), ok.clone(), vec![]).is_err());
    assert!(GuiTextures::load(&PathBuf::from("definitely/not/here")).is_err());
}

// ================================================================ Window.calculateScaleFactor / setScaleFactor

#[test]
fn auto_gui_scale_is_the_largest_that_keeps_320_by_240() {
    assert_eq!(gui_scale_factor(1920, 1080, 0, false), 4);
    assert_eq!(gui_scale_factor(2560, 1440, 0, false), 6);
    assert_eq!(gui_scale_factor(1280, 720, 0, false), 3);
    assert_eq!(gui_scale_factor(854, 480, 0, false), 2);
    assert_eq!(gui_scale_factor(640, 480, 0, false), 2);
    assert_eq!(gui_scale_factor(300, 200, 0, false), 1);
}

#[test]
fn a_chosen_gui_scale_is_used_but_capped_by_the_same_rule() {
    assert_eq!(gui_scale_factor(1920, 1080, 2, false), 2);
    assert_eq!(gui_scale_factor(1920, 1080, 1, false), 1);
    assert_eq!(gui_scale_factor(1920, 1080, 8, false), 4);
}

#[test]
fn the_unicode_font_bumps_an_odd_scale() {
    assert_eq!(gui_scale_factor(1280, 720, 0, true), 4);
    assert_eq!(gui_scale_factor(1920, 1080, 0, true), 4);
}

#[test]
fn the_scaled_window_is_rounded_up() {
    assert_eq!(scaled_size(1920, 1080, 4), (480, 270));
    assert_eq!(scaled_size(1366, 768, 3), (456, 256));
    assert_eq!(scaled_size(1366, 767, 3), (456, 256));
}

// ================================================================ InGameHud geometry

#[test]
fn hotbar_selection_and_offhand_sit_where_ingamehud_draws_them() {
    let mut st = HudState {
        selected_slot: 3,
        offhand: Some(Hand::Left),
        ..HudState::default()
    };
    let l = hud_layout(480, 270, &st);
    assert_eq!(rect(placed(&l, PieceId::Hotbar, 0)), (149, 248, 182, 22));
    assert_eq!(
        rect(placed(&l, PieceId::SelectedSlot, 3)),
        (208, 247, 24, 22)
    );
    assert_eq!(rect(placed(&l, PieceId::Offhand, 0)), (120, 247, 29, 24));
    assert_eq!(rect(placed(&l, PieceId::HotbarItem, 0)), (152, 251, 16, 16));
    assert_eq!(rect(placed(&l, PieceId::HotbarItem, 8)), (312, 251, 16, 16));
    st.offhand = Some(Hand::Right);
    assert_eq!(
        rect(placed(&hud_layout(480, 270, &st), PieceId::Offhand, 1)),
        (331, 247, 29, 24)
    );
}

#[test]
fn an_odd_scaled_width_uses_integer_division_like_the_game() {
    let l = hud_layout(455, 256, &HudState::default());
    assert_eq!(rect(placed(&l, PieceId::Hotbar, 0)), (136, 234, 182, 22));
}

#[test]
fn crosshair_and_xp_bar_positions() {
    let l = hud_layout(480, 270, &HudState::default());
    assert_eq!(rect(placed(&l, PieceId::Crosshair, 0)), (232, 127, 15, 15));
    assert_eq!(rect(placed(&l, PieceId::XpBar, 0)), (149, 241, 182, 5));
}

#[test]
fn hearts_food_armor_and_air_rows() {
    let st = HudState {
        armor: 10,
        air: Some(5),
        ..HudState::default()
    };
    let l = hud_layout(480, 270, &st);
    assert_eq!(rect(placed(&l, PieceId::Health, 0)), (149, 231, 9, 9));
    assert_eq!(rect(placed(&l, PieceId::Health, 9)), (221, 231, 9, 9));
    assert_eq!(rect(placed(&l, PieceId::Food, 0)), (322, 231, 9, 9));
    assert_eq!(rect(placed(&l, PieceId::Food, 9)), (250, 231, 9, 9));
    assert_eq!(rect(placed(&l, PieceId::Armor, 0)), (149, 221, 9, 9));
    assert_eq!(rect(placed(&l, PieceId::Air, 0)), (322, 221, 9, 9));
}

#[test]
fn a_second_heart_row_lifts_the_armor_row() {
    let st = HudState {
        armor: 4,
        absorption: 20.0,
        ..HudState::default()
    };
    let l = hud_layout(480, 270, &st);
    assert_eq!(rect(placed(&l, PieceId::Health, 10)), (149, 221, 9, 9));
    assert_eq!(rect(placed(&l, PieceId::Armor, 0)), (149, 211, 9, 9));
}

#[test]
fn effect_icons_fill_from_the_top_right() {
    let st = HudState {
        effects: vec![
            Effect {
                beneficial: true,
                ambient: false,
            },
            Effect {
                beneficial: true,
                ambient: true,
            },
            Effect {
                beneficial: false,
                ambient: false,
            },
        ],
        ..HudState::default()
    };
    let l = hud_layout(480, 270, &st);
    assert_eq!(rect(placed(&l, PieceId::EffectIcon, 0)), (455, 1, 24, 24));
    assert_eq!(rect(placed(&l, PieceId::EffectIcon, 1)), (430, 1, 24, 24));
    assert_eq!(rect(placed(&l, PieceId::EffectIcon, 2)), (455, 27, 24, 24));
}

#[test]
fn f1_and_creative_hide_what_the_game_hides() {
    assert!(hud_layout(
        480,
        270,
        &HudState {
            hud_hidden: true,
            ..HudState::default()
        }
    )
    .is_empty());
    let creative = hud_layout(
        480,
        270,
        &HudState {
            status_bars: false,
            xp_bar: false,
            ..HudState::default()
        },
    );
    assert!(creative.iter().all(|p| !matches!(
        p.piece,
        PieceId::Health | PieceId::Food | PieceId::Armor | PieceId::Air | PieceId::XpBar
    )));
    assert!(creative.iter().any(|p| p.piece == PieceId::Hotbar));
}

// ================================================================ scale fit

#[test]
fn the_scale_is_recovered_at_every_gui_scale_and_resize() {
    for (fb_w, fb_h, g, k) in [
        (640, 480, 2, 1.0),
        (1280, 720, 3, 1.0),
        (1920, 1080, 4, 1.0),
        (1920, 1080, 4, 2.0 / 3.0),
        (2560, 1440, 6, 0.5),
        (854, 480, 2, 1.5),
        (1280, 720, 1, 1.0),
    ] {
        let s = shot(fb_w, fb_h, g, k, &HudState::default(), 7);
        let m = detect(&s);
        let fit = m
            .fit
            .unwrap_or_else(|| panic!("{fb_w}x{fb_h} gui {g} k {k}: no fit, notes {:?}", m.notes));
        assert!(m.reliable, "{fb_w}x{fb_h} gui {g} k {k}: {:?}", m.notes);
        let want = g as f64 * k;
        assert!(
            (fit.scale - want).abs() / want < 0.01,
            "{fb_w}x{fb_h} gui {g} k {k}: scale {} want {want}",
            fit.scale
        );
    }
}

#[test]
fn a_framebuffer_that_is_not_a_multiple_of_the_scale_still_fits() {
    // 767 / 3 rounds up to 256: the hotbar's bottom GUI row is partly below the frame
    let s = shot(1366, 767, 3, 1.0, &HudState::default(), 8);
    let m = detect(&s);
    assert!(m.reliable, "{:?}", m.notes);
    assert!((m.fit.unwrap().scale - 3.0).abs() < 0.03);
}

#[test]
fn below_the_minimum_scale_the_frame_is_unreliable_not_guessed() {
    let s = shot(1280, 720, 1, 0.5, &HudState::default(), 9);
    let m = detect(&s);
    assert!(!m.reliable);
    assert!(
        m.piece.iter().all(|&p| p == 0),
        "nothing may be labelled when unreliable"
    );
    assert!(m.notes.iter().any(|n| n.contains("scale")), "{:?}", m.notes);
}

#[test]
fn a_frame_without_hud_is_unreliable_and_unlabelled() {
    let s = shot(
        1280,
        720,
        3,
        1.0,
        &HudState {
            hud_hidden: true,
            ..HudState::default()
        },
        10,
    );
    let m = detect(&s);
    assert!(!m.reliable);
    assert!(m.piece.iter().all(|&p| p == 0));
}

#[test]
fn plain_dark_and_decoy_worlds_do_not_fit_a_hotbar() {
    let (w, h) = (1280usize, 720usize);
    let mut decoy = world(w, h, 11, 0, 255);
    // a flat grey bar where the hotbar would be
    for y in 650..716 {
        for x in 367..913 {
            decoy[(y * w + x) * 3..(y * w + x) * 3 + 3].copy_from_slice(&[139, 139, 139]);
        }
    }
    for f in [world(w, h, 12, 0, 255), world(w, h, 13, 0, 40), decoy] {
        let m = detect_gui(&f, w, h, &tex(), &GuiOptions::default()).unwrap();
        assert!(!m.reliable, "{:?}", m.notes);
        assert!(m.piece.iter().all(|&p| p == 0));
    }
}

#[test]
fn darkening_and_noise_do_not_break_the_fit() {
    let mut s = shot(1280, 720, 3, 1.0, &HudState::default(), 14);
    let mut seed = 99u64;
    for v in s.frame.iter_mut() {
        let n = (rnd(&mut seed) % 13) as f64 - 6.0;
        *v = ((*v as f64) * 0.7 + n).clamp(0.0, 255.0) as u8; // vignette-like gain plus noise
    }
    let m = detect(&s);
    assert!(m.reliable, "{:?}", m.notes);
}

#[test]
fn a_veiled_then_unveiled_hud_is_still_found() {
    let mut s = shot(1280, 720, 3, 1.0, &HudState::default(), 15);
    let (a_top, a_bot) = (192.0 / 255.0, 208.0 / 255.0);
    for y in 0..s.h {
        let a = a_top + (a_bot - a_top) * (y as f64 + 0.5) / s.h as f64;
        for i in (y * s.w * 3)..((y + 1) * s.w * 3) {
            let veiled = (16.0 * a + s.frame[i] as f64 * (1.0 - a)).round();
            s.frame[i] = ((veiled - 16.0 * a) / (1.0 - a)).round().clamp(0.0, 255.0) as u8;
        }
    }
    assert!(detect(&s).reliable);
}

// ================================================================ pieces

#[test]
fn the_selected_slot_is_read_from_the_pixels() {
    for slot in [0u8, 4, 8] {
        let s = shot(
            1280,
            720,
            3,
            1.0,
            &HudState {
                selected_slot: slot,
                ..HudState::default()
            },
            16,
        );
        let m = detect(&s);
        let sel = hits(&m, PieceId::SelectedSlot);
        assert_eq!(sel.len(), 1, "slot {slot}");
        assert_eq!(sel[0].index, slot);
    }
}

#[test]
fn the_offhand_slot_is_found_on_its_side_or_not_at_all() {
    for (hand, want) in [
        (None, None),
        (Some(Hand::Left), Some(0u8)),
        (Some(Hand::Right), Some(1u8)),
    ] {
        let s = shot(
            1280,
            720,
            3,
            1.0,
            &HudState {
                offhand: hand,
                ..HudState::default()
            },
            17,
        );
        let got = hits(&detect(&s), PieceId::Offhand).first().map(|h| h.index);
        assert_eq!(got, want, "{hand:?}");
    }
}

#[test]
fn armor_hearts_food_and_air_are_found_when_drawn_and_only_then() {
    let plain = detect(&shot(1280, 720, 3, 1.0, &HudState::default(), 18));
    assert_eq!(hits(&plain, PieceId::Health).len(), 10);
    assert_eq!(hits(&plain, PieceId::Food).len(), 10);
    assert!(hits(&plain, PieceId::Armor).is_empty());
    assert!(hits(&plain, PieceId::Air).is_empty());

    let geared = detect(&shot(
        1280,
        720,
        3,
        1.0,
        &HudState {
            armor: 14,
            air: Some(6),
            ..HudState::default()
        },
        19,
    ));
    assert_eq!(hits(&geared, PieceId::Armor).len(), 10);
    assert_eq!(hits(&geared, PieceId::Air).len(), 6);
}

#[test]
fn damaged_poisoned_and_hardcore_hearts_are_still_hearts() {
    for st in [
        HudState {
            health: 7.0,
            ..HudState::default()
        },
        HudState {
            poisoned: true,
            ..HudState::default()
        },
        HudState {
            hardcore: true,
            health: 12.0,
            ..HudState::default()
        },
        HudState {
            food: 5,
            ..HudState::default()
        },
    ] {
        let m = detect(&shot(1280, 720, 3, 1.0, &st, 20));
        assert_eq!(hits(&m, PieceId::Health).len(), 10, "{st:?}");
        assert_eq!(hits(&m, PieceId::Food).len(), 10, "{st:?}");
    }
}

#[test]
fn two_heart_rows_are_both_found() {
    let m = detect(&shot(
        1280,
        720,
        3,
        1.0,
        &HudState {
            absorption: 20.0,
            armor: 6,
            ..HudState::default()
        },
        21,
    ));
    assert_eq!(hits(&m, PieceId::Health).len(), 20);
    assert_eq!(hits(&m, PieceId::Armor).len(), 10);
}

#[test]
fn the_xp_bar_is_found_at_any_fill_and_not_in_creative() {
    for p in [0.0f32, 0.37, 1.0] {
        let m = detect(&shot(
            1280,
            720,
            3,
            1.0,
            &HudState {
                xp_progress: p,
                ..HudState::default()
            },
            22,
        ));
        assert_eq!(hits(&m, PieceId::XpBar).len(), 1, "progress {p}");
    }
    let creative = detect(&shot(
        1280,
        720,
        3,
        1.0,
        &HudState {
            status_bars: false,
            xp_bar: false,
            ..HudState::default()
        },
        23,
    ));
    assert!(creative.reliable);
    assert!(hits(&creative, PieceId::XpBar).is_empty());
    assert!(hits(&creative, PieceId::Health).is_empty());
}

#[test]
fn effect_icon_backgrounds_are_counted() {
    let st = HudState {
        effects: vec![
            Effect {
                beneficial: true,
                ambient: false,
            },
            Effect {
                beneficial: true,
                ambient: true,
            },
            Effect {
                beneficial: false,
                ambient: false,
            },
        ],
        ..HudState::default()
    };
    assert_eq!(
        hits(
            &detect(&shot(1280, 720, 3, 1.0, &st, 24)),
            PieceId::EffectIcon
        )
        .len(),
        3
    );
    assert!(hits(
        &detect(&shot(1280, 720, 3, 1.0, &HudState::default(), 24)),
        PieceId::EffectIcon
    )
    .is_empty());
}

// ================================================================ the per-pixel mask

#[test]
fn the_mask_matches_the_truth_per_piece() {
    let st = HudState {
        selected_slot: 5,
        offhand: Some(Hand::Left),
        armor: 8,
        air: Some(10),
        effects: vec![Effect {
            beneficial: true,
            ambient: false,
        }],
        ..HudState::default()
    };
    for (fb_w, fb_h, g, k) in [
        (1280, 720, 3, 1.0),
        (1920, 1080, 4, 2.0 / 3.0),
        (2560, 1440, 6, 0.5),
    ] {
        let s = shot(fb_w, fb_h, g, k, &st, 25);
        let m = detect(&s);
        assert!(m.reliable, "{:?}", m.notes);
        for p in [
            PieceId::Hotbar,
            PieceId::Health,
            PieceId::Food,
            PieceId::Armor,
            PieceId::Air,
            PieceId::XpBar,
            PieceId::Offhand,
            PieceId::EffectIcon,
        ] {
            let v = iou(&m, &s.truth.piece, p as u8);
            assert!(v >= 0.85, "{fb_w}x{fb_h} g{g} k{k}: {p:?} IoU {v:.3}");
        }
    }
}

#[test]
fn unknown_pixels_stay_next_to_real_gui() {
    let st = HudState {
        armor: 8,
        air: Some(10),
        offhand: Some(Hand::Right),
        ..HudState::default()
    };
    for (fb_w, fb_h, g, k) in [(1280, 720, 3, 1.0), (1920, 1080, 4, 2.0 / 3.0)] {
        let s = shot(fb_w, fb_h, g, k, &st, 30);
        let m = detect(&s);
        for y in 0..s.h {
            for x in 0..s.w {
                let i = y * s.w + x;
                if m.piece[i] == 0
                    || m.class[i] != PixelClass::Unknown as u8
                    || s.truth.piece[i] != 0
                {
                    continue;
                }
                let near = (y.saturating_sub(2)..(y + 3).min(s.h)).any(|yy| {
                    (x.saturating_sub(2)..(x + 3).min(s.w))
                        .any(|xx| s.truth.piece[yy * s.w + xx] != 0)
                });
                assert!(
                    near,
                    "{fb_w}x{fb_h} k{k}: unknown pixel ({x},{y}) is far from any GUI"
                );
            }
        }
    }
}

#[test]
fn world_pixels_are_not_labelled_gui_and_gui_pixels_are_not_called_world() {
    let s = shot(
        1280,
        720,
        3,
        1.0,
        &HudState {
            armor: 8,
            ..HudState::default()
        },
        26,
    );
    let m = detect(&s);
    let (mut false_gui, mut world, mut missed, mut gui) = (0usize, 0usize, 0usize, 0usize);
    for i in 0..s.w * s.h {
        if s.truth.piece[i] == 0 {
            world += 1;
            if m.piece[i] != 0 && m.class[i] != PixelClass::Unknown as u8 {
                false_gui += 1;
            }
        } else {
            gui += 1;
            if m.piece[i] == 0 {
                missed += 1;
            }
        }
    }
    assert!(
        (false_gui as f64) / (world as f64) < 0.001,
        "{false_gui} world pixels called GUI"
    );
    assert!(
        (missed as f64) / (gui as f64) < 0.02,
        "{missed} of {gui} GUI pixels called world"
    );
}

#[test]
fn opaque_and_translucent_pixels_are_told_apart() {
    let s = shot(1280, 720, 3, 1.0, &HudState::default(), 27);
    let m = detect(&s);
    // where the mask commits (opaque or translucent) it must be right; edge pixels may be unknown, but not most of them
    let (mut agree, mut committed, mut total) = (0usize, 0usize, 0usize);
    for i in 0..s.w * s.h {
        let t = s.truth.class[i];
        if s.truth.piece[i] == PieceId::Hotbar as u8
            && (t == PixelClass::Opaque as u8 || t == PixelClass::Translucent as u8)
        {
            total += 1;
            if m.class[i] == PixelClass::Opaque as u8 || m.class[i] == PixelClass::Translucent as u8
            {
                committed += 1;
                if m.class[i] == t {
                    agree += 1;
                }
            }
        }
    }
    assert!(total > 0);
    assert!(
        agree as f64 / committed as f64 > 0.99,
        "{agree}/{committed} committed pixels right"
    );
    assert!(
        committed as f64 / total as f64 > 0.8,
        "only {committed}/{total} hotbar pixels committed"
    );
}

#[test]
fn pixels_of_unknown_content_are_unknown_never_opaque() {
    let s = shot(
        1280,
        720,
        3,
        1.0,
        &HudState {
            items: [true; 9],
            ..HudState::default()
        },
        28,
    );
    let m = detect(&s);
    for p in [PieceId::HotbarItem, PieceId::Crosshair] {
        let n = (0..s.w * s.h).filter(|&i| m.piece[i] == p as u8).count();
        assert!(n > 0, "{p:?} not labelled");
        assert!(
            (0..s.w * s.h)
                .filter(|&i| m.piece[i] == p as u8)
                .all(|i| m.class[i] == PixelClass::Unknown as u8),
            "{p:?}"
        );
    }
}

#[test]
fn the_mask_has_the_frame_size_and_is_deterministic() {
    let s = shot(1280, 720, 3, 1.0, &HudState::default(), 29);
    let (a, b) = (detect(&s), detect(&s));
    assert_eq!(
        (a.width, a.height, a.piece.len(), a.class.len()),
        (s.w, s.h, s.w * s.h, s.w * s.h)
    );
    assert_eq!(a.piece, b.piece);
    assert_eq!(a.class, b.class);
    let _ = s.fit;
}

// ================================================================ bad input

#[test]
fn a_buffer_of_the_wrong_size_is_an_error() {
    assert!(detect_gui(&[0u8; 10], 1280, 720, &tex(), &GuiOptions::default()).is_err());
    assert!(detect_gui(&[], 0, 0, &tex(), &GuiOptions::default()).is_err());
}

#[test]
fn invalid_options_are_an_error() {
    let f = world(320, 240, 1, 0, 255);
    for o in [
        GuiOptions {
            min_scale: 0.0,
            ..GuiOptions::default()
        },
        GuiOptions {
            hotbar_min_score: 1.5,
            ..GuiOptions::default()
        },
        GuiOptions {
            piece_min_score: f64::NAN,
            ..GuiOptions::default()
        },
    ] {
        assert!(detect_gui(&f, 320, 240, &tex(), &o).is_err(), "{o:?}");
    }
}

#[test]
fn the_crosshair_mask_has_the_crosshair_shape_not_its_box() {
    // Its colour is the inverted world (inverting blend), but its shape is the sprite's (icons.png 0,0 15x15).
    let s = shot(1280, 720, 3, 1.0, &HudState::default(), 30);
    let m = detect(&s);
    let cross = PieceId::Crosshair as u8;
    let (x0, y0) = (206 * 3, 112 * 3); // GUI ((427 - 15) / 2, (240 - 15) / 2) at 3 px per GUI px
    let at = |gx: usize, gy: usize| m.piece[(y0 + gy * 3 + 1) * s.w + x0 + gx * 3 + 1];
    assert_eq!(at(7, 7), cross, "centre");
    assert_eq!(at(7, 4), cross, "vertical bar");
    assert_eq!(at(4, 7), cross, "horizontal bar");
    for (gx, gy) in [(0, 0), (14, 0), (0, 14), (14, 14), (3, 3)] {
        assert_ne!(at(gx, gy), cross, "transparent sprite pixel ({gx}, {gy})");
    }
}

#[test]
fn the_hud_scale_alone_is_the_full_fits_scale_and_absent_without_a_reliable_hud() {
    let detector = GuiDetector::new(tex(), GuiOptions::default()).unwrap();
    for (fb_w, fb_h, g, k) in [
        (1280, 720, 3, 1.0),
        (1920, 1080, 4, 2.0 / 3.0),
        (2560, 1440, 6, 0.5),
        (1280, 720, 1, 1.0),
    ] {
        let s = shot(fb_w, fb_h, g, k, &HudState::default(), 7);
        let full = detect(&s);
        let mut hint = GuiFitHint::default();
        let scale = detector
            .hud_scale_with_hint(&s.frame, s.w, s.h, &mut hint)
            .unwrap();
        assert_eq!(
            scale,
            full.fit.map(|f| f.scale),
            "{fb_w}x{fb_h} gui {g} k {k}"
        );
        // the next frame reuses the hint and gives the same answer
        assert_eq!(
            detector
                .hud_scale_with_hint(&s.frame, s.w, s.h, &mut hint)
                .unwrap(),
            scale
        );
    }
    let hidden = shot(
        1280,
        720,
        3,
        1.0,
        &HudState {
            hud_hidden: true,
            ..HudState::default()
        },
        10,
    );
    assert_eq!(
        detector
            .hud_scale_with_hint(
                &hidden.frame,
                hidden.w,
                hidden.h,
                &mut GuiFitHint::default()
            )
            .unwrap(),
        None
    );
    let tiny = shot(1280, 720, 1, 0.5, &HudState::default(), 9);
    assert_eq!(
        detector
            .hud_scale_with_hint(&tiny.frame, tiny.w, tiny.h, &mut GuiFitHint::default())
            .unwrap(),
        None
    );
    assert!(detector
        .hud_scale_with_hint(&[0; 5], 10, 10, &mut GuiFitHint::default())
        .is_err());
}
