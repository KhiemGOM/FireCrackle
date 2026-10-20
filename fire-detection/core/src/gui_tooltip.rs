// Vanilla1.21.11 TooltipRenderUtil background/frame signatures. This detects
// the independent rendered layer; no GUI-match errors or renderer labels enter.
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
    for y in 0..h {
        let mut x = 0;
        while x < w {
            if !rim(x, y) {
                x += 1;
                continue;
            }
            let start = x;
            let mut last = x;
            let mut good = 0;
            while x < w && x <= last + 2 {
                if rim(x, y) {
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
            if l.abs_diff(left) > 4 || r.abs_diff(right) > 4 {
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
