//! Automatic perspective reversal, stage 1: the camera's rotation and FOV from the picture alone. Minecraft is a
//! Manhattan world (every block edge and texel edge runs along a world axis), so every edge pixel's gradient points at
//! one of three vanishing points. The frames here are ray-cast block worlds with 16×16-texel faces, like the game.
//!
//! Ways this breaks, each with a test below:
//! - yaw is only knowable modulo 90° (the three axes look the same after a quarter turn);
//! - edges that are not world edges: GUI (masked by the caller), the hand / held item (other projection), noise;
//! - a picture with no edges (sky, a flat colour) has no answer;
//! - looking straight along an axis with the horizon level leaves one finite vanishing point, so FOV is unknown;
//! - video blur and compression soften edges.
#![allow(clippy::chunks_exact_to_as_chunks)] // RGB pixels by 3 over runtime-length buffers, as in the library
use fire_core::camera::Camera;
use fire_core::reversal::{orientation, Orientation};

const W: usize = 1920;
const H: usize = 1080;

fn hash(mut v: u64) -> u64 {
    v ^= v >> 33;
    v = v.wrapping_mul(0xff51afd7ed558ccd);
    v ^= v >> 33;
    v = v.wrapping_mul(0xc4ceb9fe1a85ec53);
    v ^ (v >> 33)
}

fn key(b: [i64; 3]) -> u64 {
    (b[0] as u64).wrapping_mul(73856093)
        ^ (b[1] as u64).wrapping_mul(19349663)
        ^ (b[2] as u64).wrapping_mul(83492791)
}

/// Ground below y = 0, plus pillars and a wall away from the origin.
fn solid(b: [i64; 3]) -> bool {
    if b[1] < 0 {
        return true;
    }
    if b[0].abs() < 3 && b[2].abs() < 3 {
        return false;
    }
    let h = hash(key([b[0], 0, b[2]]) ^ 99);
    let tall = if h.is_multiple_of(9) {
        1 + (h >> 8) % 4
    } else {
        0
    } as i64;
    b[1] < tall || (b[2] == 9 && b[0] > -6 && b[0] < 7 && b[1] < 3)
}

/// One frame of the block world seen by `cam` (nearest texel per pixel centre, as the game draws).
fn render(cam: &Camera, w: usize, h: usize) -> Vec<u8> {
    let t = (cam.fov.to_radians() / 2.0).tan();
    let mut out = vec![0u8; w * h * 3];
    for py in 0..h {
        for px in 0..w {
            let v = [
                ((px as f64 + 0.5) / w as f64 * 2.0 - 1.0) * t * w as f64 / h as f64,
                (1.0 - (py as f64 + 0.5) / h as f64 * 2.0) * t,
                -1.0,
            ];
            let d = cam.view_dir_to_world(v);
            let c = cast(cam.pos, d);
            out[(py * w + px) * 3..][..3].copy_from_slice(&c);
        }
    }
    out
}

fn cast(o: [f64; 3], d: [f64; 3]) -> [u8; 3] {
    let mut b = [
        o[0].floor() as i64,
        o[1].floor() as i64,
        o[2].floor() as i64,
    ];
    let step = [
        d[0].signum() as i64,
        d[1].signum() as i64,
        d[2].signum() as i64,
    ];
    let mut next = [0.0; 3];
    let mut delta = [0.0; 3];
    for a in 0..3 {
        delta[a] = if d[a] == 0.0 {
            f64::INFINITY
        } else {
            1.0 / d[a].abs()
        };
        let edge = if d[a] > 0.0 {
            b[a] as f64 + 1.0
        } else {
            b[a] as f64
        };
        next[a] = if d[a] == 0.0 {
            f64::INFINITY
        } else {
            (edge - o[a]) / d[a]
        };
    }
    for _ in 0..400 {
        let a = (0..3).min_by(|&i, &j| next[i].total_cmp(&next[j])).unwrap();
        let t = next[a];
        if t > 80.0 {
            break;
        }
        b[a] += step[a];
        next[a] += delta[a];
        if solid(b) {
            let p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
            let (u, v) = match a {
                0 => (p[2], p[1]),
                1 => (p[0], p[2]),
                _ => (p[0], p[1]),
            };
            let tu = ((u - u.floor()) * 16.0).floor() as u64;
            let tv = ((v - v.floor()) * 16.0).floor() as u64;
            let base = 70 + (hash(key(b)) % 90) as i64;
            let shade = [0.8, 1.0, 0.6][a];
            let texel = (hash(key(b) ^ (a as u64 * 1000 + tu * 16 + tv)) % 50) as i64 - 25;
            let l = ((base + texel) as f64 * shade).clamp(0.0, 255.0);
            return [l as u8, (l * 0.8) as u8, (l * 0.6) as u8];
        }
    }
    [120, 160, 230]
}

