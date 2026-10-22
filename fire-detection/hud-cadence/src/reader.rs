//! Finds the text `FPS: ` in a greyscale strip and reads the digits after it.
use crate::font::{render, Bitmap, Font};

pub const THRESHOLD: u8 = 170;
pub const ANCHOR_TEXT: &str = "FPS: ";

#[derive(Clone, Debug, PartialEq)]
pub struct Reading {
    /// Top-left of the anchor text in strip pixels.
    pub anchor: (usize, usize),
    pub value: String,
    /// Per digit: number of pixels differing from the best template.
    pub mismatches: Vec<usize>,
}

pub fn binarize(gray: &[u8], width: usize, height: usize) -> Bitmap {
    Bitmap { width, height, bits: gray[..width * height].iter().map(|&p| p > THRESHOLD).collect() }
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
    (hit as usize >= min_hit).then_some(hit - extra)
}

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
        None => ((0..=max_x).collect(), (0..=max_y).collect()),
    };
    let min_hit = tpl.lit() * 97 / 100;
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
        let b = binarize(gray, width, height);
        let anchor = find_anchor(&b, &self.anchor, self.scale, near)
            .or_else(|| near.and_then(|_| find_anchor(&b, &self.anchor, self.scale, None)))?;
        let (value, mismatches) = self.read_digits(&b, anchor.0 + self.anchor_advance, anchor.1, 4);
        if value.is_empty() {
            return None;
        }
        Some(Reading { anchor, value, mismatches })
    }
}

/// One-shot convenience: builds templates each call (tests). Use `Templates` for streams.
pub fn read_strip(font: &Font, gray: &[u8], width: usize, height: usize, scale: usize, near: Option<(usize, usize)>) -> Option<Reading> {
    Templates::new(font, scale).read(gray, width, height, near)
}
