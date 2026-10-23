//! GUI-presence policy, with geometry caching and deterministic CPU workers.
use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
#[path = "gui_tooltip.rs"]
mod tooltip;

// Presence settings validated on the downloaded-video sample in
// docs/research/GUI_DOWNLOADED_VIDEO_CHECK.md. These are detector tolerances, not game
// constants or probabilities. Occlusion/support requirements stay independent.
const CHANNEL_TOLERANCE: u8 = 32;
const BORDER_MIN: f64 = 0.80;
const STRUCTURE_MIN: f64 = 0.70;
const IDENTITY_MIN: f64 = 0.90;

#[derive(Hash, PartialEq, Eq, Clone)]
struct Colour {
    low: [u8; 3],
    high: [u8; 3],
}
struct Stage {
    normal: Vec<Colour>,
    small: Vec<Colour>,
    floor: f64,
    allowed: usize,
}
impl Stage {
    fn new(points: &[Probe], floor: f64) -> Self {
        let colours = |small| {
            points
                .iter()
                .map(|p| {
                    let other = if small {
                        p.blended.unwrap_or(p.rgb)
                    } else {
                        p.rgb
                    };
                    Colour {
                        low: std::array::from_fn(|k| {
                            p.rgb[k].min(other[k]).saturating_sub(CHANNEL_TOLERANCE)
                        }),
                        high: std::array::from_fn(|k| {
                            p.rgb[k].max(other[k]).saturating_add(CHANNEL_TOLERANCE)
                        }),
                    }
                })
                .collect()
        };
        // Identical support requirement for every pose and frame. Calculate
        // with the policy's original division/comparison, only once.
        let minimum = (0..=points.len())
            .find(|&n| n as f64 / points.len().max(1) as f64 >= floor)
            .unwrap_or(points.len());
        Self {
            normal: colours(false),
            small: colours(true),
            floor,
            allowed: points.len() - minimum,
        }
    }
}
// Exact semantic keys for the inputs consumed by poses/find/evidence.
// Metadata is deliberately excluded: detect returns the first supported source
// in stable order, so a later equivalent source can never be the winner.
#[derive(Hash, PartialEq, Eq)]
struct ProbeKey {
    position: [u64; 3],
    rgb: [u8; 3],
    blended: Option<[u8; 3]>,
    group: usize,
}
impl From<&Probe> for ProbeKey {
    fn from(p: &Probe) -> Self {
        Self {
            position: [p.x.to_bits(), p.y.to_bits(), p.viewport_y.to_bits()],
            rgb: p.rgb,
            blended: p.blended,
            group: p.group,
        }
    }
}
#[derive(Hash, PartialEq, Eq)]
struct PanelKey {
    dimensions: [usize; 2],
    recipe_shift: bool,
    placement: [u64; 2],
    top_y: Option<u64>,
    screen: [u64; 2],
    probes: [Vec<ProbeKey>; 4],
}
impl From<&PanelTemplate> for PanelKey {
    fn from(t: &PanelTemplate) -> Self {
        Self {
            dimensions: [t.width, t.height],
            recipe_shift: t.recipe_shift,
            placement: [t.offset_x.to_bits(), t.viewport_y.to_bits()],
            top_y: t.top_y.map(f64::to_bits),
            screen: t.screen.map(f64::to_bits),
            probes: [&t.border, &t.structure, &t.presence_structure, &t.identity]
                .map(|points| points.iter().map(ProbeKey::from).collect()),
        }
    }
}

struct PreparedTemplate {
    source: PanelTemplate,
    stages: [Stage; 4],
}
struct Pose {
    bounds: Rect,
    /// The recipe-book shift this pose was placed at (0 or 77 GUI px).
    shift: f64,
    /// Sub-texel origin rounding of this pose (GUI px); viewport-anchored probes do not follow it.
    jitter_y: f64,
    sx: f64,
    sy: f64,
    border: Vec<u32>,
    border_id: usize,
}
struct Plan {
    width: usize,
    height: usize,
    poses: Vec<Vec<Pose>>,
    border_count: usize,
}

