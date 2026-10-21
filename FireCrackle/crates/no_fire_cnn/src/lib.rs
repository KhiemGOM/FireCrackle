//! Frozen preprocessing: RGB strip removal and Pillow-compatible bilinear image views.
pub const THRESHOLD: f32 = -1.757_097_2;
pub fn clear_score(score: f32) -> bool {
    score.is_finite() && score < THRESHOLD - 0.0001
}
pub fn tile_boxes() -> Vec<(usize, usize, usize, usize)> {
    let mut out = vec![(0, 0, 1920, 1068)];
    for y in [0, 428] {
        for x in [0, 427, 853, 1280] {
            out.push((x, y, 640, 640));
        }
    }
    out
}
// Separable triangle filtering, pixel-centre coordinates and 22-bit coefficients.
// Matches the frozen Pillow RGB resize (including intermediate u8 rounding).
fn coefficients(input: usize, output: usize) -> Vec<(usize, Vec<i64>)> {
    let scale = input as f64 / output as f64;
    let support = scale.max(1.0);
    (0..output)
        .map(|x| {
            let center = (x as f64 + 0.5) * scale;
            let first = ((center - support + 0.5) as isize).max(0) as usize;
            let last = ((center + support + 0.5) as usize).min(input);
            let weights: Vec<f64> = (first..last)
                .map(|i| (1.0 - ((i as f64 - center + 0.5) / support).abs()).max(0.0))
                .collect();
            let sum: f64 = weights.iter().sum();
            (
                first,
                weights
                    .into_iter()
                    .map(|w| (0.5 + w / sum * (1 << 22) as f64) as i64)
                    .collect(),
            )
        })
        .collect()
}
pub fn resize(rgb: &[u8], width: usize, rect: (usize, usize, usize, usize)) -> Vec<u8> {
    let (left, top, w, h) = rect;
    let xs = cached_coefficients(w);
    let ys = cached_coefficients(h);
    let mut temp = vec![0u8; 224 * h * 3];
    for y in 0..h {
        for (x, (first, weights)) in xs.iter().enumerate() {
            for c in 0..3 {
                let sum = weights.iter().enumerate().fold(1i64 << 21, |s, (k, a)| {
                    s + *a * rgb[((top + y) * width + left + first + k) * 3 + c] as i64
                });
                temp[(y * 224 + x) * 3 + c] = (sum >> 22).clamp(0, 255) as u8;
            }
        }
    }
    let mut out = vec![0u8; 224 * 224 * 3];
    for (y, (first, weights)) in ys.iter().enumerate() {
        for x in 0..224 {
            for c in 0..3 {
                let sum = weights.iter().enumerate().fold(1i64 << 21, |s, (k, a)| {
                    s + *a * temp[((first + k) * 224 + x) * 3 + c] as i64
                });
                out[(y * 224 + x) * 3 + c] = (sum >> 22).clamp(0, 255) as u8;
            }
        }
    }
    out
}
// Geometry-only cache for the frozen full-frame and 640px views. No pixel,
// model result or decision is carried between frames.
fn cached_coefficients(input: usize) -> std::borrow::Cow<'static, [(usize, Vec<i64>)]> {
    use std::sync::OnceLock;
    static FULL_X: OnceLock<Vec<(usize, Vec<i64>)>> = OnceLock::new();
    static FULL_Y: OnceLock<Vec<(usize, Vec<i64>)>> = OnceLock::new();
    static TILE: OnceLock<Vec<(usize, Vec<i64>)>> = OnceLock::new();
    let cache = match input {
        1920 => &FULL_X,
        1068 => &FULL_Y,
        640 => &TILE,
        _ => return std::borrow::Cow::Owned(coefficients(input, 224)),
    };
    std::borrow::Cow::Borrowed(cache.get_or_init(|| coefficients(input, 224)))
}
pub fn views(rgb: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    if rgb.len() != 1920 * 1080 * 3 {
        return Err("AI no-fire needs a complete native 1920×1080 RGB frame".into());
    }
    let cropped = &rgb[1920 * 12 * 3..];
    Ok(tile_boxes()
        .into_iter()
        .map(|rect| resize(cropped, 1920, rect))
        .collect())
}

mod engine;
pub use engine::Engine;
mod frame;
pub use frame::{clear_frame_batched, clear_frame_with};
pub mod policy;
