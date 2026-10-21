//! Detecting the vanilla GUI background veil. See tests/veil.rs for the numbers.

/// Animated known-texture overlays share this preprocessing entry point.
#[path = "portal.rs"]
pub mod portal;

/// Alpha at the top and bottom row of the veil: 192/255 and 208/255 (fillGradient 0xC0101010 -> 0xD0101010).
pub const A_TOP: f64 = 192.0 / 255.0;
pub const A_BOTTOM: f64 = 208.0 / 255.0;
/// Colour of the veil (16, 16, 16).
pub const COLOUR: f64 = 16.0;
/// Pixels outside the legal veiled range tolerated (widgets, text, compression): the frame is veiled when at least this
/// share of the pixels is inside it.
const MIN_SHARE: f64 = 0.90;
const SLACK: f64 = 2.0;

/// Only the outer 20% of the width on each side is examined: inventory, crafting and creative panels, buttons and the hotbar
/// sit in the middle and would otherwise exceed the tolerated share of out-of-range pixels.
const MARGIN: f64 = 0.20;

/// True when the frame (rows `y0..h`) looks like the game's GUI background veil was drawn over it: out = 16 * a + p * (1 - a)
/// bounds every channel to [16 * a_top, 16 * a + 255 * (1 - a)] (about 12..76 at the top, 13..60 at the bottom), so a veiled
/// frame has (almost) no pixel outside that band, whereas a real dark scene has true blacks and a real bright one has values
/// far above it. Judged on the left and right margins only (see `MARGIN`).
pub fn detect_veil_strict(rgb: &[u8], w: usize, h: usize, y0: usize) -> Result<bool, String> {
    if w == 0 || h == 0 || rgb.len() != w * h * 3 {
        return Err(format!(
            "frame must be {w}x{h} RGB24 ({} bytes), got {}",
            w * h * 3,
            rgb.len()
        ));
    }
    if y0 >= h {
        return Err(format!("no rows left: y0 {y0} for height {h}"));
    }
    let lo = (COLOUR * A_TOP - SLACK).ceil() as u8;
    let margin = ((w as f64 * MARGIN).floor() as usize).max(1).min(w / 2);
    let total = (h - y0) * margin * 2;
    let required = (MIN_SHARE * total as f64).ceil() as usize;
    let (mut inside, mut outside) = (0usize, 0usize);
    if required == 0 {
        return Ok(true);
    }
    for y in y0..h {
        let a = A_TOP + (A_BOTTOM - A_TOP) * (y as f64 + 0.5) / h as f64;
        let hi = (COLOUR * a + 255.0 * (1.0 - a) + SLACK).floor() as u8;
        let row = &rgb[y * w * 3..(y + 1) * w * 3];
        for x in (0..margin).chain(w - margin..w) {
            let px = &row[x * 3..x * 3 + 3];
            if px.iter().all(|&c| c >= lo && c <= hi) {
                inside += 1;
                if inside >= required {
                    return Ok(true);
                }
            } else {
                outside += 1;
                if outside > total - required {
                    return Ok(false);
                }
            }
        }
    }
    Ok(inside >= required)
}

/// Shared settings. GUI-neutral and narrower-margin fallbacks are always used by
/// the normal detector; the strict primitive above exists for historical tests.
#[derive(Clone, Copy)]
pub struct Options {
    pub min_share: f64,
    pub margin: f64,
    pub slack: f64,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            min_share: MIN_SHARE,
            margin: MARGIN,
            slack: SLACK,
        }
    }
}

pub fn row_transform(y: usize, h: usize) -> (f64, f64) {
    let a = A_TOP + (A_BOTTOM - A_TOP) * (y as f64 + 0.5) / h as f64;
    (COLOUR * a, 1.0 / (1.0 - a))
}
pub fn restore_channel(value: u8, bias: f64, inverse: f64) -> u8 {
    ((value as f64 - bias) * inverse).round().clamp(0.0, 255.0) as u8
}
pub fn gui_colour(c: &[u8]) -> bool {
    [85u8, 139, 198, 255]
        .iter()
        .any(|&v| c[..3].iter().all(|&x| x.abs_diff(v) <= 6))
        || (c[0].abs_diff(16) <= 8 && c[1] <= 8 && c[2].abs_diff(16) <= 8)
}
fn validate(data: &[u8], w: usize, h: usize, channels: usize) -> Result<(), String> {
    if w == 0
        || h == 0
        || ![3, 4].contains(&channels)
        || w.checked_mul(h).and_then(|n| n.checked_mul(channels)) != Some(data.len())
    {
        return Err("invalid RGB/RGBA frame dimensions".into());
    }
    Ok(())
}
#[derive(Clone, Copy)]
enum Judgment {
    Strict,
    Background,
    GuiNeutral,
}

