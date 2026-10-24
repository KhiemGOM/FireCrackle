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
    for p in orange.as_chunks_mut::<3>().0 {
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
#[test]
fn veil_colour_statistics_never_decide_the_model_sees_the_frame_as_it_is() {
    // an orange scene under the GUI veil's formula (16a + p(1 - a)), with no open screen detected: the colour
    // detector would call it veiled, but only the GUI detector decides (and a detected screen abstains anyway)
    let tex = GuiTextures::from_rgba(
        vec![0; 256 * 256 * 4],
        vec![0; 256 * 256 * 4],
        vec![0; 256 * 256 * 4],
    )
    .unwrap();
    let a = 0.76;
    let veiled: Vec<u8> = [180.0, 110.0, 20.0]
        .map(|p: f64| (16.0 * a + p * (1.0 - a)).round() as u8)
        .into_iter()
        .cycle()
        .take(1920 * 1080 * 3)
        .collect();
    assert!(
        fire_core::veil::detect_pixels(
            &veiled,
            1920,
            1080,
            3,
            12,
            fire_core::veil::Options::default()
        )
        .unwrap()
        .0,
        "the colour detector does call this veiled"
    );
    let mut unveiled_inputs = 0;
    let _ = candidate(&veiled, 1920, 1080, &tex, |_, auto| {
        unveiled_inputs += auto.is_some() as usize;
        Ok(true)
    })
    .unwrap();
    assert_eq!(
        unveiled_inputs, 0,
        "no colour-unveiled copy reaches the model"
    );
}
