use fire_core::gui_interaction::{InteractionDetector, PanelTemplate};

fn fixture() -> (PanelTemplate, Vec<u8>) {
    let mut rgba = vec![0; 80 * 80 * 4];
    for y in 0..80 {
        for x in 0..80 {
            let edge = x < 3 || y < 3 || x >= 77 || y >= 77;
            let line = (15..65).contains(&x) && [24, 25, 40, 41, 56, 57].contains(&y);
            let c = if edge {
                240
            } else if line {
                60
            } else {
                180
            };
            rgba[(y * 80 + x) * 4..(y * 80 + x) * 4 + 4].copy_from_slice(&[c, c, c, 255]);
        }
    }
    let template = PanelTemplate::from_rgba(
        "inventory.container_screen".into(),
        "fixture".into(),
        "base".into(),
        80,
        80,
        false,
        &rgba,
    )
    .unwrap();
    let mut rgb = vec![31; 400 * 240 * 3];
    for y in 0..160 {
        for x in 0..160 {
            let s = (y / 2 * 80 + x / 2) * 4;
            let d = ((40 + y) * 400 + 120 + x) * 3;
            rgb[d..d + 3].copy_from_slice(&rgba[s..s + 3]);
        }
    }
    (template, rgb)
}

#[test]
fn workers_preserve_first_source_pose_and_flat_world_abstains() {
    let (template, rgb) = fixture();
    let serial = InteractionDetector::with_workers(vec![template.clone(); 4], 1).unwrap();
    let threaded = InteractionDetector::with_workers(vec![template; 4], 4).unwrap();
    let a = serial.detect(&rgb, 400, 240).unwrap();
    let b = threaded.detect(&rgb, 400, 240).unwrap();
    assert!(a.gui_detected && b.gui_detected);
    assert_eq!(a.alternatives[0].bounds, b.alternatives[0].bounds);
    assert_eq!(
        a.alternatives[0].visible_probes,
        b.alternatives[0].visible_probes
    );
    assert!(
        !serial
            .detect(&vec![180; rgb.len()], 400, 240)
            .unwrap()
            .gui_detected
    );
    assert!(serial.detect(&rgb[..50], 400, 240).is_err());
}

#[test]
fn malformed_or_empty_bundles_fail_closed() {
    for bytes in [
        &[][..],
        &[1][..],
        &[255, 255, 255, 255][..],
        &[1, 0, 0, 0, 0][..],
    ] {
        assert!(InteractionDetector::from_bundle(bytes).is_err());
    }
}

#[test]
fn compressed_gui_levels_remain_detectable_without_a_perfect_white_border() {
    let (template, mut rgb) = fixture();
    // Source colour levels shifted by28, beyond the old24-channel budget.
    // Preserve the panel's layout and contrast, as in compressed real footage.
    for value in &mut rgb {
        *value = value.saturating_sub(28);
    }
    let detector = InteractionDetector::with_workers(vec![template], 1).unwrap();
    assert!(detector.detect(&rgb, 400, 240).unwrap().gui_detected);
}

#[test]
fn relaxed_colour_matching_still_requires_panel_structure() {
    let (template, rgb) = fixture();
    let detector = InteractionDetector::with_workers(vec![template], 1).unwrap();
    for grey in [0, 31, 60, 139, 180, 212, 230, 240, 255] {
        assert!(
            !detector
                .detect(&vec![grey; rgb.len()], 400, 240)
                .unwrap()
                .gui_detected,
            "flat grey{grey} is not a panel"
        );
    }
}

#[test]
fn a_partial_border_is_not_enough_even_with_matching_interior() {
    let (template, mut rgb) = fixture();
    // A world patch can resemble the inner greys without completing the panel.
    // This is an actual mismatch, not a known occlusion to mask out.
    for y in 40..48 {
        for x in 140..260 {
            let at = (y * 400 + x) * 3;
            rgb[at..at + 3].fill(31);
        }
    }
    let detector = InteractionDetector::with_workers(vec![template], 1).unwrap();
    assert!(!detector.detect(&rgb, 400, 240).unwrap().gui_detected);
}
