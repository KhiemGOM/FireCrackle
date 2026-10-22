//! Planar yuv420p → packed rgb24, bit-identical to what the bundled FFmpeg's
//! swscale produces for `-pix_fmt rgb24`, so a scan can take half the bytes
//! over the decoder pipe and convert in its workers.
//!
//! swscale's x86 path works in 16-bit fixed point: `y = 8·Y − 128`,
//! `c = 8·C − 1024`, products with `roundToInt16(coeff << 13)` of the ITU
//! 16.16 coefficients (luma scaled by 255/219 for limited range) taken as the
//! high 16 bits (`pmulhw`, a floor), summed and saturated to a byte. Chroma is
//! nearest-neighbour: one (U, V) per 2×2 luma block. The coefficients below
//! were fitted against exhaustive synthetic frames and verified on real decoded
//! frames (`fire-detection/perf-lab/fit_swscale.py`: 0 differing values).
//!
//! swscale chooses the matrix from the stream's colour-space tag and falls back
//! to BT.601 when it is unspecified, at any resolution; `Matrix::for_colour_space`
//! mirrors that. Streams tagged with another matrix are not handled here: let
//! FFmpeg convert them.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Matrix {
    Bt709,
    Bt601,
}
impl Matrix {
    /// The matrix swscale applies for an ffprobe `color_space` value, or `None`
    /// when the stream needs a conversion this module does not reproduce.
    pub fn for_colour_space(tag: &str) -> Option<Matrix> {
        match tag.trim() {
            "bt709" => Some(Matrix::Bt709),
            "" | "unknown" | "unspecified" | "bt470bg" | "smpte170m" => Some(Matrix::Bt601),
            _ => None,
        }
    }
    /// (vr, ub, ug, vg): `roundToInt16(coeff << 13)` of swscale's inverse tables.
    fn coefficients(self) -> (i32, i32, i32, i32) {
        match self {
            Matrix::Bt709 => (14686, 17305, -1747, -4366),
            Matrix::Bt601 => (13075, 16525, -3209, -6660),
        }
    }
}
const Y_COEFF: i32 = 9539;

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
fn tables(matrix: Matrix) -> &'static Tables {
    static BT709: std::sync::OnceLock<Tables> = std::sync::OnceLock::new();
    static BT601: std::sync::OnceLock<Tables> = std::sync::OnceLock::new();
    let cell = match matrix {
        Matrix::Bt709 => &BT709,
        Matrix::Bt601 => &BT601,
    };
    cell.get_or_init(|| {
        let (vr, ub, ug, vg) = matrix.coefficients();
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
            t.rv[i] = mulhw(c, vr);
            t.bu[i] = mulhw(c, ub);
            t.gu[i] = mulhw(c, ug);
            t.gv[i] = mulhw(c, vg);
        }
        t
    })
}
#[inline(always)]
fn clip(v: i32) -> u8 {
    v.clamp(0, 255) as u8
}

/// Bytes of one `w`×`h` yuv420p frame.
pub fn frame_bytes(w: usize, h: usize) -> usize {
    w * h + 2 * (w / 2) * (h / 2)
}

/// Convert `w`×`h` yuv420p (`src.len() == frame_bytes(w, h)`, even dimensions)
/// into `dst` (`w*h*3`).
pub fn yuv420p_to_rgb24(
    src: &[u8],
    w: usize,
    h: usize,
    matrix: Matrix,
    dst: &mut [u8],
) -> Result<(), String> {
    if !w.is_multiple_of(2)
        || !h.is_multiple_of(2)
        || src.len() != frame_bytes(w, h)
        || dst.len() != w * h * 3
    {
        return Err(format!(
            "yuv420p frame must be even-sized, {} + {} bytes for {w}x{h}; got {} and {}",
            frame_bytes(w, h),
            w * h * 3,
            src.len(),
            dst.len()
        ));
    }
    let t = tables(matrix);
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// swscale's arithmetic written out independently of the tables.
    fn reference(y: u8, u: u8, v: u8, matrix: Matrix) -> [u8; 3] {
        let (vr, ub, ug, vg) = matrix.coefficients();
        let hi = |a: i32, c: i32| (a * c) >> 16;
        let (y, u, v) = (
            (y as i32) * 8 - 128,
            (u as i32) * 8 - 1024,
            (v as i32) * 8 - 1024,
        );
        let luma = hi(y, Y_COEFF);
        [
            (luma + hi(v, vr)).clamp(0, 255) as u8,
            (luma + hi(u, ug) + hi(v, vg)).clamp(0, 255) as u8,
            (luma + hi(u, ub)).clamp(0, 255) as u8,
        ]
    }

    fn convert(y: u8, u: u8, v: u8, matrix: Matrix) -> [u8; 3] {
        let src = [y, y, y, y, u, v];
        let mut dst = [0u8; 12];
        yuv420p_to_rgb24(&src, 2, 2, matrix, &mut dst).unwrap();
        assert_eq!(
            &dst[..3],
            &dst[9..],
            "all four pixels share the block's chroma"
        );
        [dst[0], dst[1], dst[2]]
    }

    #[test]
    fn matches_values_fitted_from_ffmpeg_output() {
        // Values read from the fitted BT.709 tables (fit_swscale.py).
        assert_eq!(convert(16, 128, 128, Matrix::Bt709), [0, 0, 0]);
        assert_eq!(convert(235, 128, 128, Matrix::Bt709), [255, 255, 255]);
        assert_eq!(convert(128, 128, 128, Matrix::Bt709), [130, 130, 130]);
        assert_eq!(convert(100, 128, 200, Matrix::Bt709)[0], 226);
        assert_eq!(convert(100, 60, 128, Matrix::Bt709)[2], 0);
    }

    #[test]
    fn tables_agree_with_the_written_out_arithmetic_for_both_matrices() {
        for matrix in [Matrix::Bt709, Matrix::Bt601] {
            for y in (0..=255).step_by(5) {
                for u in (0..=255).step_by(17) {
                    for v in (0..=255).step_by(13) {
                        assert_eq!(
                            convert(y, u, v, matrix),
                            reference(y, u, v, matrix),
                            "{matrix:?} {y} {u} {v}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn colour_space_tags_follow_swscale() {
        assert_eq!(Matrix::for_colour_space("bt709"), Some(Matrix::Bt709));
        for tag in ["", "unknown", "unspecified", "bt470bg", "smpte170m"] {
            assert_eq!(Matrix::for_colour_space(tag), Some(Matrix::Bt601), "{tag}");
        }
        assert_eq!(Matrix::for_colour_space("bt2020nc"), None);
    }

    #[test]
    fn rejects_odd_sizes_and_wrong_lengths() {
        let mut dst = vec![0u8; 3 * 3 * 3];
        assert!(yuv420p_to_rgb24(&[0; 12], 3, 3, Matrix::Bt709, &mut dst).is_err());
        let mut dst = vec![0u8; 2 * 2 * 3];
        assert!(yuv420p_to_rgb24(&[0; 5], 2, 2, Matrix::Bt709, &mut dst).is_err());
        assert_eq!(frame_bytes(1920, 1080), 1920 * 1080 * 3 / 2);
    }
}
