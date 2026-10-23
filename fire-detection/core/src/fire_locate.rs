//! Where is the fire block? With the camera known (`camera::solve`), a fire's box on screen fixes a ray (its centre)
//! and a depth (its width): every block near that ray, with every way a fire can attach, is projected and ranked by
//! how well its outline matches the box. The box covers visible texels, so its top (transparent, animated flame tips)
//! is not compared: only left, right and bottom.

use crate::camera::Camera;
use crate::fire_model::{block_quads, Attach};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Located {
    pub pos: [i32; 3],
    pub attach: Attach,
    /// Mean |difference| of the left, right and bottom edges, in pixels.
    pub error: f64,
}

const ATTACHES: [Attach; 6] = [
    Attach::Floor,
    Attach::North,
    Attach::East,
    Attach::South,
    Attach::West,
    Attach::Up,
];

/// Screen box `[x0, y0, x1, y1]` of a fire at `pos` with `attach`, clamped to the screen like the label box. A floor
/// fire draws its four side planes too (blockstate). None if any corner is behind the camera or it is off screen.
pub fn predicted_box(
    camera: &Camera,
    pos: [i32; 3],
    attach: Attach,
    w: usize,
    h: usize,
) -> Option<[f64; 4]> {
    let mut parts = vec![attach];
    if attach == Attach::Floor {
        parts.extend([Attach::North, Attach::East, Attach::South, Attach::West]);
    }
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for a in parts {
        for q in block_quads(a) {
            for c in q.corners {
                let p = [
                    c[0] + pos[0] as f64,
                    c[1] + pos[1] as f64,
                    c[2] + pos[2] as f64,
                ];
                if camera.to_view(p)[2] > -0.05 {
                    return None;
                }
                let (x, y) = camera.project(p, w, h)?;
                b = [b[0].min(x), b[1].min(y), b[2].max(x), b[3].max(y)];
            }
        }
    }
    let c = [
        b[0].max(0.0),
        b[1].max(0.0),
        b[2].min(w as f64),
        b[3].min(h as f64),
    ];
    (c[2] > c[0] && c[3] > c[1]).then_some(c)
}

/// Candidate fire blocks for an observed box, best first. Empty for a box of no size or off screen.
pub fn locate(camera: &Camera, observed: [f64; 4], w: usize, h: usize) -> Vec<Located> {
    let o = [
        observed[0].max(0.0),
        observed[1].max(0.0),
        observed[2].min(w as f64),
        observed[3].min(h as f64),
    ];
    if o[2] - o[0] < 1.0 || o[3] - o[1] < 1.0 {
        return Vec::new();
    }
    // the ray through the box centre
    let t = (camera.fov.to_radians() / 2.0).tan();
    let (cx, cy) = ((o[0] + o[2]) / 2.0, (o[1] + o[3]) / 2.0);
    let v = [
        (cx / w as f64 * 2.0 - 1.0) * t * w as f64 / h as f64,
        (1.0 - cy / h as f64 * 2.0) * t,
        -1.0,
    ];
    let d = camera.view_dir_to_world(v);
    let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
    let mut blocks = std::collections::BTreeSet::new();
    let mut s = 0.3;
    while s < 160.0 {
        let p = [
            camera.pos[0] + d[0] / len * s,
            camera.pos[1] + d[1] / len * s,
            camera.pos[2] + d[2] / len * s,
        ];
        let b = [
            p[0].floor() as i32,
            p[1].floor() as i32,
            p[2].floor() as i32,
        ];
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    blocks.insert([b[0] + dx, b[1] + dy, b[2] + dz]);
                }
            }
        }
        s *= 1.02;
    }
    let mut out = Vec::new();
    for pos in blocks {
        for attach in ATTACHES {
            if let Some(p) = predicted_box(camera, pos, attach, w, h) {
                let error = ((p[0] - o[0]).abs() + (p[2] - o[2]).abs() + (p[3] - o[3]).abs()) / 3.0;
                out.push(Located { pos, attach, error });
            }
        }
    }
    out.sort_by(|a, b| a.error.total_cmp(&b.error));
    out
}
