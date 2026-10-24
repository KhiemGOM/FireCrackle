//! Fire geometry and the camera solver behind perspective reversal.
//!
//! Geometry is vanilla's baked fire model (1.16.5 and 1.21.11 have identical `template_fire_*` models and blockstate):
//! a rotation/rescale or blockstate-rotation slip moves every corner, so corners are checked against values worked out
//! by hand from the model files. The camera is Minecraft's: yaw 0 looks +z, yaw 90 looks −x, positive pitch looks
//! down, roll covers view bobbing / hurt tilt; projection is `overlay::project`. Ways the solver breaks: wrong
//! corner pairing (pairing is by UV), a single plane cannot separate FOV from distance (FOV is then held and flagged),
//! points behind the camera, empty input.
use fire_core::camera::{corner_rms, fit, fit_label_frame, solve, Camera, LoggedBlock, LoggedQuad};
use fire_core::fire_model::{block_candidates, block_quads, Attach};

fn close(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}

#[test]
fn a_north_side_plane_sits_just_inside_the_north_face_and_is_1_4_blocks_tall() {
    let q = block_quads(Attach::North);
    // side + side_alt (mirrored UV), each with a south and a north face
    assert_eq!(q.len(), 4);
    for quad in &q {
        for c in &quad.corners {
            assert!(close(c[2], 0.01 / 16.0, 1e-9), "{c:?}");
            assert!(c[0] > -1e-9 && c[0] < 1.0 + 1e-9);
            assert!(c[1] > -1e-9 && c[1] < 1.4 + 1e-9);
        }
        let ys: Vec<f64> = quad.corners.iter().map(|c| c[1]).collect();
        assert!(ys.iter().any(|&y| close(y, 1.4, 1e-6)) && ys.iter().any(|&y| close(y, 0.0, 1e-9)));
        let mut uv: Vec<(i32, i32)> = quad
            .uv
            .iter()
            .map(|t| ((t[0] * 16.0).round() as i32, (t[1] * 16.0).round() as i32))
            .collect();
        uv.sort();
        assert_eq!(uv, vec![(0, 0), (0, 16), (16, 0), (16, 16)]);
    }
}

#[test]
fn the_blockstate_rotation_turns_the_north_side_into_east_south_and_west() {
    let x_of = |a: Attach| {
        block_quads(a)[0]
            .corners
            .iter()
            .map(|c| (c[0], c[2]))
            .collect::<Vec<_>>()
    };
    assert!(
        x_of(Attach::East)
            .iter()
            .all(|&(x, _)| close(x, 1.0 - 0.01 / 16.0, 1e-6)),
        "{:?}",
        x_of(Attach::East)
    );
    assert!(x_of(Attach::South)
        .iter()
        .all(|&(_, z)| close(z, 1.0 - 0.01 / 16.0, 1e-6)));
    assert!(x_of(Attach::West)
        .iter()
        .all(|&(x, _)| close(x, 0.01 / 16.0, 1e-6)));
}

#[test]
fn a_floor_plane_corner_matches_the_hand_computed_rotation_and_rescale() {
    // template_fire_floor element 1: from (0,0,8.8) to (16,22.4,8.8), x-axis −22.5° about (8,8,8), rescale.
    // Corner (0, 0, 8.8)/16 relative to the origin is (−0.5, −0.5, 0.05); rotating by −22.5° about x and scaling y, z
    // by 1/cos(22.5°) gives (0, 0.020710, 0.757105).
    let q = block_quads(Attach::Floor);
    assert_eq!(q.len(), 4);
    let found = q.iter().flat_map(|q| q.corners.iter()).any(|c| {
        close(c[0], 0.0, 1e-6) && close(c[1], 0.020710, 2e-5) && close(c[2], 0.757105, 2e-5)
    });
    assert!(
        found,
        "{:?}",
        q.iter().map(|q| q.corners).collect::<Vec<_>>()
    );
    // the four floor planes lean in: every top corner is nearer the block centre line than its bottom corner
}