fn yaw_mod(a: f64) -> f64 {
    a.rem_euclid(90.0)
}

/// |difference| of two yaws modulo 90°.
fn yaw_err(a: f64, b: f64) -> f64 {
    let d = (yaw_mod(a) - yaw_mod(b)).rem_euclid(90.0);
    d.min(90.0 - d)
}

fn check(truth: Camera, found: &Orientation, rot_tol: f64, fov_tol: f64) {
    assert!(
        yaw_err(found.yaw, truth.yaw) < rot_tol
            && (found.pitch - truth.pitch).abs() < rot_tol
            && (found.roll - truth.roll).abs() < rot_tol,
        "truth {truth:?}, found {found:?}"
    );
    assert!(found.fov_known, "{found:?}");
    assert!(
        (found.fov - truth.fov).abs() < fov_tol,
        "truth {truth:?}, found {found:?}"
    );
    assert!(!found.ambiguous, "{found:?}");
}

fn cam(yaw: f64, pitch: f64, roll: f64, fov: f64) -> Camera {
    Camera {
        pos: [0.3, 1.62, 0.7],
        yaw,
        pitch,
        roll,
        fov,
    }
}

#[test]
fn rotation_and_fov_from_a_plain_frame() {
    let truth = cam(31.0, 24.0, 0.0, 70.0);
    let found = orientation(&render(&truth, W, H), W, H, None).expect("an answer");
    check(truth, &found, 0.25, 1.0);
}

#[test]
fn a_wide_fov_looking_up_with_bobbing_roll() {
    let truth = cam(62.0, -12.0, 0.6, 110.0);
    let found = orientation(&render(&truth, W, H), W, H, None).expect("an answer");
    check(truth, &found, 0.25, 1.5);
}

#[test]
fn looking_steeply_down_at_sprint_fov() {
    let truth = cam(47.0, 58.0, 0.0, 126.5);
    let found = orientation(&render(&truth, W, H), W, H, None).expect("an answer");
    check(truth, &found, 0.25, 1.5);
}

#[test]
fn yaw_is_found_modulo_a_quarter_turn() {
    let truth = cam(-152.0, 18.0, 0.0, 90.0);
    let found = orientation(&render(&truth, W, H), W, H, None).expect("an answer");
    assert!((0.0..90.0).contains(&found.yaw), "{found:?}");
    check(truth, &found, 0.25, 1.0);
}

/// HUD-like screen-aligned rectangles under the ignore mask, and hand-like slanted bars that are not masked.
#[test]
fn masked_gui_and_unmasked_hand_do_not_pull_it() {
    let truth = cam(23.0, 30.0, 0.0, 80.0);
    let mut img = render(&truth, W, H);
    let mut ignore = vec![false; W * H];
    for y in 900..1020 {
        for x in 540..1380 {
            let on = ((x - 540) / 90 + (y - 900) / 60) % 2 == 0;
            img[(y * W + x) * 3..][..3].copy_from_slice(if on {
                &[20, 20, 20]
            } else {
                &[200, 200, 200]
            });
            ignore[y * W + x] = true;
        }
    }
    // a "hand": two dark bars at 55° in the bottom right
    for y in 600..H {
        for x in 1410..W {
            let s = (x as f64 - 1410.0) * 0.82 + (y as f64 - 600.0) * 0.57;
            if (s as i64 / 54) % 2 == 0 && s < 480.0 {
                img[(y * W + x) * 3..][..3].copy_from_slice(&[25, 18, 14]);
            }
        }
    }
    let found = orientation(&img, W, H, Some(&ignore)).expect("an answer");
    check(truth, &found, 0.3, 1.5);
}

