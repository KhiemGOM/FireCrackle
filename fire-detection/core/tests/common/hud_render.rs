//! Test helpers shared by the first-person tests: a dim noisy scene and the game's first-person fire drawn over it
//! (both quads, 90% sprite over 10% scene), for a given row and FOV.
#![allow(dead_code)]
use fire_core::overlay::{overlay_quads, project};

pub fn rnd(seed: &mut u64) -> u32 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    (*seed >> 33) as u32
}

/// Dark grey noise, like a dim cave wall.
pub fn background(w: usize, h: usize, seed: u64) -> Vec<u8> {
    let mut s = seed;
    let mut f = vec![0u8; w * h * 3];
    for p in f.chunks_mut(3) {
        let v = 30 + (rnd(&mut s) % 70) as u8;
        p.copy_from_slice(&[v, v, v]);
    }
    f
}

/// What the game draws: both quads (the second over the first), 90% sprite over 10% scene, then optional darkening.
/// Rendered by dense sub-sampling of every opaque texel.
pub fn render_fov(
    sheet: &[u8],
    row: usize,
    w: usize,
    h: usize,
    bg: Vec<u8>,
    gain: f64,
    fov: f64,
) -> Vec<u8> {
    let mut frame = bg;
    let scene = frame.clone();
    let q = overlay_quads();
    let sub = 72usize; // texels are ~40 px here: sub-sample densely so no pixel inside a texel stays unpainted
    for quad in &q {
        for ty in 0..16 {
            for tx in 0..16 {
                let i = ((row * 16 + ty) * 16 + tx) * 4;
                if sheet[i + 3] == 0 {
                    continue;
                }
                for sy in 0..sub {
                    for sx in 0..sub {
                        let u = (tx as f64 + (sx as f64 + 0.5) / sub as f64) / 16.0;
                        let v = (ty as f64 + (sy as f64 + 0.5) / sub as f64) / 16.0;
                        let (s, t) = (1.0 - u, 1.0 - v);
                        let mut p = [0.0; 3];
                        for k in 0..3 {
                            p[k] = quad[0][k]
                                + s * (quad[1][k] - quad[0][k])
                                + t * (quad[3][k] - quad[0][k]);
                        }
                        if let Some((x, y)) = project(p, fov, w, h) {
                            let (xi, yi) = (x.floor(), y.floor());
                            if xi >= 0.0 && yi >= 0.0 && (xi as usize) < w && (yi as usize) < h {
                                let o = (yi as usize * w + xi as usize) * 3;
                                for k in 0..3 {
                                    frame[o + k] = (0.9 * sheet[i + k] as f64
                                        + 0.1 * scene[o + k] as f64)
                                        as u8;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    for b in frame.iter_mut() {
        *b = (*b as f64 * gain).round().clamp(0.0, 255.0) as u8;
    }
    frame
}
