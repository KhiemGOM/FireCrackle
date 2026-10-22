// Vanilla1.21.11 TooltipRenderUtil background/frame signatures. This detects
// the independent rendered layer; no GUI-match errors or renderer labels enter.
// Capture-space tolerances, not Minecraft layout constants. Compression can
// break the faint bottom rim or shorten its endpoints. Joining a bounded gap
// does not credit it as matching: the 85% line coverage, 75% side coverage and
// 55% dark-fill requirements below still apply independently.
const MAX_RIM_GAP_PX: usize = 12;
const ENDPOINT_SLACK_PX: usize = 12;
#[derive(Clone, Copy, Debug)]
pub struct TipRect {
    pub x: usize,
    pub y: usize,
    pub w: usize,
    pub h: usize,
}
pub fn detect_tooltips(rgb: &[u8], w: usize, h: usize) -> Vec<TipRect> {
    let rim = |x: usize, y: usize| {
        let p = &rgb[(y * w + x) * 3..][..3];
        p[1] <= 35
            && p[2] >= 35
            && p[2] <= 150
            && i16::from(p[2]) - i16::from(p[0]) >= 12
            && i16::from(p[2]) - i16::from(p[1]) >= 24
            && i16::from(p[0]) - i16::from(p[1]) >= 5
    };
    let fill = |x: usize, y: usize| {
        let p = &rgb[(y * w + x) * 3..][..3];
        p[0] >= 8
            && p[0] <= 50
            && p[1] <= 35
            && p[2] >= 8
            && p[2] <= 50
            && p[0].abs_diff(p[2]) <= 18
            && i16::from(p[0]) - i16::from(p[1]) >= 4
            && i16::from(p[2]) - i16::from(p[1]) >= 4
    };
    let mut lines = Vec::new();
    // The rim predicate for a whole row at once: a straight pass the compiler
    // can vectorise, instead of a bounds-checked closure call per pixel. Same
    // comparisons as `rim`; the run scan below reads the row's flags.
    let mut rim_row = vec![0u8; w];
    for y in 0..h {
        // `b - r >= 12` on bytes is `b.saturating_sub(r) >= 12` (a negative
        // difference saturates to 0, which also fails), so the whole predicate
        // is unsigned byte arithmetic the compiler can vectorise.
        for (flag, p) in rim_row
            .iter_mut()
            .zip(rgb[y * w * 3..(y + 1) * w * 3].chunks_exact(3))
        {
            let (r, g, b) = (p[0], p[1], p[2]);
            *flag = (g <= 35) as u8
                & (b >= 35) as u8
                & (b <= 150) as u8
                & (b.saturating_sub(r) >= 12) as u8
                & (b.saturating_sub(g) >= 24) as u8
                & (r.saturating_sub(g) >= 5) as u8;
        }
        let mut x = 0;
        while x < w {
            if rim_row[x] == 0 {
                x += 1;
                continue;
            }
            let start = x;
            let mut last = x;
            let mut good = 0;
            while x < w && x <= last + MAX_RIM_GAP_PX {
                if rim_row[x] != 0 {
                    last = x;
                    good += 1;
                }
                x += 1;
            }
            let len = last - start + 1;
            if len >= 24 && len <= w * 9 / 10 && good * 100 >= len * 85 {
                lines.push((y, start, last));
            }
        }
    }
    let mut boxes: Vec<TipRect> = Vec::new();
    for (i, &(top, left, right)) in lines.iter().enumerate() {
        if boxes
            .iter()
            .any(|b| left >= b.x && right < b.x + b.w && top >= b.y && top < b.y + b.h)
        {
            continue;
        }
        for &(bottom, l, r) in &lines[i + 1..] {
            if bottom < top + 8 {
                continue;
            }
            if bottom > top + 450 {
                break;
            }
            if l.abs_diff(left) > ENDPOINT_SLACK_PX || r.abs_diff(right) > ENDPOINT_SLACK_PX {
                continue;
            }
            let height = bottom - top + 1;
            let width = right - left + 1;
            if height > width * 4 {
                continue;
            }
            let edge = |xx: usize, yy: usize| {
                let lo = xx.saturating_sub(2);
                let hi = (xx + 2).min(w - 1);
                (lo..=hi).any(|x| rim(x, yy))
            };
            let mut lg = 0;
            let mut rg = 0;
            let mut total = 0;
            for y in top + 2..bottom.saturating_sub(1) {
                lg += usize::from(edge(left, y));
                rg += usize::from(edge(right, y));
                total += 1;
            }
            if total < 4 || lg * 100 < total * 75 || rg * 100 < total * 75 {
                continue;
            }
            let mut good = 0;
            let mut count = 0;
            for y in (top + 2..bottom.saturating_sub(1)).step_by(2) {
                for x in (left + 2..right.saturating_sub(1)).step_by(2) {
                    good += usize::from(fill(x, y));
                    count += 1;
                }
            }
            if count < 16 || good * 100 < count * 55 {
                continue;
            }
            // The frame has one logical-pixel rim; include the outer background
            // edge conservatively. Bound padding, and never cover the viewport.
            let thick = (top..=(top + 7).min(h - 1))
                .take_while(|&y| rim((left + right) / 2, y))
                .count()
                .max(1);
            let pad = (thick * 2).clamp(2, 16);
            let x = left.saturating_sub(pad);
            let y = top.saturating_sub(pad);
            let rr = (right + pad + 1).min(w);
            let bb = (bottom + pad + 1).min(h);
            boxes.push(TipRect {
                x,
                y,
                w: rr - x,
                h: bb - y,
            });
            break;
        }
        if boxes.len() >= 4 {
            break;
        }
    }
    boxes
}
pub fn mask(rects: &[TipRect], w: usize, h: usize) -> Vec<u8> {
    let mut result = vec![0; w * h];
    for r in rects {
        for y in r.y..r.y + r.h {
            result[y * w + r.x..y * w + r.x + r.w].fill(255);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tooltip() -> Vec<u8> {
        let mut rgb = vec![100; 320 * 180 * 3];
        for y in 30..130 {
            for x in 40..240 {
                let rim = !(42..238).contains(&x) || !(32..128).contains(&y);
                let colour = if rim { [80, 16, 128] } else { [16, 0, 16] };
                rgb[(y * 320 + x) * 3..(y * 320 + x) * 3 + 3].copy_from_slice(&colour);
            }
        }
        rgb
    }

    fn erase(rgb: &mut [u8], xs: std::ops::Range<usize>, ys: std::ops::Range<usize>) {
        for y in ys {
            for x in xs.clone() {
                rgb[(y * 320 + x) * 3..(y * 320 + x) * 3 + 3].fill(100);
            }
        }
    }

    #[test]
    fn compressed_rim_gaps_do_not_turn_known_tooltip_pixels_into_mismatches() {
        let mut rgb = tooltip();
        erase(&mut rgb, 110..118, 128..130);
        erase(&mut rgb, 230..240, 128..130);
        let boxes = detect_tooltips(&rgb, 320, 180);
        assert_eq!(boxes.len(), 1);
        let excluded = mask(&boxes, 320, 180);
        assert_eq!(excluded[80 * 320 + 140], 255);
        assert_eq!(excluded[10 * 320 + 10], 0);
    }

    #[test]
    fn broken_lines_still_need_coverage_sides_and_dark_fill() {
        let mut too_broken = tooltip();
        erase(&mut too_broken, 100..150, 128..130);
        assert!(detect_tooltips(&too_broken, 320, 180).is_empty());
        let mut no_side = tooltip();
        erase(&mut no_side, 40..42, 40..120);
        assert!(detect_tooltips(&no_side, 320, 180).is_empty());
        let mut no_fill = tooltip();
        erase(&mut no_fill, 42..238, 32..128);
        assert!(detect_tooltips(&no_fill, 320, 180).is_empty());
    }
}
