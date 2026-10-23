//! Fire on entities (1.16.5 `EntityRenderDispatcher.renderFire`): a stack of camera-facing quads at the entity's feet,
//! scaled by width × 1.4, each layer 1.4 tall, 0.45 higher, 0.9× as wide and 0.03 further from the camera, from a
//! start (−0.3 + ⌊height / scale⌋ · 0.02) towards it, all in scaled units; sprites alternate fire_0 / fire_1 and every
//! other pair is mirrored. Ways this breaks: the scale, the layer stack, the start depth, the layer count (`i > 0`),
//! the yaw sign (quads must face the camera and layers move away from it), UV mirroring and sheets, unknown types.
#![allow(clippy::needless_range_loop)] // corners are compared index by index with the hand-computed ones
use fire_core::fire_model::{entity_quads, entity_size};

fn close(a: [f64; 3], b: [f64; 3]) -> bool {
    (0..3).all(|k| (a[k] - b[k]).abs() < 1e-9)
}

#[test]
fn a_blaze_at_yaw_0_has_the_hand_computed_corners() {
    // f = 0.6 * 1.4 = 0.84; i = 1.8 / 0.84 = 2.14 -> start z = (-0.3 + 2 * 0.02) * 0.84 = -0.2184
    let q = entity_quads([0.0, 0.0, 0.0], 0.6, 1.8, 0.0);
    assert_eq!(q.len(), 5, "layers at i = 2.14, 1.69, 1.24, 0.79, 0.34");
    let f = 0.84;
    for (l, quad) in q.iter().enumerate() {
        let (g, y0, z) = (
            0.5 * 0.9f64.powi(l as i32) * f,
            0.45 * l as f64 * f,
            -0.2184 + 0.03 * l as f64 * f,
        );
        let want = [
            [g, y0, z],
            [-g, y0, z],
            [-g, y0 + 1.4 * f, z],
            [g, y0 + 1.4 * f, z],
        ];
        for k in 0..4 {
            assert!(
                close(quad.corners[k], want[k]),
                "layer {l} corner {k}: {:?} vs {:?}",
                quad.corners[k],
                want[k]
            );
        }
        assert_eq!(quad.sheet, (l % 2) as u8);
    }
}

#[test]
fn uvs_match_the_logged_blaze_quad_and_mirror_every_other_pair() {
    let q = entity_quads([0.0, 0.0, 0.0], 0.6, 1.8, 0.0);
    // the label log's first blaze quad: uv [0,1, 1,1, 1,0, 0,0]
    assert_eq!(q[0].uv, [[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]);
    assert_eq!(q[1].uv, q[0].uv, "layers 0 and 1 are mirrored");
    assert_eq!(
        q[2].uv,
        [[1.0, 1.0], [0.0, 1.0], [0.0, 0.0], [1.0, 0.0]],
        "layers 2 and 3 are not"
    );
    assert_eq!(q[4].uv, q[0].uv);
}

#[test]
fn the_stack_faces_the_camera_and_moves_away_from_it() {
    // camera yaw 90 looks towards -x: quads span world z and y, and later layers lie further towards -x
    let feet = [10.0, 64.0, -3.0];
    let q = entity_quads(feet, 0.6, 1.8, 90.0);
    for quad in &q {
        let x = quad.corners[0][0];
        assert!(
            quad.corners.iter().all(|c| (c[0] - x).abs() < 1e-9),
            "plane facing the camera: {quad:?}"
        );
    }
    assert!(q[1].corners[0][0] < q[0].corners[0][0]);
    // and it is centred on the feet sideways
    let zs: Vec<f64> = q[0].corners.iter().map(|c| c[2]).collect();
    assert!(
        ((zs.iter().cloned().fold(f64::MIN, f64::max)
            + zs.iter().cloned().fold(f64::MAX, f64::min))
            / 2.0
            - feet[2])
            .abs()
            < 1e-9
    );
    // any yaw: the layer step is along the look direction
    let q = entity_quads([0.0; 3], 0.6, 1.8, -30.0);
    let (a, b) = (q[0].corners[0], q[1].corners[0]);
    let fwd = [-(-30f64).to_radians().sin(), (-30f64).to_radians().cos()];
    let centre = |c: &[[f64; 3]; 4]| [(c[0][0] + c[1][0]) / 2.0, (c[0][2] + c[1][2]) / 2.0];
    let (ca, cb) = (centre(&q[0].corners), centre(&q[1].corners));
    let step = [cb[0] - ca[0], cb[1] - ca[1]];
    let along = step[0] * fwd[0] + step[1] * fwd[1];
    assert!(
        along > 0.0 && (along - 0.03 * 0.84).abs() < 1e-9,
        "{a:?} {b:?} {step:?}"
    );
}

#[test]
fn a_small_fireball_has_two_layers_and_sizes_come_from_the_game() {
    let (w, h) = entity_size("minecraft:small_fireball").expect("known");
    assert_eq!((w, h), (0.3125, 0.3125));
    assert_eq!(entity_quads([0.0; 3], w, h, 0.0).len(), 2);
    assert_eq!(
        entity_size("blaze"),
        Some((0.6, 1.8)),
        "with or without the namespace"
    );
    assert_eq!(entity_size("minecraft:player"), Some((0.6, 1.8)));
    assert_eq!(entity_size("minecraft:no_such_thing"), None);
}

#[test]
fn no_size_gives_no_quads() {
    assert!(entity_quads([0.0; 3], 0.0, 1.8, 0.0).is_empty());
    assert!(entity_quads([0.0; 3], 0.6, 0.0, 0.0).is_empty());
    assert!(entity_quads([0.0; 3], f64::NAN, 1.0, 0.0).is_empty());
}

/// A burning block is behind the fire cell, so the default face is the cell's side pointing away from the camera
/// (the dominant horizontal direction from the eye to the cell).
#[test]
fn the_default_face_points_away_from_the_camera() {
    use fire_core::fire_model::{facing_away, Attach};
    let cell = [10, 64, 10];
    // camera south of the cell (bigger z) looking north: the burning block is north of the cell
    assert_eq!(facing_away([10.5, 65.6, 20.0], cell), Attach::North);
    assert_eq!(facing_away([10.5, 65.6, 0.0], cell), Attach::South);
    assert_eq!(facing_away([0.0, 65.6, 10.4], cell), Attach::East);
    assert_eq!(facing_away([20.0, 65.6, 10.6], cell), Attach::West);
    // diagonal: the larger horizontal offset decides
    assert_eq!(facing_away([14.0, 65.6, 25.0], cell), Attach::North);
}