/// Presence only: first supported source pose in stable template/search order.
/// No exact container identity is inferred from renameable titles.
pub struct InteractionDetector {
    templates: Vec<PreparedTemplate>,
    /// One plan per frame size: scans of the same video at different sizes
    /// (e.g. native GUI scan and the 1080p no-fire view) share this detector.
    plans: Mutex<Vec<Arc<Plan>>>,
    workers: usize,
}
impl std::fmt::Debug for InteractionDetector {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InteractionDetector")
            .field("templates", &self.templates.len())
            .field("workers", &self.workers)
            .finish_non_exhaustive()
    }
}
impl InteractionDetector {
    /// Use outer frame workers during a whole-video scan, avoiding nested pools.
    pub fn serial(mut self) -> Self {
        self.workers = 1;
        self
    }
    pub fn new(templates: Vec<PanelTemplate>) -> Result<Self, String> {
        Self::with_workers(
            templates,
            std::thread::available_parallelism()
                .map_or(1, usize::from)
                .min(4),
        )
    }
    pub fn with_workers(templates: Vec<PanelTemplate>, workers: usize) -> Result<Self, String> {
        if templates.is_empty() || workers == 0 || workers > 32 {
            return Err("invalid interaction detector configuration".into());
        }
        let mut seen = std::collections::HashSet::new();
        Ok(Self {
            templates: templates
                .into_iter()
                .filter(|source| seen.insert(PanelKey::from(source)))
                .map(|source| {
                    let stages = [
                        (&source.border, BORDER_MIN),
                        (&source.structure, STRUCTURE_MIN),
                        (&source.presence_structure, STRUCTURE_MIN),
                        (&source.identity, IDENTITY_MIN),
                    ]
                    .map(|(p, floor)| Stage::new(p, floor));
                    PreparedTemplate { source, stages }
                })
                .collect(),
            plans: Mutex::new(Vec::new()),
            workers,
        })
    }
    /// A build-generated bundle of locally extracted vanilla source packs.
    pub fn from_bundle(bytes: &[u8]) -> Result<Self, String> {
        let mut cursor = 0;
        let mut templates = Vec::new();
        while cursor < bytes.len() {
            let size = bytes.get(cursor..cursor + 4).ok_or("short GUI bundle")?;
            let size = u32::from_le_bytes(size.try_into().unwrap()) as usize;
            cursor += 4;
            let end = cursor.checked_add(size).ok_or("invalid GUI bundle size")?;
            templates.push(PanelTemplate::from_bytes(
                bytes.get(cursor..end).ok_or("short GUI source pack")?,
            )?);
            cursor = end;
        }
        Self::new(templates)
    }
    fn plan(&self, width: usize, height: usize) -> Arc<Plan> {
        let find = |plans: &[Arc<Plan>]| {
            plans
                .iter()
                .find(|p| p.width == width && p.height == height)
                .cloned()
        };
        if let Some(plan) = find(&self.plans.lock().unwrap_or_else(|e| e.into_inner())) {
            return plan;
        }
        // Build outside the lock: planning one size never blocks lookups of another.
        let mut poses: Vec<Vec<Pose>> = self
            .templates
            .iter()
            .map(|t| poses(&t.source, width, height))
            .collect();
        // Border scores depend only on the ordered RGB offsets and colour
        // intervals when no tooltip is present. Fold those exact checks, not
        // panel identities: later structure/identity stages remain independent.
        // HashMap equality checks the complete key (hash collisions are safe).
        let mut keys = std::collections::HashMap::new();
        for (t, poses) in self.templates.iter().zip(&mut poses) {
            for pose in poses {
                let colours = if pose.sx < 1. && pose.sy < 1. {
                    &t.stages[0].small
                } else {
                    &t.stages[0].normal
                };
                let key = (pose.border.clone(), colours.clone());
                let next = keys.len();
                pose.border_id = *keys.entry(key).or_insert(next);
            }
        }
        let border_count = keys.len();
        let plan = Arc::new(Plan {
            width,
            height,
            poses,
            border_count,
        });
        let mut plans = self.plans.lock().unwrap_or_else(|e| e.into_inner());
        // Another thread may have built the same size meanwhile: keep the first.
        if let Some(existing) = find(&plans) {
            return existing;
        }
        // A handful of sizes at most in practice; bound memory regardless.
        if plans.len() >= 4 {
            plans.remove(0);
        }
        plans.push(plan.clone());
        plan
    }
    pub fn prepare(&self, width: usize, height: usize) -> Result<(), String> {
        if width == 0
            || height == 0
            || width
                .checked_mul(height)
                .and_then(|n| n.checked_mul(3))
                .is_none_or(|n| n >= u32::MAX as usize)
        {
            return Err("invalid interaction frame dimensions".into());
        }
        let _ = self.plan(width, height);
        Ok(())
    }
    pub fn detect(&self, rgb: &[u8], width: usize, height: usize) -> Result<Detection, String> {
        self.detect_with_scale(rgb, width, height, None)
    }
    /// One frame has one GUI scale: vanilla draws the HUD and every screen with it, so a panel at another scale than
    /// a reliable HUD is not a screen (the HUD's many pieces outvote one panel match). `hud_scale` is only measured
    /// when a panel was found; on disagreement the search is repeated at the HUD's scale. Same decisions as always
    /// searching at the HUD scale, at the cost of the HUD fit on positive frames only.
    pub fn detect_at_hud_scale(
        &self,
        rgb: &[u8],
        width: usize,
        height: usize,
        hud_scale: impl FnOnce() -> Result<Option<f64>, String>,
    ) -> Result<Detection, String> {
        let first = self.detect_with_scale(rgb, width, height, None)?;
        let Some(found) = first.alternatives.first() else {
            return Ok(first);
        };
        let Some(scale) = hud_scale()? else {
            return Ok(first);
        };
        let agrees = |sx: f64| (sx - scale).abs() <= SCALE_PRUNE_TOLERANCE;
        if agrees(found.scale_x) {
            return Ok(first);
        }
        let mut again = self.detect_with_scale(rgb, width, height, Some(scale))?;
        // the rule holds even with the pose-pruning switch off
        if again
            .alternatives
            .first()
            .is_some_and(|p| !agrees(p.scale_x))
        {
            again.alternatives.clear();
            again.gui_detected = false;
            again.reason = "no_known_panel_match".into();
        }
        Ok(again)
    }
    /// `hud_scale`: the frame's reliable HUD scale; used to restrict the pose
    /// search only while the `SCALE_PRUNE` experiment switch is on.
    pub fn detect_with_scale(
        &self,
        rgb: &[u8],
        width: usize,
        height: usize,
        hud_scale: Option<f64>,
    ) -> Result<Detection, String> {
        if width.checked_mul(height).and_then(|n| n.checked_mul(3)) != Some(rgb.len()) {
            return Err("invalid interaction RGB dimensions".into());
        }
        let near_scale = hud_scale.filter(|_| SCALE_PRUNE.load(Ordering::Relaxed));
        self.prepare(width, height)?;
        let plan = self.plan(width, height);
        let timer = crate::profile::start(16);
        let tips = tooltip::detect_tooltips(rgb, width, height);
        let mask = (!tips.is_empty()).then(|| tooltip::mask(&tips, width, height));
        drop(timer);
        let _timer = crate::profile::start(17);
        let first = AtomicUsize::new(self.templates.len());
        let chunk = self.templates.len().div_ceil(self.workers);
        let hits = if self.workers == 1 {
            let mut rejected = vec![false; plan.border_count];
            self.templates
                .iter()
                .enumerate()
                .find_map(|(i, t)| {
                    find(
                        rgb,
                        &plan,
                        t,
                        &plan.poses[i],
                        mask.as_deref(),
                        near_scale,
                        &mut rejected,
                    )
                    .map(|hit| {
                        first.store(i, Ordering::Relaxed);
                        (i, hit)
                    })
                })
                .into_iter()
                .collect()
        } else {
            std::thread::scope(|scope| {
                let handles: Vec<_> = (0..self.templates.len())
                    .step_by(chunk)
                    .map(|start| {
                        let end = (start + chunk).min(self.templates.len());
                        let (plan, mask, first) = (&plan, mask.as_deref(), &first);
                        scope.spawn(move || {
                            let mut rejected = vec![false; plan.border_count];
                            for i in start..end {
                                if i >= first.load(Ordering::Relaxed) {
                                    break;
                                }
                                if let Some(hit) = find(
                                    rgb,
                                    plan,
                                    &self.templates[i],
                                    &plan.poses[i],
                                    mask,
                                    near_scale,
                                    &mut rejected,
                                ) {
                                    first.fetch_min(i, Ordering::Relaxed);
                                    return Some((i, hit));
                                }
                            }
                            None
                        })
                    })
                    .collect();
                handles
                    .into_iter()
                    .filter_map(|h| h.join().expect("GUI worker panicked"))
                    .collect::<Vec<_>>()
            })
        };
        let hit = hits.into_iter().min_by_key(|h| h.0).map(|h| h.1);
        Ok(Detection {
            image_width: width,
            image_height: height,
            gui_detected: hit.is_some(),
            candidate_types: Vec::new(),
            matched: None,
            alternatives: hit.into_iter().collect(),
            reason: if first.load(Ordering::Relaxed) < self.templates.len() {
                "known_panel_presence"
            } else {
                "no_known_panel_match"
            }
            .into(),
            tooltips: tips
                .iter()
                .map(|t| Rect {
                    x: t.x as f64,
                    y: t.y as f64,
                    width: t.w as f64,
                    height: t.h as f64,
                })
                .collect(),
        })
    }
}

