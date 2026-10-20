//! Source-template interaction screens. Independent of HUD/hotbar fitting.
//!
//! Local vanilla textures supply anchors; no recorded frame is used to fit a
//! model. A missing/ambiguous match is an abstention, never proof of closed GUI.
//! Panel regions are conservative neutral exclusions, not opaque pixel masks.

use std::path::Path;

#[derive(Clone, Debug)]
pub struct PanelTemplate {
    pub screen_type: String,
    pub version: String,
    pub variant: String,
    pub width: usize,
    pub height: usize,
    pub recipe_shift: bool,
    border: Vec<Probe>,
    structure: Vec<Probe>,
}

#[derive(Clone, Copy, Debug)]
struct Probe {
    x: f64,
    y: f64,
    rgb: [u8; 3],
    group: usize,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug)]
pub struct PanelMatch {
    pub screen_type: String,
    pub version: String,
    pub variant: String,
    pub bounds: Rect,
    pub scale_x: f64,
    pub scale_y: f64,
    /// Fraction of source anchors explained, not calibrated probability.
    pub score: f64,
    pub border_score: f64,
    pub structure_score: f64,
}

#[derive(Clone, Debug)]
pub struct Detection {
    pub image_width: usize,
    pub image_height: usize,
    pub matched: Option<PanelMatch>,
    pub alternatives: Vec<PanelMatch>,
    pub reason: &'static str,
}

#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub min_scale: f64,
    pub max_scale: f64,
    pub scale_step: f64,
    pub channel_tolerance: u8,
    pub min_border: f64,
    pub min_structure: f64,
    pub min_type_margin: f64,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            min_scale: 0.75,
            max_scale: 8.0,
            scale_step: 0.125,
            channel_tolerance: 24,
            min_border: 0.90,
            min_structure: 0.85,
            min_type_margin: 0.04,
        }
    }
}

impl PanelTemplate {
    pub fn from_rgba(
        screen_type: String,
        version: String,
        variant: String,
        width: usize,
        height: usize,
        recipe_shift: bool,
        rgba: &[u8],
    ) -> Result<Self, String> {
        if width < 16
            || height < 16
            || width.checked_mul(height).and_then(|n| n.checked_mul(4)) != Some(rgba.len())
        {
            return Err("invalid panel texture dimensions".into());
        }
        let pixel = |x: usize, y: usize| -> [u8; 4] {
            rgba[(y * width + x) * 4..(y * width + x) * 4 + 4]
                .try_into()
                .unwrap()
        };
        let mut border = Vec::new();
        let mut structure = Vec::new();
        for y in 1..height - 1 {
            for x in 1..width - 1 {
                let c = pixel(x, y);
                if c[3] != 255 {
                    continue;
                }
                // Coloured icon/model/item interiors are variable. Opaque grey
                // bevel transitions and separators are reusable static anchors.
                if c[..3].iter().max().unwrap() - c[..3].iter().min().unwrap() > 8 {
                    continue;
                }
                let group = (usize::from(x >= width / 2)) + 2 * usize::from(y >= height / 2);
                let probe = Probe {
                    x: x as f64 + 0.5,
                    y: y as f64 + 0.5,
                    rgb: [c[0], c[1], c[2]],
                    group,
                };
                if x < 4 || x >= width - 4 || y < 4 || y >= height - 4 {
                    if (x + 3 * y) % 7 == 0 {
                        border.push(probe);
                    }
                } else if x >= 5
                    && x < width - 5
                    && y >= 16
                    && y < if width >= 150
                        && height >= 120
                        && !screen_type.ends_with("horse_inventory_screen")
                        && !screen_type.ends_with("merchant_screen")
                    {
                        height.saturating_sub(86).max(32)
                    } else {
                        height - 5
                    }
                {
                    // The lower player inventory/hotbar is shared by many
                    // unrelated containers. Identify the upper work area,
                    // instead of rewarding hundreds of identical lower slots.
                    let neighbors = [
                        pixel(x - 1, y),
                        pixel(x + 1, y),
                        pixel(x, y - 1),
                        pixel(x, y + 1),
                    ];
                    if neighbors
                        .iter()
                        .any(|p| p[3] == 255 && p[0].abs_diff(c[0]) >= 24)
                        && (x + y) % 3 == 0
                    {
                        structure.push(probe);
                    }
                }
            }
        }
        fn thin(points: Vec<Probe>, limit: usize) -> Vec<Probe> {
            if points.len() <= limit {
                return points;
            }
            (0..limit)
                .map(|i| points[i * points.len() / limit])
                .collect()
        }
        let border = thin(border, 96);
        let structure = thin(structure, 192);
        if border.len() < 16 || structure.len() < 16 {
            return Err("panel has insufficient static anchors".into());
        }
        Ok(Self {
            screen_type,
            version,
            variant,
            width,
            height,
            recipe_shift,
            border,
            structure,
        })
    }