#[test]
fn up_fire_hangs_two_planes_from_each_variant_and_candidates_cover_every_attachment() {
    let up = block_quads(Attach::Up);
    assert_eq!(up.len(), 4); // fire_up (2) + fire_up_alt (2)
    assert!(up
        .iter()
        .all(|q| q.corners.iter().any(|c| close(c[1], 1.0, 1e-6))));
    let all = block_candidates([-91, 80, 130]);
    assert_eq!(all.len(), 4 + 4 * 4 + 4);
    assert!(all.iter().all(|q| q
        .corners
        .iter()
        .all(|c| c[0] >= -91.0 - 1e-6 && c[0] <= -90.0 + 1e-6 && c[1] >= 79.9 && c[2] >= 129.9)));
}

#[test]
fn the_camera_uses_minecraft_yaw_pitch_and_screen_directions() {
    let at = |yaw, pitch| Camera {
        pos: [10.0, 70.0, -3.0],
        yaw,
        pitch,
        roll: 0.0,
        fov: 70.0,
    };
    let (w, h) = (2560usize, 1440usize);
    let ahead = |c: &Camera, d: [f64; 3]| {
        c.project([c.pos[0] + d[0], c.pos[1] + d[1], c.pos[2] + d[2]], w, h)
            .unwrap()
    };
    let c = at(0.0, 0.0);
    let p = ahead(&c, [0.0, 0.0, 5.0]);
    assert!(
        close(p.0, 1280.0, 1e-9) && close(p.1, 720.0, 1e-9),
        "yaw 0 looks +z: {p:?}"
    );
    assert!(ahead(&c, [0.0, 1.0, 5.0]).1 < 720.0, "up is up on screen");
    assert!(ahead(&c, [-1.0, 0.0, 5.0]).0 > 1280.0, "yaw 0: right is -x");
    let p = ahead(&at(90.0, 0.0), [-5.0, 0.0, 0.0]);
    assert!(
        close(p.0, 1280.0, 1e-9) && close(p.1, 720.0, 1e-9),
        "yaw 90 looks -x: {p:?}"
    );
    let p = ahead(&at(0.0, 90.0), [0.0, -5.0, 0.0]);
    assert!(
        close(p.0, 1280.0, 1e-6) && close(p.1, 720.0, 1e-6),
        "pitch 90 looks down: {p:?}"
    );
    // one block at 5 blocks, FOV 70, 1440 px tall: 1/tan(35°) · 720 / 5 = 205.653 px (the reverser showed 514.3 = 720 − 205.7, rounded)
    assert!(close(720.0 - ahead(&c, [0.0, 1.0, 5.0]).1, 205.653, 0.001));
    assert!(
        c.project([10.0, 70.0, -8.0], w, h).is_none(),
        "behind the camera"
    );
}

fn truth() -> Camera {
    Camera {
        pos: [-88.37, 81.62, 122.4],
        yaw: 18.5,
        pitch: 21.0,
        roll: 1.3,
        fov: 77.0,
    }
}

/// What the label mod logs for a block: the drawn quads' screen corners and UVs (here: the floor and north side).
#[allow(clippy::needless_range_loop)]
fn logged(cam: &Camera, pos: [i32; 3], noise: f64, seed: &mut u64) -> LoggedBlock {
    let (w, h) = (2560, 1440);
    let mut quads = Vec::new();
    for (k, q) in block_candidates(pos).iter().enumerate() {
        // floor (first 4) and the plain north side (next 2): a subset, as a real fire draws one variant per part
        if k >= 6 {
            continue;
        }
        let mut corners = [[0.0; 2]; 4];
        for i in 0..4 {
            let (x, y) = cam.project(q.corners[i], w, h).unwrap();
            let mut r = || {
                *seed = seed
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                ((*seed >> 33) as f64 / (1u64 << 31) as f64) * 2.0 - 1.0
            };
            corners[i] = [x + r() * noise, y + r() * noise];
        }
        // logged corner order differs from the model's (the game re-orders unrotated faces): rotate by one
        let c = [corners[1], corners[2], corners[3], corners[0]];
        let uv = [q.uv[1], q.uv[2], q.uv[3], q.uv[0]];
        quads.push(LoggedQuad { corners: c, uv });
    }
    let centre = [
        pos[0] as f64 + 0.5,
        pos[1] as f64 + 0.5,
        pos[2] as f64 + 0.5,
    ];
    let dist = ((centre[0] - cam.pos[0]).powi(2)
        + (centre[1] - cam.pos[1]).powi(2)
        + (centre[2] - cam.pos[2]).powi(2))
    .sqrt();
    LoggedBlock { pos, dist, quads }
}