#[test]
fn blur_and_noise_like_a_video_still_work() {
    let truth = cam(12.0, 20.0, 0.0, 70.0);
    let img = render(&truth, W, H);
    // 3×3 box blur, then ±10 noise
    let mut out = img.clone();
    for y in 1..H - 1 {
        for x in 1..W - 1 {
            for c in 0..3 {
                let mut s = 0u32;
                for dy in 0..3 {
                    for dx in 0..3 {
                        s += img[((y + dy - 1) * W + x + dx - 1) * 3 + c] as u32;
                    }
                }
                let n = (hash((y * W + x) as u64 * 3 + c as u64) % 21) as i32 - 10;
                out[(y * W + x) * 3 + c] = (s as i32 / 9 + n).clamp(0, 255) as u8;
            }
        }
    }
    let found = orientation(&out, W, H, None).expect("an answer");
    check(truth, &found, 0.35, 2.0);
}

#[test]
fn a_flat_picture_has_no_answer() {
    let img = vec![90u8; W * H * 3];
    assert!(orientation(&img, W, H, None).is_none());
    let mut ignore = vec![true; W * H];
    ignore[0] = false;
    let truth = cam(31.0, 24.0, 0.0, 70.0);
    assert!(
        orientation(&render(&truth, W, H), W, H, Some(&ignore)).is_none(),
        "everything ignored"
    );
}

#[test]
fn looking_along_an_axis_with_a_level_horizon_leaves_fov_unknown() {
    let truth = cam(0.0, 0.0, 0.0, 70.0);
    let found = orientation(&render(&truth, W, H), W, H, None).expect("an answer");
    assert!(!found.fov_known, "{found:?}");
    assert!(
        yaw_err(found.yaw, 0.0) < 0.5 && found.pitch.abs() < 0.5,
        "{found:?}"
    );
}

#[test]
fn bad_input_sizes_give_nothing() {
    assert!(orientation(&[0u8; 10], W, H, None).is_none());
    assert!(orientation(&[], 0, 0, None).is_none());
    let img = vec![0u8; W * H * 3];
    assert!(orientation(&img, W, H, Some(&[false; 5])).is_none());
}

/// Writes a rendered frame for a look: `RENDER_OUT=x.ppm cargo test --test reversal dump -- --ignored`.
#[test]
#[ignore]
fn dump() {
    let img = render(&cam(31.0, 24.0, 0.0, 70.0), W, H);
    let mut f = format!("P6 {W} {H} 255\n").into_bytes();
    f.extend_from_slice(&img);
    std::fs::write(std::env::var("RENDER_OUT").unwrap(), f).unwrap();
}

#[test]
fn rotation_error_ignores_quarter_turns_and_measures_degrees() {
    use fire_core::reversal::rotation_error;
    let c = cam(-152.0, 18.0, 0.3, 90.0);
    let o = |yaw, pitch, roll| Orientation {
        yaw,
        pitch,
        roll,
        fov: 90.0,
        fov_known: true,
        ambiguous: false,
        margin: 1.0,
        support: 1.0,
        edges: 100,
    };
    assert!(rotation_error(&o(28.0, 18.0, 0.3), &c) < 1e-6);
    assert!((rotation_error(&o(28.0, 19.0, 0.3), &c) - 1.0).abs() < 0.01);
    assert!((rotation_error(&o(28.0, 18.0, 2.3), &c) - 2.0).abs() < 0.01);
    assert!(rotation_error(&o(73.0, 18.0, 0.3), &c) > 40.0);
}

