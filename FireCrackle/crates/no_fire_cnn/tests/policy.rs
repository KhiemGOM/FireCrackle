use fire_core::gui_mask::GuiTextures;
use no_fire_cnn::policy::candidate;
#[test]
fn cnn_can_override_orange_score_but_never_missing_gui_evidence() {
    let tex = GuiTextures::from_rgba(
        vec![0; 256 * 256 * 4],
        vec![0; 256 * 256 * 4],
        vec![0; 256 * 256 * 4],
    )
    .unwrap();
    let rgb = vec![100u8; 1920 * 1080 * 3];
    let mut orange = rgb;
    for p in orange.chunks_exact_mut(3) {
        p.copy_from_slice(&[230, 130, 20]);
    }
    let mut calls = 0;
    assert!(
        !candidate(&orange, 1920, 1080, &tex, |_, _| {
            calls += 1;
            Ok(true)
        })
        .unwrap()
    );
    assert_eq!(
        calls, 1,
        "CNN must be tried when orange rules retain the frame"
    );
}
#[test]
fn prepared_gui_preserves_candidate_decisions() {
    use fire_core::gui_mask::{GuiDetector, GuiOptions};
    let tex = GuiTextures::from_rgba(
        vec![0; 256 * 256 * 4],
        vec![0; 256 * 256 * 4],
        vec![0; 256 * 256 * 4],
    )
    .unwrap();
    let detector = GuiDetector::new(tex.clone(), GuiOptions::default()).unwrap();
    for color in [[0, 0, 0], [230, 130, 20], [110, 30, 170]] {
        let rgb: Vec<u8> = color.into_iter().cycle().take(1920 * 1080 * 3).collect();
        assert_eq!(
            candidate(&rgb, 1920, 1080, &tex, |_, _| Ok(true)).unwrap(),
            no_fire_cnn::policy::candidate_prepared(&rgb, 1920, 1080, &detector, |_, _| Ok(true))
                .unwrap()
        );
    }
}
