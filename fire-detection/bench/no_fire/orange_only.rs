//! Orange-only deterministic evidence. White/pale pixels never contribute.
#[path = "../../core/src/veil.rs"]
#[allow(dead_code)]
mod shared_veil;
use std::io::{self, Read, Write};

fn orange(c: [u8; 3]) -> bool {
    let [r, g, b] = c.map(|v| v as f64);
    r >= 64. && g >= 0.23 * r && g <= 0.88 * r && b <= 0.5 * r && r - b >= 24.
}
fn veiled_margin(rgb: &[u8], w: usize, h: usize, divisor: usize) -> bool {
    shared_veil::strict_pixels(
        rgb,
        w,
        h,
        3,
        12.min(h - 1),
        shared_veil::Options {
            margin: 1.0 / divisor as f64,
            ..Default::default()
        },
    )
    .expect("valid RGB")
}
fn veiled_base(rgb: &[u8], w: usize, h: usize) -> bool {
    veiled_margin(rgb, w, h, 5) || veiled_margin(rgb, w, h, 10)
}
fn gui_colour(c: [u8; 3]) -> bool {
    shared_veil::gui_colour(&c)
}
fn veiled(rgb: &[u8], w: usize, h: usize) -> bool {
    shared_veil::detect_veil(rgb, w, h, 12.min(h - 1)).expect("valid RGB")
}

