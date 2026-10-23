//! Finds the text `FPS: ` in a greyscale strip and reads the digits after it.
use crate::font::{render, Bitmap, Font};

pub const THRESHOLD: u8 = 170;
pub const ANCHOR_TEXT: &str = "FPS: ";

/// Share of the label's pixels that must be lit for the anchor to match. Footage stored at another size than it was drawn
/// (a 1440p game in a 1080p file, resampled back) comes out soft, with 90 to 95 % of the strokes still above the
/// threshold; the old 97 % read nothing there. Native footage is unaffected (identical readings, REPORT.md).
pub const COVERAGE_PCT: usize = 80;

#[derive(Clone, Debug, PartialEq)]
pub struct Reading {
    /// Top-left of the anchor text in strip pixels.
    pub anchor: (usize, usize),
    pub value: String,
    /// Per digit: number of pixels differing from the best template.
    pub mismatches: Vec<usize>,
}

/// Second threshold for an overlay dimmed by a screen tint (inventory or pause darkening): measured text ~80 grey
/// over a ~22 box in the reference footage.
pub const DIM_THRESHOLD: u8 = 50;

pub fn binarize(gray: &[u8], width: usize, height: usize) -> Bitmap {
    binarize_at(gray, width, height, THRESHOLD)
}

pub fn binarize_at(gray: &[u8], width: usize, height: usize, threshold: u8) -> Bitmap {
    Bitmap { width, height, bits: gray[..width * height].iter().map(|&p| p > threshold).collect() }
}

/// Score of `tpl` placed at (x, y) in `b`: lit-where-expected minus lit-where-not, or None below `min_hit` coverage.
fn score(b: &Bitmap, tpl: &Bitmap, x: usize, y: usize, min_hit: usize) -> Option<i64> {
    let (mut hit, mut extra) = (0i64, 0i64);
    for ty in 0..tpl.height {
        let brow = (y + ty) * b.width + x;
        let trow = ty * tpl.width;
        for tx in 0..tpl.width {
            match (tpl.bits[trow + tx], b.bits[brow + tx]) {
                (true, true) => hit += 1,
                (false, true) => extra += 1,
                _ => {}
            }
        }
    }
    // A solid bright region lights every template pixel too; the glyph gaps must stay mostly dark.
    (hit as usize >= min_hit && extra * 2 < hit).then_some(hit - extra)
}

/// The anchor search. Only windows whose lit-pixel count could pass `score` are scored: `score` needs
/// `hit >= min_hit` and `2 * extra < hit` with `hit <= tpl.lit()` and `extra = lit_in_window - hit`, so
/// `min_hit <= lit_in_window` and `2 * lit_in_window < 3 * tpl.lit()` are necessary. Window counts come from a
/// summed-area table, so a frame without the overlay costs one pass over the strip instead of a full template match
/// at every position. Same result as `find_anchor_brute` on every input.
fn find_anchor(b: &Bitmap, tpl: &Bitmap, scale: usize, near: Option<(usize, usize)>) -> Option<(usize, usize)> {
    if b.width < tpl.width || b.height < tpl.height {
        return None;
    }
    let (max_x, max_y) = (b.width - tpl.width, b.height - tpl.height);
    let (xs, ys): (Vec<usize>, Vec<usize>) = match near {
        Some((px, py)) => (
            (px.saturating_sub(6 * scale)..=(px + 6 * scale).min(max_x)).collect(),
            (py.saturating_sub(scale)..=(py + scale).min(max_y)).collect(),
        ),
        None => ((0..=max_x).step_by(scale).collect(), (0..=max_y).step_by(scale).collect()),
    };
    let w1 = b.width + 1;
    let mut sat = vec![0u32; w1 * (b.height + 1)];
    for y in 0..b.height {
        let mut row = 0u32;
        for x in 0..b.width {
            row += b.bits[y * b.width + x] as u32;
            sat[(y + 1) * w1 + x + 1] = sat[y * w1 + x + 1] + row;
        }
    }
    let lit_in = |x: usize, y: usize| {
        let (x1, y1) = (x + tpl.width, y + tpl.height);
        (sat[y1 * w1 + x1] + sat[y * w1 + x]) as usize - (sat[y * w1 + x1] + sat[y1 * w1 + x]) as usize
    };
    let tl = tpl.lit();
    let min_hit = tl * COVERAGE_PCT / 100;
    let mut best: Option<(i64, usize, usize)> = None;
    for &y in &ys {
        for &x in &xs {
            let l = lit_in(x, y);
            if l < min_hit || 2 * l >= 3 * tl {
                continue;
            }
            if let Some(s) = score(b, tpl, x, y, min_hit) {
                if best.is_none_or(|(bs, _, _)| s > bs) {
                    best = Some((s, x, y));
                }
            }
        }
    }
    best.map(|(_, x, y)| (x, y))
}