#[test]
fn a_known_camera_is_recovered_from_two_logged_fire_blocks_without_any_starting_guess() {
    let cam = truth();
    let mut seed = 7;
    let blocks = vec![
        logged(&cam, [-87, 80, 128], 0.0, &mut seed),
        logged(&cam, [-85, 80, 129], 0.0, &mut seed),
    ];
    let f = fit_label_frame(&blocks, 2560, 1440).expect("solvable");
    assert!(f.rms < 0.01, "{f:?}");
    assert!(!f.fov_fixed);
    let c = f.camera;
    let d = ((c.pos[0] - cam.pos[0]).powi(2)
        + (c.pos[1] - cam.pos[1]).powi(2)
        + (c.pos[2] - cam.pos[2]).powi(2))
    .sqrt();
    assert!(
        d < 1e-3
            && close(c.yaw, cam.yaw, 1e-3)
            && close(c.pitch, cam.pitch, 1e-3)
            && close(c.roll, cam.roll, 1e-3)
            && close(c.fov, cam.fov, 1e-3),
        "{c:?}"
    );
}

#[test]
fn logged_rounding_noise_still_gives_the_camera_to_a_small_fraction_of_a_degree() {
    let cam = truth();
    let mut seed = 11;
    // the log keeps one decimal: ±0.05 px
    let blocks = vec![
        logged(&cam, [-87, 80, 128], 0.05, &mut seed),
        logged(&cam, [-85, 80, 129], 0.05, &mut seed),
    ];
    let f = fit_label_frame(&blocks, 2560, 1440).unwrap();
    assert!(f.rms < 0.06, "{f:?}");
    let c = f.camera;
    assert!(
        close(c.yaw, cam.yaw, 0.05)
            && close(c.pitch, cam.pitch, 0.05)
            && close(c.fov, cam.fov, 0.1),
        "{c:?}"
    );
}

#[test]
fn one_plane_holds_the_fov_and_says_so_and_empty_input_gives_nothing() {
    let cam = Camera {
        fov: 70.0,
        ..truth()
    };
    let q = &block_candidates([-87, 80, 128])[4]; // one north-side plane: four coplanar points
    let pts: Vec<([f64; 3], [f64; 2])> = (0..4)
        .map(|i| {
            let (x, y) = cam.project(q.corners[i], 2560, 1440).unwrap();
            (q.corners[i], [x, y])
        })
        .collect();
    let start = Camera {
        pos: [cam.pos[0] + 0.3, cam.pos[1] - 0.2, cam.pos[2] + 0.4],
        yaw: 22.0,
        pitch: 18.0,
        roll: 0.0,
        fov: 70.0,
    };
    let f = fit(&pts, 2560, 1440, &start, true).unwrap();
    assert!(f.fov_fixed && f.camera.fov == 70.0, "{f:?}");
    assert!(fit(&[], 2560, 1440, &start, true).is_none());
    assert!(fit_label_frame(&[], 2560, 1440).is_none());
}

#[test]
fn one_corrupted_quad_is_left_out_and_the_camera_is_still_exact() {
    // a real log can carry one quad that does not belong to this camera; it must not drag the fit
    let cam = truth();
    let mut seed = 3;
    let mut blocks = vec![
        logged(&cam, [-87, 80, 128], 0.0, &mut seed),
        logged(&cam, [-85, 80, 129], 0.0, &mut seed),
    ];
    for c in &mut blocks[1].quads[2].corners {
        c[0] += 40.0;
        c[1] -= 25.0;
    }
    let f = fit_label_frame(&blocks, 2560, 1440).unwrap();
    assert_eq!(f.dropped_quads, 1, "{f:?}");
    assert!(f.rms < 0.01, "{f:?}");
    assert!(
        close(f.camera.yaw, cam.yaw, 1e-3) && close(f.camera.fov, cam.fov, 1e-3),
        "{f:?}"
    );
    // a clean frame drops nothing
    let clean = vec![logged(&cam, [-87, 80, 128], 0.0, &mut seed)];
    assert_eq!(
        fit_label_frame(&clean, 2560, 1440).unwrap().dropped_quads,
        0
    );
}

