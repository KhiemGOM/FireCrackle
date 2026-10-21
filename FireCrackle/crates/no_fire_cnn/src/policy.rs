//! Frozen ensemble policy. GUI/unveil remain canonical; model and rules share uncertainty gates.
#[path = "../../../../fire-detection/bench/no_fire/fragment_rules.rs"]
#[allow(dead_code)]
mod fragments;
#[path = "../../../../fire-detection/bench/no_fire/retention_rules.rs"]
#[allow(dead_code)]
mod retention;
use fire_core::{
    gui_mask::{GuiDetector, GuiFitHint, GuiOptions, GuiTextures},
    veil::{Options, detect_pixels, unveil_rgb},
};
use std::borrow::Cow;
pub fn candidate(
    rgb: &[u8],
    w: usize,
    h: usize,
    tex: &GuiTextures,
    infer: impl FnMut(&[u8], Option<&[u8]>) -> Result<bool, String>,
) -> Result<bool, String> {
    candidate_prepared(
        rgb,
        w,
        h,
        &GuiDetector::new(tex.clone(), GuiOptions::default())?,
        infer,
    )
}
pub fn candidate_prepared(
    rgb: &[u8],
    w: usize,
    h: usize,
    detector: &GuiDetector,
    infer: impl FnMut(&[u8], Option<&[u8]>) -> Result<bool, String>,
) -> Result<bool, String> {
    candidate_prepared_inner(rgb, w, h, detector, None, infer)
}

pub fn candidate_prepared_with_hint(
    rgb: &[u8],
    w: usize,
    h: usize,
    detector: &GuiDetector,
    hint: &mut GuiFitHint,
    infer: impl FnMut(&[u8], Option<&[u8]>) -> Result<bool, String>,
) -> Result<bool, String> {
    hint.begin_frame();
    candidate_prepared_inner(rgb, w, h, detector, Some(hint), infer)
}

fn candidate_prepared_inner(
    rgb: &[u8],
    w: usize,
    h: usize,
    detector: &GuiDetector,
    hint: Option<&mut GuiFitHint>,
    mut infer: impl FnMut(&[u8], Option<&[u8]>) -> Result<bool, String>,
) -> Result<bool, String> {
    if w != 1920 || h != 1080 || rgb.len() != w * h * 3 {
        return Err("AI no-fire requires native 1920×1080 RGB".into());
    }
    let raw = fragments::mask(rgb, w, h);
    let mut rules = !fragments::reaches(&raw, w, h, 4, 2198);
    let (used, share) = detect_pixels(rgb, w, h, 3, 12, Options::default())?;
    if !used && share >= 0.80 {
        return Ok(false);
    }
    let fixed = if used {
        Cow::Owned(unveil_rgb(rgb, w, h)?)
    } else {
        Cow::Borrowed(rgb)
    };
    rules &= !used || !fragments::reaches(&fragments::mask(&fixed, w, h), w, h, 4, 2198);
    let auto = used.then_some(fixed.as_ref());
    let cnn = if rules { None } else { Some(infer(rgb, auto)?) };
    if cnn == Some(false) {
        return Ok(false);
    }
    if fire_core::veil::portal::guard(rgb, w, h, None, None)?.abstain {
        return Ok(false);
    }
    let gui = match hint {
        Some(hint) => detector.detect_with_hint(rgb, w, h, hint)?,
        None => detector.detect(rgb, w, h)?,
    };
    if !gui.reliable {
        return Ok(false);
    }
    // A neutral screen rectangle hides unknown world evidence. It cannot
    // authorize a confident no-fire label, even with a reliable hotbar fit.
    if gui.hits.iter().any(|hit| {
        matches!(
            hit.piece,
            fire_core::gui_mask::PieceId::InventoryPanel | fire_core::gui_mask::PieceId::MenuButton
        )
    }) {
        return Ok(false);
    }
    let world: Vec<u8> = gui
        .class
        .iter()
        .zip(&gui.piece)
        .map(|(&class, &piece)| (!(class == 1 || class == 2 || [4, 5, 11].contains(&piece))) as u8)
        .collect();
    if material(&fixed, &world, w, h) {
        return Ok(false);
    }
    if rules
        && used
        && retention::components(&fixed, &world, w, h)
            .iter()
            .any(|c| c.0 >= 128 && c.3 - c.1 >= 24 && c.4 - c.2 >= 8)
    {
        rules = false;
    }
    if rules {
        Ok(true)
    } else {
        cnn.map_or_else(|| infer(rgb, auto), Ok)
    }
}
/// Material-patches-v3, matching translucency.py: sampled 48px patches, conservative veto.
pub fn material(rgb: &[u8], world: &[u8], w: usize, h: usize) -> bool {
    let (sw, sh) = (w.div_ceil(3), h.div_ceil(3));
    let mut blue = vec![false; sw * sh];
    let mut purple = blue.clone();
    let mut lum = vec![0f64; sw * sh];
    for y in 0..sh {
        for x in 0..sw {
            let i = y * sw + x;
            let p = y * 3 * w + x * 3;
            let (r, g, b) = (
                rgb[p * 3] as f64,
                rgb[p * 3 + 1] as f64,
                rgb[p * 3 + 2] as f64,
            );
            lum[i] = (r + g + b) / 3.;
            if world[p] == 0 {
                continue;
            }
            purple[i] = b >= 95. && r >= 55. && r > 1.5 * g && b > 1.15 * r && b > 1.65 * g;
            blue[i] = b >= 42. && b > 1.20 * r && b > 1.30 * g && g > 1.12 * r;
        }
    }
    let (pw, ph) = (sw / 16, sh / 16);
    let mut tint = vec![false; pw * ph];
    for py in 0..ph {
        for px in 0..pw {
            let (mut bn, mut pn, mut en, mut sum, mut sq) = (0, 0, 0, 0., 0.);
            for dy in 0..16 {
                for dx in 0..16 {
                    let (x, y) = (px * 16 + dx, py * 16 + dy);
                    let i = y * sw + x;
                    let v = lum[i];
                    sum += v;
                    sq += v * v;
                    bn += blue[i] as usize;
                    pn += purple[i] as usize;
                    let mut edge: f64 = 0.;
                    if x > 0 && blue[i] && blue[i - 1] {
                        edge = (v - lum[i - 1]).abs();
                    }
                    if y > 0 && blue[i] && blue[i - sw] {
                        edge = edge.max((v - lum[i - sw]).abs());
                    }
                    en += (edge > 5.) as usize;
                }
            }
            let sd = (sq / 256. - (sum / 256.).powi(2)).max(0.).sqrt();
            if pn as f64 / 256. >= 0.12 && sd >= 5. {
                return true;
            }
            tint[py * pw + px] = bn as f64 / 256. >= 0.65 && sd >= 4. && en as f64 / 256. >= 0.08;
        }
    }
    for y in 0..ph {
        for x in 0..pw {
            let i = y * pw + x;
            if tint[i]
                && ((x > 0 && tint[i - 1])
                    || (x + 1 < pw && tint[i + 1])
                    || (y > 0 && tint[i - pw])
                    || (y + 1 < ph && tint[i + pw]))
            {
                return true;
            }
        }
    }
    false
}
