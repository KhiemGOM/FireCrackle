//! Guided camera solve: the automatic guess (rotation + FOV from `reversal::orientation`, yaw known modulo 90°) plus
//! one or two clicked block corners gives the exact camera; more clicks override a wrong guess.
//!
//! Ways this breaks, each tested: one point alone leaves the eye free (needs the eye height); yaw modulo 90° leaves
//! four quarter turns, which the clicks must decide; a wrong guess (e.g. the 90° pitch swap) must give way to the
//! clicks once there are enough of them (4+); click noise; duplicate or degenerate points; points behind the camera.
use fire_core::camera::{solve_guided, Camera, Guess};

const W: usize = 1920;
const H: usize = 1080;

fn truth() -> Camera {
    Camera {
        pos: [3.37, 65.62, -2.81],
        yaw: -152.0,
        pitch: 24.0,
        roll: 0.2,
        fov: 110.0,
    }
}

/// The guess `reversal::orientation` would give: yaw modulo 90, angles off by `err` degrees.
fn guess(c: &Camera, err: f64) -> Guess {
    Guess {
        yaw: (c.yaw + err).rem_euclid(90.0),
        pitch: c.pitch - err,
        roll: c.roll + err * 0.5,
        fov: c.fov + err * 2.0,
        yaw_mod_90: true,
        fov_known: true,
        roll_fixed: false,
    }
}

fn clicks(c: &Camera, pts: &[[f64; 3]], noise: f64) -> Vec<([f64; 3], [f64; 2])> {
    pts.iter()
        .enumerate()
        .map(|(i, &p)| {
            let (x, y) = c.project(p, W, H).expect("in front");
            let n = |k: usize| noise * (((i * 7 + k * 3) % 5) as f64 / 2.0 - 1.0);
            (p, [x + n(0), y + n(1)])
        })
        .collect()
}

