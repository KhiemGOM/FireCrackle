//! Automatic perspective reversal from the picture alone (no labels, no clicks). Stage 1: rotation and FOV.
//!
//! Minecraft is a Manhattan world: every block edge and every texel edge runs along a world axis, so the gradient at
//! an edge pixel is perpendicular to the image line through that pixel towards one of the three axis vanishing points
//! (Coughlan & Yuille's "Manhattan world" alignment). A camera hypothesis (`camera::Camera` rotation + FOV) is scored
//! by how many edge pixels it explains; a coarse grid then a pattern search finds the best one. Yaw is only defined
//! modulo 90°: a quarter turn maps the three axes onto themselves.

use crate::camera::Camera;
use crate::lines::segments;

/// Camera rotation and FOV from a frame. Yaw is in [0, 90): the axes look the same after a quarter turn.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Orientation {
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
    pub fov: f64,
    /// False when fewer than two vanishing points are both finite and seen (e.g. looking along an axis with the
    /// horizon level): `fov` is then a guess and should come from neighbouring frames.
    pub fov_known: bool,
    /// Another rotation, more than 5° away, explains the edges almost as well (`margin` < `AMBIGUOUS_MARGIN`).
    pub ambiguous: bool,
    /// 1 − (score of the best rotation more than 5° away) / (best score): how clearly this answer wins.
    pub margin: f64,
    /// Share of segment length the answer explains (within 2°).
    pub support: f64,
    /// Segments used.
    pub edges: usize,
}

/// A segment as the scorer uses it: centre (y up), unit normal (y up), weight and its own angular variance.
#[derive(Clone, Copy)]
struct Edge {
    x: f64,
    y: f64,
    gx: f64,
    gy: f64,
    weight: f64,
    /// sin² of the segment's own direction uncertainty (about 1.5 px over its length).
    var: f64,
}

const MIN_SEGMENTS: usize = 20;
/// Shorter segments are mostly texture noise (netherrack, lava) with directions good to only ±10°.
const MIN_LENGTH: f64 = 16.0;
/// A segment counts for its length up to this, so a few long non-world edges cannot outvote the world.
const MAX_WEIGHT: f64 = 60.0;
/// Segments within this many degrees of exactly horizontal or vertical on screen count for `SCREEN_ALIGNED_WEIGHT`:
/// screen-space drawing (GUI the mask missed, chat, toasts, overlays, facecams, compression blocks) is exactly
/// aligned and otherwise pulls the answer to a level, axis-aligned camera with a narrow FOV.
const SCREEN_ALIGNED: f64 = 1.0;
const SCREEN_ALIGNED_WEIGHT: f64 = 0.1;
/// View bobbing stays within ±1°; hurt tilt is brief. A larger roll is how a 90° pitch swap fakes a fit.
const MAX_ROLL: f64 = 6.0;
/// Below this the answers on the recordings were the level, axis-aligned non-answer; zooming (OptiFine, spyglass) is
/// left to the manual tool.
const MIN_FOV: f64 = 45.0;
const MIN_SUPPORT: f64 = 0.1;
/// Margin below which an answer is ambiguous: on quad1 and survival1, answers at or above it were more than 2°
/// off 4–8 % of the time, against 30–60 % below 0.05.
pub const AMBIGUOUS_MARGIN: f64 = 0.1;
const ASSIGNED: f64 = 0.0012; // sin²(2°)

/// The first-person arm and held item cover the bottom corners, drawn with their own fixed projection: their edges
/// are not world edges and are left out. In image fractions (x right, y down).
fn in_hand_zone(fx: f64, fy: f64) -> bool {
    fy > 0.5 && (fx > 0.62 || fx < 0.3)
}