/// Reference implementation: score every candidate window.
#[cfg(test)]
fn find_anchor_brute(b: &Bitmap, tpl: &Bitmap, scale: usize, near: Option<(usize, usize)>) -> Option<(usize, usize)> {
    if b.width < tpl.width || b.height < tpl.height {
        return None;
    }
    let (max_x, max_y) = (b.width - tpl.width, b.height - tpl.height);
    let (xs, ys): (Vec<usize>, Vec<usize>) = match near {
        Some((px, py)) => (
            (px.saturating_sub(6 * scale)..=(px + 6 * scale).min(max_x)).collect(),
            (py.saturating_sub(scale)..=(py + scale).min(max_y)).collect(),
        ),
        // The HUD is laid out in GUI units, so the label sits on the `scale` grid: search it in steps of `scale`.
        None => ((0..=max_x).step_by(scale).collect(), (0..=max_y).step_by(scale).collect()),
    };
    let min_hit = tpl.lit() * COVERAGE_PCT / 100;
    let mut best: Option<(i64, usize, usize)> = None;
    for &y in &ys {
        for &x in &xs {
            if let Some(s) = score(b, tpl, x, y, min_hit) {
                if best.is_none_or(|(bs, _, _)| s > bs) {
                    best = Some((s, x, y));
                }
            }
        }
    }
    best.map(|(_, x, y)| (x, y))
}

pub struct Templates {
    pub anchor: Bitmap,
    pub anchor_advance: usize,
    pub digits: Vec<Bitmap>, // '0'..='9', each 5*scale wide, 8*scale tall
    pub scale: usize,
}

impl Templates {
    pub fn new(font: &Font, scale: usize) -> Templates {
        let full = render(font, ANCHOR_TEXT, scale);
        // Drop the trailing gap column so a lit pixel there (the first digit) is not an "extra".
        let anchor = full.crop(0, 0, full.width - scale, full.height);
        let digits = (b'0'..=b'9')
            .map(|d| {
                let r = render(font, &(d as char).to_string(), scale);
                r.crop(0, 0, 5 * scale, r.height)
            })
            .collect();
        Templates { anchor, anchor_advance: full.width, digits, scale }
    }

    /// Reads digits at (x, y); stops at the first cell that matches no digit within 12 % of its pixels.
    pub fn read_digits(&self, b: &Bitmap, x: usize, y: usize, max_digits: usize) -> (String, Vec<usize>) {
        let (s, adv) = (self.scale, 6 * self.scale);
        let (mut value, mut mismatches) = (String::new(), Vec::new());
        for i in 0..max_digits {
            let cx = x + i * adv;
            if cx + 5 * s > b.width || y + 8 * s > b.height {
                break;
            }
            let mut best = (usize::MAX, 0u8);
            for (d, tpl) in self.digits.iter().enumerate() {
                let mut diff = 0;
                for ty in 0..8 * s {
                    for tx in 0..5 * s {
                        if tpl.get(tx, ty) != b.get(cx + tx, y + ty) {
                            diff += 1;
                        }
                    }
                }
                if diff < best.0 {
                    best = (diff, d as u8);
                }
            }
            if best.0 > 40 * s * s * 12 / 100 {
                break;
            }
            value.push((b'0' + best.1) as char);
            mismatches.push(best.0);
        }
        (value, mismatches)
    }

    pub fn read(&self, gray: &[u8], width: usize, height: usize, near: Option<(usize, usize)>) -> Option<Reading> {
        // Normal threshold first; the dim one only when the overlay is not found, so a lit overlay never
        // picks up its own shadow or box as glyph pixels.
        self.read_at(gray, width, height, near, THRESHOLD).or_else(|| self.read_at(gray, width, height, near, DIM_THRESHOLD))
    }

