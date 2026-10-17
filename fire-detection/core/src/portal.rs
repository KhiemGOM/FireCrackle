//! Vanilla portal overlay: fit the animated RGBA layer, then reverse its blend.
//! The caller provides local game textures; no game assets are embedded here.

#[derive(Clone, Copy, Debug)]
pub struct Fit {
    pub detected: bool,
    pub phase: usize,
    /// Render colour alpha, before multiplication by each texture texel's alpha.
    pub opacity: f64,
    pub residual: f64,
    pub baseline: f64,
    pub improvement: f64,
    pub runner_up: f64,
    pub purple_share: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Guard {
    pub abstain: bool,
    /// Bit1=caller-supplied translucent world pixel; bit2=purple portal/effect candidate.
    pub flags: u32,
    pub largest_purple: usize,
    pub known_pixels: usize,
}

/// Conservative abstention, not a claim to infer arbitrary transparency from RGB.
/// Opaque purple materials may also trigger; callers must never interpret no hit as proof of opacity.
pub fn guard(
    rgb: &[u8],
    w: usize,
    h: usize,
    world_mask: Option<&[u8]>,
    known_translucent: Option<&[u8]>,
) -> Result<Guard, String> {
    if w.checked_mul(h).and_then(|n| n.checked_mul(3)) != Some(rgb.len())
        || w == 0
        || h == 0
        || world_mask.is_some_and(|m| m.len() != w * h)
        || known_translucent.is_some_and(|m| m.len() != w * h)
    {
        return Err("Invalid translucency guard buffers".into());
    }
    let mut candidates = vec![false; w * h];
    let mut known = 0;
    for i in 0..w * h {
        if world_mask.is_some_and(|m| m[i] == 0) {
            continue;
        }
        if known_translucent.is_some_and(|m| m[i] != 0) {
            known += 1;
        }
        let p = i * 3;
        let r = rgb[p] as f64;
        let g = rgb[p + 1] as f64;
        let b = rgb[p + 2] as f64;
        candidates[i] = b >= 48.0 && r > 1.4 * g && b > 1.15 * r && b > 1.7 * g;
    }
    let mut largest = 0;
    let mut queue = Vec::new();
    for start in 0..w * h {
        if !candidates[start] {
            continue;
        }
        candidates[start] = false;
        queue.clear();
        queue.push(start);
        let mut head = 0;
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            let x = i % w;
            let y = i / w;
            for yy in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                for xx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                    let j = yy * w + xx;
                    if candidates[j] {
                        candidates[j] = false;
                        queue.push(j);
                    }
                }
            }
        }
        largest = largest.max(queue.len());
    }
    let flags = (if known > 0 { 1 } else { 0 }) | (if largest >= 64 { 2 } else { 0 });
    Ok(Guard {
        abstain: flags != 0,
        flags,
        largest_purple: largest,
        known_pixels: known,
    })
}

fn validate(rgb: &[u8], w: usize, h: usize, atlas: &[u8], side: usize) -> Result<usize, String> {
    if w < 32 || h < 32 || w.checked_mul(h).and_then(|n| n.checked_mul(3)) != Some(rgb.len()) {
        return Err("Expected RGB24 image at least32x32".into());
    }
    let frame = side
        .checked_mul(side)
        .and_then(|n| n.checked_mul(4))
        .ok_or("Invalid texture size")?;
    if side < 2 || frame == 0 || atlas.is_empty() || !atlas.len().is_multiple_of(frame) {
        return Err("Expected square RGBA portal animation frames".into());
    }
    Ok(atlas.len() / frame)
}

fn texel(
    atlas: &[u8],
    side: usize,
    phase: usize,
    x: usize,
    y: usize,
    w: usize,
    h: usize,
) -> [f64; 4] {
    let u = (((x as f64 + 0.5) * side as f64 / w as f64).floor() as usize).min(side - 1);
    let v = (((y as f64 + 0.5) * side as f64 / h as f64).floor() as usize).min(side - 1);
    let p = ((phase * side + v) * side + u) * 4;
    [
        atlas[p] as f64,
        atlas[p + 1] as f64,
        atlas[p + 2] as f64,
        atlas[p + 3] as f64 / 255.0,
    ]
}