// ---- reversal without fire: any world points (block corners) the user clicks, no starting guess

fn block_corners_in_view(cam: &Camera, w: usize, h: usize) -> Vec<([f64; 3], [f64; 2])> {
    let mut out = Vec::new();
    for x in -100..-70 {
        for y in 76..90 {
            for z in 120..150 {
                let p = [x as f64, y as f64, z as f64];
                let v = cam.to_view(p);
                if v[2] > -1.5 {
                    continue;
                }
                if let Some((px, py)) = cam.project(p, w, h) {
                    if px > 20.0 && px < w as f64 - 20.0 && py > 20.0 && py < h as f64 - 20.0 {
                        out.push((p, [px, py]));
                    }
                }
            }
        }
    }
    out
}

fn pick(all: &[([f64; 3], [f64; 2])], n: usize, seed: &mut u64) -> Vec<([f64; 3], [f64; 2])> {
    let mut pool = all.to_vec();
    let mut out = Vec::new();
    for _ in 0..n {
        *seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        out.push(pool.swap_remove((*seed >> 33) as usize % pool.len()));
    }
    out
}

#[test]
fn clicked_block_corners_alone_give_the_camera_with_no_starting_guess() {
    for cam in [
        truth(),
        Camera {
            pos: [-80.2, 85.1, 141.7],
            yaw: -151.0,
            pitch: -12.0,
            roll: 0.0,
            fov: 110.0,
        },
        Camera {
            pos: [-95.5, 79.62, 125.3],
            yaw: -60.0,
            pitch: 55.0,
            roll: -0.4,
            fov: 70.0,
        },
    ] {
        let all = block_corners_in_view(&cam, 2560, 1440);
        let mut seed = 5;
        let pts = pick(&all, 8, &mut seed);
        let f = solve(&pts, 2560, 1440).expect("solvable");
        let c = f.camera;
        let d = ((c.pos[0] - cam.pos[0]).powi(2)
            + (c.pos[1] - cam.pos[1]).powi(2)
            + (c.pos[2] - cam.pos[2]).powi(2))
        .sqrt();
        assert!(
            f.rms < 1e-3
                && d < 1e-3
                && close(c.yaw, cam.yaw, 1e-3)
                && close(c.pitch, cam.pitch, 1e-3)
                && close(c.fov, cam.fov, 1e-3),
            "{cam:?} -> {f:?}"
        );
    }
}

#[test]
fn half_pixel_clicks_still_give_the_camera_closely() {
    let cam = truth();
    let all = block_corners_in_view(&cam, 2560, 1440);
    let mut seed = 9;
    let mut pts = pick(&all, 12, &mut seed);
    for (k, p) in pts.iter_mut().enumerate() {
        p.1[0] += if k % 2 == 0 { 0.5 } else { -0.5 };
        p.1[1] += if k % 3 == 0 { -0.5 } else { 0.5 };
    }
    let f = solve(&pts, 2560, 1440).unwrap();
    let c = f.camera;
    assert!(
        close(c.yaw, cam.yaw, 0.1) && close(c.pitch, cam.pitch, 0.1) && close(c.fov, cam.fov, 0.3),
        "{f:?}"
    );
}

#[test]
fn too_few_points_give_nothing_and_coplanar_clicks_hold_the_fov() {
    let cam = Camera {
        fov: 70.0,
        ..truth()
    };
    let all = block_corners_in_view(&cam, 2560, 1440);
    let mut seed = 1;
    assert!(solve(&pick(&all, 3, &mut seed), 2560, 1440).is_none());
    // the four corners of one block face (z = 128 plane)
    let face: Vec<_> = [
        [-88.0, 80.0, 128.0],
        [-87.0, 80.0, 128.0],
        [-87.0, 81.0, 128.0],
        [-88.0, 81.0, 128.0],
    ]
    .iter()
    .map(|&p| {
        let (x, y) = cam.project(p, 2560, 1440).unwrap();
        (p, [x, y])
    })
    .collect();
    let f = solve(&face, 2560, 1440).unwrap();
    assert!(f.fov_fixed, "{f:?}");
}

