//! Finds the size of a font pixel in the recording, so any resolution reads. A game drawn at GUI scale `s` on a screen
//! `Hg` tall and stored `H` tall has font pixels of `g = s * H / Hg` video pixels, whole or not (a 1440p game at scale 3
//! in a 1080p file: 2.25). The reader needs whole ones; the footage is resampled by `3 / g` first and read at 3.
use crate::font::Font;
use crate::reader::Templates;

/// The reader's frame: the top-left region it searches, at 3 video pixels per font pixel.
pub const CANON_W: usize = 1500;
pub const CANON_H: usize = 40;
const CANON_GLYPH: f64 = 3.0;

/// A native-resolution grey crop of the top-left of a frame.
#[derive(Clone, Debug)]
pub struct Band {
    pub gray: Vec<u8>,
    pub width: usize,
    pub height: usize,
}

#[derive(Clone, Debug)]
pub struct Detected {
    /// Video pixels per font pixel.
    pub glyph: f64,
    /// Resample factor that makes a font pixel `CANON_GLYPH` pixels.
    pub factor: f64,
    /// Samples whose overlay was read at this size.
    pub reads: usize,
}

/// Lanczos3, the filter the pipeline's ffmpeg `scale` uses, so detection reads what the pipeline will read.
fn lanczos(x: f64) -> f64 {
    if x.abs() >= 3.0 {
        return 0.0;
    }
    if x == 0.0 {
        return 1.0;
    }
    let p = std::f64::consts::PI * x;
    3.0 * p.sin() * (p / 3.0).sin() / (p * p)
}

/// One axis of a lanczos resample: for each output pixel its (first source index, weights). The filter widens when
/// shrinking, so a shrink averages instead of skipping.
fn taps(n_in: usize, n_out: usize) -> Vec<(usize, Vec<f32>)> {
    let scale = n_in as f64 / n_out as f64;
    let stretch = scale.max(1.0);
    (0..n_out)
        .map(|o| {
            let c = (o as f64 + 0.5) * scale - 0.5;
            let first = ((c - 3.0 * stretch).ceil().max(0.0)) as usize;
            let last = ((c + 3.0 * stretch).floor() as isize).clamp(0, n_in as isize - 1) as usize;
            let mut w: Vec<f32> = (first..=last).map(|i| lanczos((i as f64 - c) / stretch) as f32).collect();
            let sum: f32 = w.iter().sum();
            if sum != 0.0 {
                w.iter_mut().for_each(|v| *v /= sum);
            }
            (first, w)
        })
        .collect()
}

pub fn resample(g: &[u8], w: usize, h: usize, ow: usize, oh: usize) -> Vec<u8> {
    let (tx, ty) = (taps(w, ow), taps(h, oh));
    let mut rows = vec![0f32; ow * h];
    for y in 0..h {
        for (x, (first, ws)) in tx.iter().enumerate() {
            rows[y * ow + x] = ws.iter().enumerate().map(|(k, wt)| g[y * w + first + k] as f32 * wt).sum();
        }
    }
    let mut out = vec![0u8; ow * oh];
    for (y, (first, ws)) in ty.iter().enumerate() {
        for x in 0..ow {
            let v: f32 = ws.iter().enumerate().map(|(k, wt)| rows[(first + k) * ow + x] * wt).sum();
            out[y * ow + x] = v.round().clamp(0.0, 255.0) as u8;
        }
    }
    out
}

/// Font pixel sizes worth trying for a recording `video_height` tall: every GUI scale 1..8 on the usual screen heights
/// (and on the file's own). Sizes within half a percent are one.
fn candidates(video_height: usize) -> Vec<f64> {
    let mut out: Vec<f64> = Vec::new();
    for game_height in [video_height, 720, 900, 1080, 1200, 1440, 1600, 2160, 2880] {
        for s in 1..=8 {
            let g = s as f64 * video_height as f64 / game_height as f64;
            if (1.4..=12.0).contains(&g) && !out.iter().any(|&o| (o - g).abs() / g < 0.005) {
                out.push(g);
            }
        }
    }
    out
}

