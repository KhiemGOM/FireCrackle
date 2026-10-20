// Research-only frozen threshold sweep; not production.
pub mod gui_mask {
    pub use fire_core::gui_mask::*;
}
mod tooltip {
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
}
mod target {
    include!(env!("GUI_CALIBRATION_SOURCE"));
    #[derive(Clone, Copy)]
    struct Cfg {
        b: f64,
        s: f64,
        margin: Option<f64>,
    }
    fn configs() -> Vec<Cfg> {
        let mut v = Vec::new();
        for b in (60..=90).step_by(5) {
            for s in (55..=85).step_by(5) {
                for m in [Some(0.15), Some(0.30), None] {
                    v.push(Cfg {
                        b: b as f64 / 100.,
                        s: s as f64 / 100.,
                        margin: m,
                    });
                }
            }
        }
        v
    }
    #[derive(Clone, Copy)]
    struct Evidence {
        value: Option<f64>,
        min_group: f64,
        probes: usize,
        groups: [usize; 4],
    }
    impl Evidence {
        fn failed(n: usize) -> Self {
            Self {
                value: Some(0.),
                min_group: 0.,
                probes: n,
                groups: [0; 4],
            }
        }
        fn unavailable() -> Self {
            Self {
                value: None,
                min_group: 1.,
                probes: 0,
                groups: [0; 4],
            }
        }
        fn pass(self, threshold: f64, margin: Option<f64>) -> bool {
            self.value.is_none_or(|v| {
                v >= threshold && margin.is_none_or(|m| self.min_group >= threshold - m)
            })
        }
    }
    fn evidence(
        rgb: &[u8],
        width: usize,
        height: usize,
        points: &[Probe],
        rect: Rect,
        sx: f64,
        sy: f64,
        low: f64,
        mask: Option<&[u8]>,
    ) -> Evidence {
        if let Some(mask) = mask {
            let visible: Vec<_> = points
                .iter()
                .copied()
                .filter(|p| {
                    let x = (rect.x + p.x * sx).floor() as isize;
                    let y = (rect.y + p.y * sy + p.viewport_y * height as f64).floor() as isize;
                    x < 0
                        || y < 0
                        || x >= width as isize
                        || y >= height as isize
                        || mask[y as usize * width + x as usize] == 0
                })
                .collect();
            if visible.len() < 16 {
                return Evidence::unavailable();
            }
            raw_score(rgb, width, height, &visible, rect, sx, sy, 24, low)
        } else {
            raw_score(rgb, width, height, points, rect, sx, sy, 24, low)
        }
    }

    fn raw_score(
        rgb: &[u8],
        width: usize,
        height: usize,
        points: &[Probe],
        rect: Rect,
        sx: f64,
        sy: f64,
        tolerance: u8,
        early_floor: f64,
    ) -> Evidence {
        let mut good = 0;
        let max_misses = ((1.0 - early_floor) * points.len() as f64).ceil() as usize;
        let mut groups = [[0usize; 2]; 4];
        for (i, p) in points.iter().enumerate() {
            let x = (rect.x + p.x * sx).floor() as isize;
            let y = (rect.y + p.y * sy + p.viewport_y * height as f64).floor() as isize;
            if x < 0 || y < 0 || x >= width as isize || y >= height as isize {
                return Evidence::failed(points.len());
            }
            let offset = (y as usize * width + x as usize) * 3;
            // Below one output pixel per GUI texel, a thin highlight/shadow can
            // be blended toward its opaque source neighbourhood. Keep the layout,
            // regional quorums and acceptance fractions unchanged. This is not
            // occlusion: unmatched visible probes still count as errors.
            let blended = if sx < 1. && sy < 1. { p.blended } else { None };
            let agrees = (0..3).all(|k| {
                let other = blended.map_or(p.rgb[k], |c| c[k]);
                let low = p.rgb[k].min(other).saturating_sub(tolerance);
                let high = p.rgb[k].max(other).saturating_add(tolerance);
                (low..=high).contains(&rgb[offset + k])
            });
            good += usize::from(agrees);
            groups[p.group][0] += usize::from(agrees);
            groups[p.group][1] += 1;
            if i + 1 - good > max_misses {
                return Evidence::failed(points.len());
            }
        }
        Evidence {
            value: Some(good as f64 / points.len().max(1) as f64),
            min_group: groups
                .iter()
                .filter(|g| g[1] > 0)
                .map(|g| g[0] as f64 / g[1] as f64)
                .fold(1., f64::min),
            probes: points.len(),
            groups: groups.map(|g| g[1]),
        }
    }