    /// GUI source packs are generated locally from the installed client jar.
    /// Header: GUIT1, type, version, variant, width height recipe_shift; then RGBA.
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let mut cursor = 0;
        let mut line = || -> Result<String, String> {
            let end = bytes[cursor..]
                .iter()
                .position(|b| *b == b'\n')
                .ok_or("short template header")?
                + cursor;
            let value = std::str::from_utf8(&bytes[cursor..end])
                .map_err(|e| e.to_string())?
                .to_owned();
            cursor = end + 1;
            Ok(value)
        };
        if line()? != "GUIT1" {
            return Err("unsupported GUI template format".into());
        }
        let kind = line()?;
        let version = line()?;
        let variant = line()?;
        let fields = line()?;
        let shape: Vec<usize> = fields
            .split_whitespace()
            .map(|s| s.parse().map_err(|_| "bad template shape"))
            .collect::<Result<_, _>>()?;
        if shape.len() != 3 {
            return Err("bad template shape".into());
        }
        Self::from_rgba(
            kind,
            version,
            variant,
            shape[0],
            shape[1],
            shape[2] != 0,
            &bytes[cursor..],
        )
    }
}

pub fn load_templates(folder: &Path) -> Result<Vec<PanelTemplate>, String> {
    let mut paths = std::fs::read_dir(folder)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|s| s == "guit"))
        .collect::<Vec<_>>();
    paths.sort();
    if paths.is_empty() {
        return Err("no local GUI source templates installed".into());
    }
    paths.iter().map(|p| PanelTemplate::load(p)).collect()
}

fn score(
    rgb: &[u8],
    width: usize,
    height: usize,
    points: &[Probe],
    rect: Rect,
    sx: f64,
    sy: f64,
    tolerance: u8,
    early_floor: f64,
) -> f64 {
    let mut good = 0;
    let max_misses = ((1.0 - early_floor) * points.len() as f64).ceil() as usize;
    let mut groups = [[0usize; 2]; 4];
    for (i, p) in points.iter().enumerate() {
        let x = (rect.x + p.x * sx).floor() as isize;
        let y = (rect.y + p.y * sy).floor() as isize;
        if x < 0 || y < 0 || x >= width as isize || y >= height as isize {
            return 0.;
        }
        let offset = (y as usize * width + x as usize) * 3;
        let agrees = (0..3).all(|k| rgb[offset + k].abs_diff(p.rgb[k]) <= tolerance);
        good += usize::from(agrees);
        groups[p.group][0] += usize::from(agrees);
        groups[p.group][1] += 1;
        if i + 1 - good > max_misses {
            return 0.;
        }
    }
    // Evidence must span the panel, not one isolated grey corner.
    if groups
        .iter()
        .any(|g| g[1] > 0 && (g[0] as f64 / g[1] as f64) < early_floor - 0.15)
    {
        return 0.;
    }
    good as f64 / points.len().max(1) as f64
}