fn offset(p: &Probe, pose: &Pose, w: usize, h: usize) -> u32 {
    let x = (pose.bounds.x + p.x * pose.sx).floor() as isize;
    let jitter = if p.viewport_y != 0. {
        pose.jitter_y
    } else {
        0.
    };
    let y = (pose.bounds.y + (p.y - jitter) * pose.sy + p.viewport_y * h as f64).floor() as isize;
    if x < 0 || y < 0 || x >= w as isize || y >= h as isize {
        u32::MAX
    } else {
        ((y as usize * w + x as usize) * 3) as u32
    }
}

fn poses(t: &PanelTemplate, w: usize, h: usize) -> Vec<Pose> {
    let mut result = Vec::new();
    for i in 0..=58 {
        let sx = 0.75 + i as f64 * 0.125;
        for ratio in [1., 0.95, 1.05] {
            let sy = sx * ratio;
            let (pw, ph) = (t.width as f64 * sx, t.height as f64 * sy);
            if pw > w as f64 + 1. || ph > h as f64 + 1. {
                continue;
            }
            for shift in if t.recipe_shift {
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
                let ox = source_origin_offset(w, t.width, sx, true);
                let oy = source_origin_offset(h, t.height, sy, t.top_y.is_none());
                if !origins
                    .iter()
                    .any(|&(x, y): &(f64, f64)| (x - ox).abs() < 1e-9 && (y - oy).abs() < 1e-9)
                {
                    origins.push((ox, oy));
                }
                for (ox, oy) in origins {
                    let bounds = Rect {
                        x: (w as f64 - pw) / 2. + (t.offset_x + shift + ox) * sx,
                        y: t.top_y.map_or((h as f64 - ph) / 2., |top| top * sy)
                            + t.viewport_y * h as f64
                            + oy * sy,
                        width: pw,
                        height: ph,
                    };
                    if bounds.x < -1. || bounds.x + pw > w as f64 + 1. {
                        continue;
                    }
                    let mut pose = Pose {
                        bounds,
                        shift: *shift,
                        jitter_y: oy,
                        sx,
                        sy,
                        border: Vec::new(),
                        border_id: 0,
                    };
                    pose.border = t.border.iter().map(|p| offset(p, &pose, w, h)).collect();
                    result.push(pose);
                }
            }
        }
    }
    result
}

