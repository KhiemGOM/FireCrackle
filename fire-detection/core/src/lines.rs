//! Straight edge segments in a frame (LSD-style region growing: von Gioi et al., "LSD: a Line Segment Detector").
//! Pixels with a strong gradient are grouped with neighbours whose gradient direction agrees within 22.5°, strongest
//! first; each group's direction is the principal axis of its pixels. Minecraft draws without antialiasing, so a
//! slanted edge is a staircase whose single-pixel gradients sit near 0° or 90°; the group's axis still follows the true
//! edge. Used by `reversal` for vanishing points.

/// A straight edge. `centre` is relative to the image centre with y up (pixel centre at (x + 0.5, y + 0.5)); `dir` is
/// a unit direction along the edge, y up; `length` in pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    pub centre: [f64; 2],
    pub dir: [f64; 2],
    pub length: f64,
}

/// Scharr response (weights sum 32 per side) for a luma step of 4.
const MIN_GRADIENT: f64 = 32.0 * 4.0;
const TOLERANCE: f64 = 22.5;
const MIN_PIXELS: usize = 8;
const MIN_LENGTH: f64 = 8.0;
const MIN_ELONGATION: f64 = 2.5;

/// 3-tap binomial blur, separable (softens the staircase a little; σ ≈ 0.7 px).
fn blur(src: &[f64], w: usize, h: usize) -> Vec<f64> {
    let mut tmp = vec![0.0; w * h];
    for y in 0..h {
        for x in 0..w {
            let l = src[y * w + x.saturating_sub(1)];
            let r = src[y * w + (x + 1).min(w - 1)];
            tmp[y * w + x] = 0.25 * l + 0.5 * src[y * w + x] + 0.25 * r;
        }
    }
    let mut out = vec![0.0; w * h];
    for y in 0..h {
        for x in 0..w {
            let u = tmp[y.saturating_sub(1) * w + x];
            let d = tmp[(y + 1).min(h - 1) * w + x];
            out[y * w + x] = 0.25 * u + 0.5 * tmp[y * w + x] + 0.25 * d;
        }
    }
    out
}

/// Gap between two gradient angles (radians) modulo π, in degrees.
fn gap(a: f64, b: f64) -> f64 {
    let d = (a - b).rem_euclid(std::f64::consts::PI);
    d.min(std::f64::consts::PI - d).to_degrees()
}

/// Straight edge segments of an RGB24 frame, longest evidence first is not guaranteed. `ignore` marks pixels that
/// must not contribute (GUI). Empty for bad sizes.
pub fn segments(rgb: &[u8], w: usize, h: usize, ignore: Option<&[bool]>) -> Vec<Segment> {
    if w < 5 || h < 5 || rgb.len() != w * h * 3 || ignore.is_some_and(|m| m.len() != w * h) {
        return Vec::new();
    }
    let luma: Vec<f64> = rgb
        .chunks_exact(3)
        .map(|p| 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64)
        .collect();
    let luma = blur(&luma, w, h);
    // a pixel's gradient uses the 3×3 of the blurred picture, i.e. the 5×5 of the frame
    let masked = |x: usize, y: usize| {
        ignore.is_some_and(|m| (0..5).any(|dy| (0..5).any(|dx| m[(y + dy - 2) * w + x + dx - 2])))
    };
    let mut mag = vec![0.0; w * h];
    let mut ang = vec![0.0; w * h];
    let mut candidates = Vec::new();
    for y in 2..h - 2 {
        for x in 2..w - 2 {
            if masked(x, y) {
                continue;
            }
            let p = |dx: usize, dy: usize| luma[(y + dy - 1) * w + x + dx - 1];
            let gx =
                3.0 * (p(2, 0) - p(0, 0)) + 10.0 * (p(2, 1) - p(0, 1)) + 3.0 * (p(2, 2) - p(0, 2));
            let gy =
                3.0 * (p(0, 2) - p(0, 0)) + 10.0 * (p(1, 2) - p(1, 0)) + 3.0 * (p(2, 2) - p(2, 0));
            let m = (gx * gx + gy * gy).sqrt();
            if m > MIN_GRADIENT {
                let i = y * w + x;
                mag[i] = m;
                ang[i] = gy.atan2(gx);
                candidates.push(i);
            }
        }
    }
    candidates.sort_by(|&a, &b| mag[b].total_cmp(&mag[a]));
    let mut used = vec![false; w * h];
    let mut out = Vec::new();
    let mut region = Vec::new();
    let mut stack = Vec::new();
    for &seed in &candidates {
        if used[seed] {
            continue;
        }
        region.clear();
        stack.clear();
        used[seed] = true;
        stack.push(seed);
        // running mean of the doubled angle (direction modulo π)
        let (mut c2, mut s2) = ((2.0 * ang[seed]).cos(), (2.0 * ang[seed]).sin());
        while let Some(i) = stack.pop() {
            region.push(i);
            let mean = 0.5 * s2.atan2(c2);
            let (x, y) = (i % w, i / w);
            for dy in -1i64..=1 {
                for dx in -1i64..=1 {
                    let (nx, ny) = (x as i64 + dx, y as i64 + dy);
                    if nx < 0 || ny < 0 || nx >= w as i64 || ny >= h as i64 {
                        continue;
                    }
                    let j = ny as usize * w + nx as usize;
                    if used[j] || mag[j] == 0.0 || gap(ang[j], mean) > TOLERANCE {
                        continue;
                    }
                    used[j] = true;
                    c2 += (2.0 * ang[j]).cos();
                    s2 += (2.0 * ang[j]).sin();
                    stack.push(j);
                }
            }
        }
        if region.len() < MIN_PIXELS {
            continue;
        }
        if let Some(s) = fit(&region, &mag, w, h) {
            out.push(s);
        }
    }
    out
}

/// Principal axis of a region's pixels, weighted by gradient strength.
fn fit(region: &[usize], mag: &[f64], w: usize, h: usize) -> Option<Segment> {
    let (mut sw, mut sx, mut sy) = (0.0, 0.0, 0.0);
    for &i in region {
        let (x, y) = ((i % w) as f64 + 0.5, (i / w) as f64 + 0.5);
        sw += mag[i];
        sx += mag[i] * x;
        sy += mag[i] * y;
    }
    let (mx, my) = (sx / sw, sy / sw);
    let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
    for &i in region {
        let (x, y) = ((i % w) as f64 + 0.5 - mx, (i / w) as f64 + 0.5 - my);
        xx += mag[i] * x * x;
        xy += mag[i] * x * y;
        yy += mag[i] * y * y;
    }
    // main eigenvector of the covariance (image coordinates, y down)
    let theta = 0.5 * (2.0 * xy).atan2(xx - yy);
    let (dx, dy) = (theta.cos(), theta.sin());
    let (mut lo, mut hi, mut wlo, mut whi) = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for &i in region {
        let (x, y) = ((i % w) as f64 + 0.5 - mx, (i / w) as f64 + 0.5 - my);
        let along = x * dx + y * dy;
        let across = -x * dy + y * dx;
        lo = lo.min(along);
        hi = hi.max(along);
        wlo = wlo.min(across);
        whi = whi.max(across);
    }
    let length = hi - lo + 1.0;
    let width = whi - wlo + 1.0;
    if length < MIN_LENGTH || length < MIN_ELONGATION * width {
        return None;
    }
    let mid = (lo + hi) / 2.0;
    let (cx, cy) = (mx + mid * dx, my + mid * dy);
    Some(Segment {
        centre: [cx - w as f64 / 2.0, h as f64 / 2.0 - cy],
        dir: [dx, -dy],
        length,
    })
}