fn judge(
    data: &[u8],
    w: usize,
    h: usize,
    channels: usize,
    y0: usize,
    o: Options,
    mode: Judgment,
) -> (bool, f64) {
    let neutral_gui = matches!(mode, Judgment::GuiNeutral);
    let margin = ((w as f64 * o.margin).floor() as usize)
        .max(1)
        .min((w / 2).max(1));
    let total = (h - y0) * margin * 2;
    // The rendered veil floor is an integer channel before compression adds
    // its error. At the top, 12.047 quantizes to 12: with slack=2, channel 10
    // is valid. Comparing against 12.047 - 2 and then ceil would require 11
    // and reject compressed dark menus. Keep the old exact bound available
    // only for the historical strict diagnostic.
    let floor = if !matches!(mode, Judgment::Strict) {
        (COLOUR * A_TOP).round()
    } else {
        COLOUR * A_TOP
    };
    let lo = (floor - o.slack).ceil().max(0.0) as u8;
    let (mut inside, mut judged) = (0usize, 0usize);
    for y in y0..h {
        let (bias, inverse) = row_transform(y, h);
        let hi = (bias + 255.0 / inverse + o.slack).floor().min(255.0) as u8;
        for x in (0..margin).chain(w - margin..w) {
            let p = (y * w + x) * channels;
            let c = &data[p..p + 3];
            if neutral_gui && gui_colour(c) {
                continue;
            }
            judged += 1;
            inside += c.iter().all(|&v| v >= lo && v <= hi) as usize;
        }
    }
    let share = if judged > 0 {
        inside as f64 / judged as f64
    } else {
        0.0
    };
    (
        judged > 0 && (!neutral_gui || judged * 2 >= total) && share >= o.min_share,
        share,
    )
}
/// Perf-lab reference: the four judgments evaluated separately, as before the
/// single-pass `judge_all`. Same results; kept for A/B timing only.
#[doc(hidden)]
pub fn detect_pixels_reference(
    data: &[u8],
    w: usize,
    h: usize,
    channels: usize,
    y0: usize,
    o: Options,
) -> Result<(bool, f64), String> {
    validate(data, w, h, channels)?;
    let mut best = 0.0_f64;
    for margin in [o.margin, o.margin.min(0.1)] {
        for mode in [Judgment::Background, Judgment::GuiNeutral] {
            let (yes, share) = judge(data, w, h, channels, y0, Options { margin, ..o }, mode);
            best = best.max(share);
            if yes {
                return Ok((true, share));
            }
        }
    }
    Ok((false, best))
}
/// The single production detector for native Rust, Python and browser WASM.
pub fn detect_pixels(
    data: &[u8],
    w: usize,
    h: usize,
    channels: usize,
    y0: usize,
    o: Options,
) -> Result<(bool, f64), String> {
    validate(data, w, h, channels)?;
    let valid_options = y0 < h
        && o.min_share.is_finite()
        && o.min_share > 0.0
        && o.min_share <= 1.0
        && o.margin.is_finite()
        && o.margin > 0.0
        && o.margin <= 0.5
        && o.slack.is_finite()
        && o.slack >= 0.0;
    if !valid_options {
        return Err("invalid veil settings/start row".into());
    }
    Ok(judge_all(data, w, h, channels, y0, o))
}