struct Evidence {
    value: Option<f64>,
    probes: usize,
    groups: [usize; 4],
}
#[allow(clippy::too_many_arguments)]
fn evidence(
    rgb: &[u8],
    plan: &Plan,
    pose: &Pose,
    points: &[Probe],
    stage: &Stage,
    cached: Option<&[u32]>,
    regional: bool,
    mask: Option<&[u8]>,
) -> Evidence {
    let colours = if pose.sx < 1. && pose.sy < 1. {
        &stage.small
    } else {
        &stage.normal
    };
    let (mut good, mut visible, mut groups) = (0usize, 0usize, [[0usize; 2]; 4]);
    for (i, p) in points.iter().enumerate() {
        let at = cached.map_or_else(|| offset(p, pose, plan.width, plan.height), |v| v[i]);
        // Probe addresses are scattered over an 11 MB frame; fetch a few ahead so
        // the loop is not one cache miss per probe (exact: a hint only).
        #[cfg(target_arch = "x86_64")]
        if let Some(v) = cached {
            if let Some(&next) = v.get(i + PREFETCH_DISTANCE) {
                if next != u32::MAX && (next as usize) < rgb.len() {
                    // SAFETY: prefetch has no architectural effect; the address is in bounds.
                    unsafe {
                        std::arch::x86_64::_mm_prefetch::<{ std::arch::x86_64::_MM_HINT_T0 }>(
                            rgb.as_ptr().add(next as usize) as *const i8,
                        )
                    };
                }
            }
        }
        if at == u32::MAX {
            return Evidence {
                value: Some(0.),
                probes: points.len(),
                groups: [0; 4],
            };
        }
        let at = at as usize;
        if mask.is_some_and(|m| m[at / 3] != 0) {
            continue;
        }
        let c = &colours[i];
        let agrees = rgb[at] >= c.low[0]
            && rgb[at] <= c.high[0]
            && rgb[at + 1] >= c.low[1]
            && rgb[at + 1] <= c.high[1]
            && rgb[at + 2] >= c.low[2]
            && rgb[at + 2] <= c.high[2];
        visible += 1;
        good += usize::from(agrees);
        if regional || mask.is_some() {
            groups[p.group][0] += usize::from(agrees);
            groups[p.group][1] += 1;
        }
        // Safe upper bound: masking can only reduce the final denominator.
        // Do not reject a masked stage until it has enough visible support.
        if visible - good > stage.allowed && (mask.is_none() || visible >= 16) {
            return Evidence {
                value: Some(0.),
                probes: visible,
                groups: [0; 4],
            };
        }
    }
    if mask.is_some() && visible < 16 {
        return Evidence {
            value: None,
            probes: 0,
            groups: [0; 4],
        };
    }
    let mut value = good as f64 / visible.max(1) as f64;
    if regional
        && groups
            .iter()
            .any(|g| g[1] > 0 && g[0] as f64 / (g[1] as f64) < stage.floor - 0.15)
    {
        value = 0.;
    }
    Evidence {
        value: Some(value),
        probes: visible,
        groups: groups.map(|g| g[1]),
    }
}

