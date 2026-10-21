//! Planar yuv420p → packed rgb24 inside the scan workers, so the decoder pipe
//! carries 1.5 instead of 3 bytes per pixel and the colour conversion runs on
//! every worker instead of FFmpeg's single filter thread.
//!
//! Bit-identical to what the bundled FFmpeg (8.1.2, x86-64 SIMD swscale path)
//! produces for a BT.709 limited-range stream with `-pix_fmt rgb24`: the
//! 16-bit fixed-point arithmetic below was fitted against an exhaustive
//! synthetic frame covering every (Y, U, V) triple and verified on real decoded
//! frames (`fit_swscale.py`: 0 of 11,059,200 channel values differ). Chroma is
//! nearest-neighbour: one (U, V) per 2×2 luma block, as swscale does unscaled.

/// swscale: `roundToInt16(coeff << 13)` of the ITU-R 709 16.16 coefficients with
/// luma scaled by 255/219 (limited range), and `pmulhw` = high 16 bits of the
/// signed product (floor division by 65536).
const Y_COEFF: i32 = 9539;
const VR_COEFF: i32 = 14686;
const UB_COEFF: i32 = 17305;
const UG_COEFF: i32 = -1747;
const VG_COEFF: i32 = -4366;

struct Tables {
    y: [i16; 256],
    rv: [i16; 256],
    bu: [i16; 256],
    gu: [i16; 256],
    gv: [i16; 256],
}
fn mulhw(a: i32, coeff: i32) -> i16 {
    ((a * coeff) >> 16) as i16
}
fn tables() -> &'static Tables {
    static TABLES: std::sync::OnceLock<Tables> = std::sync::OnceLock::new();
    TABLES.get_or_init(|| {
        let mut t = Tables {
            y: [0; 256],
            rv: [0; 256],
            bu: [0; 256],
            gu: [0; 256],
            gv: [0; 256],
        };
        for i in 0..256 {
            let y = ((i as i32) << 3) - 128;
            let c = ((i as i32) << 3) - 1024;
            t.y[i] = mulhw(y, Y_COEFF);
            t.rv[i] = mulhw(c, VR_COEFF);
            t.bu[i] = mulhw(c, UB_COEFF);
            t.gu[i] = mulhw(c, UG_COEFF);
            t.gv[i] = mulhw(c, VG_COEFF);
        }
        t
    })
}
#[inline(always)]
fn clip(v: i32) -> u8 {
    // paddsw saturates to i16 (never reached with these magnitudes), packuswb to u8.
    v.clamp(0, 255) as u8
}

/// Convert `w`×`h` yuv420p (`src.len() == w*h*3/2`) into `dst` (`w*h*3`).
pub fn yuv420p_to_rgb24(src: &[u8], w: usize, h: usize, dst: &mut [u8]) {
    debug_assert_eq!(src.len(), w * h * 3 / 2);
    debug_assert_eq!(dst.len(), w * h * 3);
    let t = tables();
    let (y_plane, rest) = src.split_at(w * h);
    let cw = w / 2;
    let (u_plane, v_plane) = rest.split_at(cw * (h / 2));
    for y in 0..h {
        let yrow = &y_plane[y * w..(y + 1) * w];
        let urow = &u_plane[(y / 2) * cw..(y / 2 + 1) * cw];
        let vrow = &v_plane[(y / 2) * cw..(y / 2 + 1) * cw];
        let out = &mut dst[y * w * 3..(y + 1) * w * 3];
        for ((px, ys), (&u, &v)) in out
            .chunks_exact_mut(6)
            .zip(yrow.chunks_exact(2))
            .zip(urow.iter().zip(vrow))
        {
            let (rv, bu, g) = (
                t.rv[v as usize] as i32,
                t.bu[u as usize] as i32,
                t.gu[u as usize] as i32 + t.gv[v as usize] as i32,
            );
            for k in 0..2 {
                let luma = t.y[ys[k] as usize] as i32;
                px[k * 3] = clip(luma + rv);
                px[k * 3 + 1] = clip(luma + g);
                px[k * 3 + 2] = clip(luma + bu);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_fitted_swscale_samples() {
        // Values read from swscale_tables.json (R_YV / B_YU) produced by fit_swscale.py.
        let (w, h) = (2, 2);
        let mut dst = vec![0u8; 12];
        let mut src = vec![0u8; 6];
        for (y, u, v, rgb) in [(16u8, 128u8, 128u8, [0u8, 0, 0]), (235, 128, 128, [255, 255, 255]), (128, 128, 128, [130, 130, 130])] {
            src[..4].fill(y);
            src[4] = u;
            src[5] = v;
            yuv420p_to_rgb24(&src, w, h, &mut dst);
            assert_eq!(&dst[..3], &rgb, "Y{y} U{u} V{v}");
        }
    }
}
