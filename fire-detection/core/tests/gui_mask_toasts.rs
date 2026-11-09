//! Toasts in the GUI mask: the recipe and advancement toast backgrounds (`textures/gui/toasts.png` rows 32 and 0, art
//! identical in 1.21.11's `toast/recipe` and `toast/advancement` sprites). `ToastManager`: 160x32 GUI px at
//! x = scaledWidth - 160 * visiblePortion, y = 32 * slot, five slots. Only settled toasts (portion 1) are placed; the icon
//! and text areas are unknown content. Synthetic frames are composed from the real textures, so the truth is per pixel.

use fire_core::gui_mask::*;
use std::path::PathBuf;

fn tex() -> GuiTextures {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/assets/gui");
    let t = GuiTextures::load(&dir).expect("vanilla GUI textures in data/assets/gui");
    assert!(
        t.toasts.is_some(),
        "toasts.rgba missing: run `node -e \"import('./FireCrackle/scripts/gui-assets.mjs').then(m=>m.prepareGuiAssets())\"`"
    );
    t
}

fn rnd(seed: &mut u64) -> u32 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    (*seed >> 33) as u32
}

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

fn shot_on(
    fb_w: u32,
    fb_h: u32,
    scale: u32,
    st: &HudState,
    mut frame: Vec<u8>,
    t: &GuiTextures,
) -> Shot {
    let fit = GuiFit::framebuffer(fb_w, fb_h, scale, 1.0);
    let (w, h) = (fb_w as usize, fb_h as usize);
    let truth = compose_hud(&mut frame, w, h, t, st, &fit);
    Shot {
        w,
        h,
        frame,
        truth,
        fit,
    }
}

fn shot(fb_w: u32, fb_h: u32, scale: u32, st: &HudState, seed: u64) -> Shot {
    let frame = world(fb_w as usize, fb_h as usize, seed, 0, 255);
    shot_on(fb_w, fb_h, scale, st, frame, &tex())
}

fn with_toasts(slots: [Option<ToastKind>; 5]) -> HudState {
    HudState {
        toasts: slots,
        ..HudState::default()
    }
}

fn detect_with(s: &Shot, t: &GuiTextures) -> GuiMask {
    detect_gui(&s.frame, s.w, s.h, t, &GuiOptions::default()).expect("valid frame")
}

fn detect(s: &Shot) -> GuiMask {
    detect_with(s, &tex())
}

fn toast_hits(m: &GuiMask) -> Vec<(PieceId, u8, i32, i32, u32, u32)> {
    let mut v: Vec<_> = m
        .hits
        .iter()
        .filter(|h| matches!(h.piece, PieceId::RecipeToast | PieceId::AdvancementToast))
        .map(|h| (h.piece, h.index, h.x, h.y, h.w, h.h))
        .collect();
    v.sort_by_key(|h| h.1);
    v
}

/// Video rectangle of toast slot `slot` at this fit.
fn slot_rect(fit: &GuiFit, slot: u8) -> (i32, i32, u32, u32) {
    let s = fit.scale;
    (
        ((fit.scaled_width as f64 - 160.0) * s).floor() as i32,
        (32.0 * slot as f64 * s).floor() as i32,
        (160.0 * s).round() as u32,
        (32.0 * s).round() as u32,
    )
}

const R: Option<ToastKind> = Some(ToastKind::Recipe);
const A: Option<ToastKind> = Some(ToastKind::Advancement);

// ================================================================ textures and layout

#[test]
fn the_toast_sheet_loads_with_the_vanilla_textures() {
    let t = tex();
    let toasts = t.toasts.as_ref().unwrap();
    assert_eq!((toasts.width, toasts.height), (256, 256));
    assert!(t.clone().with_toasts(Some(vec![0; 8])).is_err());
    assert!(
        t.with_toasts(None).unwrap().toasts.is_some(),
        "None keeps the loaded sheet"
    );
}

#[test]
fn settled_toasts_sit_at_the_right_edge_in_32_px_slots_and_draw_last() {
    let l = hud_layout(854, 480, &with_toasts([R, None, A, None, None]));
    let toasts: Vec<_> = l
        .iter()
        .filter(|p| matches!(p.piece, PieceId::RecipeToast | PieceId::AdvancementToast))
        .map(|p| (p.piece, p.index, p.x, p.y, p.w, p.h))
        .collect();
    assert_eq!(
        toasts,
        vec![
            (PieceId::RecipeToast, 0, 694, 0, 160, 32),
            (PieceId::AdvancementToast, 2, 694, 64, 160, 32),
        ]
    );
    let first_toast = l
        .iter()
        .position(|p| p.piece == PieceId::RecipeToast)
        .unwrap();
    assert!(
        l[first_toast..]
            .iter()
            .all(|p| matches!(p.piece, PieceId::RecipeToast | PieceId::AdvancementToast)),
        "toasts are drawn over the HUD (ToastManager renders after InGameHud)"
    );
    let r = l.iter().find(|p| p.piece == PieceId::RecipeToast).unwrap();
    // the result item (8,8) and the 0.6-scaled category item (1.8..11.4) share the icon area; text from x 30
    assert!(r
        .unknown
        .iter()
        .any(|&(x, y, w, h)| x <= 1 && y <= 1 && x + w as i32 >= 24 && y + h as i32 >= 24));
    assert!(r
        .unknown
        .iter()
        .any(|&(x, y, w, h)| x <= 29 && y <= 2 && x + w as i32 >= 155 && y + h as i32 >= 29));
}

