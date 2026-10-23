//! Vanilla fire block geometry: the quads the game bakes from `blockstates/fire.json` and `template_fire_*`
//! (identical in 1.16.5 and 1.21.11), reproduced with 1.16.5's `BakedQuadFactory` rules: `CubeFace` corner table,
//! element rotation about its origin with `rescale` (other two axes × 1/cos 22.5°), then the blockstate's y rotation
//! (`ModelRotation`: −y degrees about the block centre), and each corner's UV from the face `uv` and `rotation`.
//! Corner order is the model's; the game re-orders unrotated faces, so match corners by UV, never by index.

/// Which way a fire is attached: floor fire (no flammable neighbour), a flammable block on one side, or above.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Attach {
    Floor,
    North,
    East,
    South,
    West,
    Up,
}

/// A fire quad: corners in blocks (block-local 0..1 from `block_quads`, world from `block_candidates`) and each
/// corner's UV within the fire sprite (0..1).
#[derive(Clone, Debug, PartialEq)]
pub struct ModelQuad {
    pub corners: [[f64; 3]; 4],
    pub uv: [[f64; 2]; 4],
}

#[derive(Clone, Copy)]
enum Face {
    Down,
    North,
    South,
    West,
    East,
}

#[derive(Clone, Copy)]
enum Axis {
    X,
    Y,
    Z,
}

struct Element {
    from: [f64; 3],
    to: [f64; 3],
    /// (axis, degrees, origin in 1/16 block); every fire rotation has `rescale: true`.
    rotation: Option<(Axis, f64, [f64; 3])>,
    faces: &'static [(Face, [f64; 4], u32)],
}

const UV: [f64; 4] = [0.0, 0.0, 16.0, 16.0];
const UV_MIRRORED: [f64; 4] = [16.0, 0.0, 0.0, 16.0];

/// template_fire_floor
const FLOOR: &[Element] = &[
    Element {
        from: [0.0, 0.0, 8.8],
        to: [16.0, 22.4, 8.8],
        rotation: Some((Axis::X, -22.5, [8.0, 8.0, 8.0])),
        faces: &[(Face::South, UV, 0)],
    },
    Element {
        from: [0.0, 0.0, 7.2],
        to: [16.0, 22.4, 7.2],
        rotation: Some((Axis::X, 22.5, [8.0, 8.0, 8.0])),
        faces: &[(Face::North, UV, 0)],
    },
    Element {
        from: [8.8, 0.0, 0.0],
        to: [8.8, 22.4, 16.0],
        rotation: Some((Axis::Z, -22.5, [8.0, 8.0, 8.0])),
        faces: &[(Face::West, UV, 0)],
    },
    Element {
        from: [7.2, 0.0, 0.0],
        to: [7.2, 22.4, 16.0],
        rotation: Some((Axis::Z, 22.5, [8.0, 8.0, 8.0])),
        faces: &[(Face::East, UV, 0)],
    },
];
/// template_fire_side, then template_fire_side_alt (mirrored UV)
const SIDE: &[Element] = &[
    Element {
        from: [0.0, 0.0, 0.01],
        to: [16.0, 22.4, 0.01],
        rotation: None,
        faces: &[(Face::South, UV, 0), (Face::North, UV, 0)],
    },
    Element {
        from: [0.0, 0.0, 0.01],
        to: [16.0, 22.4, 0.01],
        rotation: None,
        faces: &[(Face::South, UV_MIRRORED, 0), (Face::North, UV_MIRRORED, 0)],
    },
];
/// template_fire_up, then template_fire_up_alt
const UP: &[Element] = &[
    Element {
        from: [0.0, 16.0, 0.0],
        to: [16.0, 16.0, 16.0],
        rotation: Some((Axis::Z, 22.5, [16.0, 16.0, 8.0])),
        faces: &[(Face::Down, UV, 270)],
    },
    Element {
        from: [0.0, 16.0, 0.0],
        to: [16.0, 16.0, 16.0],
        rotation: Some((Axis::Z, -22.5, [0.0, 16.0, 8.0])),
        faces: &[(Face::Down, UV, 90)],
    },
    Element {
        from: [0.0, 16.0, 0.0],
        to: [16.0, 16.0, 16.0],
        rotation: Some((Axis::X, -22.5, [8.0, 16.0, 16.0])),
        faces: &[(Face::Down, UV, 180)],
    },
    Element {
        from: [0.0, 16.0, 0.0],
        to: [16.0, 16.0, 16.0],
        rotation: Some((Axis::X, 22.5, [8.0, 16.0, 0.0])),
        faces: &[(Face::Down, UV, 0)],
    },
];