struct Pair {
    c: [[f64; 3]; 2],
    xy: [(usize, usize); 2],
}

fn pairs(rgb: &[u8], w: usize, h: usize, side: usize, mask: Option<&[u8]>) -> Vec<Pair> {
    let mut result = Vec::new();
    let mut push = |a: (usize, usize), b: (usize, usize)| {
        // Fit uses world-dominant interior; opaque UI is not part of portal rendering.
        if a.1 < h * 3 / 100 || a.1 >= h * 85 / 100 || a.0 >= w || b.0 >= w || b.1 >= h {
            return;
        }
        if mask.is_some_and(|m| m[a.1 * w + a.0] == 0 || m[b.1 * w + b.0] == 0) {
            return;
        }
        let read = |(x, y): (usize, usize)| {
            let p = (y * w + x) * 3;
            [rgb[p] as f64, rgb[p + 1] as f64, rgb[p + 2] as f64]
        };
        result.push(Pair {
            c: [read(a), read(b)],
            xy: [a, b],
        });
    };
    for edge in 1..side {
        let x = ((edge as f64 * w as f64 / side as f64).round() as usize).min(w - 1);
        let y = ((edge as f64 * h as f64 / side as f64).round() as usize).min(h - 1);
        for cell in 0..side {
            for f in [0.2, 0.4, 0.6, 0.8] {
                let yy = ((cell as f64 + f) * h as f64 / side as f64).floor() as usize;
                let xx = ((cell as f64 + f) * w as f64 / side as f64).floor() as usize;
                push((x.saturating_sub(3), yy), ((x + 3).min(w - 1), yy));
                push((xx, y.saturating_sub(3)), (xx, (y + 3).min(h - 1)));
            }
        }
    }
    result
}

fn trimmed(values: &mut [f64]) -> f64 {
    let n = (values.len() * 7 / 10).max(1);
    values.select_nth_unstable_by(n.min(values.len() - 1), |a, b| a.total_cmp(b));
    values[..n].iter().sum::<f64>() / n as f64
}

fn objective(pairs: &[Pair], layers: &[[[f64; 4]; 2]], f: f64) -> f64 {
    let mut errors = Vec::with_capacity(pairs.len());
    for (p, t) in pairs.iter().zip(layers) {
        let a = [f * t[0][3], f * t[1][3]];
        let q = [1.0 - a[0], 1.0 - a[1]];
        let mut error = 0.0;
        for (c, _) in p.c[0].iter().enumerate() {
            let s = [p.c[0][c] - a[0] * t[0][c], p.c[1][c] - a[1] * t[1][c]];
            error += (s[0] * q[1] - s[1] * q[0]).abs() / (q[0] + q[1]).max(0.02);
            // Wrong phases cannot claim an implausible negative/overexposed world.
            for i in 0..2 {
                error += 0.3 * ((-s[i] - 4.0).max(0.0) + (s[i] - 255.0 * q[i] - 4.0).max(0.0));
            }
        }
        errors.push(error / 3.0);
    }
    trimmed(&mut errors)
}

