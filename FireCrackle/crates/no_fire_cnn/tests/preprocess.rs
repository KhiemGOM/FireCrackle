use no_fire_cnn::{clear_score, tile_boxes, views};
#[test]
fn strict_threshold_and_invalid_scores_abstain() {
    assert!(clear_score(-2.0));
    assert!(!clear_score(no_fire_cnn::THRESHOLD));
    assert!(!clear_score(f32::NAN));
    assert!(!clear_score(f32::NEG_INFINITY));
}
#[test]
fn tiles_cover_the_strip_cropped_frame_in_frozen_order() {
    assert_eq!(
        tile_boxes(),
        vec![
            (0, 0, 1920, 1068),
            (0, 0, 640, 640),
            (427, 0, 640, 640),
            (853, 0, 640, 640),
            (1280, 0, 640, 640),
            (0, 428, 640, 640),
            (427, 428, 640, 640),
            (853, 428, 640, 640),
            (1280, 428, 640, 640)
        ]
    );
}
#[test]
fn invalid_frame_is_refused_and_constant_colours_stay_exact() {
    assert!(views(&[0; 20]).is_err());
    let rgb = vec![37; 1920 * 1080 * 3];
    let out = views(&rgb).unwrap();
    assert_eq!(out.len(), 9);
    for image in out {
        assert_eq!(image, vec![37; 224 * 224 * 3]);
    }
}
#[test]
fn every_view_matches_frozen_pillow_rounding_on_edges_and_gradients() {
    let mut rgb = vec![0u8; 1920 * 1080 * 3];
    for y in 0..1080 {
        for x in 0..1920 {
            for c in 0..3 {
                rgb[(y * 1920 + x) * 3 + c] =
                    ((x * 17 + y * 13 + c * 71 + (x ^ y) * 3) % 256) as u8;
            }
        }
    }
    let actual: Vec<_> = views(&rgb)
        .unwrap()
        .iter()
        .map(|v| {
            v.iter().fold(14695981039346656037u64, |h, b| {
                (h ^ *b as u64).wrapping_mul(1099511628211)
            })
        })
        .collect();
    assert_eq!(
        actual,
        vec![
            12143120918087265324,
            10216322064033174983,
            16202514416712009155,
            14899274019887650915,
            10216322064033174983,
            15169053093603593085,
            14066562202797551923,
            9937200149443139664,
            15169053093603593085
        ]
    );
}
#[test]
fn backend_rounding_near_the_threshold_remains_unreviewed() {
    assert!(!clear_score(no_fire_cnn::THRESHOLD - 0.00001));
}
#[test]
fn portable_calibration_is_the_frozen_cpu_minimum() {
    assert_eq!(no_fire_cnn::THRESHOLD, -1.757_097_2);
}