fn edges(rgb: &[u8], w: usize, h: usize, ignore: Option<&[bool]>) -> Vec<Edge> {
    segments(rgb, w, h, ignore)
        .into_iter()
        .filter(|s| s.length >= MIN_LENGTH)
        .filter(|s| !in_hand_zone(s.centre[0] / w as f64 + 0.5, 0.5 - s.centre[1] / h as f64))
        .map(|s| {
            // degrees off the nearest screen axis
            let off = s.dir[0].abs().min(s.dir[1].abs()).asin().to_degrees();
            Edge {
                x: s.centre[0],
                y: s.centre[1],
                gx: -s.dir[1],
                gy: s.dir[0],
                weight: s.length.min(MAX_WEIGHT)
                    * if off < SCREEN_ALIGNED {
                        SCREEN_ALIGNED_WEIGHT
                    } else {
                        1.0
                    },
                var: (1.5 / s.length).powi(2),
            }
        })
        .collect()
}

#[derive(Clone, Copy, Debug)]
struct Hypothesis {
    yaw: f64,
    pitch: f64,
    roll: f64,
    fov: f64,
}

impl Hypothesis {
    fn camera(self) -> Camera {
        Camera {
            pos: [0.0; 3],
            yaw: self.yaw,
            pitch: self.pitch,
            roll: self.roll,
            fov: self.fov,
        }
    }

    /// The three world axes in view space.
    fn axes(self) -> [[f64; 3]; 3] {
        let c = self.camera();
        [
            c.to_view([1.0, 0.0, 0.0]),
            c.to_view([0.0, 1.0, 0.0]),
            c.to_view([0.0, 0.0, 1.0]),
        ]
    }

    fn get(self, k: usize) -> f64 {
        [self.yaw, self.pitch, self.roll, self.fov][k]
    }

    fn with(mut self, k: usize, v: f64) -> Hypothesis {
        match k {
            0 => self.yaw = v,
            1 => self.pitch = v,
            2 => self.roll = v,
            _ => self.fov = v,
        }
        self
    }

    fn plausible(self) -> bool {
        self.pitch.abs() <= 90.0
            && self.roll.abs() <= MAX_ROLL
            && self.fov >= MIN_FOV
            && self.fov < 170.0
    }
}

/// Smallest sin² of the angle between the edge's gradient and the normal of its image line towards each vanishing
/// point, and the axis it belongs to.
fn residual(e: &Edge, axes: &[[f64; 3]; 3], f: f64) -> (f64, usize) {
    let (mut best, mut axis) = (1.0, 0);
    for (k, d) in axes.iter().enumerate() {
        // normal of the plane through the camera, the pixel ray (x, y, -f) and direction d, projected on the image
        let nx = e.y * d[2] + f * d[1];
        let ny = -f * d[0] - e.x * d[2];
        let nn = nx * nx + ny * ny;
        if nn < 1e-12 {
            continue;
        }
        let c = e.gx * nx + e.gy * ny;
        let s2 = 1.0 - c * c / nn;
        if s2 < best {
            (best, axis) = (s2, k);
        }
    }
    (best, axis)
}

fn focal(fov: f64, h: usize) -> f64 {
    h as f64 / 2.0 / (fov.to_radians() / 2.0).tan()
}

fn score(edges: &[Edge], hyp: Hypothesis, h: usize, sigma2: f64) -> f64 {
    if !hyp.plausible() {
        return f64::NEG_INFINITY;
    }
    let axes = hyp.axes();
    let f = focal(hyp.fov, h);
    edges
        .iter()
        .map(|e| e.weight * (-residual(e, &axes, f).0 / (2.0 * (sigma2 + e.var))).exp())
        .sum()
}