    fn profile(
        rgb: &[u8],
        width: usize,
        height: usize,
        templates: &[PanelTemplate],
        cfgs: &[Cfg],
        mask: Option<&[u8]>,
    ) -> Vec<bool> {
        let mut hits = vec![false; cfgs.len()];
        let opts = Options::default();
        if mask.is_some_and(|m| m.iter().all(|&x| x != 0)) {
            return hits;
        }
        let count = ((opts.max_scale - opts.min_scale) / opts.scale_step).floor() as usize;

        for template in templates {
            for i in 0..=count {
                let sx = opts.min_scale + i as f64 * opts.scale_step;
                // Standard uncropped capture, with modest independent vertical
                // rescale tolerance for a window stretched into a recording canvas.
                for ratio in [1.0, 0.95, 1.05] {
                    let sy = sx * ratio;
                    let pw = template.width as f64 * sx;
                    let ph = template.height as f64 * sy;
                    if pw > width as f64 + 1. || ph > height as f64 + 1. {
                        continue;
                    }
                    for shift in if template.recipe_shift {
                        &[0., 77.][..]
                    } else {
                        &[0.][..]
                    } {
                        let mut origins = vec![
                            (0., 0.),
                            (0., -0.5),
                            (0., 0.5),
                            (-0.5, 0.),
                            (-0.5, -0.5),
                            (-0.5, 0.5),
                            (0.5, 0.),
                            (0.5, -0.5),
                            (0.5, 0.5),
                        ];
                        let ox = source_origin_offset(width, template.width, sx, true);
                        let oy = source_origin_offset(
                            height,
                            template.height,
                            sy,
                            template.top_y.is_none(),
                        );
                        // Only one extra source-rounded pair, rather than the
                        // Cartesian product of extra x/y offsets. Preserve the
                        // original nine poses and bound the extra search cost.
                        if !origins.iter().any(|&(x, y): &(f64, f64)| {
                            (x - ox).abs() < 1e-9 && (y - oy).abs() < 1e-9
                        }) {
                            origins.push((ox, oy));
                        }
                        for (ox, oy) in origins {
                            {
                                let bounds = Rect {
                                    x: (width as f64 - pw) / 2.
                                        + (template.offset_x + shift + ox) * sx,
                                    y: template
                                        .top_y
                                        .map_or((height as f64 - ph) / 2., |top| top * sy)
                                        + template.viewport_y * height as f64
                                        + oy * sy,
                                    width: pw,
                                    height: ph,
                                };
                                if bounds.x < -1. || bounds.x + pw > width as f64 + 1. {
                                    continue;
                                }
                                let border = evidence(
                                    rgb,
                                    width,
                                    height,
                                    &template.border,
                                    bounds,
                                    sx,
                                    sy,
                                    0.60,
                                    mask,
                                );
                                let active: Vec<usize> = cfgs
                                    .iter()
                                    .enumerate()
                                    .filter(|(j, c)| !hits[*j] && border.pass(c.b, c.margin))
                                    .map(|(j, _)| j)
                                    .collect();
                                if active.is_empty() {
                                    continue;
                                }
                                let structure = evidence(
                                    rgb,
                                    width,
                                    height,
                                    &template.structure,
                                    bounds,
                                    sx,
                                    sy,
                                    0.55,
                                    mask,
                                );
                                let needs_full = active
                                    .iter()
                                    .any(|&j| !structure.pass(cfgs[j].s, cfgs[j].margin));
                                let full = if needs_full
                                    && !template.presence_structure.is_empty()
                                    && template.identity.is_empty()
                                {
                                    evidence(
                                        rgb,
                                        width,
                                        height,
                                        &template.presence_structure,
                                        bounds,
                                        sx,
                                        sy,
                                        0.55,
                                        mask,
                                    )
                                } else {
                                    Evidence::failed(0)
                                };
                                if !active.iter().any(|&j| {
                                    structure.pass(cfgs[j].s, cfgs[j].margin)
                                        || (full.value.is_some()
                                            && full.pass(cfgs[j].s, cfgs[j].margin))
                                }) {
                                    continue;
                                }
                                let identity = if template.identity.is_empty() {
                                    Evidence::unavailable()
                                } else {
                                    evidence(
                                        rgb,
                                        width,
                                        height,
                                        &template.identity,
                                        bounds,
                                        sx,
                                        sy,
                                        0.90,
                                        mask,
                                    )
                                };
                                if !identity.pass(0.90, Some(0.15)) {
                                    continue;
                                }
                                for j in active {
                                    let c = cfgs[j];
                                    let s = if structure.pass(c.s, c.margin) {
                                        structure
                                    } else {
                                        if !template.identity.is_empty()
                                            || template.presence_structure.is_empty()
                                            || full.value.is_none()
                                            || !full.pass(c.s, c.margin)
                                        {
                                            continue;
                                        }
                                        full
                                    };
                                    if mask.is_some() {
                                        let total = border.probes + s.probes + identity.probes;
                                        let groups = (0..4)
                                            .filter(|&g| {
                                                border.groups[g] + s.groups[g] + identity.groups[g]
                                                    > 0
                                            })
                                            .count();
                                        if total < 32 || groups < 2 {
                                            continue;
                                        }
                                    }
                                    hits[j] = true;
                                }
                                if hits.iter().all(|&x| x) {
                                    return hits;
                                }
                            }
                        }
                    }
                }
            }
        }
        hits
    }

