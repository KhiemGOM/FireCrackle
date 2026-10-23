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

/// Which planes a fire block draws, as the 3D tool chooses them: the floor shape, or any of the five faces whose
/// neighbour burns.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FireFaces {
    pub floor: bool,
    pub north: bool,
    pub east: bool,
    pub south: bool,
    pub west: bool,
    pub up: bool,
}

/// The distinct planes a fire block at `pos` draws, in world coordinates (the sprite variants share their planes, so
/// each plane once, with the first variant's UV). Floor is the game's no-flammable-neighbour case: the floor planes
/// plus the four side planes, and it wins over any face. Soul fire draws only the floor planes.
pub fn fire_block_quads(pos: [i32; 3], faces: FireFaces, soul: bool) -> Vec<ModelQuad> {
    let attaches: Vec<Attach> = if soul {
        if faces == FireFaces::default() {
            Vec::new()
        } else {
            vec![Attach::Floor]
        }
    } else if faces.floor {
        vec![
            Attach::Floor,
            Attach::North,
            Attach::East,
            Attach::South,
            Attach::West,
        ]
    } else {
        [
            (faces.north, Attach::North),
            (faces.east, Attach::East),
            (faces.south, Attach::South),
            (faces.west, Attach::West),
            (faces.up, Attach::Up),
        ]
        .iter()
        .filter(|f| f.0)
        .map(|f| f.1)
        .collect()
    };
    let key = |q: &ModelQuad| {
        let mut c: Vec<[i64; 3]> = q
            .corners
            .iter()
            .map(|v| {
                [
                    (v[0] * 1e6).round() as i64,
                    (v[1] * 1e6).round() as i64,
                    (v[2] * 1e6).round() as i64,
                ]
            })
            .collect();
        c.sort();
        c
    };
    let mut out: Vec<ModelQuad> = Vec::new();
    let mut seen = Vec::new();
    for a in attaches {
        for mut q in block_quads(a) {
            let k = key(&q);
            if seen.contains(&k) {
                continue;
            }
            seen.push(k);
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

/// A quad of fire on an entity: world corners, UV within the sprite, and which sprite (0 = fire_0, 1 = fire_1).
#[derive(Clone, Debug, PartialEq)]
pub struct EntityQuad {
    pub corners: [[f64; 3]; 4],
    pub uv: [[f64; 2]; 4],
    pub sheet: u8,
}

/// The fire drawn on a burning entity (1.16.5 `EntityRenderDispatcher.renderFire`) with its feet at `feet`, hitbox
/// `width` × `height`, seen by a camera with `camera_yaw`: scaled by width × 1.4, turned to face the camera about the
/// vertical axis, layers 1.4 tall stepping up 0.45, 0.9× as wide and 0.03 further from the camera each, from a start
/// (−0.3 + ⌊height / scale⌋ · 0.02) towards it (scaled units). Empty for a hitbox of no size.
pub fn entity_quads(feet: [f64; 3], width: f64, height: f64, camera_yaw: f64) -> Vec<EntityQuad> {
    if !(width > 0.0 && height > 0.0 && width.is_finite() && height.is_finite()) {
        return Vec::new();
    }
    let f = width * 1.4;
    // rotation by −yaw about +y: local x → (cos θ, 0, −sin θ), local z → (sin θ, 0, cos θ), θ = −yaw
    let (s, c) = (-camera_yaw).to_radians().sin_cos();
    let world = |x: f64, y: f64, z: f64| {
        let (x, y, z) = (x * f, y * f, z * f);
        [
            feet[0] + x * c + z * s,
            feet[1] + y,
            feet[2] - x * s + z * c,
        ]
    };
    let mut i = height / f;
    let start = -0.3 + (i as i64) as f64 * 0.02;
    let (mut g, mut j, mut k) = (0.5, 0.0, 0.0);
    let mut out = Vec::new();
    let mut l = 0usize;
    while i > 0.0 {
        // sprite u runs min → max from corner 1 to corner 0, mirrored on layers 0, 1, 4, 5, …
        let (u0, u1) = if (l / 2).is_multiple_of(2) {
            (0.0, 1.0)
        } else {
            (1.0, 0.0)
        };
        let z = start + k;
        out.push(EntityQuad {
            corners: [
                world(g, -j, z),
                world(-g, -j, z),
                world(-g, 1.4 - j, z),
                world(g, 1.4 - j, z),
            ],
            uv: [[u0, 1.0], [u1, 1.0], [u1, 0.0], [u0, 0.0]],
            sheet: (l % 2) as u8,
        });
        i -= 0.45;
        j -= 0.45;
        g *= 0.9;
        k += 0.03;
        l += 1;
    }
    out
}

/// Hitbox width × height of an entity type (`minecraft:` optional), from 1.16.5 `EntityType` (`setDimensions`).
/// Runtime changes are the caller's: babies are half size, slimes and magma cubes × 0.255 × size, a sneaking
/// player is 1.5 tall and a swimming or gliding one 0.6.
pub fn entity_size(kind: &str) -> Option<(f64, f64)> {
    let name = kind.strip_prefix("minecraft:").unwrap_or(kind);
    ENTITY_SIZES
        .iter()
        .find(|e| e.0 == name)
        .map(|e| (e.1, e.2))
}

/// Every entity type's hitbox in 1.16.5 (`EntityType.register(..).setDimensions(w, h)`).
pub const ENTITY_SIZES: &[(&str, f64, f64)] = &[
    ("area_effect_cloud", 6.0, 0.5),
    ("armor_stand", 0.5, 1.975),
    ("arrow", 0.5, 0.5),
    ("bat", 0.5, 0.9),
    ("bee", 0.7, 0.6),
    ("blaze", 0.6, 1.8),
    ("boat", 1.375, 0.5625),
    ("cat", 0.6, 0.7),
    ("cave_spider", 0.7, 0.5),
    ("chicken", 0.4, 0.7),
    ("cod", 0.5, 0.3),
    ("cow", 0.9, 1.4),
    ("creeper", 0.6, 1.7),
    ("dolphin", 0.9, 0.6),
    ("donkey", 1.3964844, 1.5),
    ("dragon_fireball", 1.0, 1.0),
    ("drowned", 0.6, 1.95),
    ("elder_guardian", 1.9975, 1.9975),
    ("end_crystal", 2.0, 2.0),
    ("ender_dragon", 16.0, 8.0),
    ("enderman", 0.6, 2.9),
    ("endermite", 0.4, 0.3),
    ("evoker", 0.6, 1.95),
    ("evoker_fangs", 0.5, 0.8),
    ("experience_orb", 0.5, 0.5),
    ("eye_of_ender", 0.25, 0.25),
    ("falling_block", 0.98, 0.98),
    ("firework_rocket", 0.25, 0.25),
    ("fox", 0.6, 0.7),
    ("ghast", 4.0, 4.0),
    ("giant", 3.6, 12.0),
    ("guardian", 0.85, 0.85),
    ("hoglin", 1.3964844, 1.4),
    ("horse", 1.3964844, 1.6),
    ("husk", 0.6, 1.95),
    ("illusioner", 0.6, 1.95),
    ("iron_golem", 1.4, 2.7),
    ("item", 0.25, 0.25),
    ("item_frame", 0.5, 0.5),
    ("fireball", 1.0, 1.0),
    ("leash_knot", 0.5, 0.5),
    ("lightning_bolt", 0.0, 0.0),
    ("llama", 0.9, 1.87),
    ("llama_spit", 0.25, 0.25),
    ("magma_cube", 2.04, 2.04),
    ("minecart", 0.98, 0.7),
    ("chest_minecart", 0.98, 0.7),
    ("command_block_minecart", 0.98, 0.7),
    ("furnace_minecart", 0.98, 0.7),
    ("hopper_minecart", 0.98, 0.7),
    ("spawner_minecart", 0.98, 0.7),
    ("tnt_minecart", 0.98, 0.7),
    ("mule", 1.3964844, 1.6),
    ("mooshroom", 0.9, 1.4),
    ("ocelot", 0.6, 0.7),
    ("painting", 0.5, 0.5),
    ("panda", 1.3, 1.25),
    ("parrot", 0.5, 0.9),
    ("phantom", 0.9, 0.5),
    ("pig", 0.9, 0.9),
    ("piglin", 0.6, 1.95),
    ("piglin_brute", 0.6, 1.95),
    ("pillager", 0.6, 1.95),
    ("polar_bear", 1.4, 1.4),
    ("tnt", 0.98, 0.98),
    ("pufferfish", 0.7, 0.7),
    ("rabbit", 0.4, 0.5),
    ("ravager", 1.95, 2.2),
    ("salmon", 0.7, 0.4),
    ("sheep", 0.9, 1.3),
    ("shulker", 1.0, 1.0),
    ("shulker_bullet", 0.3125, 0.3125),
    ("silverfish", 0.4, 0.3),
    ("skeleton", 0.6, 1.99),
    ("skeleton_horse", 1.3964844, 1.6),
    ("slime", 2.04, 2.04),
    ("small_fireball", 0.3125, 0.3125),
    ("snow_golem", 0.7, 1.9),
    ("snowball", 0.25, 0.25),
    ("spectral_arrow", 0.5, 0.5),
    ("spider", 1.4, 0.9),
    ("squid", 0.8, 0.8),
    ("stray", 0.6, 1.99),
    ("strider", 0.9, 1.7),
    ("egg", 0.25, 0.25),
    ("ender_pearl", 0.25, 0.25),
    ("experience_bottle", 0.25, 0.25),
    ("potion", 0.25, 0.25),
    ("trident", 0.5, 0.5),
    ("trader_llama", 0.9, 1.87),
    ("tropical_fish", 0.5, 0.4),
    ("turtle", 1.2, 0.4),
    ("vex", 0.4, 0.8),
    ("villager", 0.6, 1.95),
    ("vindicator", 0.6, 1.95),
    ("wandering_trader", 0.6, 1.95),
    ("witch", 0.6, 1.95),
    ("wither", 0.9, 3.5),
    ("wither_skeleton", 0.7, 2.4),
    ("wither_skull", 0.3125, 0.3125),
    ("wolf", 0.6, 0.85),
    ("zoglin", 1.3964844, 1.4),
    ("zombie", 0.6, 1.95),
    ("zombie_horse", 1.3964844, 1.6),
    ("zombie_villager", 0.6, 1.95),
    ("zombified_piglin", 0.6, 1.95),
    ("player", 0.6, 1.8),
    ("fishing_bobber", 0.25, 0.25),
];
