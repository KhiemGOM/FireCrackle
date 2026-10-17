//! First-person on-fire overlay: known screen geometry, so plain sprite matching can name the row.
//! See DETECT_PLAN.md ("round 7").

pub type Corners = [[f64; 3]; 4];

const TEX: usize = 16;
const ROWS: usize = 32;
const SHEET_LEN: usize = TEX * TEX * ROWS * 4;
/// A row needs this many visible opaque texels (over both quads) to be scored at all.
const MIN_SAMPLES: usize = 10;
/// A template pixel counts as orange when R - B >= this; a frame pixel when R - B >= WARM_FRAME (lenient: veils darken).
const WARM_TEMPLATE: i32 = 40;
const WARM_FRAME: i32 = 8;

#[derive(Debug, Clone, Copy)]
pub struct RowScore {
    pub row: u8,
    /// Zero-mean normalised correlation (-1..1), -1 when it cannot be computed.
    pub score: f64,
    /// Fisher significance atanh(r) * sqrt(n - 3): comparable across rows with different numbers of visible texels.
    pub z: f64,
    pub samples: usize,
}

/// View-space corners of the two overlay quads (hand view = identity), order c0..c3 as in the mod's OverlayQuads:
/// for r in {0, 1} with s = 2r - 1 a unit quad at z = -0.5 is rotated s * 10 degrees about Y and translated (-s * 0.24, -0.3, 0).
pub fn overlay_quads() -> [Corners; 2] {
    const CORNERS: [[f64; 3]; 4] = [
        [-0.5, -0.5, -0.5],
        [0.5, -0.5, -0.5],
        [0.5, 0.5, -0.5],
        [-0.5, 0.5, -0.5],
    ];
    let mut out = [[[0.0; 3]; 4]; 2];
    for (r, quad) in out.iter_mut().enumerate() {
        let s = 2.0 * r as f64 - 1.0;
        let a = (s * 10.0f64).to_radians();
        let (sin, cos) = a.sin_cos();
        for (i, c) in CORNERS.iter().enumerate() {
            quad[i] = [
                c[0] * cos + c[2] * sin - s * 0.24,
                c[1] - 0.3,
                -c[0] * sin + c[2] * cos,
            ];
        }
    }
    out
}

/// Perspective projection (vertical `fov_deg`, aspect w/h, looking down -z) to pixels, y down. None if the point is not
/// in front of the camera or fov / size are unusable.
pub fn project(p: [f64; 3], fov_deg: f64, w: usize, h: usize) -> Option<(f64, f64)> {
    if !fov_deg.is_finite()
        || fov_deg <= 0.0
        || fov_deg >= 180.0
        || w == 0
        || h == 0
        || p[2].partial_cmp(&-1e-9) != Some(std::cmp::Ordering::Less)
    {
        return None;
    }
    let f = 1.0 / (fov_deg.to_radians() / 2.0).tan();
    let aspect = w as f64 / h as f64;
    let nx = f / aspect * p[0] / -p[2];
    let ny = f * p[1] / -p[2];
    Some(((nx + 1.0) / 2.0 * w as f64, (1.0 - ny) / 2.0 * h as f64))
}