    pub fn run() -> Result<(), Box<dyn std::error::Error>> {
        use std::io::{Read, Write};
        let a = std::env::args().collect::<Vec<_>>();
        let templates = load_templates(Path::new(&a[1]))?;
        let width: usize = a[2].parse()?;
        let height: usize = a[3].parse()?;
        let mut rgb = vec![0; width * height * 3];
        let cfgs = configs();
        let mut input = std::io::stdin().lock();
        let mut output = std::io::stdout().lock();
        let mut index = 0;
        loop {
            let mut read = 0;
            while read < rgb.len() {
                let n = input.read(&mut rgb[read..])?;
                if n == 0 {
                    break;
                }
                read += n;
            }
            if read == 0 {
                break;
            }
            if read != rgb.len() {
                return Err("partial RGB".into());
            }
            let start = std::time::Instant::now();
            let plain = profile(&rgb, width, height, &templates, &cfgs, None);
            let tips = crate::tooltip::detect_tooltips(&rgb, width, height);
            let (masked, reference) = if tips.is_empty() {
                (plain.clone(), None)
            } else {
                let mask = crate::tooltip::mask(&tips, width, height);
                let p = profile(&rgb, width, height, &templates, &cfgs, Some(&mask));
                let r = detect_with_occlusion(
                    &rgb,
                    width,
                    height,
                    &templates,
                    Options::default(),
                    &mask,
                )?
                .gui_detected;
                assert_eq!(p[144], r, "masked default parity");
                (p, Some(r))
            };
            let bits = |v: &[bool]| {
                v.iter()
                    .map(|&x| if x { '1' } else { '0' })
                    .collect::<String>()
            };
            write!(output,"{{\"index\":{},\"plain\":\"{}\",\"masked\":\"{}\",\"ms\":{:.3},\"tooltip_rects\":[",index,bits(&plain),bits(&masked),start.elapsed().as_secs_f64()*1000.)?;
            for (i, t) in tips.iter().enumerate() {
                if i > 0 {
                    write!(output, ",")?;
                }
                write!(output, "[{},{},{},{}]", t.x, t.y, t.w, t.h)?;
            }
            writeln!(
                output,
                "],\"masked_default_reference\":{}}}",
                reference.map_or("null", |x| if x { "true" } else { "false" })
            )?;
            output.flush()?;
            index += 1;
        }
        Ok(())
    }
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    target::run()
}