/// The four judgments of `detect_pixels` — wide margin then narrow margin, each
/// judged as plain background then GUI-neutral — share one pass over the pixels.
/// The narrow columns are a subset of the wide ones, so four counters per margin
/// reproduce every `judge` result and the same first-yes / best-share order.
fn judge_all(data: &[u8], w: usize, h: usize, channels: usize, y0: usize, o: Options) -> (bool, f64) {
    let margin_px = |m: f64| ((w as f64 * m).floor() as usize).max(1).min((w / 2).max(1));
    let wide = margin_px(o.margin);
    let narrow = margin_px(o.margin.min(0.1));
    let floor = (COLOUR * A_TOP).round();
    let lo = (floor - o.slack).ceil().max(0.0) as u8;
    // [wide, narrow] × (judged_all, inside_all, judged_non_gui, inside_non_gui)
    let mut counts = [[0usize; 4]; 2];
    // One straight loop per column segment: the narrow columns are a prefix of
    // the left margin and a suffix of the right one, so each segment adds to a
    // fixed set of counters and no pixel needs a membership test. `gui_colour`
    // is evaluated only where its necessary condition holds (near-grey, or the
    // tooltip fill's red/blue window).
    let segment = |row: &[u8], hi: u8| -> (u32, u32, u32, u32) {
        let (mut judged, mut inside_all, mut non_gui, mut inside_non_gui) = (0u32, 0u32, 0u32, 0u32);
        for c in row.chunks_exact(channels) {
            let (r, g, b) = (c[0], c[1], c[2]);
            // Non-short-circuit `&`/`|`: straight-line byte tests, no branch per pixel.
            let inside = ((r >= lo) & (r <= hi) & (g >= lo) & (g <= hi) & (b >= lo) & (b <= hi)) as u32;
            let spread = r.max(g).max(b) - r.min(g).min(b);
            let near = (spread <= 12) | ((r.abs_diff(16) <= 8) & (g <= 8) & (b.abs_diff(16) <= 8));
            let gui = near && gui_colour(c);
            judged += 1;
            inside_all += inside;
            non_gui += !gui as u32;
            inside_non_gui += inside & (!gui as u32);
        }
        (judged, inside_all, non_gui, inside_non_gui)
    };
    let mut add = |sets: &[usize], (judged, inside_all, non_gui, inside_non_gui): (u32, u32, u32, u32)| {
        for &set in sets {
            counts[set][0] += judged as usize;
            counts[set][1] += inside_all as usize;
            counts[set][2] += non_gui as usize;
            counts[set][3] += inside_non_gui as usize;
        }
    };
    for y in y0..h {
        let (bias, inverse) = row_transform(y, h);
        let hi = (bias + 255.0 / inverse + o.slack).floor().min(255.0) as u8;
        let row = &data[y * w * channels..(y + 1) * w * channels];
        let px = |a: usize, b: usize| &row[a * channels..b * channels];
        add(&[0, 1], segment(px(0, narrow), hi));
        add(&[0], segment(px(narrow, wide), hi));
        add(&[0], segment(px(w - wide, w - narrow), hi));
        add(&[0, 1], segment(px(w - narrow, w), hi));
    }
    let mut best = 0.0_f64;
    for (set, margin) in [(0usize, wide), (1, narrow)] {
        for neutral_gui in [false, true] {
            let total = (h - y0) * margin * 2;
            let (judged, inside) = if neutral_gui {
                (counts[set][2], counts[set][3])
            } else {
                (counts[set][0], counts[set][1])
            };
            let share = if judged > 0 {
                inside as f64 / judged as f64
            } else {
                0.0
            };
            let yes = judged > 0 && (!neutral_gui || judged * 2 >= total) && share >= o.min_share;
            best = best.max(share);
            if yes {
                return (true, share);
            }
        }
    }
    (false, best)
}
pub fn detect_veil(rgb: &[u8], w: usize, h: usize, y0: usize) -> Result<bool, String> {
    Ok(detect_pixels(rgb, w, h, 3, y0, Options::default())?.0)
}
/// Historical strict-window diagnostic; production callers use detect_pixels.
pub fn strict_pixels(
    data: &[u8],
    w: usize,
    h: usize,
    channels: usize,
    y0: usize,
    o: Options,
) -> Result<bool, String> {
    // Reuse all dimension/option validation, then evaluate the one strict window.
    detect_pixels(data, w, h, channels, y0, o)?;
    Ok(judge(data, w, h, channels, y0, o, Judgment::Strict).0)
}
/// In-place inverse; RGBA alpha is preserved. No other implementation should
/// reproduce these row/round/clamp operations.
pub fn unveil_in_place(
    data: &mut [u8],
    w: usize,
    h: usize,
    channels: usize,
    a_top: f64,
    a_bottom: f64,
    colour: [u8; 3],
) -> Result<(), String> {
    validate(data, w, h, channels)?;
    if ![a_top, a_bottom]
        .iter()
        .all(|&a| a.is_finite() && (0.0..1.0).contains(&a))
    {
        return Err("invalid veil alpha".into());
    }
    // The restored value depends only on (row, channel, byte): tabulate the 256
    // values of `restore_channel` per row and channel instead of evaluating it
    // per pixel. Same expression, same rounding.
    let mut lut = [[0u8; 256]; 3];
    for y in 0..h {
        let a = a_top + (a_bottom - a_top) * (y as f64 + 0.5) / h as f64;
        let inverse = 1.0 / (1.0 - a);
        for k in 0..3 {
            let bias = colour[k] as f64 * a;
            for (v, out) in lut[k].iter_mut().enumerate() {
                *out = restore_channel(v as u8, bias, inverse);
            }
        }
        for px in data[y * w * channels..(y + 1) * w * channels].chunks_exact_mut(channels) {
            for k in 0..3 {
                px[k] = lut[k][px[k] as usize];
            }
        }
    }
    Ok(())
}
pub fn unveil_rgb(data: &[u8], w: usize, h: usize) -> Result<Vec<u8>, String> {
    let mut out = data.to_vec();
    unveil_in_place(&mut out, w, h, 3, A_TOP, A_BOTTOM, [COLOUR as u8; 3])?;
    Ok(out)
}
