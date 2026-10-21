//! Source-template interaction screens. Independent of HUD/hotbar fitting.
//!
//! Local vanilla textures supply anchors; no recorded frame is used to fit a
//! model. Type ambiguity does not negate GUI presence. A missing match is an
//! abstention, never proof of closed GUI.
//! Panel regions are conservative neutral exclusions, not opaque pixel masks.

use std::path::Path;

#[path = "gui_interaction_fast.rs"]
mod fast;
pub use fast::SCALE_PRUNE;
pub use fast::InteractionDetector;

#[derive(Clone, Debug)]
pub struct PanelTemplate {
    pub screen_type: String,
    pub version: String,
    pub variant: String,
    pub width: usize,
    pub height: usize,
    pub recipe_shift: bool,
    /// Logical offset from horizontal centre; optional logical vertical offset.
    /// Vertical offsets may be relative to a viewport fraction (e.g. footer).
    pub offset_x: f64,
    pub top_y: Option<f64>,
    pub viewport_y: f64,
    border: Vec<Probe>,
    structure: Vec<Probe>,
    presence_structure: Vec<Probe>,
    identity: Vec<Probe>,
}

#[derive(Clone, Copy, Debug)]
struct Probe {
    x: f64,
    y: f64,
    rgb: [u8; 3],
    /// Source-only 3x3 average. Subpixel captures blend thin source edges.
    /// None for fixed text controls and beside unknown/transparent source pixels.
    blended: Option<[u8; 3]>,
    group: usize,
    viewport_y: f64,
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
    /// Whole-panel evidence establishes GUI presence, not an exact type.
    pub presence_only: bool,
    /// Visible probes contributing to each score; zero means unavailable,
    /// not a negative vote. Order: border, structure, fixed controls.
    pub visible_probes: [usize; 3],
}

