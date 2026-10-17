//! Opt-in inventory/menu surfaces. Requires the canonical hotbar scale fit.
//! No veil detection or inverse math: screen surfaces are separate exclusions.
use super::*;

fn confirmed(
    frame: &[u8],
    w: usize,
    h: usize,
    fit: &GuiFit,
    points: &[(i32, i32, [u8; 4])],
    x: i32,
    y: i32,
) -> f64 {
    let mut good = 0;
    let mut total = 0;
    for &(u, v, c) in points {
        let px = fit.origin_x + (x + u) as f64 * fit.scale + 0.5 * fit.scale;
        let py = fit.origin_y + (y + v) as f64 * fit.scale + 0.5 * fit.scale;
        if px < 0. || py < 0. || px >= w as f64 || py >= h as f64 {
            return 0.;
        }
        let p = (py as usize * w + px as usize) * 3;
        total += 1;
        good += usize::from((0..3).all(|k| frame[p + k].abs_diff(c[k]) <= 16));
    }
    if total == 0 {
        0.
    } else {
        good as f64 / total as f64
    }
}

fn mark(
    mask: &mut GuiMask,
    fit: &GuiFit,
    piece: PieceId,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    score: f64,
) {
    // Entire confirmed surface is neutral, including icons/entities and text.
    // Unknown avoids claiming a transparent preview hole is actually opaque.
    paint(
        mask,
        fit,
        (x as f64, y as f64, w as f64, h as f64),
        piece,
        PixelClass::Unknown,
        0.05,
    );
    mask.hits.push(PieceHit {
        piece,
        index: 0,
        x: (fit.origin_x + x as f64 * fit.scale).floor() as i32,
        y: (fit.origin_y + y as f64 * fit.scale).floor() as i32,
        w: (w as f64 * fit.scale).round() as u32,
        h: (h as f64 * fit.scale).round() as u32,
        score,
        text: None,
    });
}

/// Extend an already detected GUI with texture-confirmed vanilla inventory and
/// pause/options buttons. Does not run automatically in `detect_gui` yet.
/// Callers excluding screen pieces must treat IDs24/25 as neutral regardless of
/// class. Unconfirmed geometry is never painted; full-screen tint is untouched.
pub fn add_screen_masks(
    frame: &[u8],
    w: usize,
    h: usize,
    tex: &GuiTextures,
    mask: &mut GuiMask,
) -> Result<(), String> {
    if w == 0 || h == 0 || frame.len() != w * h * 3 || mask.width != w || mask.height != h {
        return Err("screen mask dimensions do not match RGB frame".into());
    }
    let Some(fit) = mask.fit else {
        return Ok(());
    };
    if !mask.reliable {
        return Ok(());
    }
    let sw = fit.scaled_width as i32;
    let sh = fit.scaled_height as i32;
    // Fixed outer panel bevels and horizontal separators: no slot items,
    // player preview, crafting output or localized title enter confirmation.
    let mut panel = Vec::new();
    for v in 0..166 {
        for u in 0..176 {
            if (u < 5
                || u >= 171
                || v < 5
                || v >= 161
                || [76, 77, 78, 79, 80, 81, 138, 139, 140].contains(&v))
                && (u + v) % 2 == 0
            {
                let c = tex.inventory.texel(u as i64, v as i64);
                if c[3] == 255 {
                    panel.push((u, v, c));
                }
            }
        }
    }
    let mut best = (0., 0, 0);
    // InventoryScreen layout with recipe book closed or open (+77 GUI px).
    // Also test the actual centered shifted layout rounded to adjacent pixels.
    for dx in [0, 77] {
        for ox in -1..=1 {
            for oy in -1..=1 {
                let x = (sw - 176) / 2 + dx + ox;
                let y = (sh - 166) / 2 + oy;
                let score = confirmed(frame, w, h, &fit, &panel, x, y);
                if score > best.0 {
                    best = (score, x, y);
                }
            }
        }
    }
    if best.0 >= 0.90 {
        mark(
            mask,
            &fit,
            PieceId::InventoryPanel,
            best.1,
            best.2,
            176,
            166,
            best.0,
        );
    }

    // Standard 20px buttons are assembled from the left/right halves of the
    // widgets sheet. Confirm borders, excluding the variable label interior.
    let mut found = Vec::new();
    let mut candidates = std::collections::BTreeSet::new();
    for r in 0..6 {
        let y = sh / 4 + 8 + 24 * r;
        candidates.insert((sw / 2 - 102, y, 204));
        candidates.insert((sw / 2 - 102, y, 98));
        candidates.insert((sw / 2 + 4, y, 98));
    }
    for r in 0..8 {
        let y = sh / 6 - 12 + 24 * r;
        candidates.insert((sw / 2 - 155, y, 150));
        candidates.insert((sw / 2 + 5, y, 150));
    }
    // Options' Done button and pause screen's Disconnect/Return button.
    candidates.insert((sw / 2 - 100, sh / 6 + 168, 200));
    for (x, y, width) in candidates {
        if x < 0 || y < 0 || x + width > sw || y + 20 > sh {
            continue;
        }
        let mut best_score: f64 = 0.;
        for state in 0..3 {
            let mut points = Vec::new();
            for v in 0..20 {
                for u in 0..width {
                    if (u < 4 || u >= width - 4 || v < 4 || v >= 16) && (u + v) % 2 == 0 {
                        let tx = if u < width / 2 { u } else { 200 - width + u };
                        let c = tex.widgets.texel(tx as i64, (46 + state * 20 + v) as i64);
                        if c[3] == 255 {
                            points.push((u, v, c));
                        }
                    }
                }
            }
            // Each edge must agree independently. A shorter candidate over the
            // flat middle of a long button must not pass by averaging away its
            // missing right bevel.
            let mut edge_score = confirmed(frame, w, h, &fit, &points, x, y);
            for edge in 0..4 {
                let selected: Vec<_> = points
                    .iter()
                    .copied()
                    .filter(|&(u, v, _)| match edge {
                        0 => u < 4,
                        1 => u >= width - 4,
                        2 => v < 4,
                        _ => v >= 16,
                    })
                    .collect();
                edge_score = edge_score.min(confirmed(frame, w, h, &fit, &selected, x, y));
            }
            best_score = best_score.max(edge_score);
        }
        if best_score >= 0.90 {
            found.push((x, y, width, best_score));
        }
    }
    // Resolve overlapping width hypotheses by measured border agreement.
    found.sort_by(|a, b| b.3.total_cmp(&a.3).then_with(|| b.2.cmp(&a.2)));
    let mut distinct: Vec<(i32, i32, i32, f64)> = Vec::new();
    for candidate in found {
        if !distinct.iter().any(|p| {
            candidate.0 < p.0 + p.2
                && p.0 < candidate.0 + candidate.2
                && candidate.1 < p.1 + 20
                && p.1 < candidate.1 + 20
        }) {
            distinct.push(candidate);
        }
    }
    let found = distinct;
    // One gray object is not a menu. Require multiple aligned button rows.
    let rows: std::collections::BTreeSet<_> = found.iter().map(|p| p.1).collect();
    if found.len() >= 3 && rows.len() >= 2 {
        for (x, y, width, score) in found {
            mark(
                mask,
                &fit,
                PieceId::MenuButton,
                x,
                y,
                width as u32,
                20,
                score,
            );
        }
    }
    Ok(())
}