/// The open screen a match stands for: the patch, the source pack's declared screen extent (centred on the patch,
/// from its top) and the fixed-control anchors outside it (a heading above a button grid). Clipped to the frame.
fn screen_extent(t: &PanelTemplate, pose: &Pose, plan: &Plan) -> Rect {
    let b = pose.bounds;
    let (mut x0, mut y0, mut x1, mut y1) = (b.x, b.y, b.x + b.width, b.y + b.height);
    let [sw, sh] = t.screen;
    if sw > 0. && sh > 0. {
        let cx = b.x + b.width / 2.;
        x0 = x0.min(cx - sw * pose.sx / 2.);
        x1 = x1.max(cx + sw * pose.sx / 2.);
        y1 = y1.max(b.y + sh * pose.sy);
    }
    for p in &t.identity {
        let jitter = if p.viewport_y != 0. {
            pose.jitter_y
        } else {
            0.
        };
        let x = b.x + p.x * pose.sx;
        let y = b.y + (p.y - jitter) * pose.sy + p.viewport_y * plan.height as f64;
        // a glyph texel around its centre
        x0 = x0.min(x - pose.sx / 2.);
        x1 = x1.max(x + pose.sx / 2.);
        y0 = y0.min(y - pose.sy / 2.);
        y1 = y1.max(y + pose.sy / 2.);
    }
    let (x0, y0) = (x0.max(0.), y0.max(0.));
    let (x1, y1) = (x1.min(plan.width as f64), y1.min(plan.height as f64));
    Rect {
        x: x0,
        y: y0,
        width: (x1 - x0).max(0.),
        height: (y1 - y0).max(0.),
    }
}