/// `corner_rms` measures how well a camera reproduces the logged quads: zero for the camera that drew them, about a
/// degree's worth of pixels for one a degree off, nothing without quads.
#[test]
fn corner_rms_is_zero_for_the_drawing_camera_and_grows_when_it_turns() {
    let cam = truth();
    let mut seed = 7;
    let blocks = vec![logged(&cam, [-87, 80, 128], 0.0, &mut seed)];
    assert!(corner_rms(&blocks, &cam, 2560, 1440).unwrap() < 1e-6);
    let turned = Camera {
        yaw: cam.yaw + 1.0,
        ..cam
    };
    let e = corner_rms(&blocks, &turned, 2560, 1440).unwrap();
    // 1° at this FOV is about 720 / tan(fov / 2) * tan(1°) px
    let expect = 720.0 / (cam.fov.to_radians() / 2.0).tan() * 1f64.to_radians().tan();
    assert!(e > 0.5 * expect && e < 2.0 * expect, "{e} vs {expect}");
    assert!(corner_rms(&[], &cam, 2560, 1440).is_none());
}

/// The 3D view's orbit camera: looking at `target` from `dist` blocks back along yaw/pitch puts the target at the
/// image centre; zero distance or a bad FOV gives nothing.
#[test]
fn an_orbit_camera_puts_its_target_at_the_centre() {
    let target = [4.5, 64.0, -7.5];
    for (yaw, pitch) in [(0.0, 30.0), (137.0, 60.0), (-90.0, -10.0)] {
        let c = Camera::orbit(target, yaw, pitch, 12.0, 70.0).expect("orbit");
        let (x, y) = c.project(target, 1600, 900).unwrap();
        assert!(
            (x - 800.0).abs() < 1e-6 && (y - 450.0).abs() < 1e-6,
            "{c:?}"
        );
        let d = ((c.pos[0] - target[0]).powi(2)
            + (c.pos[1] - target[1]).powi(2)
            + (c.pos[2] - target[2]).powi(2))
        .sqrt();
        assert!((d - 12.0).abs() < 1e-9);
        assert!((c.yaw - yaw).abs() < 1e-9 && (c.pitch - pitch).abs() < 1e-9);
    }
    assert!(Camera::orbit(target, 0.0, 0.0, 0.0, 70.0).is_none());
    assert!(Camera::orbit(target, 0.0, 0.0, 5.0, 0.0).is_none());
}

/// A pixel's ray goes back through the world point drawn there, and a click on the screen lands on the plane y = Y
/// where that plane is drawn: the 3D quad tool places fire by clicking the video.
#[test]
fn a_pixel_ray_and_a_plane_click_invert_the_projection() {
    let cam = truth();
    let (w, h) = (2560, 1440);
    for p in [
        [-88.0, 79.0, 128.0],
        [-85.5, 80.0, 129.25],
        [-90.2, 78.0, 131.0],
    ] {
        let (x, y) = cam.project(p, w, h).expect("in front");
        let d = cam.pixel_ray(x, y, w, h);
        let to = [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]];
        let len = (to[0] * to[0] + to[1] * to[1] + to[2] * to[2]).sqrt();
        let dot = (d[0] * to[0] + d[1] * to[1] + d[2] * to[2]) / len;
        assert!((dot - 1.0).abs() < 1e-9, "{d:?} vs {to:?}");
        let hit = cam.hit_plane_y(x, y, w, h, p[1]).expect("plane in front");
        assert!(
            (0..3).all(|k| (hit[k] - p[k]).abs() < 1e-6),
            "{hit:?} vs {p:?}"
        );
    }
    // the sky above the horizon never meets a floor below the eye
    let level = Camera { pitch: 0.0, ..cam };
    assert!(level
        .hit_plane_y(1280.0, 10.0, w, h, cam.pos[1] - 5.0)
        .is_none());
}

