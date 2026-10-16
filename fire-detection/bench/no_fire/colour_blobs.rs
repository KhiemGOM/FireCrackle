//! Offline connected orange/pale-region experiment. No external dependencies.
use std::collections::HashSet;
use std::io::{self, Read, Write};

#[derive(Default, Clone)]
struct Region {
    colour: u8,
    n: usize,
    sx: f64,
    sy: f64,
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
}
#[derive(Default, Debug)]
struct Evidence {
    pixels: usize,
    single: usize,
    pair: usize,
    separated: usize,
    bbox: [usize; 4],
}

fn classify(c: [u8; 3], yellow: bool) -> u8 {
    let [r, g, b] = c.map(|x| x as f64);
    // Disjoint warm orange and pale yellow/white bands, frozen before scoring.
    let pale = if yellow {
        g >= 0.6 * r && r >= 0.9 * g
    } else {
        g >= 0.65 * r && b >= 0.35 * r && r >= 0.85 * g
    };
    if r >= 110. && pale && b <= 1.1 * r && g >= 0.85 * b {
        2
    } else if r >= 64. && g >= 0.23 * r && g <= 0.88 * r && b <= 0.5 * r && r - b >= 24. {
        1
    } else {
        0
    }
}

fn evidence(mask: &[u8], w: usize, h: usize) -> Evidence {
    let mut labels = vec![0u32; mask.len()];
    let mut regions = vec![Region::default()];
    let mut queue = Vec::new();
    let mut out = Evidence::default();
    for start in 0..mask.len() {
        if mask[start] == 0 || labels[start] != 0 {
            continue;
        }
        let id = regions.len() as u32;
        let mut r = Region {
            colour: mask[start],
            x0: w,
            y0: h,
            ..Region::default()
        };
        queue.clear();
        queue.push(start);
        labels[start] = id;
        let mut head = 0;
        while head < queue.len() {
            let p = queue[head];
            head += 1;
            let x = p % w;
            let y = p / w;
            r.n += 1;
            r.sx += x as f64;
            r.sy += y as f64;
            r.x0 = r.x0.min(x);
            r.y0 = r.y0.min(y);
            r.x1 = r.x1.max(x);
            r.y1 = r.y1.max(y);
            for ny in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                for nx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                    let q = ny * w + nx;
                    if labels[q] == 0 && mask[q] == r.colour {
                        labels[q] = id;
                        queue.push(q);
                    }
                }
            }
        }
        out.pixels += r.n;
        out.single = out.single.max(r.n);
        regions.push(r);
    }
    // Each side must be its own connected region, with actual 8-neighbour contact.
    // Far-apart orange and white blobs never form a pair.
    let mut pairs = HashSet::new();
    for y in 0..h {
        for x in 0..w {
            let p = y * w + x;
            let a = labels[p];
            if a == 0 {
                continue;
            }
            for (dx, dy) in [(1isize, 0isize), (-1, 1), (0, 1), (1, 1)] {
                let xx = x as isize + dx;
                let yy = y as isize + dy;
                if xx < 0 || xx >= w as isize || yy >= h as isize {
                    continue;
                }
                let q = yy as usize * w + xx as usize;
                let b = labels[q];
                if b != 0 && mask[p] != mask[q] {
                    pairs.insert((a.min(b), a.max(b)));
                }
            }
        }
    }
    for (a, b) in pairs {
        let a = &regions[a as usize];
        let b = &regions[b as usize];
        let n = a.n + b.n;
        if a.n.min(b.n) < 2 || a.n.min(b.n) as f64 / (n as f64) < 0.05 {
            continue;
        }
        let bounds = [
            a.x0.min(b.x0),
            a.y0.min(b.y0),
            a.x1.max(b.x1),
            a.y1.max(b.y1),
        ];
        out.pair = out.pair.max(n);
        let distance = ((a.sx / a.n as f64 - b.sx / b.n as f64).powi(2)
            + (a.sy / a.n as f64 - b.sy / b.n as f64).powi(2))
        .sqrt();
        let diagonal = (((bounds[2] - bounds[0] + 1).pow(2) + (bounds[3] - bounds[1] + 1).pow(2))
            as f64)
            .sqrt();
        // Rotation-independent separation of the two colour-region centroids.
        if distance / diagonal >= 0.12 && n > out.separated {
            out.separated = n;
            out.bbox = bounds;
        }
    }
    out
}

fn veiled(rgb: &[u8], w: usize, h: usize) -> bool {
    let mut hit = 0usize;
    let mut total = 0usize;
    for y in 12..h {
        let alpha = (192. + (y as f64 + 0.5) * 16. / h as f64) / 255.;
        let upper = (16. * alpha + 255. * (1. - alpha) + 2.).floor() as u8;
        for x in (0..w / 5).chain(w - w / 5..w) {
            let p = (y * w + x) * 3;
            hit += rgb[p..p + 3].iter().all(|&c| c >= 11 && c <= upper) as usize;
            total += 1;
        }
    }
    total > 0 && hit as f64 / total as f64 >= 0.9
}

