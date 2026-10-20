//! Nearby orange fragments: dilation joins components, but only original orange
//! pixels contribute area. GUI rectangles are a diagnostic proxy, never oracle.
#[path = "../../core/src/veil.rs"]
#[allow(dead_code)]
mod shared_veil;
use std::io::{self, Read, Write};

fn orange(c: &[u8]) -> bool {
    let (r, g, b) = (c[0] as f64, c[1] as f64, c[2] as f64);
    r >= 64. && g >= r * 0.23 && g <= r * 0.88 && b <= r * 0.5 && r - b >= 24.
}
pub(crate) fn mask(rgb: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut m = vec![0; w * h];
    for p in 12 * w..w * h {
        m[p] = orange(&rgb[3 * p..3 * p + 3]) as u8;
    }
    m
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
fn dilate(m: &[u8], w: usize, h: usize, r: usize) -> Vec<u8> {
    if r == 0 {
        return m.to_vec();
    }
    let mut horiz = vec![0; w * h];
    let mut out = vec![0; w * h];
    for y in 0..h {
        let mut count: u32 = m[y * w..y * w + (r + 1).min(w)]
            .iter()
            .map(|&x| x as u32)
            .sum();
        for x in 0..w {
            horiz[y * w + x] = (count > 0) as u8;
            if x >= r {
                count -= m[y * w + x - r] as u32;
            }
            if x + r + 1 < w {
                count += m[y * w + x + r + 1] as u32;
            }
        }
    }
    // Same vertical sliding window, visiting contiguous rows instead of
    // striding an entire 1080p image once per column.
    let mut counts = vec![0u32; w];
    for row in horiz[..(r + 1).min(h) * w].chunks_exact(w) {
        for (count, &value) in counts.iter_mut().zip(row) {
            *count += value as u32;
        }
    }
    for y in 0..h {
        for (pixel, &count) in out[y * w..(y + 1) * w].iter_mut().zip(&counts) {
            *pixel = (count > 0) as u8;
        }
        if y >= r {
            for (count, &value) in counts.iter_mut().zip(&horiz[(y - r) * w..(y - r + 1) * w]) {
                *count -= value as u32;
            }
        }
        if y + r + 1 < h {
            for (count, &value) in counts
                .iter_mut()
                .zip(&horiz[(y + r + 1) * w..(y + r + 2) * w])
            {
                *count += value as u32;
            }
        }
    }
    out
}
pub(crate) fn largest(m: &[u8], w: usize, h: usize, r: usize) -> usize {
    largest_capped(m, w, h, r, usize::MAX)
}
/// Exact threshold decision without traversing the rest of an already-large component.
pub(crate) fn reaches(m: &[u8], w: usize, h: usize, r: usize, threshold: usize) -> bool {
    largest_capped(m, w, h, r, threshold) >= threshold
}
fn largest_capped(m: &[u8], w: usize, h: usize, r: usize, limit: usize) -> usize {
    let mut d = dilate(m, w, h, r);
    let mut queue = Vec::new();
    let mut best = 0;
    for p in 0..m.len() {
        if d[p] == 0 {
            continue;
        }
        queue.clear();
        queue.push(p);
        d[p] = 0;
        let mut i = 0;
        let mut area = 0;
        while i < queue.len() {
            let p = queue[i];
            i += 1;
            area += m[p] as usize;
            if area >= limit {
                return area;
            }
            let (x, y) = (p % w, p / w);
            for yy in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                for xx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                    let q = yy * w + xx;
                    if d[q] != 0 {
                        d[q] = 0;
                        queue.push(q);
                    }
                }
            }
        }
        best = best.max(area);
    }
    best
}

#[cfg(test)]
mod dilation_parity {
    use super::dilate;
    #[test]
    fn contiguous_pass_is_exact_square_dilation_at_edges_and_small_images() {
        for (w, h) in [(1usize, 1usize), (3, 7), (64, 48)] {
            let m: Vec<u8> = (0..w * h)
                .map(|n| u8::from((n * 7919 + n * n * 17) % 101 < 7))
                .collect();
            for radius in [0, 1, 4, 9] {
                let expected: Vec<u8> = (0..w * h)
                    .map(|n| {
                        let (x, y) = (n % w, n / w);
                        u8::from(
                            (y.saturating_sub(radius)..=(y + radius).min(h - 1)).any(|yy| {
                                (x.saturating_sub(radius)..=(x + radius).min(w - 1))
                                    .any(|xx| m[yy * w + xx] != 0)
                            }),
                        )
                    })
                    .collect();
                assert_eq!(
                    dilate(&m, w, h, radius),
                    expected,
                    "{w}x{h}, radius {radius}"
                );
            }
        }
    }
}
fn evidence(m: &[u8], w: usize, h: usize) -> String {
    format!(
        "{{\"r0\":{},\"r1\":{},\"r2\":{},\"r4\":{}}}",
        largest(m, w, h, 0),
        largest(m, w, h, 1),
        largest(m, w, h, 2),
        largest(m, w, h, 4)
    )
}
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let w: usize = a[1].parse().unwrap();
    let h: usize = a[2].parse().unwrap();
    assert!(w > 0 && h > 12);
    let mut rgb = vec![0; w * h * 3];
    let mut input = io::stdin().lock();
    let mut output = io::BufWriter::new(io::stdout().lock());
    loop {
        if input.read(&mut rgb[..1]).unwrap() == 0 {
            break;
        }
        input.read_exact(&mut rgb[1..]).expect("truncated frame");
        let mut m = mask(&rgb, w, h);
        let raw = evidence(&m, w, h);
        hud(&mut m, w, h);
        let raw_nohud = evidence(&m, w, h);
        let undo = shared_veil::detect_veil(&rgb, w, h, 12).unwrap();
        let (auto, auto_nohud) = if undo {
            let corrected = shared_veil::unveil_rgb(&rgb, w, h).unwrap();
            let mut m = mask(&corrected, w, h);
            let a = evidence(&m, w, h);
            hud(&mut m, w, h);
            (a, evidence(&m, w, h))
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
    fn joins_without_inflating_area() {
        let mut m = vec![0; 20 * 20];
        m[21] = 1;
        m[24] = 1;
        assert_eq!(largest(&m, 20, 20, 0), 1);
        assert_eq!(largest(&m, 20, 20, 1), 2);
    }
    #[test]
    fn respects_radius() {
        let mut m = vec![0; 20 * 20];
        m[21] = 1;
        m[27] = 1;
        assert_eq!(largest(&m, 20, 20, 2), 1);
        assert_eq!(largest(&m, 20, 20, 4), 2);
    }
    #[test]
    fn white_not_orange() {
        assert!(!orange(&[255, 255, 255]));
        assert!(orange(&[230, 130, 20]));
    }
    #[test]
    fn dilation_corner() {
        let mut m = vec![0; 100];
        m[99] = 1;
        assert_eq!(dilate(&m, 10, 10, 1).iter().sum::<u8>(), 4);
    }
}
#[cfg(test)]
mod capped_tests {
    use super::*;
    #[test]
    fn capped_components_equal_full_threshold_decisions() {
        for seed in 0..10 {
            let m: Vec<_> = (0..64 * 48)
                .map(|i| ((i * 31 + seed * 17) % 37 < seed) as u8)
                .collect();
            for radius in [0, 1, 4] {
                for threshold in [1, 15, 128, 2198] {
                    assert_eq!(
                        reaches(&m, 64, 48, radius, threshold),
                        largest(&m, 64, 48, radius) >= threshold
                    );
                }
            }
        }
    }
}