const PREFETCH_DISTANCE: usize = 6;

/// Perf-lab experiment switch: when set, `find` only visits poses whose
/// horizontal scale is within `SCALE_PRUNE_TOLERANCE` of the HUD fit scale.
/// Vanilla draws every screen with the window's single GUI scale factor, so a
/// panel at another scale than the hotbar does not occur in unmodified footage.
pub static SCALE_PRUNE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
pub const SCALE_PRUNE_TOLERANCE: f64 = 0.26;

fn find(
    rgb: &[u8],
    plan: &Plan,
    t: &PreparedTemplate,
    poses: &[Pose],
    mask: Option<&[u8]>,
    near_scale: Option<f64>,
    rejected: &mut [bool],
) -> Option<PanelMatch> {
    let source = &t.source;
    let mut visited = 0u64;
    let result = (|| {
        for pose in poses {
            if let Some(scale) = near_scale {
                if (pose.sx - scale).abs() > SCALE_PRUNE_TOLERANCE {
                    continue;
                }
            }
            visited += 1;
            // Reuse only definite border rejection, within this frame and worker.
            // With occlusion, group/support accounting also matters; use the
            // original path. Never reuse results across frames or reorder winners.
            if mask.is_none() && rejected[pose.border_id] {
                continue;
            }
            let border = evidence(
                rgb,
                plan,
                pose,
                &source.border,
                &t.stages[0],
                Some(&pose.border),
                false,
                mask,
            );
            if border.value.is_some_and(|v| v < BORDER_MIN) {
                if mask.is_none() {
                    rejected[pose.border_id] = true;
                }
                continue;
            }
            let mut structure = evidence(
                rgb,
                plan,
                pose,
                &source.structure,
                &t.stages[1],
                None,
                false,
                mask,
            );
            if structure.value.is_some_and(|v| v < STRUCTURE_MIN) {
                if !source.identity.is_empty() || source.presence_structure.is_empty() {
                    continue;
                }
                structure = evidence(
                    rgb,
                    plan,
                    pose,
                    &source.presence_structure,
                    &t.stages[2],
                    None,
                    false,
                    mask,
                );
                if structure.value.is_none_or(|v| v < STRUCTURE_MIN) {
                    continue;
                }
            }
            let identity = if source.identity.is_empty() {
                Evidence {
                    value: None,
                    probes: 0,
                    groups: [0; 4],
                }
            } else {
                evidence(
                    rgb,
                    plan,
                    pose,
                    &source.identity,
                    &t.stages[3],
                    None,
                    true,
                    mask,
                )
            };
            if identity.value.is_some_and(|v| v < IDENTITY_MIN) {
                continue;
            }
            if mask.is_some()
                && (border.probes + structure.probes + identity.probes < 32
                    || (0..4)
                        .filter(|&g| {
                            border.groups[g] + structure.groups[g] + identity.groups[g] > 0
                        })
                        .count()
                        < 2)
            {
                continue;
            }
            return Some(PanelMatch {
                screen_type: source.screen_type.clone(),
                version: source.version.clone(),
                variant: source.variant.clone(),
                bounds: screen_extent(source, pose, plan),
                scale_x: pose.sx,
                scale_y: pose.sy,
                score: border.value.unwrap_or(0.) * 0.3 + structure.value.unwrap_or(0.) * 0.7,
                border_score: border.value.unwrap_or(0.),
                structure_score: structure.value.unwrap_or(0.),
                presence_only: true,
                visible_probes: [border.probes, structure.probes, identity.probes],
                recipe_book: pose.shift > 0.,
            });
        }
        None
    })();
    crate::profile::count(0, visited);
    crate::profile::count(2, poses.len() as u64);
    result
}