fn mask(rgb: &[u8], w: usize, h: usize, undo: bool, yellow: bool) -> Vec<u8> {
    let mut result = vec![0u8; w * h];
    for y in 12..h {
        let alpha = (192. + (y as f64 + 0.5) * 16. / h as f64) / 255.;
        for x in 0..w {
            let p = (y * w + x) * 3;
            let mut c = [rgb[p], rgb[p + 1], rgb[p + 2]];
            if undo {
                c = c.map(|v| {
                    ((v as f64 - 16. * alpha) / (1. - alpha))
                        .round_ties_even()
                        .clamp(0., 255.) as u8
                });
            }
            result[y * w + x] = classify(c, yellow);
        }
    }
    result
}

fn json(e: &Evidence) -> String {
    format!(
        "{{\"pixels\":{},\"single\":{},\"pair\":{},\"separated\":{},\"bbox\":{:?}}}",
        e.pixels, e.single, e.pair, e.separated, e.bbox
    )
}

fn exclude_hud(mask: &mut [u8], w: usize, h: usize) {
    // Diagnostic vanilla-HUD exclusion, not a universal GUI segmentation mask.
    // Deliberately report any real fire lost here as a detector miss.
    for y in 0..h {
        for x in 0..w {
            if (y >= h * 88 / 100 && x >= w / 4 && x < w * 3 / 4)
                || (y < h * 18 / 100 && x >= w * 85 / 100)
            {
                mask[y * w + x] = 0;
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let w: usize = args.get(1).expect("width").parse().unwrap();
    let h: usize = args.get(2).expect("height").parse().unwrap();
    let yellow = args.get(3).map(|s| s == "yellow").unwrap_or(false);
    assert!(w > 0 && h > 12);
    let mut input = io::stdin().lock();
    let mut output = io::BufWriter::new(io::stdout().lock());
    let mut rgb = vec![0u8; w * h * 3];
    loop {
        match input.read(&mut rgb[..1]) {
            Ok(0) => break,
            Ok(_) => {}
            Err(e) => panic!("{e}"),
        }
        input
            .read_exact(&mut rgb[1..])
            .expect("truncated RGB frame");
        let mut raw_mask = mask(&rgb, w, h, false, yellow);
        let raw = evidence(&raw_mask, w, h);
        let undo = veiled(&rgb, w, h);
        exclude_hud(&mut raw_mask, w, h);
        let raw_nohud = evidence(&raw_mask, w, h);
        let (auto, auto_nohud) = if undo {
            let mut m = mask(&rgb, w, h, true, yellow);
            let auto = evidence(&m, w, h);
            exclude_hud(&mut m, w, h);
            (auto, evidence(&m, w, h))
        } else {
            (
                Evidence {
                    pixels: raw.pixels,
                    single: raw.single,
                    pair: raw.pair,
                    separated: raw.separated,
                    bbox: raw.bbox,
                },
                Evidence {
                    pixels: raw_nohud.pixels,
                    single: raw_nohud.single,
                    pair: raw_nohud.pair,
                    separated: raw_nohud.separated,
                    bbox: raw_nohud.bbox,
                },
            )
        };
        writeln!(
            output,
            "{{\"raw\":{},\"auto\":{},\"raw_nohud\":{},\"auto_nohud\":{},\"unveiled\":{}}}",
            json(&raw),
            json(&auto),
            json(&raw_nohud),
            json(&auto_nohud),
            undo
        )
        .unwrap();
        output.flush().unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn orange_and_pale_must_touch_and_be_connected() {
        let mut m = vec![0u8; 100];
        for y in 1..4 {
            for x in 1..4 {
                m[y * 10 + x] = 1;
            }
            for x in 6..9 {
                m[y * 10 + x] = 2;
            }
        }
        assert_eq!(evidence(&m, 10, 10).pair, 0);
        for y in 1..4 {
            for x in 4..6 {
                m[y * 10 + x] = 2;
            }
        }
        let e = evidence(&m, 10, 10);
        assert_eq!(e.pair, 24);
        assert_eq!(e.separated, 24);
    }
    #[test]
    fn scattered_single_pixels_and_one_colour_are_not_two_regions() {
        let mut m = vec![0u8; 100];
        m[11] = 1;
        m[12] = 2;
        assert_eq!(evidence(&m, 10, 10).pair, 0);
        for p in &mut m {
            *p = 1;
        }
        assert_eq!(evidence(&m, 10, 10).pair, 0);
    }
    #[test]
    fn colour_bands_are_distinct_and_green_is_rejected() {
        assert_eq!(classify([220, 100, 10], false), 1);
        assert_eq!(classify([240, 220, 180], false), 2);
        assert_eq!(classify([30, 180, 30], false), 0);
        assert_eq!(classify([200, 150, 0], false), 1);
        assert_eq!(classify([200, 150, 0], true), 2);
        assert_eq!(classify([220, 100, 10], true), 1);
    }
    #[test]
    fn hud_exclusion_preserves_pixels_elsewhere() {
        let mut m = vec![1; 10000];
        exclude_hud(&mut m, 100, 100);
        assert_eq!(m[95 * 100 + 50], 0);
        assert_eq!(m[5 * 100 + 95], 0);
        assert_eq!(m[50 * 100 + 50], 1);
        assert_eq!(m[95 * 100 + 10], 1);
    }
}