/// Unmasked chat-like text (many short, exactly screen-aligned strokes, as when the GUI mask misses the chat) must not
/// pull the answer to a level camera with a narrow FOV, whose vanishing lines are all screen-aligned.
#[test]
fn unmasked_text_does_not_win() {
    let truth = cam(35.5, 38.0, 0.0, 110.0);
    // the pause screen darkens the world
    let mut img: Vec<u8> = render(&truth, W, H)
        .iter()
        .map(|&v| (v as f64 * 0.3) as u8)
        .collect();
    // 12 lines of "glyphs": 5×7 cells of 3 px dots, white with a dark shadow, like Minecraft text at GUI scale 3
    for line in 0..12 {
        for ch in 0..100 {
            let g = hash(line * 1000 + ch);
            for cy in 0..7 {
                for cx in 0..5 {
                    if (g >> (cy * 5 + cx)) & 1 == 0 {
                        continue;
                    }
                    for (off, col) in [(3usize, [62u8, 62, 62]), (0, [255, 255, 255])] {
                        for py in 0..3 {
                            for px in 0..3 {
                                let x = 6 + ch as usize * 18 + cx * 3 + px + off;
                                let y = 600 + line as usize * 27 + cy * 3 + py + off;
                                img[(y * W + x) * 3..][..3].copy_from_slice(&col);
                            }
                        }
                    }
                }
            }
        }
    }
    let found = orientation(&img, W, H, None).expect("an answer");
    check(truth, &found, 0.3, 1.5);
}

/// Fill the convex polygon `pts` (image pixels) with `col`.
fn fill(img: &mut [u8], pts: &[(f64, f64)], col: [u8; 3]) {
    for y in 0..H {
        for x in 0..W {
            let (px, py) = (x as f64 + 0.5, y as f64 + 0.5);
            let inside = (0..pts.len()).all(|i| {
                let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
                (b.0 - a.0) * (py - a.1) - (b.1 - a.1) * (px - a.0) >= 0.0
            });
            if inside {
                img[(y * W + x) * 3..][..3].copy_from_slice(&col);
            }
        }
    }
}

/// The first-person arm and held item: big boxes drawn with their own fixed projection in the bottom corners, with
/// long strong edges that are not world edges (frame 1535 of quad1). They must not pull the answer.
#[test]
fn the_first_person_arms_do_not_win() {
    let truth = cam(15.5, 36.0, 0.0, 110.0);
    let mut img = render(&truth, W, H);
    // right arm: a long slanted box from the bottom edge up towards the centre, with a lit side face
    fill(
        &mut img,
        &[
            (1500.0, 1080.0),
            (1330.0, 640.0),
            (1450.0, 600.0),
            (1700.0, 1080.0),
        ],
        [30, 26, 24],
    );
    fill(
        &mut img,
        &[
            (1700.0, 1080.0),
            (1450.0, 600.0),
            (1520.0, 590.0),
            (1820.0, 1080.0),
        ],
        [70, 62, 58],
    );
    // left arm, mirrored
    fill(
        &mut img,
        &[
            (420.0, 1080.0),
            (220.0, 1080.0),
            (470.0, 600.0),
            (590.0, 640.0),
        ],
        [30, 26, 24],
    );
    fill(
        &mut img,
        &[
            (220.0, 1080.0),
            (100.0, 1080.0),
            (400.0, 590.0),
            (470.0, 600.0),
        ],
        [70, 62, 58],
    );
    let found = orientation(&img, W, H, None).expect("an answer");
    check(truth, &found, 0.3, 1.5);
}

/// Video compression's block edges (8×8 blocks, each a little brighter or darker) are exactly screen-aligned; with a
/// camera a few degrees off an axis they must not snap the yaw to the axis (quad1 frame 2695: 9.7° found as 0.2°).
#[test]
fn compression_blocks_do_not_snap_yaw_to_an_axis() {
    let truth = cam(9.7, 27.4, 0.0, 120.8);
    let mut img = render(&truth, W, H);
    for (i, p) in img.chunks_exact_mut(3).enumerate() {
        let (bx, by) = ((i % W) / 8, (i / W) / 8);
        let d = (hash((by * 1000 + bx) as u64) % 15) as i32 - 7;
        for c in p {
            *c = (*c as i32 + d).clamp(0, 255) as u8;
        }
    }
    let found = orientation(&img, W, H, None).expect("an answer");
    check(truth, &found, 0.3, 1.5);
}
