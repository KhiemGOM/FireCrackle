#[path = "../src/portal.rs"]
#[allow(dead_code)] // Test-only inclusion exercises a subset of the shared module's public fields.
mod portal;

fn atlas() -> Vec<u8> {
    let mut t = Vec::new();
    for phase in 0..4 {
        for y in 0..4 {
            for x in 0..4 {
                let k = (x * 31 + y * 47 + phase * 67 + x * y * 13) % 100;
                t.extend_from_slice(&[
                    60 + k as u8,
                    10 + (k / 3) as u8,
                    170 + (k / 2) as u8,
                    170 + (k / 2) as u8,
                ]);
            }
        }
    }
    t
}
fn scene() -> Vec<u8> {
    let mut v = Vec::new();
    for y in 0..144 {
        for x in 0..256 {
            v.extend_from_slice(&[(40 + x / 4) as u8, (30 + y / 3) as u8, (25 + x / 6) as u8]);
        }
    }
    v
}
fn blend(scene: &[u8], t: &[u8], phase: usize, f: f64) -> Vec<u8> {
    let mut out = scene.to_vec();
    for y in 0..144 {
        for x in 0..256 {
            let p = (y * 256 + x) * 3;
            let q = ((phase * 4 + y * 4 / 144) * 4 + x * 4 / 256) * 4;
            let a = f * t[q + 3] as f64 / 255.0;
            for c in 0..3 {
                out[p + c] = (scene[p + c] as f64 * (1.0 - a) + a * t[q + c] as f64).round() as u8;
            }
        }
    }
    out
}

#[test]
fn fits_phase_opacity_and_recovers_smooth_world() {
    let t = atlas();
    let original = scene();
    let mut image = blend(&original, &t, 2, 0.75);
    let fit = portal::fit(&image, 256, 144, &t, 4, None).unwrap();
    assert!(fit.detected, "{fit:?}");
    assert_eq!(fit.phase, 2);
    assert!((fit.opacity - 0.75).abs() < 0.04, "{fit:?}");
    let valid = portal::undo(&mut image, 256, 144, &t, 4, fit.phase, fit.opacity, None).unwrap();
    assert!(valid.iter().all(|&v| v == 1));
    let error = image
        .iter()
        .zip(original)
        .map(|(&a, b)| (a as f64 - b as f64).abs())
        .sum::<f64>()
        / image.len() as f64;
    assert!(error < 3.0, "error{error} {fit:?}");
}
#[test]
fn ordinary_and_uniform_purple_are_not_portal() {
    let t = atlas();
    assert!(
        !portal::fit(&scene(), 256, 144, &t, 4, None)
            .unwrap()
            .detected
    );
    assert!(
        !portal::fit(&[80, 20, 170].repeat(256 * 144), 256, 144, &t, 4, None)
            .unwrap()
            .detected
    );
}
#[test]
fn preserves_gui_and_unrecoverable_pixels() {
    let original = scene();
    let mut image = original.clone();
    let t = [100, 20, 200, 255].repeat(16);
    let mask = vec![0; 256 * 144];
    let v = portal::undo(&mut image, 256, 144, &t, 4, 0, 0.5, Some(&mask)).unwrap();
    assert_eq!(image, original);
    assert!(v.iter().all(|&v| v == 0));
    let v = portal::undo(&mut image, 256, 144, &t, 4, 0, 1.0, None).unwrap();
    assert_eq!(image, original);
    assert!(v.iter().all(|&v| v == 0));
}
#[test]
fn malformed_buffers_are_rejected() {
    assert!(portal::fit(&[], 100, 100, &atlas(), 4, None).is_err());
    assert!(portal::undo(&mut scene(), 256, 144, &atlas(), 4, 99, 0.5, None).is_err());
}

#[test]
fn guard_abstains_on_known_world_translucency_and_portal_candidates() {
    let mut rgb = vec![20; 64 * 64 * 3];
    let mut known = vec![0; 64 * 64];
    known[0] = 1;
    assert!(
        portal::guard(&rgb, 64, 64, None, Some(&known))
            .unwrap()
            .abstain
    );
    let mut mask = vec![1; 64 * 64];
    mask[0] = 0;
    assert!(
        !portal::guard(&rgb, 64, 64, Some(&mask), Some(&known))
            .unwrap()
            .abstain
    );
    for y in 10..20 {
        for x in 10..20 {
            rgb[(y * 64 + x) * 3..(y * 64 + x) * 3 + 3].copy_from_slice(&[100, 20, 180]);
        }
    }
    let g = portal::guard(&rgb, 64, 64, None, None).unwrap();
    assert!(g.abstain);
    assert_eq!(g.largest_purple, 100);
    assert_eq!(g.flags, 2);
}