#[cfg(test)]
mod folding {
    use super::*;
    fn base() -> PanelTemplate {
        let p = Probe {
            x: 1.5,
            y: 2.5,
            rgb: [180; 3],
            blended: Some([179; 3]),
            group: 0,
            viewport_y: 0.,
        };
        PanelTemplate {
            screen_type: "inventory.first".into(),
            version: "first".into(),
            variant: "base".into(),
            width: 80,
            height: 80,
            recipe_shift: false,
            offset_x: 0.,
            top_y: None,
            viewport_y: 0.,
            border: vec![p; 16],
            structure: vec![p; 16],
            presence_structure: vec![p; 16],
            identity: vec![p; 16],
            screen: [0.; 2],
        }
    }
    /// Scans at different frame sizes share one detector (the app's first-person,
    /// no-fire and GUI scans): alternating sizes must reuse each size's plan, not
    /// rebuild it on every call.
    #[test]
    fn plans_for_different_frame_sizes_are_kept_side_by_side() {
        let bank = InteractionDetector::with_workers(vec![base()], 1).unwrap();
        let small = bank.plan(1920, 1080);
        let large = bank.plan(2560, 1440);
        for _ in 0..5 {
            assert!(Arc::ptr_eq(&small, &bank.plan(1920, 1080)));
            assert!(Arc::ptr_eq(&large, &bank.plan(2560, 1440)));
        }
        assert_eq!((small.width, small.height), (1920, 1080));
        assert_eq!((large.width, large.height), (2560, 1440));
        // Detection results do not depend on which sizes were planned before.
        let fresh = InteractionDetector::with_workers(vec![base()], 1).unwrap();
        let rgb = vec![31u8; 1920 * 1080 * 3];
        let a = bank.detect(&rgb, 1920, 1080).unwrap();
        let b = fresh.detect(&rgb, 1920, 1080).unwrap();
        assert_eq!(a.gui_detected, b.gui_detected);
        assert_eq!(a.reason, b.reason);
    }
    #[test]
    fn exact_aliases_keep_first_source_and_every_decision_input_matters() {
        let a = base();
        let mut alias = a.clone();
        alias.screen_type = "options.other".into();
        alias.version = "later".into();
        alias.variant = "fixed_controls_later".into();
        let bank = InteractionDetector::with_workers(vec![a.clone(), alias], 4).unwrap();
        assert_eq!(bank.templates.len(), 1);
        assert_eq!(bank.templates[0].source.screen_type, "inventory.first");
        assert_eq!(bank.templates[0].source.version, "first");
        let hit = bank.detect(&vec![180; 400 * 240 * 3], 400, 240).unwrap();
        assert_eq!(hit.alternatives[0].screen_type, "inventory.first");
        assert_eq!(hit.alternatives[0].variant, "base");
        let mut ordered = a.clone();
        ordered.border[1].x += 0.5;
        let mut reordered = ordered.clone();
        reordered.border.swap(0, 1);
        assert!(PanelKey::from(&ordered) != PanelKey::from(&reordered));

        let changes: &[fn(&mut PanelTemplate)] = &[
            |t| t.width += 1,
            |t| t.height += 1,
            |t| t.recipe_shift = true,
            |t| t.offset_x = 0.5,
            |t| t.top_y = Some(0.),
            |t| t.viewport_y = 0.25,
            |t| t.border[0].x += 0.5,
            |t| t.border[0].y += 0.5,
            |t| t.border[0].rgb[0] += 1,
            |t| t.border[0].blended = None,
            |t| t.border[0].group = 1,
            |t| t.border[0].viewport_y = 0.5,
            |t| t.border.push(t.border[0]),
            |t| t.structure[0].rgb[0] += 1,
            |t| t.presence_structure.clear(),
            |t| t.identity.clear(),
        ];
        for change in changes {
            let mut b = a.clone();
            change(&mut b);
            assert!(PanelKey::from(&a) != PanelKey::from(&b));
            assert_eq!(
                InteractionDetector::with_workers(vec![a.clone(), b], 1)
                    .unwrap()
                    .templates
                    .len(),
                2
            );
        }
    }
    #[test]
    fn shared_border_rejection_keeps_structure_and_frame_independent() {
        let a = base();
        let mut b = a.clone();
        b.screen_type = "second".into();
        b.structure[0].rgb = [40; 3];
        b.identity[0].rgb = [40; 3];
        let detector = InteractionDetector::with_workers(vec![a, b], 1).unwrap();
        let plan = detector.plan(400, 240);
        assert!(plan.border_count < plan.poses.iter().map(Vec::len).sum());
        assert_eq!(plan.poses[0][0].border_id, plan.poses[1][0].border_id);
        for colour in [0, 180, 40, 180, 255] {
            let rgb = vec![colour; 400 * 240 * 3];
            // Exhaustive ordered reference: no failure is reused between poses.
            let expected = detector
                .templates
                .iter()
                .zip(&plan.poses)
                .find_map(|(t, poses)| {
                    poses.iter().find_map(|pose| {
                        find(
                            &rgb,
                            &plan,
                            t,
                            std::slice::from_ref(pose),
                            None,
                            None,
                            &mut vec![false; plan.border_count],
                        )
                    })
                });
            let actual = detector.detect(&rgb, 400, 240).unwrap();
            assert_eq!(
                format!("{:?}", expected),
                format!("{:?}", actual.alternatives.first().cloned())
            );
        }
        let mut c = base();
        c.border[0].rgb = [40; 3];
        let detector = InteractionDetector::with_workers(vec![base(), c], 1).unwrap();
        let plan = detector.plan(400, 240);
        assert_ne!(plan.poses[0][0].border_id, plan.poses[1][0].border_id);
    }

    #[test]
    fn installed_source_bank_equivalence_audit() {
        let bytes = std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../data/assets/gui/interaction.bundle"),
        )
        .unwrap();
        let mut source = Vec::new();
        let mut cursor = 0;
        while cursor < bytes.len() {
            let n = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
            cursor += 4;
            source.push(PanelTemplate::from_bytes(&bytes[cursor..cursor + n]).unwrap());
            cursor += n;
        }
        let original_count = source.len();
        let mut groups: std::collections::HashMap<PanelKey, Vec<String>> = Default::default();
        for t in &source {
            groups
                .entry(PanelKey::from(t))
                .or_default()
                .push(format!("{}:{}:{}", t.version, t.screen_type, t.variant));
        }
        let bank = InteractionDetector::with_workers(source, 1).unwrap();
        assert_eq!(bank.templates.len(), groups.len());
        eprintln!("PANEL_GROUP_COUNT {} {}", original_count, groups.len());
        let mut groups: Vec<_> = groups.into_values().collect();
        groups.sort_by(|a, b| a[0].cmp(&b[0]));
        for group in groups {
            eprintln!("PANEL_GROUP {}", group.join("|"));
        }
    }
}