/// The 3D quad's world view shows the player whose eye is the camera: a box model (legs, body, arms, head) at the
/// game's 0.9375 scale, feet 1.62 below the eye, body turned to the yaw, head tilted by the pitch. Its view cone's
/// far corners are the frame's corner rays.
#[test]
fn the_simulated_player_stands_under_the_camera_and_looks_where_it_looks() {
    use fire_core::camera::{player_boxes, view_cone};
    let cam = Camera {
        pos: [10.5, 65.62, -3.5],
        yaw: 0.0,
        pitch: 0.0,
        roll: 0.0,
        fov: 70.0,
    };
    let boxes = player_boxes(&cam);
    assert_eq!(boxes.len(), 6, "2 legs, body, 2 arms, head");
    let ys: Vec<f64> = boxes.iter().flat_map(|b| b.iter().map(|c| c[1])).collect();
    let (lo, hi) = (
        ys.iter().cloned().fold(f64::MAX, f64::min),
        ys.iter().cloned().fold(f64::MIN, f64::max),
    );
    assert!((lo - (cam.pos[1] - 1.62)).abs() < 1e-9, "feet {lo}");
    assert!((hi - lo - 1.875).abs() < 1e-9, "height {}", hi - lo);
    // yaw 0 looks +z: the head's front face is the +z one
    let head = boxes[5];
    let zmax = head.iter().map(|c| c[2]).fold(f64::MIN, f64::max);
    assert!((zmax - (cam.pos[2] + 0.25 * 0.9375)).abs() < 1e-9, "{zmax}");
    // looking down tilts the head's front down
    let down = player_boxes(&Camera { pitch: 60.0, ..cam });
    let front_low = down[5].iter().map(|c| c[1]).fold(f64::MAX, f64::min);
    assert!(front_low < head.iter().map(|c| c[1]).fold(f64::MAX, f64::min));
    // turned 90 (looking -x): the body is turned too
    let turned = player_boxes(&Camera { yaw: 90.0, ..cam });
    let xmin = turned[5].iter().map(|c| c[0]).fold(f64::MAX, f64::min);
    assert!((xmin - (cam.pos[0] - 0.25 * 0.9375)).abs() < 1e-9, "{xmin}");
    // the cone: 4 far corners, each `depth` along its corner ray, projecting back onto the frame's corners
    let cone = view_cone(&cam, 1920, 1080, 5.0);
    for (k, (x, y)) in [(0.0, 0.0), (1920.0, 0.0), (1920.0, 1080.0), (0.0, 1080.0)]
        .iter()
        .enumerate()
    {
        let (px, py) = cam.project(cone[k], 1920, 1080).unwrap();
        assert!(
            (px - x).abs() < 1e-6 && (py - y).abs() < 1e-6,
            "corner {k}: {px},{py}"
        );
    }
}

// ---- the 3D plane each logged quad was drawn from (for rendering the logged fire through another camera)

#[test]
fn each_logged_quad_gets_its_model_planes_world_corners_in_its_own_corner_order() {
    use fire_core::camera::logged_quad_worlds;
    let cam = truth();
    let mut seed = 7;
    let block = logged(&cam, [-80, 79, 131], 0.0, &mut seed);
    let worlds = logged_quad_worlds(std::slice::from_ref(&block), &cam, 2560, 1440);
    assert_eq!(worlds.len(), 1);
    assert_eq!(worlds[0].len(), block.quads.len());
    let model = block_candidates([-80, 79, 131]);
    for (k, (q, world)) in block.quads.iter().zip(&worlds[0]).enumerate() {
        let world = world.expect("a plane for every logged quad");
        // the logged corner order is the model's rotated by one (see `logged`)
        let want = [
            model[k].corners[1],
            model[k].corners[2],
            model[k].corners[3],
            model[k].corners[0],
        ];
        for i in 0..4 {
            for a in 0..3 {
                assert!(close(world[i][a], want[i][a], 1e-9), "quad {k} corner {i}");
            }
            let (x, y) = cam.project(world[i], 2560, 1440).unwrap();
            assert!(close(x, q.corners[i][0], 1e-6) && close(y, q.corners[i][1], 1e-6));
        }
    }
}