/// Fit the phase/opacity using artificial texture-grid boundaries, without fire labels.
/// `world_mask` is optional: 1=world allowed,0=GUI/unknown excluded from fitting/inverse.
pub fn fit(
    rgb: &[u8],
    w: usize,
    h: usize,
    atlas: &[u8],
    side: usize,
    world_mask: Option<&[u8]>,
) -> Result<Fit, String> {
    let frames = validate(rgb, w, h, atlas, side)?;
    if world_mask.is_some_and(|m| m.len() != w * h) {
        return Err("World mask dimensions differ".into());
    }
    let ps = pairs(rgb, w, h, side, world_mask);
    if ps.len() < 32 {
        return Err("Insufficient world samples".into());
    }
    let purple = ps
        .iter()
        .flat_map(|p| p.c)
        .filter(|c| c[2] > 40.0 && c[2] > 1.2 * c[0] && c[2] > 1.5 * c[1])
        .count() as f64
        / (ps.len() * 2) as f64;
    let mut raw: Vec<f64> = ps
        .iter()
        .map(|p| (0..3).map(|c| (p.c[0][c] - p.c[1][c]).abs()).sum::<f64>() / 6.0)
        .collect();
    let baseline = trimmed(&mut raw);
    let mut best = (f64::INFINITY, 0, 0.0);
    let mut per_phase = Vec::new();
    if purple >= 0.2 && baseline >= 0.1 {
        for phase in 0..frames {
            let layers: Vec<_> = ps
                .iter()
                .map(|p| p.xy.map(|(x, y)| texel(atlas, side, phase, x, y, w, h)))
                .collect();
            let mut local = (f64::INFINITY, 0.0);
            for step in 0..=40 {
                let f = step as f64 / 40.0;
                let score = objective(&ps, &layers, f);
                if score < local.0 {
                    local = (score, f);
                }
            }
            per_phase.push(local.0);
            if local.0 < best.0 {
                best = (local.0, phase, local.1);
            }
        }
        let layers: Vec<_> = ps
            .iter()
            .map(|p| p.xy.map(|(x, y)| texel(atlas, side, best.1, x, y, w, h)))
            .collect();
        let centre = best.2;
        for step in -10..=10 {
            let f = (centre + step as f64 * 0.0025).clamp(0.0, 1.0);
            let score = objective(&ps, &layers, f);
            if score < best.0 {
                best = (score, best.1, f);
            }
        }
    } else {
        best = (baseline, 0, 0.0);
    }
    let runner = per_phase
        .iter()
        .enumerate()
        .filter(|(p, _)| *p != best.1)
        .map(|(_, s)| *s)
        .fold(f64::INFINITY, f64::min);
    let improvement = if baseline > 0.0 {
        (baseline - best.0) / baseline
    } else {
        0.0
    };
    Ok(Fit {
        detected: best.2 >= 0.1 && improvement >= 0.35 && purple >= 0.2,
        phase: best.1,
        opacity: best.2,
        residual: best.0,
        baseline,
        improvement,
        runner_up: runner,
        purple_share: purple,
    })
}

/// Reverse a known fitted layer, preserving alpha/GUI outside the caller's world mask.
/// Returns a per-pixel validity map; badly conditioned pixels are left unchanged.
#[allow(clippy::too_many_arguments)] // Explicit image/atlas/mask dimensions also form the native/WASM ABI.
pub fn undo(
    rgb: &mut [u8],
    w: usize,
    h: usize,
    atlas: &[u8],
    side: usize,
    phase: usize,
    opacity: f64,
    world_mask: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let frames = validate(rgb, w, h, atlas, side)?;
    if phase >= frames
        || !opacity.is_finite()
        || !(0.0..=1.0).contains(&opacity)
        || world_mask.is_some_and(|m| m.len() != w * h)
    {
        return Err("Invalid portal inverse parameters".into());
    }
    let mut valid = vec![0; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if world_mask.is_some_and(|m| m[i] == 0) {
                continue;
            }
            let t = texel(atlas, side, phase, x, y, w, h);
            let a = opacity * t[3];
            let q = 1.0 - a;
            if q < 0.08 {
                continue;
            }
            let p = i * 3;
            let out = [0, 1, 2].map(|c| (rgb[p + c] as f64 - a * t[c]) / q);
            if out.iter().any(|&c| !(-24.0..=279.0).contains(&c)) {
                continue;
            }
            for c in 0..3 {
                rgb[p + c] = out[c].round().clamp(0.0, 255.0) as u8;
            }
            valid[i] = 1;
        }
    }
    Ok(valid)
}
