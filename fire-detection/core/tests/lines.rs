//! Straight edge segments (LSD-style region growing). Minecraft draws without antialiasing, so a slanted edge is a
//! staircase; a segment's direction must come from the whole run, not from pixel gradients. Ways this breaks: two
//! crossing edges merged into one, a staircase read as many short 0°/90° pieces, noise and flat areas giving segments,
//! masked pixels (GUI) leaking in.
use fire_core::lines::{segments, Segment};

const W: usize = 400;
const H: usize = 300;

/// Half-plane picture: dark on one side of the line through (cx, cy) at `deg` (image coordinates, y down), drawn
/// with nearest sampling (a staircase), optionally supersampled (antialiased like a downscaled video).
fn edge_picture(cx: f64, cy: f64, deg: f64, aa: bool) -> Vec<u8> {
    let (s, c) = deg.to_radians().sin_cos();
    let mut img = vec![0u8; W * H * 3];
    for y in 0..H {
        for x in 0..W {
            let n = if aa { 4 } else { 1 };
            let mut dark = 0;
            for sy in 0..n {
                for sx in 0..n {
                    let (px, py) = (
                        x as f64 + (sx as f64 + 0.5) / n as f64,
                        y as f64 + (sy as f64 + 0.5) / n as f64,
                    );
                    // signed distance to the line
                    if (px - cx) * s - (py - cy) * c > 0.0 {
                        dark += 1;
                    }
                }
            }
            let l = 200 - (150 * dark / (n * n)) as u8;
            img[(y * W + x) * 3..][..3].copy_from_slice(&[l, l, l]);
        }
    }
    img
}

/// Direction of a segment in image degrees (y down), in [0, 180).
fn angle(s: &Segment) -> f64 {
    (-s.dir[1]).atan2(s.dir[0]).to_degrees().rem_euclid(180.0)
}

fn angle_gap(a: f64, b: f64) -> f64 {
    let d = (a - b).rem_euclid(180.0);
    d.min(180.0 - d)
}

fn longest(v: &[Segment]) -> &Segment {
    v.iter()
        .max_by(|a, b| a.length.total_cmp(&b.length))
        .expect("a segment")
}

#[test]
fn a_straight_edge_gives_one_long_segment_at_its_angle() {
    for deg in [17.0, 63.0, 128.0] {
        let found = segments(&edge_picture(200.0, 150.0, deg, true), W, H, None);
        let s = longest(&found);
        assert!(angle_gap(angle(s), deg) < 0.3, "{deg}: {s:?}");
        assert!(s.length > 200.0, "{deg}: {s:?}");
    }
}

#[test]
fn a_staircase_edge_still_has_its_true_angle() {
    // 4° off horizontal: steps 14 px long, which raw gradients see as horizontal
    for deg in [4.0, 33.0, 86.0] {
        let found = segments(&edge_picture(200.0, 150.0, deg, false), W, H, None);
        let s = longest(&found);
        assert!(angle_gap(angle(s), deg) < 0.5, "{deg}: {s:?}");
        assert!(s.length > 150.0, "{deg}: {s:?}");
    }
}

#[test]
fn the_segment_lies_on_the_edge() {
    let found = segments(&edge_picture(200.0, 150.0, 30.0, true), W, H, None);
    let s = longest(&found);
    // the centre's distance from the true line (y up in Segment: convert)
    let (cx, cy) = (s.centre[0] + W as f64 / 2.0, H as f64 / 2.0 - s.centre[1]);
    let (sn, cs) = 30f64.to_radians().sin_cos();
    let dist = ((cx - 200.0) * sn - (cy - 150.0) * cs).abs();
    assert!(dist < 1.0, "{s:?}, {dist}");
}

#[test]
fn crossing_edges_are_not_merged() {
    // a dark quadrant: a horizontal and a vertical edge meeting at the centre
    let mut img = vec![200u8; W * H * 3];
    for y in 150..H {
        for x in 200..W {
            img[(y * W + x) * 3..][..3].copy_from_slice(&[50, 50, 50]);
        }
    }
    let found = segments(&img, W, H, None);
    let long: Vec<&Segment> = found.iter().filter(|s| s.length > 100.0).collect();
    assert_eq!(long.len(), 2, "{found:?}");
    let mut a: Vec<f64> = long.iter().map(|s| angle(s)).collect();
    a.sort_by(f64::total_cmp);
    assert!(
        angle_gap(a[0], 0.0) < 0.3 && angle_gap(a[1], 90.0) < 0.3,
        "{a:?}"
    );
}

#[test]
fn flat_and_noise_give_no_long_segments() {
    assert!(segments(&vec![120u8; W * H * 3], W, H, None).is_empty());
    let mut v: u64 = 7;
    let noise: Vec<u8> = (0..W * H * 3)
        .map(|_| {
            v = v
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (100 + (v >> 59)) as u8
        })
        .collect();
    let found = segments(&noise, W, H, None);
    assert!(
        found.iter().all(|s| s.length < 20.0),
        "{:?}",
        longest(&found)
    );
}

#[test]
fn masked_pixels_give_no_segments() {
    let img = edge_picture(200.0, 150.0, 40.0, true);
    let ignore = vec![true; W * H];
    assert!(segments(&img, W, H, Some(&ignore)).is_empty());
    // only the left half visible: the segment stays left of the centre
    let ignore: Vec<bool> = (0..W * H).map(|i| i % W >= W / 2).collect();
    let found = segments(&img, W, H, Some(&ignore));
    let s = longest(&found);
    assert!(
        s.centre[0] + s.length / 2.0 * s.dir[0].abs() <= 2.0,
        "{s:?}"
    );
}

#[test]
fn bad_sizes_give_nothing() {
    assert!(segments(&[0u8; 7], W, H, None).is_empty());
    assert!(segments(&[], 0, 0, None).is_empty());
    assert!(segments(&vec![0u8; W * H * 3], W, H, Some(&[false; 3])).is_empty());
}