fn dist(a: [f64; 3], b: [f64; 3]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// Pixel distance, under two cameras, of a point neither was solved from.
fn held_out_px(a: &Camera, b: &Camera, p: [f64; 3]) -> f64 {
    let (x0, y0) = a.project(p, W, H).unwrap();
    let (x1, y1) = b.project(p, W, H).unwrap();
    ((x0 - x1).powi(2) + (y0 - y1).powi(2)).sqrt()
}

// block corners in front of the truth camera (yaw -152 looks towards +x -z, pitch 24 down)
const A: [f64; 3] = [6.0, 64.0, -7.0];
const B: [f64; 3] = [9.0, 64.0, -5.0];
const C: [f64; 3] = [5.0, 66.0, -9.0];
const D: [f64; 3] = [4.0, 63.0, -6.0];
const FIRE: [f64; 3] = [6.5, 63.5, -5.5];

#[test]
fn an_exact_guess_and_two_corners_give_the_exact_camera() {
    let t = truth();
    let fits = solve_guided(&clicks(&t, &[A, B], 0.0), W, H, &guess(&t, 0.0), None);
    let f = &fits[0];
    assert!(dist(f.camera.pos, t.pos) < 1e-4, "{f:?}");
    assert!(
        (f.camera.yaw - t.yaw)
            .rem_euclid(360.0)
            .min((t.yaw - f.camera.yaw).rem_euclid(360.0))
            < 1e-3,
        "{f:?}"
    );
    assert!(f.rms < 1e-3, "{f:?}");
}

#[test]
fn the_clicks_pick_the_quarter_turn() {
    let t = truth();
    let fits = solve_guided(&clicks(&t, &[A, B], 0.0), W, H, &guess(&t, 0.0), None);
    // the yaw the guess gave was modulo 90; the answer has the real one
    let d = (fits[0].camera.yaw - t.yaw).rem_euclid(360.0);
    assert!(d < 1e-3 || d > 360.0 - 1e-3, "{:?}", fits[0]);
    if fits.len() > 1 {
        assert!(fits[1].rms > 10.0 * fits[0].rms.max(0.01), "{fits:?}");
    }
}

#[test]
fn a_guess_off_by_half_a_degree_still_places_a_fire_within_a_few_pixels() {
    let t = truth();
    let fits = solve_guided(&clicks(&t, &[A, B], 0.0), W, H, &guess(&t, 0.5), None);
    let f = &fits[0];
    assert!(held_out_px(&f.camera, &t, FIRE) < 6.0, "{f:?}");
    assert!(dist(f.camera.pos, t.pos) < 0.2, "{f:?}");
}

#[test]
fn one_corner_needs_the_eye_height() {
    let t = truth();
    let one = clicks(&t, &[A], 0.0);
    assert!(solve_guided(&one, W, H, &guess(&t, 0.0), None).is_empty());
    let fits = solve_guided(&one, W, H, &guess(&t, 0.0), Some(t.pos[1]));
    // one corner + eye height fits every quarter turn exactly; the right one is among them
    assert!(
        fits.iter().any(|f| dist(f.camera.pos, t.pos) < 1e-4),
        "{fits:?}"
    );
}

#[test]
fn enough_clicks_override_a_wrong_guess() {
    let t = truth();
    // the 90° pitch swap: 24 → -66
    let wrong = Guess {
        pitch: t.pitch - 90.0,
        ..guess(&t, 0.0)
    };
    let fits = solve_guided(&clicks(&t, &[A, B, C, D, FIRE], 0.0), W, H, &wrong, None);
    let f = &fits[0];
    assert!(dist(f.camera.pos, t.pos) < 1e-3, "{f:?}");
    assert!((f.camera.pitch - t.pitch).abs() < 1e-3, "{f:?}");
}

/// With several noisy clicks (0.7 px, as a person clicks) and a slightly wrong guess, the guided answer must place a
/// fire at least as well as the clicks alone (`camera::solve`). Changed from "exact with exact clicks": the guess is
/// held softly, and on the recordings that is what makes 4 real clicks better than the clicks alone (1.8 px against
/// 3.1 px median), because a few noisy clicks fit a wrong camera too well.
#[test]
fn several_noisy_clicks_and_a_slightly_wrong_guess_do_at_least_as_well_as_the_clicks_alone() {
    use fire_core::camera::solve;
    let t = truth();
    let pts = clicks(&t, &[A, B, C, D, FIRE], 0.7);
    let guided = &solve_guided(&pts, W, H, &guess(&t, 0.5), None)[0];
    let alone = solve(&pts, W, H).expect("clicks alone");
    let far = [8.0, 62.0, -11.0];
    let (g, a) = (
        held_out_px(&guided.camera, &t, far),
        held_out_px(&alone.camera, &t, far),
    );
    assert!(
        g <= a.max(2.0),
        "guided {g:.2} px, clicks alone {a:.2} px: {guided:?}"
    );
}

#[test]
fn click_noise_moves_the_eye_only_a_little() {
    let t = truth();
    let fits = solve_guided(&clicks(&t, &[A, B, C], 0.7), W, H, &guess(&t, 0.3), None);
    let f = &fits[0];
    assert!(dist(f.camera.pos, t.pos) < 0.1, "{f:?}");
    assert!(held_out_px(&f.camera, &t, FIRE) < 4.0, "{f:?}");
}

#[test]
fn degenerate_input_gives_nothing_and_never_panics() {
    let t = truth();
    assert!(solve_guided(&[], W, H, &guess(&t, 0.0), None).is_empty());
    let same = clicks(&t, &[A, A], 0.0);
    let fits = solve_guided(&same, W, H, &guess(&t, 0.0), None);
    assert!(
        fits.is_empty(),
        "two clicks on one corner fix only two equations: {fits:?}"
    );
    let bad = vec![(A, [f64::NAN, 10.0]), (B, [20.0, 30.0])];
    assert!(solve_guided(&bad, W, H, &guess(&t, 0.0), None).is_empty());
}

#[test]
fn every_answer_has_the_clicked_points_in_front() {
    let t = truth();
    for f in solve_guided(&clicks(&t, &[A, B], 0.0), W, H, &guess(&t, 0.0), None) {
        for p in [A, B] {
            assert!(f.camera.to_view(p)[2] < 0.0, "{f:?}");
        }
    }
}

// ---- roll held at 0 (Minecraft tilts the view only for a moment when hurt): a wrong assumption must show as a misfit,
// not hide in a tilted camera

/// A level camera (roll 0) looking down 30 degrees from 3 blocks above the floor the corners are on.
fn level() -> Camera {
    Camera {
        pos: [3.0, 64.0 + 4.62, 1.0],
        yaw: -150.0,
        pitch: 30.0,
        roll: 0.0,
        fov: 90.0,
    }
}
const P: [f64; 3] = [5.0, 64.0, -2.0];
const Q: [f64; 3] = [6.0, 64.0, -3.0];

#[test]
fn with_roll_held_every_answer_is_level_and_a_level_camera_is_found_exactly() {
    let t = level();
    let held = Guess {
        roll_fixed: true,
        roll: 4.0,
        ..guess(&t, 0.0)
    };
    let fits = solve_guided(&clicks(&t, &[P, Q, FIRE], 0.0), W, H, &held, None);
    assert!(!fits.is_empty());
    for f in &fits {
        assert!(f.camera.roll.abs() < 1e-9, "roll {f:?}");
    }
    let f = &fits[0];
    assert!(dist(f.camera.pos, t.pos) < 1e-3, "{f:?}");
    assert!(f.rms < 1e-3, "{f:?}");
}

#[test]
fn with_roll_held_three_corners_expose_a_wrong_eye_height_that_roll_free_hides() {
    // "On ground" on the corners' floor, but the player stands 3 blocks higher. Two corners can never tell (4 equations,
    // 5 unknowns even with eye height and roll fixed: the tool calls such a camera rough). With three, a level camera
    // cannot fit the wrong height and misses the corners; with roll free a tilted camera absorbs it.
    let t = level();
    let pts = clicks(&t, &[P, Q, R], 0.0);
    let wrong_eye = Some(64.0 + 1.62);
    let free = solve_guided(&pts, W, H, &guess(&t, 0.0), wrong_eye);
    let held = solve_guided(
        &pts,
        W,
        H,
        &Guess {
            roll_fixed: true,
            ..guess(&t, 0.0)
        },
        wrong_eye,
    );
    assert!(held[0].camera.roll.abs() < 1e-9);
    assert!(held[0].rms > 3.0, "held: {:?}", held[0]);
    assert!(
        held[0].rms > 2.0 * free[0].rms,
        "free: {:?} held: {:?}",
        free[0],
        held[0]
    );
    // and with the right eye height, held fits exactly
    let right = solve_guided(
        &pts,
        W,
        H,
        &Guess {
            roll_fixed: true,
            ..guess(&t, 0.0)
        },
        Some(t.pos[1]),
    );
    assert!(right[0].rms < 1e-3, "{:?}", right[0]);
}
const R: [f64; 3] = [4.0, 65.0, -3.0];

#[test]
fn with_roll_held_the_clicks_alone_answer_is_level_too() {
    // four or more corners also offer the clicks-alone camera; held, it is fitted again with roll 0
    let t = level();
    let wrong = Guess {
        pitch: t.pitch - 90.0,
        roll_fixed: true,
        ..guess(&t, 0.0)
    };
    let fits = solve_guided(&clicks(&t, &[A, B, C, D, P, Q], 0.0), W, H, &wrong, None);
    assert!(fits.iter().all(|f| f.camera.roll.abs() < 1e-9), "{fits:?}");
    assert!(fits.iter().any(|f| f.rms < 1e-2), "{fits:?}");
}