#[test]
fn no_toasts_by_default() {
    assert_eq!(HudState::default().toasts, [None; 5]);
    assert!(!hud_layout(854, 480, &HudState::default())
        .iter()
        .any(|p| matches!(p.piece, PieceId::RecipeToast | PieceId::AdvancementToast)));
}

// ================================================================ detection: the basics

#[test]
fn a_recipe_toast_is_found_at_common_sizes_and_scales() {
    for (i, &(fw, fh, sc)) in [
        (2560u32, 1440u32, 3u32),
        (1920, 1080, 2),
        (1920, 1080, 4),
        (1280, 720, 2),
    ]
    .iter()
    .enumerate()
    {
        let s = shot(
            fw,
            fh,
            sc,
            &with_toasts([R, None, None, None, None]),
            11 + i as u64,
        );
        let m = detect(&s);
        let (x, y, w, h) = slot_rect(&s.fit, 0);
        assert_eq!(
            toast_hits(&m),
            vec![(PieceId::RecipeToast, 0, x, y, w, h)],
            "{fw}x{fh} scale {sc}: {:?}",
            m.notes
        );
    }
}

#[test]
fn an_advancement_toast_is_told_apart_from_a_recipe_toast() {
    let s = shot(1920, 1080, 3, &with_toasts([None, A, None, None, None]), 5);
    let (x, y, w, h) = slot_rect(&s.fit, 1);
    assert_eq!(
        toast_hits(&detect(&s)),
        vec![(PieceId::AdvancementToast, 1, x, y, w, h)]
    );
}

#[test]
fn stacked_toasts_with_an_empty_slot_between_are_all_found() {
    let s = shot(2560, 1440, 3, &with_toasts([R, A, None, R, A]), 7);
    let got: Vec<_> = toast_hits(&detect(&s)).iter().map(|h| (h.0, h.1)).collect();
    assert_eq!(
        got,
        vec![
            (PieceId::RecipeToast, 0),
            (PieceId::AdvancementToast, 1),
            (PieceId::RecipeToast, 3),
            (PieceId::AdvancementToast, 4),
        ]
    );
}

#[test]
fn the_mask_labels_the_toast_frame_opaque_and_its_icon_and_text_unknown() {
    let s = shot(2560, 1440, 3, &with_toasts([R, None, None, None, None]), 3);
    let m = detect(&s);
    let id = PieceId::RecipeToast as u8;
    let (mut agree, mut truth_px, mut wrong_opaque) = (0usize, 0usize, 0usize);
    for i in 0..s.w * s.h {
        if s.truth.piece[i] == id {
            truth_px += 1;
            if m.piece[i] == id {
                agree += 1;
            }
            if s.truth.class[i] == PixelClass::Unknown as u8
                && m.class[i] == PixelClass::Opaque as u8
            {
                wrong_opaque += 1;
            }
        } else if m.piece[i] == id {
            // edge rounding only: never far outside the truth rectangle
            let (x, y) = ((i % s.w) as i32, (i / s.w) as i32);
            let (rx, ry, rw, rh) = slot_rect(&s.fit, 0);
            assert!(x >= rx - 1 && y >= ry - 1 && x <= rx + rw as i32 && y <= ry + rh as i32);
        }
    }
    assert!(truth_px > 0);
    assert!(agree as f64 >= 0.99 * truth_px as f64, "{agree}/{truth_px}");
    assert_eq!(
        wrong_opaque, 0,
        "item and text pixels are unknown content, never opaque GUI"
    );
}

// ================================================================ detection: potential failures