/// The texel of `quad` that covers the pixel centre (x, y), if any (ray from the camera through the pixel meets the quad).
fn texel_at_pixel(
    quad: &Corners,
    x: f64,
    y: f64,
    fov_deg: f64,
    w: usize,
    h: usize,
) -> Option<(usize, usize)> {
    let f = 1.0 / (fov_deg.to_radians() / 2.0).tan();
    let aspect = w as f64 / h as f64;
    let d = [
        (2.0 * x / w as f64 - 1.0) * aspect / f,
        (1.0 - 2.0 * y / h as f64) / f,
        -1.0,
    ];
    let sub = |a: [f64; 3], b: [f64; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let e1 = sub(quad[1], quad[0]);
    let e3 = sub(quad[3], quad[0]);
    let n = [
        e1[1] * e3[2] - e1[2] * e3[1],
        e1[2] * e3[0] - e1[0] * e3[2],
        e1[0] * e3[1] - e1[1] * e3[0],
    ];
    let denom = dot(n, d);
    if denom.abs() < 1e-12 {
        return None;
    }
    let t = dot(n, quad[0]) / denom;
    if t <= 0.0 {
        return None;
    }
    let r = sub([d[0] * t, d[1] * t, d[2] * t], quad[0]);
    let (s, tt) = (dot(r, e1) / dot(e1, e1), dot(r, e3) / dot(e3, e3));
    if !(0.0..1.0).contains(&s) || !(0.0..1.0).contains(&tt) {
        return None;
    }
    let (u, v) = (1.0 - s, 1.0 - tt);
    Some((
        ((u * TEX as f64) as usize).min(TEX - 1),
        ((v * TEX as f64) as usize).min(TEX - 1),
    ))
}

fn luma(r: u8, g: u8, b: u8) -> f64 {
    0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64
}

/// Scores the 32 rows of fire_1 (raw RGBA, 16 wide) against an RGB24 frame, best (highest z) first. For each opaque texel of
/// a row the frame is sampled where that texel lands on screen (both quads, the second one drawn over the first); the score
/// is the zero-mean normalised correlation of frame luma against template luma. Texels off screen are skipped; fewer than 10
/// usable samples or a flat frame score -1 (z = -100).
pub fn match_overlay(
    sheet1: &[u8],
    frame: &[u8],
    w: usize,
    h: usize,
    fov_deg: f64,
) -> Result<Vec<RowScore>, String> {
    if sheet1.len() != SHEET_LEN {
        return Err(format!(
            "fire_1 must be {SHEET_LEN} bytes of RGBA, got {}",
            sheet1.len()
        ));
    }
    if w == 0 || h == 0 || frame.len() != w * h * 3 {
        return Err(format!(
            "frame must be {w}x{h} RGB24 ({} bytes), got {}",
            w * h * 3,
            frame.len()
        ));
    }
    if !fov_deg.is_finite() || fov_deg <= 0.0 || fov_deg >= 180.0 {
        return Err(format!("fov must be in (0, 180) degrees: {fov_deg}"));
    }
    // where each texel lands on screen (two quads) and what the frame shows there
    let quads = overlay_quads();
    // per texel and quad: (frame luma, frame pixel is warm i.e. R - B >= WARM_FRAME)
    let mut samples: Vec<[Option<(f64, bool)>; 2]> = vec![[None, None]; TEX * TEX];
    // quad 1 is drawn after quad 0: where one of its opaque texels covers a quad-0 texel, the pixel shows quad 1 instead
    let mut covered_by: Vec<Option<(usize, usize)>> = vec![None; TEX * TEX];
    for ty in 0..TEX {
        for tx in 0..TEX {
            let (u, v) = (
                (tx as f64 + 0.5) / TEX as f64,
                (ty as f64 + 0.5) / TEX as f64,
            );
            let (s, t) = (1.0 - u, 1.0 - v);
            for (qi, q) in quads.iter().enumerate() {
                let mut p = [0.0; 3];
                for k in 0..3 {
                    p[k] = q[0][k] + s * (q[1][k] - q[0][k]) + t * (q[3][k] - q[0][k]);
                }
                if let Some((x, y)) = project(p, fov_deg, w, h) {
                    let (xi, yi) = (x.floor(), y.floor());
                    if xi >= 0.0 && yi >= 0.0 && (xi as usize) < w && (yi as usize) < h {
                        let o = (yi as usize * w + xi as usize) * 3;
                        let warm = frame[o] as i32 - frame[o + 2] as i32 >= WARM_FRAME;
                        samples[ty * TEX + tx][qi] =
                            Some((luma(frame[o], frame[o + 1], frame[o + 2]), warm));
                        if qi == 0 {
                            covered_by[ty * TEX + tx] =
                                texel_at_pixel(&quads[1], xi + 0.5, yi + 0.5, fov_deg, w, h);
                        }
                    }
                }
            }
        }
    }

    let mut out: Vec<RowScore> = Vec::with_capacity(ROWS);
    let (mut fv, mut tv) = (Vec::new(), Vec::new());
    for row in 0..ROWS {
        fv.clear();
        tv.clear();
        for ty in 0..TEX {
            for tx in 0..TEX {
                let i = ((row * TEX + ty) * TEX + tx) * 4;
                if sheet1[i + 3] == 0 {
                    continue;
                }
                let tl = luma(sheet1[i], sheet1[i + 1], sheet1[i + 2]);
                let tpl_warm = sheet1[i] as i32 - sheet1[i + 2] as i32 >= WARM_TEMPLATE;
                let [s0, s1] = samples[ty * TEX + tx];
                // a sample is dropped when the template says "orange here" but the frame is not: something (hotbar,
                // hearts, a menu) is drawn over the overlay at that pixel
                let usable = |s: Option<(f64, bool)>| {
                    s.filter(|&(_, warm)| warm || !tpl_warm).map(|(l, _)| l)
                };
                if let Some(v) = usable(s0) {
                    let hidden = covered_by[ty * TEX + tx]
                        .is_some_and(|(cx, cy)| sheet1[((row * TEX + cy) * TEX + cx) * 4 + 3] != 0);
                    if !hidden {
                        fv.push(v);
                        tv.push(tl);
                    }
                }
                if let Some(v) = usable(s1) {
                    fv.push(v);
                    tv.push(tl);
                }
            }
        }
        let n = fv.len();
        let score = if n < MIN_SAMPLES {
            -1.0
        } else {
            let (mf, mt) = (
                fv.iter().sum::<f64>() / n as f64,
                tv.iter().sum::<f64>() / n as f64,
            );
            let (mut cov, mut vf, mut vt) = (0.0, 0.0, 0.0);
            for k in 0..n {
                cov += (fv[k] - mf) * (tv[k] - mt);
                vf += (fv[k] - mf) * (fv[k] - mf);
                vt += (tv[k] - mt) * (tv[k] - mt);
            }
            if vf < 1e-9 || vt < 1e-9 {
                -1.0
            } else {
                (cov / (vf * vt).sqrt()).clamp(-1.0, 1.0)
            }
        };
        let z = if n < MIN_SAMPLES || score <= -1.0 {
            -100.0
        } else {
            score.clamp(-0.9999, 0.9999).atanh() * ((n - 3) as f64).sqrt()
        };
        out.push(RowScore {
            row: row as u8,
            score,
            z,
            samples: n,
        });
    }
    out.sort_by(|a, b| b.z.partial_cmp(&a.z).unwrap());
    Ok(out)
}

/// Silhouette matcher (see DETECT_PLAN.md, round 7b): which fire_1 row, and is the overlay there at all.
///
/// Probe pixels on a grid are mapped to the texel of each quad that covers them. A row predicts "orange" at a probe when
/// either covering texel is opaque. The frame is orange ("warm") where R >= 45, 5B <= R and 10G >= 3R. The row whose prediction
/// agrees best with the frame, over probes where rows disagree, wins; presence is how well that row separates warm from
/// not-warm probes.
pub struct SilhouetteMatcher {
    w: usize,
    h: usize,
    /// probe pixel offsets into the RGB frame (byte index of R)
    offsets: Vec<usize>,
    /// predicted orange per row, per probe
    pred: Vec<Vec<bool>>,
    /// indices into the probes whose prediction differs between rows
    disc: Vec<usize>,
    /// Opaque discriminating probe indices and expected G/R ratios, per row.
    colour_probes: Vec<Vec<(usize, f64)>>,
    /// Packed discriminating silhouettes: exact agreement via XOR/popcount.
    disc_bits: Vec<Vec<u64>>,
    /// Same per-row veil arithmetic as unveil_rows, sampled only at detector probes.
    veil_math: Vec<(f64, f64)>,
}

#[derive(Debug, Clone)]
pub struct SilhouetteResult {
    /// (row, agreement) best first; ties keep row order. Silhouette only.
    pub ranked: Vec<(u8, f64)>,
    /// (row, combined score) best first: silhouette agreement and colour match, each standardised over the 32 rows.
    pub ranked_colour: Vec<(u8, f64)>,
    /// Youden index of the best row: P(warm | predicted orange) - P(warm | predicted not orange).
    pub presence: f64,
    /// Best row's colour evidence in -1..1: (matching probes - mismatching probes) / probes the row expects opaque. Comparable
    /// across matchers built for different FOVs.
    pub colour_evidence: f64,
}

const MIN_PROBES: usize = 200;
/// An observed pixel matches the expected texel colour when its green/red ratio is within this of the texel's and it is not
/// too dark to tell. The value sits on a plateau: 0.04..0.08 all gave at least 94% on lava frames and at least 99% elsewhere
/// on the two recorded clips (see DETECT_PLAN.md, result 12).
const CHROMA_TOL: f64 = 0.06;
const CHROMA_MIN_RED: f64 = 25.0;
/// Weight of the standardised colour score against the standardised silhouette agreement.
const COLOUR_WEIGHT: f64 = 2.0;
/// Rows with fewer usable colour probes than this get no colour score.
const MIN_COLOUR_PROBES: usize = 5;

fn standardise(x: &[f64], valid: &[bool]) -> Vec<f64> {
    let vals: Vec<f64> = x
        .iter()
        .zip(valid)
        .filter(|(_, v)| **v)
        .map(|(a, _)| *a)
        .collect();
    if vals.is_empty() {
        return vec![-9.0; x.len()];
    }
    let mean = vals.iter().sum::<f64>() / vals.len() as f64;
    let sd = (vals.iter().map(|v| (v - mean) * (v - mean)).sum::<f64>() / vals.len() as f64).sqrt();
    let sd = if sd > 1e-12 { sd } else { 1.0 };
    x.iter()
        .zip(valid)
        .map(|(a, v)| if *v { (a - mean) / sd } else { -9.0 })
        .collect()
}

/// Fire orange: red-dominant, little blue, and green at least 30% of red (fire texels are >= 0.36; red lava fog is about 0.16).
fn is_warm(r: u8, g: u8, b: u8) -> bool {
    r >= 45 && (b as u32) * 5 <= r as u32 && (g as u32) * 10 >= (r as u32) * 3
}

impl SilhouetteMatcher {
    pub fn new(
        sheet1: &[u8],
        w: usize,
        h: usize,
        fov_deg: f64,
    ) -> Result<SilhouetteMatcher, String> {
        if sheet1.len() != SHEET_LEN {
            return Err(format!(
                "fire_1 must be {SHEET_LEN} bytes of RGBA, got {}",
                sheet1.len()
            ));
        }
        if w == 0 || h == 0 {
            return Err("frame size must be non-zero".into());
        }
        if !fov_deg.is_finite() || fov_deg <= 0.0 || fov_deg >= 180.0 {
            return Err(format!("fov must be in (0, 180) degrees: {fov_deg}"));
        }
        let quads = overlay_quads();
        let step = (w / 320).max(1);
        let mut offsets = Vec::new();
        let mut tex: Vec<[Option<usize>; 2]> = Vec::new();
        for y in (0..h).step_by(step) {
            for x in (0..w).step_by(step) {
                let (px, py) = (x as f64 + 0.5, y as f64 + 0.5);
                let t0 =
                    texel_at_pixel(&quads[0], px, py, fov_deg, w, h).map(|(tx, ty)| ty * TEX + tx);
                let t1 =
                    texel_at_pixel(&quads[1], px, py, fov_deg, w, h).map(|(tx, ty)| ty * TEX + tx);
                if t0.is_some() || t1.is_some() {
                    offsets.push((y * w + x) * 3);
                    tex.push([t0, t1]);
                }
            }
        }
        if offsets.len() < MIN_PROBES {
            return Err(format!(
                "only {} probe pixels fall on the overlay at {w}x{h}, fov {fov_deg}: too few",
                offsets.len()
            ));
        }
        let mut pred = vec![vec![false; offsets.len()]; ROWS];
        for (row, p) in pred.iter_mut().enumerate() {
            for (k, t) in tex.iter().enumerate() {
                p[k] = t
                    .iter()
                    .flatten()
                    .any(|&ti| sheet1[(row * TEX * TEX + ti) * 4 + 3] != 0);
            }
        }
        let mut col = vec![vec![None; offsets.len()]; ROWS];
        for (row, c) in col.iter_mut().enumerate() {
            for (k, t) in tex.iter().enumerate() {
                // quad 1 is drawn after quad 0, so its texel wins where it is opaque
                for ti in [t[1], t[0]].iter().flatten() {
                    let o = (row * TEX * TEX + ti) * 4;
                    if sheet1[o + 3] != 0 {
                        c[k] = Some([sheet1[o], sheet1[o + 1], sheet1[o + 2]]);
                        break;
                    }
                }
            }
        }
        let disc_col: Vec<usize> = (0..offsets.len())
            .filter(|&k| col.iter().any(|c| c[k] != col[0][k]))
            .collect();
        let disc: Vec<usize> = (0..offsets.len())
            .filter(|&k| {
                let first = pred[0][k];
                pred.iter().any(|p| p[k] != first)
            })
            .collect();
        if disc.is_empty() {
            return Err("no probe distinguishes the rows".into());
        }
        let colour_probes = col
            .iter()
            .map(|c| {
                disc_col
                    .iter()
                    .filter_map(|&k| c[k].map(|rgb| (k, rgb[1] as f64 / (rgb[0] as f64).max(1.0))))
                    .collect()
            })
            .collect();
        let disc_bits = pred
            .iter()
            .map(|p| {
                let mut words = vec![0u64; disc.len().div_ceil(64)];
                for (i, &k) in disc.iter().enumerate() {
                    if p[k] {
                        words[i / 64] |= 1u64 << (i % 64);
                    }
                }
                words
            })
            .collect();
        let veil_math = offsets
            .iter()
            .map(|&o| {
                let y = o / 3 / w;
                crate::veil::row_transform(y, h)
            })
            .collect();
        Ok(SilhouetteMatcher {
            w,
            h,
            offsets,
            pred,
            disc,
            colour_probes,
            disc_bits,
            veil_math,
        })
    }

    /// True when another row predicts exactly the same silhouette at every probe (nothing can tell them apart).
    pub fn same_silhouette_as_another(&self, row: u8) -> bool {
        let r = row as usize;
        r < ROWS && (0..ROWS).any(|o| o != r && self.pred[o] == self.pred[r])
    }

    pub fn match_frame(&self, frame: &[u8]) -> Result<SilhouetteResult, String> {
        self.match_sampled::<false>(frame, false, None)
    }

    /// Exact equivalent to match_frame(unveil_rows(frame)), without a full-frame allocation/pass.
    pub fn match_frame_veiled(&self, frame: &[u8]) -> Result<SilhouetteResult, String> {
        self.match_sampled::<false>(frame, true, None)
    }

    /// Experimental exclusion mask: nonzero pixels contribute neither agreement nor disagreement.
    /// All existing entry points retain their exact unmasked behavior.
    pub fn match_frame_excluding(
        &self,
        frame: &[u8],
        excluded: &[u8],
        veiled: bool,
    ) -> Result<SilhouetteResult, String> {
        if excluded.len() != self.w * self.h {
            return Err("exclusion mask dimensions do not match frame".into());
        }
        self.match_sampled::<true>(frame, veiled, Some(excluded))
    }

    fn match_sampled<const MASKED: bool>(
        &self,
        frame: &[u8],
        veiled: bool,
        excluded: Option<&[u8]>,
    ) -> Result<SilhouetteResult, String> {
        if frame.len() != self.w * self.h * 3 {
            return Err(format!(
                "frame must be {}x{} RGB24 ({} bytes), got {}",
                self.w,
                self.h,
                self.w * self.h * 3,
                frame.len()
            ));
        }
        // Compile the existing unmasked entry points without mask allocation or filtering.
        let active: Vec<bool> = if MASKED {
            self.offsets
                .iter()
                .map(|&o| excluded.unwrap()[o / 3] == 0)
                .collect()
        } else {
            Vec::new()
        };
        let mut usable = if MASKED {
            vec![0u64; self.disc.len().div_ceil(64)]
        } else {
            Vec::new()
        };
        let mut disc_count = self.disc.len();
        if MASKED {
            disc_count = 0;
            for (i, &k) in self.disc.iter().enumerate() {
                if active[k] {
                    usable[i / 64] |= 1u64 << (i % 64);
                    disc_count += 1;
                }
            }
        }
        let mut warm = Vec::with_capacity(self.offsets.len());
        let mut ratios = Vec::with_capacity(self.offsets.len());
        for (k, &o) in self.offsets.iter().enumerate() {
            let rgb = if veiled {
                let (bias, inv) = self.veil_math[k];
                std::array::from_fn(|i| crate::veil::restore_channel(frame[o + i], bias, inv))
            } else {
                [frame[o], frame[o + 1], frame[o + 2]]
            };
            warm.push(is_warm(rgb[0], rgb[1], rgb[2]));
            ratios.push(if rgb[0] as f64 >= CHROMA_MIN_RED {
                rgb[1] as f64 / rgb[0] as f64
            } else {
                f64::NAN
            });
        }
        let mut observed = vec![0u64; self.disc.len().div_ceil(64)];
        for (i, &k) in self.disc.iter().enumerate() {
            if warm[k] {
                observed[i / 64] |= 1u64 << (i % 64);
            }
        }
        let mut ranked: Vec<(u8, f64)> = (0..ROWS)
            .map(|row| {
                let differences: usize = if MASKED {
                    self.disc_bits[row]
                        .iter()
                        .zip(&observed)
                        .zip(&usable)
                        .map(|((a, b), mask)| ((a ^ b) & mask).count_ones() as usize)
                        .sum()
                } else {
                    self.disc_bits[row]
                        .iter()
                        .zip(&observed)
                        .map(|(a, b)| (a ^ b).count_ones() as usize)
                        .sum()
                };
                let agree = disc_count - differences;
                (row as u8, agree as f64 / disc_count.max(1) as f64)
            })
            .collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        let best = &self.pred[ranked[0].0 as usize];
        let (mut on, mut on_warm, mut off, mut off_warm) = (0usize, 0usize, 0usize, 0usize);
        for (k, &p) in best.iter().enumerate() {
            if MASKED && !active[k] {
                continue;
            }
            if p {
                on += 1;
                on_warm += warm[k] as usize;
            } else {
                off += 1;
                off_warm += warm[k] as usize;
            }
        }
        let rate = |a: usize, b: usize| if b == 0 { 0.0 } else { a as f64 / b as f64 };

        // colour evidence: where the row expects an opaque texel, the frame should show that texel's colour (up to a gain:
        // vignette, veil). Over an orange scene the warm test says nothing, but flat, exactly coloured squares on the
        // overlay's own grid do.
        let mut agree_by_row = vec![0.0f64; ROWS];
        for (row, a) in ranked.iter() {
            agree_by_row[*row as usize] = *a;
        }
        // Chromaticity, not raw colour: the green/red ratio of a pixel does not change under a vignette or a veil gain, and
        // lava fog (G/R about 0.16) is far from every fire texel (G/R >= 0.36) although it is close in raw colour.
        let mut m = vec![0.0f64; ROWS];
        let mut valid = vec![false; ROWS];
        let mut evidence = vec![0.0f64; ROWS];
        for row in 0..ROWS {
            let probes = &self.colour_probes[row];
            let count = if MASKED {
                probes.iter().filter(|&&(k, _)| active[k]).count()
            } else {
                probes.len()
            };
            if count < MIN_COLOUR_PROBES {
                continue;
            }
            let mut score = 0.0;
            for &(k, expected) in probes {
                if MASKED && !active[k] {
                    continue;
                }
                let hit = (ratios[k] - expected).abs() < CHROMA_TOL;
                score += if hit { 1.0 } else { -1.0 };
            }
            m[row] = score;
            evidence[row] = score / count as f64;
            valid[row] = true;
        }
        let all_valid = vec![true; ROWS];
        let z_sil = standardise(&agree_by_row, &all_valid);
        let z_col = standardise(&m, &valid);
        let mut ranked_colour: Vec<(u8, f64)> = (0..ROWS)
            .map(|r| (r as u8, z_sil[r] + COLOUR_WEIGHT * z_col[r]))
            .collect();
        ranked_colour.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        let colour_evidence = evidence[ranked_colour[0].0 as usize];
        Ok(SilhouetteResult {
            ranked,
            ranked_colour,
            presence: rate(on_warm, on) - rate(off_warm, off),
            colour_evidence,
        })
    }
}