/// `CubeFace` corners as (x, y, z) picks: false = from, true = to.
fn corners(face: Face) -> [[bool; 3]; 4] {
    const F: bool = false;
    const T: bool = true;
    match face {
        Face::Down => [[F, F, T], [F, F, F], [T, F, F], [T, F, T]],
        Face::North => [[T, T, F], [T, F, F], [F, F, F], [F, T, F]],
        Face::South => [[F, T, T], [F, F, T], [T, F, T], [T, T, T]],
        Face::West => [[F, T, F], [F, F, F], [F, F, T], [F, T, T]],
        Face::East => [[T, T, T], [T, F, T], [T, F, F], [T, T, F]],
    }
}

/// Right-handed rotation of `v` by `deg` about `axis`.
fn rotate(v: [f64; 3], axis: Axis, deg: f64) -> [f64; 3] {
    let (s, c) = deg.to_radians().sin_cos();
    match axis {
        Axis::X => [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c],
        Axis::Y => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c],
        Axis::Z => [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]],
    }
}

fn bake(elements: &[Element], y_rotation: f64) -> Vec<ModelQuad> {
    let rescale = 1.0 / (std::f64::consts::PI / 8.0).cos(); // every fire rotation is ±22.5°
    let mut out = Vec::new();
    for e in elements {
        for &(face, uvs, uv_rotation) in e.faces {
            let mut q = ModelQuad {
                corners: [[0.0; 3]; 4],
                uv: [[0.0; 2]; 4],
            };
            for (i, pick) in corners(face).iter().enumerate() {
                let mut v = [0.0; 3];
                for k in 0..3 {
                    v[k] = if pick[k] { e.to[k] } else { e.from[k] } / 16.0;
                }
                if let Some((axis, deg, origin)) = e.rotation {
                    let o = [origin[0] / 16.0, origin[1] / 16.0, origin[2] / 16.0];
                    let r = rotate([v[0] - o[0], v[1] - o[1], v[2] - o[2]], axis, deg);
                    let s = match axis {
                        Axis::X => [1.0, rescale, rescale],
                        Axis::Y => [rescale, 1.0, rescale],
                        Axis::Z => [rescale, rescale, 1.0],
                    };
                    v = [r[0] * s[0] + o[0], r[1] * s[1] + o[1], r[2] * s[2] + o[2]];
                }
                if y_rotation != 0.0 {
                    let r = rotate([v[0] - 0.5, v[1] - 0.5, v[2] - 0.5], Axis::Y, -y_rotation);
                    v = [r[0] + 0.5, r[1] + 0.5, r[2] + 0.5];
                }
                q.corners[i] = v;
                // ModelElementTexture.getU/getV with getRotatedUVIndex
                let idx = (i as u32 + uv_rotation / 90) % 4;
                let u = uvs[if idx == 0 || idx == 1 { 0 } else { 2 }];
                let w = uvs[if idx == 0 || idx == 3 { 1 } else { 3 }];
                q.uv[i] = [u / 16.0, w / 16.0];
            }
            out.push(q);
        }
    }
    out
}

/// Every quad a fire with this attachment can draw (all model variants), block-local.
pub fn block_quads(attach: Attach) -> Vec<ModelQuad> {
    match attach {
        Attach::Floor => bake(FLOOR, 0.0),
        Attach::North => bake(SIDE, 0.0),
        Attach::East => bake(SIDE, 90.0),
        Attach::South => bake(SIDE, 180.0),
        Attach::West => bake(SIDE, 270.0),
        Attach::Up => bake(UP, 0.0),
    }
}

/// Every quad any fire at `pos` can draw, in world coordinates: floor, north, east, south, west, up.
pub fn block_candidates(pos: [i32; 3]) -> Vec<ModelQuad> {
    let mut out = Vec::new();
    for a in [
        Attach::Floor,
        Attach::North,
        Attach::East,
        Attach::South,
        Attach::West,
        Attach::Up,
    ] {
        for mut q in block_quads(a) {
            for c in &mut q.corners {
                for k in 0..3 {
                    c[k] += pos[k] as f64;
                }
            }
            out.push(q);
        }
    }
    out
}
