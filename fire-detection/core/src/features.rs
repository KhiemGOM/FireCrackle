//! Structure features for the presence detector. See DETECT_PLAN.md ("round 2").

#[derive(Debug, Default, Clone, Copy)]
pub struct Blobs {
    /// Mask pixels in total.
    pub total: usize,
    /// 4-connected blobs with at least `min_area` pixels.
    pub blobs_ge_min: usize,
    pub largest: usize,
    /// Mask pixels that belong to a blob of at least `min_area` pixels.
    pub in_big: usize,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct EdgeStats {
    /// Horizontally adjacent pixel pairs with both pixels in the mask.
    pub pairs: usize,
    pub mean_abs_diff: f64,
    /// Share of those pairs whose luma differs by more than 30.
    pub share_big: f64,
}

const BIG_STEP: f64 = 30.0;

fn check_dims(len: usize, per_px: usize, w: usize, h: usize, what: &str) -> Result<(), String> {
    if w == 0 || h == 0 || len != w * h * per_px {
        return Err(format!(
            "{what} must hold {w}x{h}x{per_px} values, got {len}"
        ));
    }
    Ok(())
}

/// Connected components (4-connectivity, iterative flood fill) of a boolean mask.
pub fn blob_stats(mask: &[bool], w: usize, h: usize, min_area: usize) -> Result<Blobs, String> {
    check_dims(mask.len(), 1, w, h, "mask")?;
    if min_area == 0 {
        return Err("min_area must be >= 1".into());
    }
    let mut seen = vec![false; mask.len()];
    let mut stack: Vec<usize> = Vec::new();
    let mut out = Blobs::default();
    for start in 0..mask.len() {
        if !mask[start] || seen[start] {
            continue;
        }
        let mut area = 0usize;
        seen[start] = true;
        stack.push(start);
        while let Some(i) = stack.pop() {
            area += 1;
            let (x, y) = (i % w, i / w);
            let mut push = |j: usize| {
                if mask[j] && !seen[j] {
                    seen[j] = true;
                    stack.push(j);
                }
            };
            if x > 0 {
                push(i - 1);
            }
            if x + 1 < w {
                push(i + 1);
            }
            if y > 0 {
                push(i - w);
            }
            if y + 1 < h {
                push(i + w);
            }
        }
        out.total += area;
        out.largest = out.largest.max(area);
        if area >= min_area {
            out.blobs_ge_min += 1;
            out.in_big += area;
        }
    }
    Ok(out)
}

/// Pixel-art roughness inside the mask: how much luma jumps between horizontal neighbours that are both masked.
pub fn mask_edge_stats(
    mask: &[bool],
    luma: &[f64],
    w: usize,
    h: usize,
) -> Result<EdgeStats, String> {
    check_dims(mask.len(), 1, w, h, "mask")?;
    check_dims(luma.len(), 1, w, h, "luma")?;
    let (mut pairs, mut sum, mut big) = (0usize, 0.0f64, 0usize);
    for y in 0..h {
        for x in 0..w - 1 {
            let i = y * w + x;
            if mask[i] && mask[i + 1] {
                let d = (luma[i] - luma[i + 1]).abs();
                pairs += 1;
                sum += d;
                if d > BIG_STEP {
                    big += 1;
                }
            }
        }
    }
    if pairs == 0 {
        return Ok(EdgeStats::default());
    }
    Ok(EdgeStats {
        pairs,
        mean_abs_diff: sum / pairs as f64,
        share_big: big as f64 / pairs as f64,
    })
}

/// Mean luma (0..255) and the share of pixels with luma below `dark_below`.
pub fn mean_luma_and_dark(
    rgb: &[u8],
    w: usize,
    h: usize,
    dark_below: f64,
) -> Result<(f64, f64), String> {
    check_dims(rgb.len(), 3, w, h, "frame")?;
    let (mut sum, mut dark) = (0.0f64, 0usize);
    for p in rgb.as_chunks::<3>().0 {
        let l = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
        sum += l;
        if l < dark_below {
            dark += 1;
        }
    }
    let n = (w * h) as f64;
    Ok((sum / n, dark as f64 / n))
}

/// Undoes a GUI background veil: `out = c * a + p * (1 - a)` with `a` growing linearly from `a_top` (top of the frame)
/// to `a_bottom`, sampled at each row's centre. Returns `p = (out - c * a) / (1 - a)`, clamped to 0..255.
pub fn unveil_rows(
    rgb: &[u8],
    w: usize,
    h: usize,
    a_top: f64,
    a_bottom: f64,
    c: [u8; 3],
) -> Result<Vec<u8>, String> {
    let mut out = rgb.to_vec();
    crate::veil::unveil_in_place(&mut out, w, h, 3, a_top, a_bottom, c)?;
    Ok(out)
}

/// Morphological opening with a (2r+1)x(2r+1) square: erosion then dilation. Removes specks and thin lines.
/// Out of frame counts as set during erosion and as clear during dilation, so blobs at the border are kept.
pub fn open_mask(mask: &[bool], w: usize, h: usize, r: usize) -> Result<Vec<bool>, String> {
    check_dims(mask.len(), 1, w, h, "mask")?;
    if r == 0 {
        return Ok(mask.to_vec());
    }
    let eroded = window_filter(mask, w, h, r, |set, cells| set == cells);
    Ok(window_filter(&eroded, w, h, r, |set, _| set > 0))
}

/// For every pixel: `keep(set pixels in the clipped (2r+1)^2 window, window cells inside the frame)`.
fn window_filter(
    mask: &[bool],
    w: usize,
    h: usize,
    r: usize,
    keep: impl Fn(u32, u32) -> bool,
) -> Vec<bool> {
    let stride = w + 1;
    let mut integral = vec![0u32; stride * (h + 1)];
    for y in 0..h {
        let mut run = 0u32;
        for x in 0..w {
            run += mask[y * w + x] as u32;
            integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + run;
        }
    }
    let mut out = vec![false; mask.len()];
    for y in 0..h {
        let (ya, yb) = (y.saturating_sub(r), (y + r + 1).min(h));
        for x in 0..w {
            let (xa, xb) = (x.saturating_sub(r), (x + r + 1).min(w));
            let set = integral[yb * stride + xb] + integral[ya * stride + xa]
                - integral[ya * stride + xb]
                - integral[yb * stride + xa];
            out[y * w + x] = keep(set, ((xb - xa) * (yb - ya)) as u32);
        }
    }
    out
}

#[derive(Debug, Clone, Copy)]
pub struct BlobInfo {
    pub area: usize,
    pub x0: usize,
    pub y0: usize,
    /// Exclusive.
    pub x1: usize,
    pub y1: usize,
    /// Pixel sides facing a non-blob pixel inside the frame (sides on the frame edge are not counted).
    pub perimeter: usize,
}

/// 4-connected labelling: 0 = background, blob k is `infos[k - 1]`, numbered in scan order.
pub fn label_blobs(mask: &[bool], w: usize, h: usize) -> Result<(Vec<u32>, Vec<BlobInfo>), String> {
    check_dims(mask.len(), 1, w, h, "mask")?;
    let mut labels = vec![0u32; mask.len()];
    let mut infos: Vec<BlobInfo> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    for start in 0..mask.len() {
        if !mask[start] || labels[start] != 0 {
            continue;
        }
        let id = infos.len() as u32 + 1;
        let mut info = BlobInfo {
            area: 0,
            x0: w,
            y0: h,
            x1: 0,
            y1: 0,
            perimeter: 0,
        };
        labels[start] = id;
        stack.push(start);
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            info.area += 1;
            info.x0 = info.x0.min(x);
            info.y0 = info.y0.min(y);
            info.x1 = info.x1.max(x + 1);
            info.y1 = info.y1.max(y + 1);
            let mut visit = |j: usize, info: &mut BlobInfo| {
                if mask[j] {
                    if labels[j] == 0 {
                        labels[j] = id;
                        stack.push(j);
                    }
                } else {
                    info.perimeter += 1;
                }
            };
            if x > 0 {
                visit(i - 1, &mut info);
            }
            if x + 1 < w {
                visit(i + 1, &mut info);
            }
            if y > 0 {
                visit(i - w, &mut info);
            }
            if y + 1 < h {
                visit(i + w, &mut info);
            }
        }
        infos.push(info);
    }
    Ok((labels, infos))
}