/// Coordinate pattern search on yaw, pitch, roll, FOV with a narrowing kernel.
#[allow(clippy::needless_range_loop)] // k indexes the parameter and its step together
fn refine(edges: &[Edge], start: Hypothesis, h: usize) -> (Hypothesis, f64) {
    let mut hyp = start;
    let mut best = f64::NEG_INFINITY;
    for sigma in [0.07, 0.035, 0.015] {
        let s2 = sigma * sigma;
        best = score(edges, hyp, h, s2);
        let mut step = [
            sigma.to_degrees() * 0.5,
            sigma.to_degrees() * 0.5,
            sigma.to_degrees() * 0.5,
            2.0,
        ];
        while step.iter().any(|&s| s > 0.004) {
            let mut moved = false;
            for k in 0..4 {
                for sign in [1.0, -1.0] {
                    let c = hyp.with(k, hyp.get(k) + sign * step[k]);
                    let s = score(edges, c, h, s2);
                    if s > best {
                        (hyp, best, moved) = (c, s, true);
                        break;
                    }
                }
            }
            if !moved {
                for s in &mut step {
                    *s /= 2.0;
                }
            }
        }
    }
    (hyp, best)
}

/// Angle (degrees) between two rotations, after the best quarter turn of yaw.
fn rotation_gap(a: Hypothesis, b: Hypothesis) -> f64 {
    let (fa, ca) = (a.camera(), b.camera());
    (0..4)
        .map(|q| {
            let cb = Camera {
                yaw: ca.yaw + 90.0 * q as f64,
                ..ca
            };
            let mut worst: f64 = 0.0;
            for v in [[0.0, 0.0, -1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]] {
                let (p, q) = (fa.view_dir_to_world(v), cb.view_dir_to_world(v));
                let dot = p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
                let cross = [
                    p[1] * q[2] - p[2] * q[1],
                    p[2] * q[0] - p[0] * q[2],
                    p[0] * q[1] - p[1] * q[0],
                ];
                let sin = (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt();
                worst = worst.max(sin.atan2(dot).to_degrees());
            }
            worst
        })
        .fold(f64::INFINITY, f64::min)
}

fn parallel<T: Send, F: Fn(usize) -> T + Sync>(n: usize, f: F) -> Vec<T> {
    crate::camera::parallel_map(n, f)
}

/// Rotation (yaw modulo 90°) and FOV of the camera that drew `rgb` (RGB24, `w`×`h`). `ignore` marks pixels that are
/// not the world (GUI); the hand, entities and noise are outvoted. None when the picture has too few world edges.
pub fn orientation(rgb: &[u8], w: usize, h: usize, ignore: Option<&[bool]>) -> Option<Orientation> {
    if w < 3 || h < 3 || rgb.len() != w * h * 3 || ignore.is_some_and(|m| m.len() != w * h) {
        return None;
    }
    let edges = edges(rgb, w, h, ignore);
    if edges.len() < MIN_SEGMENTS {
        return None;
    }
    // coarse grid, roll 0
    let mut grid = Vec::new();
    for fov in [40.0, 60.0, 80.0, 100.0, 120.0, 140.0] {
        for pitch in (-22..=22).map(|i| i as f64 * 4.0) {
            for yaw in (0..30).map(|i| i as f64 * 3.0) {
                grid.push(Hypothesis {
                    yaw,
                    pitch,
                    roll: 0.0,
                    fov,
                });
            }
        }
    }
    let coarse_s2 = 0.07f64 * 0.07;
    let scores = parallel(grid.len(), |i| score(&edges, grid[i], h, coarse_s2));
    let mut order: Vec<usize> = (0..grid.len()).collect();
    order.sort_by(|&a, &b| scores[b].total_cmp(&scores[a]));
    let mut starts: Vec<Hypothesis> = Vec::new();
    for i in order {
        let c = grid[i];
        if starts
            .iter()
            .all(|s| rotation_gap(*s, c) > 8.0 || (s.fov - c.fov).abs() > 30.0)
        {
            starts.push(c);
            if starts.len() == 8 {
                break;
            }
        }
    }
    let mut refined = parallel(starts.len(), |i| refine(&edges, starts[i], h));
    // the classic confusions of the best answer, refined too, so the margin below is measured against them
    refined.sort_by(|a, b| b.1.total_cmp(&a.1));
    let b = refined[0].0;
    let swap = b.pitch - 90.0 * if b.pitch >= 0.0 { 1.0 } else { -1.0 };
    let rivals = [
        Hypothesis {
            yaw: b.yaw + 45.0,
            ..b
        },
        Hypothesis { pitch: swap, ..b },
        Hypothesis {
            fov: b.fov * 0.6,
            ..b
        },
        Hypothesis {
            fov: (b.fov * 1.4).min(165.0),
            ..b
        },
    ];
    refined.extend(parallel(rivals.len(), |i| refine(&edges, rivals[i], h)));
    // best first; a near tie prefers the smaller |pitch| (the usual way a player looks)
    refined.sort_by(|a, b| b.1.total_cmp(&a.1));
    let top = refined[0].1;
    let mut best = refined[0].0;
    for (c, s) in &refined[1..] {
        if *s >= top * 0.999 && c.pitch.abs() < best.pitch.abs() {
            best = *c;
        }
    }
    let runner_up = refined
        .iter()
        .filter(|(c, _)| rotation_gap(*c, best) > 5.0)
        .map(|(_, s)| *s)
        .fold(0.0, f64::max);
    let margin = 1.0 - runner_up / top;
    let ambiguous = margin < AMBIGUOUS_MARGIN;
    // which vanishing points are finite and seen
    let axes = best.axes();
    let f = focal(best.fov, h);
    let mut per_axis = [0.0; 3];
    let mut assigned = 0.0;
    for e in &edges {
        let (s2, k) = residual(e, &axes, f);
        if s2 < ASSIGNED + e.var {
            per_axis[k] += e.weight;
            assigned += e.weight;
        }
    }
    let support = assigned / edges.iter().map(|e| e.weight).sum::<f64>();
    if support < MIN_SUPPORT {
        return None;
    }
    let finite = (0..3)
        .filter(|&k| axes[k][2].abs() > 0.2 && per_axis[k] >= (0.03 * assigned).max(100.0))
        .count();
    Some(Orientation {
        yaw: best.yaw.rem_euclid(90.0),
        pitch: best.pitch,
        roll: best.roll,
        fov: best.fov,
        fov_known: finite >= 2,
        ambiguous,
        margin,
        support,
        edges: edges.len(),
    })
}

/// Angle (degrees) between the rotation in `found` and `camera`'s, after the best quarter turn of yaw (the most any
/// view axis is off).
pub fn rotation_error(found: &Orientation, camera: &Camera) -> f64 {
    let h = |yaw, pitch, roll, fov| Hypothesis {
        yaw,
        pitch,
        roll,
        fov,
    };
    rotation_gap(
        h(found.yaw, found.pitch, found.roll, found.fov),
        h(camera.yaw, camera.pitch, camera.roll, camera.fov),
    )
}

/// The segments of a frame and the world axis (0 = x, 1 = y, 2 = z) each one supports under `found`, None for those
/// it does not explain (within 2° plus the segment's own uncertainty). For drawing what an answer rests on.
pub fn explain(
    rgb: &[u8],
    w: usize,
    h: usize,
    ignore: Option<&[bool]>,
    found: &Orientation,
) -> Vec<(crate::lines::Segment, Option<usize>)> {
    let hyp = Hypothesis {
        yaw: found.yaw,
        pitch: found.pitch,
        roll: found.roll,
        fov: found.fov,
    };
    let axes = hyp.axes();
    let f = focal(hyp.fov, h);
    segments(rgb, w, h, ignore)
        .into_iter()
        .map(|s| {
            let e = Edge {
                x: s.centre[0],
                y: s.centre[1],
                gx: -s.dir[1],
                gy: s.dir[0],
                weight: 0.0,
                var: (1.5 / s.length).powi(2),
            };
            let (s2, k) = residual(&e, &axes, f);
            (s, (s2 < ASSIGNED + e.var).then_some(k))
        })
        .collect()
}