#[derive(Clone, Debug)]
pub struct Detection {
    pub image_width: usize,
    pub image_height: usize,
    /// Primary result: at least one known GUI layout passed the evidence gates.
    pub gui_detected: bool,
    /// Plausible known types within the type margin; ambiguity is retained.
    pub candidate_types: Vec<String>,
    /// Exact type only. None can mean type ambiguity even with GUI detected.
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
        let mut presence_structure = Vec::new();
        let coloured = screen_type.ends_with("book_edit_screen")
            || screen_type.ends_with("book_sign_screen")
            || screen_type.ends_with("book_view_screen")
            || screen_type.ends_with("lectern_screen")
            || screen_type.ends_with("hanging_sign_edit_screen");
        for y in 1..height - 1 {
            for x in 1..width - 1 {
                let c = pixel(x, y);
                if c[3] != 255 {
                    continue;
                }
                // Coloured icon/model/item interiors are variable. Opaque grey
                // bevel transitions and separators are reusable static anchors.
                if !coloured && c[..3].iter().max().unwrap() - c[..3].iter().min().unwrap() > 8 {
                    continue;
                }
                let group = (usize::from(x >= width / 2)) + 2 * usize::from(y >= height / 2);
                let probe = Probe {
                    x: x as f64 + 0.5,
                    y: y as f64 + 0.5,
                    rgb: [c[0], c[1], c[2]],
                    blended: {
                        let mut sum = [0u32; 3];
                        let mut opaque = true;
                        for yy in y - 1..=y + 1 {
                            for xx in x - 1..=x + 1 {
                                let q = pixel(xx, yy);
                                opaque &= q[3] == 255;
                                for k in 0..3 {
                                    sum[k] += u32::from(q[k]);
                                }
                            }
                        }
                        opaque.then(|| sum.map(|v| ((v + 4) / 9) as u8))
                    },
                    group,
                    viewport_y: 0.,
                };
                if x < 4 || x >= width - 4 || y < 4 || y >= height - 4 {
                    if (x + 3 * y) % 7 == 0 {
                        border.push(probe);
                    }
                } else if x >= 5 && x < width - 5 && y >= 16 && y < height - 5 {
                    let type_limit = if !coloured
                        && width >= 150
                        && height >= 120
                        && !screen_type.ends_with("horse_inventory_screen")
                        && !screen_type.ends_with("merchant_screen")
                    {
                        height.saturating_sub(86).max(32)
                    } else {
                        height - 5
                    };
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
                        .any(|p| p[3] == 255 && (0..3).any(|k| p[k].abs_diff(c[k]) >= 24))
                        && (x + y) % 3 == 0
                    {
                        presence_structure.push(probe);
                        if y < type_limit {
                            structure.push(probe);
                        }
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
        let presence_structure = if screen_type.starts_with("inventory.")
            && !coloured
            && width >= 150
            && height >= 120
        {
            thin(presence_structure, 192)
        } else {
            Vec::new()
        };
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
            offset_x: 0.,
            top_y: None,
            viewport_y: 0.,
            border,
            structure,
            presence_structure,
            identity: Vec::new(),
        })
    }

    /// Additional source-rendered identity anchors, e.g. fixed book controls.
    /// Renameable container titles must never be used as type evidence.
    /// Coordinates may extend outside the panel (book controls below the paper).
    pub fn require_identity(&mut self, pixels: &[(f64, f64, [u8; 3])]) -> Result<(), String> {
        if pixels.len() < 16
            || pixels.len() > 4096
            || pixels.iter().any(|(x, y, _)| {
                !x.is_finite() || !y.is_finite() || x.abs() > 1024. || y.abs() > 1024.
            })
        {
            return Err("invalid GUI identity anchors".into());
        }
        self.identity = pixels
            .iter()
            .map(|&(x, y, rgb)| Probe {
                x,
                y,
                rgb,
                blended: None,
                group: 0,
                viewport_y: 0.,
            })
            .collect();
        Ok(())
    }

    /// GUI source packs are generated locally from the installed client jar.
    /// GUIT1: type, version, variant, width height recipe_shift; then RGBA.
    /// GUIT2 adds a layout line: offset_x top_y identity_count [viewport_y],
    /// followed by identity_count lines: x y r g b [viewport_y], then RGBA.
    /// A top_y of -1 at viewport_y=0 retains the centred legacy geometry.
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        Self::from_bytes(&bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
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
        let format = line()?;
        if format != "GUIT1" && format != "GUIT2" {
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
        let mut identity = Vec::new();
        let mut layout = [0., -1.];
        let mut viewport_y = 0.;
        let mut identity_viewports = Vec::new();
        if format == "GUIT2" {
            let metadata = line()?;
            let fields: Vec<_> = metadata.split_whitespace().collect();
            if fields.len() != 3 && fields.len() != 4 {
                return Err("bad GUI layout header".into());
            }
            layout[0] = fields[0].parse::<f64>().map_err(|_| "bad GUI offset")?;
            layout[1] = fields[1].parse::<f64>().map_err(|_| "bad GUI top")?;
            if !layout.iter().all(|v| v.is_finite() && v.abs() <= 1024.) {
                return Err("invalid GUI layout".into());
            }
            let count = fields[2]
                .parse::<usize>()
                .map_err(|_| "bad identity count")?;
            if fields.len() == 4 {
                viewport_y = fields[3]
                    .parse::<f64>()
                    .map_err(|_| "bad viewport fraction")?;
                if !viewport_y.is_finite() || !(0.0..=1.0).contains(&viewport_y) {
                    return Err("invalid viewport fraction".into());
                }
            }
            if count > 4096 {
                return Err("too many identity anchors".into());
            }
            for _ in 0..count {
                let row = line()?;
                let p: Vec<_> = row.split_whitespace().collect();
                if p.len() != 5 && p.len() != 6 {
                    return Err("bad identity anchor".into());
                }
                identity.push((
                    p[0].parse().map_err(|_| "bad anchor x")?,
                    p[1].parse().map_err(|_| "bad anchor y")?,
                    [
                        p[2].parse().map_err(|_| "bad anchor red")?,
                        p[3].parse().map_err(|_| "bad anchor green")?,
                        p[4].parse().map_err(|_| "bad anchor blue")?,
                    ],
                ));
                let fraction = if p.len() == 6 {
                    p[5].parse::<f64>().map_err(|_| "bad anchor viewport")?
                } else {
                    0.
                };
                if !fraction.is_finite() || !(-1.0..=1.0).contains(&fraction) {
                    return Err("invalid anchor viewport".into());
                }
                identity_viewports.push(fraction);
            }
        }
        let mut template = Self::from_rgba(
            kind,
            version,
            variant,
            shape[0],
            shape[1],
            shape[2] != 0,
            &bytes[cursor..],
        )?;
        template.offset_x = layout[0];
        template.top_y = if layout[1] == -1. && viewport_y == 0. {
            None
        } else {
            Some(layout[1])
        };
        template.viewport_y = viewport_y;
        if !identity.is_empty() {
            template.require_identity(&identity)?;
            for (probe, fraction) in template.identity.iter_mut().zip(identity_viewports) {
                probe.viewport_y = fraction;
                probe.group = usize::from(fraction != 0.);
            }
        }
        Ok(template)
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

#[allow(clippy::too_many_arguments)]
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
        let y = (rect.y + p.y * sy + p.viewport_y * height as f64).floor() as isize;
        if x < 0 || y < 0 || x >= width as isize || y >= height as isize {
            return 0.;
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

struct VisibleEvidence {
    value: Option<f64>,
    probes: usize,
    groups: [usize; 4],
}

/// Container origins are integer divisions in the logical GUI viewport,
/// before capture scaling. Centring an already-scaled panel can skip that
/// raster alignment when the logical viewport was rounded up.
fn source_origin_offset(viewport: usize, extent: usize, scale: f64, centered: bool) -> f64 {
    if centered {
        let logical = (viewport as f64 / scale).ceil();
        let source_origin = ((logical - extent as f64) / 2.).floor() * scale;
        let video_origin = (viewport as f64 - extent as f64 * scale) / 2.;
        (source_origin - video_origin) / scale
    } else {
        0.
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod origin_tests {
    use super::source_origin_offset;

    #[test]
    fn rounded_logical_viewport_pose_is_not_skipped_or_applied_to_fixed_top() {
        let offset = source_origin_offset(1920, 276, 2.25, true);
        assert!((649.5 + offset * 2.25 - 650.25).abs() < 1e-9);
        assert_eq!(source_origin_offset(1920, 276, 2.25, false), 0.);
        assert_eq!(source_origin_offset(400, 80, 2., true), 0.);
    }
}

/// A supplied occlusion mask is evidence from the caller, never inferred from
/// failed colour comparisons. Masked points do not enter either denominator.
#[allow(clippy::too_many_arguments)]
fn visible_evidence(
    rgb: &[u8],
    width: usize,
    height: usize,
    points: &[Probe],
    rect: Rect,
    sx: f64,
    sy: f64,
    tolerance: u8,
    floor: f64,
    occlusion: Option<&[u8]>,
) -> VisibleEvidence {
    let Some(mask) = occlusion else {
        return VisibleEvidence {
            value: Some(score(
                rgb, width, height, points, rect, sx, sy, tolerance, floor,
            )),
            probes: points.len(),
            groups: [0; 4],
        };
    };
    let visible: Vec<_> = points
        .iter()
        .copied()
        .filter(|p| {
            let x = (rect.x + p.x * sx).floor() as isize;
            let y = (rect.y + p.y * sy + p.viewport_y * height as f64).floor() as isize;
            // Out-of-frame points remain a rejected geometry, not an invented mask.
            x < 0
                || y < 0
                || x >= width as isize
                || y >= height as isize
                || mask[y as usize * width + x as usize] == 0
        })
        .collect();
    // A tiny surviving fragment cannot independently establish a screen.
    // These are conservative support guards, not fitted accuracy thresholds.
    if visible.len() < 16 {
        return VisibleEvidence {
            value: None,
            probes: 0,
            groups: [0; 4],
        };
    }
    let mut groups = [0; 4];
    for p in &visible {
        groups[p.group] += 1;
    }
    VisibleEvidence {
        value: Some(score(
            rgb, width, height, &visible, rect, sx, sy, tolerance, floor,
        )),
        probes: visible.len(),
        groups,
    }
}

pub fn detect(
    rgb: &[u8],
    width: usize,
    height: usize,
    templates: &[PanelTemplate],
    opts: Options,
) -> Result<Detection, String> {
    detect_impl(rgb, width, height, templates, opts, None)
}

/// Detect using a caller-supplied video-pixel occlusion mask. Any nonzero mask
/// pixel is neutral, never a mismatch or positive vote. This does not estimate
/// occlusion automatically. Too little visible evidence remains an abstention.
pub fn detect_with_occlusion(
    rgb: &[u8],
    width: usize,
    height: usize,
    templates: &[PanelTemplate],
    opts: Options,
    occlusion: &[u8],
) -> Result<Detection, String> {
    if width.checked_mul(height) != Some(occlusion.len()) {
        return Err("occlusion dimensions do not match frame".into());
    }
    let mask = if occlusion.iter().any(|&p| p != 0) {
        Some(occlusion)
    } else {
        None
    };
    detect_impl(rgb, width, height, templates, opts, mask)
}

fn detect_impl(
    rgb: &[u8],
    width: usize,
    height: usize,
    templates: &[PanelTemplate],
    opts: Options,
    occlusion: Option<&[u8]>,
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
    if occlusion.is_some_and(|mask| mask.iter().all(|&p| p != 0)) {
        return Ok(Detection {
            image_width: width,
            image_height: height,
            gui_detected: false,
            candidate_types: Vec::new(),
            matched: None,
            alternatives: Vec::new(),
            reason: "insufficient_visible_gui_evidence",
        });
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
                    let oy =
                        source_origin_offset(height, template.height, sy, template.top_y.is_none());
                    // Only one extra source-rounded pair, rather than the
                    // Cartesian product of extra x/y offsets. Preserve the
                    // original nine poses and bound the extra search cost.
                    if !origins
                        .iter()
                        .any(|&(x, y): &(f64, f64)| (x - ox).abs() < 1e-9 && (y - oy).abs() < 1e-9)
                    {
                        origins.push((ox, oy));
                    }
                    for (ox, oy) in origins {
                        {
                            let bounds = Rect {
                                x: (width as f64 - pw) / 2. + (template.offset_x + shift + ox) * sx,
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
                            let border = visible_evidence(
                                rgb,
                                width,
                                height,
                                &template.border,
                                bounds,
                                sx,
                                sy,
                                opts.channel_tolerance,
                                opts.min_border,
                                occlusion,
                            );
                            if border.value.is_some_and(|value| value < opts.min_border) {
                                continue;
                            }
                            let mut structure = visible_evidence(
                                rgb,
                                width,
                                height,
                                &template.structure,
                                bounds,
                                sx,
                                sy,
                                opts.channel_tolerance,
                                opts.min_structure,
                                occlusion,
                            );
                            let presence_only = structure
                                .value
                                .is_some_and(|value| value < opts.min_structure);
                            if presence_only {
                                if template.presence_structure.is_empty()
                                    || !template.identity.is_empty()
                                {
                                    continue;
                                }
                                // Shared player slots are useful GUI-presence
                                // evidence, but cannot establish a unique type.
                                structure = visible_evidence(
                                    rgb,
                                    width,
                                    height,
                                    &template.presence_structure,
                                    bounds,
                                    sx,
                                    sy,
                                    opts.channel_tolerance,
                                    opts.min_structure,
                                    occlusion,
                                );
                                if structure
                                    .value
                                    .is_none_or(|value| value < opts.min_structure)
                                {
                                    continue;
                                }
                            }
                            let identity = if !template.identity.is_empty() {
                                visible_evidence(
                                    rgb,
                                    width,
                                    height,
                                    &template.identity,
                                    bounds,
                                    sx,
                                    sy,
                                    opts.channel_tolerance,
                                    0.90,
                                    occlusion,
                                )
                            } else {
                                VisibleEvidence {
                                    value: None,
                                    probes: 0,
                                    groups: [0; 4],
                                }
                            };
                            if identity.value.is_some_and(|value| value < 0.90) {
                                continue;
                            }
                            if occlusion.is_some() {
                                let total = border.probes + structure.probes + identity.probes;
                                let groups = (0..4)
                                    .filter(|&g| {
                                        border.groups[g] + structure.groups[g] + identity.groups[g]
                                            > 0
                                    })
                                    .count();
                                if total < 32 || groups < 2 {
                                    continue;
                                }
                            }
                            let border_score = border.value.unwrap_or(0.);
                            let structure_score = structure.value.unwrap_or(0.);
                            let weight = if border.value.is_some() { 0.3 } else { 0. }
                                + if structure.value.is_some() { 0.7 } else { 0. };
                            let quality = if weight > 0. {
                                (0.3 * border_score + 0.7 * structure_score) / weight
                            } else {
                                identity.value.unwrap_or(0.)
                            };
                            if best.as_ref().is_none_or(|b| {
                                (b.presence_only && !presence_only)
                                    || (b.presence_only == presence_only && quality > b.score)
                            }) {
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
                                    presence_only,
                                    visible_probes: [
                                        border.probes,
                                        structure.probes,
                                        identity.probes,
                                    ],
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
    candidates.sort_by(|a, b| {
        a.presence_only
            .cmp(&b.presence_only)
            .then(b.score.total_cmp(&a.score))
    });
    // Different source-version/visual variants of the SAME known screen are
    // not competing semantic types. Never choose a class solely by iteration.
    let best = candidates.first().cloned();
    let runner = best.as_ref().and_then(|best| {
        candidates
            .iter()
            .find(|p| p.screen_type != best.screen_type && p.presence_only == best.presence_only)
    });
    let ambiguous = best
        .as_ref()
        .zip(runner)
        .is_some_and(|(a, b)| a.score - b.score < opts.min_type_margin);
    let reason = if best.is_none() {
        "no_known_panel_match"
    } else if best.as_ref().is_some_and(|b| b.presence_only) {
        "known_panel_presence"
    } else if ambiguous {
        "ambiguous_known_types"
    } else {
        "known_panel_match"
    };
    let mut candidate_types = Vec::new();
    if let Some(best) = &best {
        for candidate in &candidates {
            if (candidate.screen_type == best.screen_type
                || best.score - candidate.score < opts.min_type_margin)
                && candidate.presence_only == best.presence_only
                && !candidate_types.contains(&candidate.screen_type)
            {
                candidate_types.push(candidate.screen_type.clone());
            }
        }
    }
    candidates.truncate(8);
    Ok(Detection {
        image_width: width,
        image_height: height,
        gui_detected: best.is_some(),
        candidate_types,
        matched: if ambiguous || best.as_ref().is_some_and(|b| b.presence_only) {
            None
        } else {
            best
        },
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
        if !self.gui_detected {
            return Ok(0);
        }
        let Some(hit) = self.matched.as_ref().or_else(|| self.alternatives.first()) else {
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
        let piece_id = if hit.variant.starts_with("fixed_controls") {
            crate::gui_mask::PieceId::MenuButton
        } else {
            crate::gui_mask::PieceId::InventoryPanel
        };
        let piece = piece_id as u8;
        for y in y0..y1 {
            for x in x0..x1 {
                let p = y * mask.width + x;
                if mask.class[p] == 0 {
                    mask.class[p] = 3; // Unknown / neutral, never opaque ownership.
                    mask.piece[p] = piece;
                    count += 1;
                }
            }
        }
        mask.hits.push(crate::gui_mask::PieceHit {
            piece: piece_id,
            index: 0,
            x: x0 as i32,
            y: y0 as i32,
            w: x1.saturating_sub(x0) as u32,
            h: y1.saturating_sub(y0) as u32,
            score: hit.score,
            text: None,
        });
        mask.notes.push(format!(
            "Known GUI layout ({} source); panel region is neutral, not pixel ownership",
            hit.version
        ));
        Ok(count)
    }
}