pub fn detect(
    rgb: &[u8],
    width: usize,
    height: usize,
    templates: &[PanelTemplate],
    opts: Options,
) -> Result<Detection, String> {
    if width == 0
        || height == 0
        || width.checked_mul(height).and_then(|n| n.checked_mul(3)) != Some(rgb.len())
    {
        return Err("frame dimensions do not match RGB".into());
    }
    if !opts.min_scale.is_finite()
        || !opts.max_scale.is_finite()
        || !opts.scale_step.is_finite()
        || opts.min_scale <= 0.
        || opts.max_scale < opts.min_scale
        || opts.scale_step < 0.01
        || opts.max_scale > 32.
        || !(0.0..=1.0).contains(&opts.min_border)
        || !(0.0..=1.0).contains(&opts.min_structure)
        || !(0.0..=1.0).contains(&opts.min_type_margin)
    {
        return Err("invalid GUI detector options".into());
    }
    let count = ((opts.max_scale - opts.min_scale) / opts.scale_step).floor() as usize;
    let mut candidates = Vec::new();
    for template in templates {
        let mut best: Option<PanelMatch> = None;
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
                    for ox in [0., -0.5, 0.5] {
                        for oy in [0., -0.5, 0.5] {
                            let bounds = Rect {
                                x: (width as f64 - pw) / 2. + shift * sx + ox * sx,
                                y: (height as f64 - ph) / 2. + oy * sy,
                                width: pw,
                                height: ph,
                            };
                            if bounds.x < -1. || bounds.x + pw > width as f64 + 1. {
                                continue;
                            }
                            let border_score = score(
                                rgb,
                                width,
                                height,
                                &template.border,
                                bounds,
                                sx,
                                sy,
                                opts.channel_tolerance,
                                opts.min_border,
                            );
                            if border_score < opts.min_border {
                                continue;
                            }
                            let structure_score = score(
                                rgb,
                                width,
                                height,
                                &template.structure,
                                bounds,
                                sx,
                                sy,
                                opts.channel_tolerance,
                                opts.min_structure,
                            );
                            if structure_score < opts.min_structure {
                                continue;
                            }
                            let quality = 0.3 * border_score + 0.7 * structure_score;
                            if best.as_ref().is_none_or(|b| quality > b.score) {
                                best = Some(PanelMatch {
                                    screen_type: template.screen_type.clone(),
                                    version: template.version.clone(),
                                    variant: template.variant.clone(),
                                    bounds,
                                    scale_x: sx,
                                    scale_y: sy,
                                    score: quality,
                                    border_score,
                                    structure_score,
                                });
                            }
                        }
                    }
                }
            }
        }
        if let Some(hit) = best {
            candidates.push(hit);
        }
    }
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    // Different source-version/visual variants of the SAME known screen are
    // not competing semantic types. Never choose a class solely by iteration.
    let best = candidates.first().cloned();
    let runner = best.as_ref().and_then(|best| {
        candidates
            .iter()
            .find(|p| p.screen_type != best.screen_type)
    });
    let ambiguous = best
        .as_ref()
        .zip(runner)
        .is_some_and(|(a, b)| a.score - b.score < opts.min_type_margin);
    let reason = if best.is_none() {
        "no_known_panel_match"
    } else if ambiguous {
        "ambiguous_known_types"
    } else {
        "known_panel_match"
    };
    candidates.truncate(8);
    Ok(Detection {
        image_width: width,
        image_height: height,
        matched: if ambiguous { None } else { best },
        alternatives: candidates,
        reason,
    })
}

impl Detection {
    /// Merge into the same per-pixel GUI exclusions, independent of HUD fit.
    /// Do not change `reliable`/`fit`: those still describe HUD evidence only.
    pub fn merge_neutral_panel(
        &self,
        mask: &mut crate::gui_mask::GuiMask,
    ) -> Result<usize, String> {
        let Some(hit) = &self.matched else {
            return Ok(0);
        };
        if mask.width != self.image_width
            || mask.height != self.image_height
            || mask.width.checked_mul(mask.height) != Some(mask.class.len())
            || mask.piece.len() != mask.class.len()
        {
            return Err("GUI mask dimensions do not match buffers".into());
        }
        let x0 = hit.bounds.x.floor().max(0.) as usize;
        let y0 = hit.bounds.y.floor().max(0.) as usize;
        let x1 = (hit.bounds.x + hit.bounds.width)
            .ceil()
            .min(mask.width as f64)
            .max(0.) as usize;
        let y1 = (hit.bounds.y + hit.bounds.height)
            .ceil()
            .min(mask.height as f64)
            .max(0.) as usize;
        let mut count = 0;
        for y in y0..y1 {
            for x in x0..x1 {
                let p = y * mask.width + x;
                if mask.class[p] == 0 {
                    mask.class[p] = 3; // Unknown / neutral, never opaque ownership.
                    mask.piece[p] = crate::gui_mask::PieceId::InventoryPanel as u8;
                    count += 1;
                }
            }
        }
        Ok(count)
    }
}