#[test]
fn any_icon_and_text_content_still_matches() {
    let st = with_toasts([R, A, None, None, None]);
    let mut s = shot(1920, 1080, 3, &st, 21);
    let l = hud_layout(s.fit.scaled_width, s.fit.scaled_height, &st);
    let mut seed = 99u64;
    for p in l
        .iter()
        .filter(|p| matches!(p.piece, PieceId::RecipeToast | PieceId::AdvancementToast))
    {
        for &(ux, uy, uw, uh) in p.unknown.iter() {
            let sc = s.fit.scale as i32;
            for y in (p.y + uy) * sc..(p.y + uy + uh as i32) * sc {
                for x in (p.x + ux) * sc..(p.x + ux + uw as i32) * sc {
                    let i = (y as usize * s.w + x as usize) * 3;
                    for k in 0..3 {
                        s.frame[i + k] = (rnd(&mut seed) & 255) as u8;
                    }
                }
            }
        }
    }
    let got: Vec<_> = toast_hits(&detect(&s)).iter().map(|h| (h.0, h.1)).collect();
    assert_eq!(
        got,
        vec![(PieceId::RecipeToast, 0), (PieceId::AdvancementToast, 1)]
    );
}

#[test]
fn no_toast_is_reported_on_frames_without_one() {
    let t = tex();
    let (fw, fh) = (2560u32, 1440u32);
    let (w, h) = (fw as usize, fh as usize);
    let flat = |c: u8| vec![c; w * h * 3];
    let backgrounds: Vec<(&str, Vec<u8>)> = vec![
        ("noisy world", world(w, h, 1, 0, 255)),
        ("snow", world(w, h, 2, 225, 255)),
        ("dark cave", world(w, h, 3, 0, 40)),
        ("flat toast body grey", flat(222)),
        ("flat toast rim grey", flat(170)),
        ("flat advancement grey", flat(33)),
    ];
    for (name, frame) in backgrounds {
        let s = shot_on(fw, fh, 3, &HudState::default(), frame, &t);
        let m = detect_with(&s, &t);
        assert!(m.reliable, "{name}: the HUD itself must fit");
        assert_eq!(toast_hits(&m), vec![], "{name}");
    }
}

#[test]
fn a_toast_mid_slide_is_not_reported_at_the_settled_place() {
    let mut s = shot(2560, 1440, 3, &with_toasts([R, None, None, None, None]), 31);
    let (rx, ry, rw, rh) = slot_rect(&s.fit, 0);
    // slide it 40 GUI px back out to the right: video columns move right, the clipped part leaves the screen
    let off = (40.0 * s.fit.scale) as usize;
    let bg = world(s.w, s.h, 31, 0, 255);
    for y in ry as usize..(ry as usize + rh as usize) {
        for x in (rx as usize..s.w).rev() {
            let i = (y * s.w + x) * 3;
            let src = x.checked_sub(off).filter(|&sx| sx >= rx as usize);
            match src {
                Some(sx) => {
                    let j = (y * s.w + sx) * 3;
                    let px = [s.frame[j], s.frame[j + 1], s.frame[j + 2]];
                    s.frame[i..i + 3].copy_from_slice(&px);
                }
                None => {
                    let px = [bg[i], bg[i + 1], bg[i + 2]];
                    s.frame[i..i + 3].copy_from_slice(&px);
                }
            }
        }
    }
    let _ = rw;
    assert_eq!(
        toast_hits(&detect(&s)),
        vec![],
        "a sliding toast is a documented gap, never a wrong placement"
    );
}

#[test]
fn a_toast_covers_the_effect_icons_beneath_it() {
    let mut st = with_toasts([R, None, None, None, None]);
    st.effects = vec![
        Effect {
            beneficial: true,
            ambient: false,
        };
        3
    ];
    let s = shot(2560, 1440, 3, &st, 41);
    let m = detect(&s);
    assert_eq!(toast_hits(&m).len(), 1);
    let (rx, ry, rw, rh) = slot_rect(&s.fit, 0);
    for y in ry + 3..ry + rh as i32 - 3 {
        for x in rx + 3..rx + rw as i32 - 3 {
            let i = y as usize * s.w + x as usize;
            assert_ne!(
                m.piece[i],
                PieceId::EffectIcon as u8,
                "({x},{y}) is under the toast"
            );
            if s.truth.piece[i] == PieceId::RecipeToast as u8 {
                assert_eq!(m.piece[i], PieceId::RecipeToast as u8, "({x},{y})");
            }
        }
    }
}

#[test]
fn without_the_toast_sheet_toasts_are_skipped_and_nothing_else_changes() {
    let full = tex();
    let mut bare = full.clone();
    bare.toasts = None;
    // a frame with a toast: no toast hit, and a note says why
    let s = shot(1920, 1080, 3, &with_toasts([R, None, None, None, None]), 51);
    let m = detect_with(&s, &bare);
    assert_eq!(toast_hits(&m), vec![]);
    assert!(m.notes.iter().any(|n| n.contains("toast")), "{:?}", m.notes);
    // a frame without toasts: the sheet changes nothing at all
    let s = shot(1920, 1080, 3, &HudState::default(), 52);
    let (a, b) = (detect_with(&s, &full), detect_with(&s, &bare));
    assert_eq!(a.piece, b.piece);
    assert_eq!(a.class, b.class);
    assert_eq!(a.hits.len(), b.hits.len());
}