/// The reader's frame for a native band at font pixel size `glyph`: resampled to 3 px per font pixel, cropped to the
/// reader's region. The same geometry the pipeline's ffmpeg filter produces.
fn canonical(b: &Band, glyph: f64) -> (Vec<u8>, usize, usize) {
    let f = CANON_GLYPH / glyph;
    let (w, h) = (((b.width as f64 * f).round() as usize).max(1), ((b.height as f64 * f).round() as usize).max(1));
    let g = if w == b.width && h == b.height { b.gray.clone() } else { resample(&b.gray, b.width, b.height, w, h) };
    let (cw, ch) = (w.min(CANON_W), h.min(CANON_H));
    let mut out = Vec::with_capacity(cw * ch);
    for y in 0..ch {
        out.extend_from_slice(&g[y * w..y * w + cw]);
    }
    (out, cw, ch)
}

/// The font pixel size at which the overlay reads in the most samples (ties: the fewest mismatched pixels). None when
/// fewer than two samples, or fewer than a third of them, read at any size.
pub fn detect(font: &Font, bands: &[Band], video_height: usize) -> Option<Detected> {
    let tpl = Templates::new(font, CANON_GLYPH as usize);
    let mut best: Option<(usize, usize, f64)> = None; // (reads, mismatches, glyph)
    for glyph in candidates(video_height) {
        let (mut reads, mut miss) = (0, 0);
        for b in bands {
            let (g, w, h) = canonical(b, glyph);
            if let Some(r) = tpl.read(&g, w, h, None) {
                reads += 1;
                miss += r.mismatches.iter().sum::<usize>();
            }
        }
        if reads > 0 && best.is_none_or(|(br, bm, _)| reads > br || (reads == br && miss < bm)) {
            best = Some((reads, miss, glyph));
        }
    }
    best.filter(|&(reads, _, _)| reads >= 2 && reads * 3 >= bands.len())
        .map(|(reads, _, glyph)| Detected { glyph, factor: CANON_GLYPH / glyph, reads })
}

/// The ffmpeg crop and scale that give the reader its frame for font pixels of `glyph` video pixels:
/// (crop w, crop h, out w, out h), the crop clipped to the video.
pub fn geometry(glyph: f64, video_w: usize, video_h: usize) -> (usize, usize, usize, usize) {
    let f = CANON_GLYPH / glyph;
    // even: ffmpeg's scaler pads an odd input to even, stretching the band by a pixel and moving the glyphs off the grid
    let even = |n: usize, max: usize| (n + n % 2).min(max);
    let cw = even((CANON_W as f64 / f).ceil() as usize, video_w);
    let ch = even((CANON_H as f64 / f).ceil() as usize, video_h);
    (cw, ch, (cw as f64 * f).round() as usize, (ch as f64 * f).round() as usize)
}

/// (width, height, seconds) from `ffmpeg -i VIDEO`'s banner; None without a video size or a known length.
pub fn parse_probe(banner: &str) -> Option<(usize, usize, f64)> {
    let d = banner.split("Duration: ").nth(1)?.split(',').next()?;
    let mut t = d.trim().split(':').map(|p| p.parse::<f64>().ok());
    let secs = t.next()?? * 3600.0 + t.next()?? * 60.0 + t.next()??;
    let video = banner.split("Video: ").nth(1)?.lines().next()?;
    let (w, h) = video.split(|c: char| c == ',' || c == ' ').find_map(|tok| {
        let (w, h) = tok.split_once('x')?;
        let (w, h): (usize, usize) = (w.parse().ok()?, h.parse().ok()?);
        (w >= 16 && h >= 16).then_some((w, h))
    })?;
    Some((w, h, secs))
}