fn mask(rgb: &[u8], w: usize, h: usize, undo: bool) -> (Vec<u8>, Vec<u8>) {
    let mut m = vec![0u8; w * h];
    let mut red = vec![0u8; w * h];
    for y in 12..h {
        let (bias, inverse) = shared_veil::row_transform(y, h);
        for x in 0..w {
            let p = (y * w + x) * 3;
            let mut c = [rgb[p], rgb[p + 1], rgb[p + 2]];
            if undo {
                c = c.map(|v| shared_veil::restore_channel(v, bias, inverse));
            }
            m[y * w + x] = orange(c) as u8;
            red[y * w + x] = c[0];
        }
    }
    (m, red)
}
fn hud(m: &mut [u8], w: usize, h: usize) {
    for y in 0..h {
        for x in 0..w {
            if (y >= h * 88 / 100 && x >= w / 4 && x < w * 3 / 4)
                || (y < h * 18 / 100 && x >= w * 85 / 100)
            {
                m[y * w + x] = 0;
            }
        }
    }
}
fn integral(m: &[u8], w: usize, h: usize) -> Vec<u32> {
    let mut v = vec![0u32; (w + 1) * (h + 1)];
    for y in 0..h {
        let mut row = 0;
        for x in 0..w {
            row += m[y * w + x] as u32;
            v[(y + 1) * (w + 1) + x + 1] = v[y * (w + 1) + x + 1] + row;
        }
    }
    v
}
fn local(v: &[u32], w: usize, h: usize, side: usize) -> u32 {
    let s = side.min(w).min(h);
    let step = (s / 2).max(1);
    let mut best = 0;
    let mut ys: Vec<_> = (0..=h - s).step_by(step).collect();
    ys.push(h - s);
    let mut xs: Vec<_> = (0..=w - s).step_by(step).collect();
    xs.push(w - s);
    for &y in &ys {
        for &x in &xs {
            let stride = w + 1;
            // Signed arithmetic avoids unsigned intermediate subtraction underflow.
            let count = v[(y + s) * stride + x + s] as i64 + v[y * stride + x] as i64
                - v[y * stride + x + s] as i64
                - v[(y + s) * stride + x] as i64;
            best = best.max(count as u32);
        }
    }
    best
}
fn evidence(m: &[u8], red: &[u8], w: usize, h: usize) -> String {
    let count: usize = m.iter().map(|&v| v as usize).sum();
    let mut seen = vec![false; m.len()];
    let mut queue = Vec::new();
    let mut largest = 0;
    for p in 0..m.len() {
        if m[p] == 0 || seen[p] {
            continue;
        }
        queue.clear();
        queue.push(p);
        seen[p] = true;
        let mut i = 0;
        while i < queue.len() {
            let q = queue[i];
            i += 1;
            let (x, y) = (q % w, q / w);
            for yy in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                for xx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                    let n = yy * w + xx;
                    if m[n] != 0 && !seen[n] {
                        seen[n] = true;
                        queue.push(n);
                    }
                }
            }
        }
        largest = largest.max(queue.len());
    }
    let mut textured = vec![0u8; m.len()];
    for y in 0..h {
        for x in 0..w {
            let p = y * w + x;
            if m[p] == 0 {
                continue;
            }
            for q in [
                if x + 1 < w { p + 1 } else { p },
                if y + 1 < h { p + w } else { p },
            ] {
                // Only contrast BETWEEN two orange pixels counts; white neighbours do not.
                if m[q] != 0 && red[p].abs_diff(red[q]) >= 24 {
                    textured[p] = 1;
                    textured[q] = 1;
                }
            }
        }
    }
    let sums = integral(m, w, h);
    let tex = integral(&textured, w, h);
    format!("{{\"pixels\":{},\"single\":{},\"local24\":{},\"local48\":{},\"local96\":{},\"texture24\":{},\"texture48\":{},\"texture96\":{}}}",count,largest,
        local(&sums,w,h,24),local(&sums,w,h,48),local(&sums,w,h,96),local(&tex,w,h,24),local(&tex,w,h,48),local(&tex,w,h,96))
}
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let w: usize = a[1].parse().unwrap();
    let h: usize = a[2].parse().unwrap();
    assert!(w > 0 && h > 12);
    let patch = a
        .get(3)
        .map(|v| v == "--new-auto-only" || v == "--gui-auto-only")
        .unwrap_or(false);
    let gui_patch = a.get(3).map(|v| v == "--gui-auto-only").unwrap_or(false);
    let mut input = io::stdin().lock();
    let mut output = io::BufWriter::new(io::stdout().lock());
    let mut rgb = vec![0u8; w * h * 3];
    loop {
        if input.read(&mut rgb[..1]).unwrap() == 0 {
            break;
        }
        input.read_exact(&mut rgb[1..]).expect("truncated frame");
        if patch {
            let extra = if gui_patch {
                !veiled_base(&rgb, w, h) && veiled(&rgb, w, h)
            } else {
                !veiled_margin(&rgb, w, h, 5) && veiled(&rgb, w, h)
            };
            if extra {
                let (mut m, r) = mask(&rgb, w, h, true);
                let auto = evidence(&m, &r, w, h);
                hud(&mut m, w, h);
                let auto_nohud = evidence(&m, &r, w, h);
                writeln!(
                    output,
                    "{{\"extra\":true,\"auto\":{},\"auto_nohud\":{}}}",
                    auto, auto_nohud
                )
                .unwrap();
            } else {
                writeln!(output, "{{\"extra\":false}}").unwrap();
            }
            output.flush().unwrap();
            continue;
        }
        let (mut m, r) = mask(&rgb, w, h, false);
        let raw = evidence(&m, &r, w, h);
        hud(&mut m, w, h);
        let raw_nohud = evidence(&m, &r, w, h);
        let undo = veiled(&rgb, w, h);
        let (auto, auto_nohud) = if undo {
            let (mut m, r) = mask(&rgb, w, h, true);
            let auto = evidence(&m, &r, w, h);
            hud(&mut m, w, h);
            (auto, evidence(&m, &r, w, h))
        } else {
            (raw.clone(), raw_nohud.clone())
        };
        writeln!(
            output,
            "{{\"raw\":{},\"auto\":{},\"raw_nohud\":{},\"auto_nohud\":{},\"unveiled\":{}}}",
            raw, auto, raw_nohud, auto_nohud, undo
        )
        .unwrap();
        output.flush().unwrap();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn white_never_counts() {
        assert!(!orange([255, 255, 255]));
        assert!(!orange([150, 150, 150]));
        assert!(orange([230, 130, 20]));
    }
    #[test]
    fn boundary_windows_covered() {
        let mut m = vec![0; 100];
        m[99] = 1;
        assert_eq!(local(&integral(&m, 10, 10), 10, 10, 4), 1);
    }
    #[test]
    fn white_cannot_provide_texture() {
        let mut m = vec![0; 100];
        let mut r = vec![255; 100];
        m[55] = 1;
        r[55] = 100;
        let e = evidence(&m, &r, 10, 10);
        assert!(e.contains("\"texture24\":0"));
        assert!(e.contains("\"single\":1"));
    }
    #[test]
    fn auto_unveil_survives_menu_panel_in_wide_margin() {
        let (w, h) = (100, 100);
        let mut rgb = vec![20u8; w * h * 3];
        for y in 12..h {
            for x in 10..20 {
                let p = (y * w + x) * 3;
                rgb[p..p + 3].fill(220);
            }
        }
        assert!(!veiled_margin(&rgb, w, h, 5));
        assert!(veiled(&rgb, w, h));
        rgb.fill(220);
        assert!(!veiled(&rgb, w, h));
    }
    #[test]
    fn known_gui_grey_and_tooltip_are_neutral_not_background() {
        let (w, h) = (100, 100);
        let mut rgb = vec![20u8; w * h * 3];
        for y in 12..h {
            for x in (0..5).chain(95..100) {
                let p = (y * w + x) * 3;
                rgb[p..p + 3].copy_from_slice(&[16, 0, 16]);
            }
        }
        assert!(!veiled_base(&rgb, w, h));
        assert!(veiled(&rgb, w, h));
        rgb.fill(139);
        assert!(!veiled(&rgb, w, h));
        rgb.fill(0);
        assert!(!veiled(&rgb, w, h));
        assert!(!gui_colour([0, 0, 0]));
        assert!(gui_colour([139, 141, 138]));
        assert!(!orange([139, 141, 138]));
    }
}