    fn read_at(&self, gray: &[u8], width: usize, height: usize, near: Option<(usize, usize)>, threshold: u8) -> Option<Reading> {
        let b = binarize_at(gray, width, height, threshold);
        let found = find_anchor(&b, &self.anchor, self.scale, near)
            .or_else(|| near.and_then(|_| find_anchor(&b, &self.anchor, self.scale, None)));
        // The label can be covered (a bright block, other HUD text) while the digits are intact: with the position
        // known from the previous frame, read the digits there and accept only a clean match.
        let (anchor, strict) = match (found, near) {
            (Some(a), _) => (a, false),
            (None, Some(n)) => (n, true),
            (None, None) => return None,
        };
        let (value, mismatches) = self.read_digits(&b, anchor.0 + self.anchor_advance, anchor.1, 4);
        if value.is_empty() || (strict && mismatches.iter().any(|&m| m > 2 * self.scale * self.scale)) {
            return None;
        }
        Some(Reading { anchor, value, mismatches })
    }
}

/// One-shot convenience: builds templates each call (tests). Use `Templates` for streams.
pub fn read_strip(font: &Font, gray: &[u8], width: usize, height: usize, scale: usize, near: Option<(usize, usize)>) -> Option<Reading> {
    Templates::new(font, scale).read(gray, width, height, near)
}

#[cfg(test)]
mod tests {
    //! Speed-up plan: the full anchor search only scores windows whose lit-pixel count could possibly pass `score`
    //! (min_hit <= lit < 1.5 * template lit). Both bounds follow from `score`'s own conditions, so the result must be
    //! identical to the brute-force search on every input: dark frames, bright/solid frames (the upper bound is
    //! the one that can go wrong), textured noise, the label on and off the scale grid, near hits and misses.
    use super::*;
    use crate::font::Font;

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
    }

    fn strip(rng: &mut Rng, font: &Font, w: usize, h: usize, scale: usize) -> Vec<u8> {
        let mut g = vec![0u8; w * h];
        match rng.below(5) {
            0 => g.iter_mut().for_each(|p| *p = rng.below(40) as u8),         // dark
            1 => g.iter_mut().for_each(|p| *p = rng.below(256) as u8),        // noise
            2 => g.iter_mut().for_each(|p| *p = 200 + rng.below(56) as u8),   // bright / sky
            3 => {
                // dark with bright blocks (toasts, snow) of random size
                for _ in 0..1 + rng.below(6) {
                    let (bw, bh) = (1 + rng.below(200) as usize, 1 + rng.below(h as u64) as usize);
                    let (x0, y0) = (rng.below((w - bw) as u64 + 1) as usize, rng.below((h - bh) as u64 + 1) as usize);
                    for y in y0..y0 + bh {
                        for x in x0..x0 + bw {
                            g[y * w + x] = 230;
                        }
                    }
                }
            }
            _ => g.iter_mut().for_each(|p| *p = 60 + rng.below(80) as u8),    // mid-grey texture
        }
        if rng.below(3) > 0 {
            let text = format!("FPS: {}", rng.below(2000));
            let img = crate::font::render(font, &text, scale);
            if img.width < w {
                let x0 = rng.below((w - img.width) as u64) as usize;
                let y0 = rng.below((h - img.height) as u64 + 1) as usize;
                let on = if rng.below(4) == 0 { 90 } else { 220 }; // sometimes dimmed
                for y in 0..img.height {
                    for x in 0..img.width {
                        if img.get(x, y) {
                            g[(y0 + y) * w + x0 + x] = on;
                        }
                    }
                }
            }
        }
        g
    }

    #[test]
    fn the_prefiltered_anchor_search_equals_brute_force_on_every_input() {
        let font = Font::load(include_bytes!("../assets/ascii.png")).unwrap();
        let mut rng = Rng(0x9e3779b97f4a7c15);
        for scale in [2usize, 3] {
            let t = Templates::new(&font, scale);
            let (w, h) = (700, 40);
            for case in 0..120 {
                let g = strip(&mut rng, &font, w, h, scale);
                for threshold in [THRESHOLD, DIM_THRESHOLD] {
                    let b = binarize_at(&g, w, h, threshold);
                    for near in [None, Some((rng.below(w as u64) as usize, rng.below(h as u64) as usize))] {
                        assert_eq!(
                            find_anchor(&b, &t.anchor, scale, near),
                            find_anchor_brute(&b, &t.anchor, scale, near),
                            "scale {scale} case {case} threshold {threshold} near {near:?}"
                        );
                    }
                }
            }
        }
    }
}
