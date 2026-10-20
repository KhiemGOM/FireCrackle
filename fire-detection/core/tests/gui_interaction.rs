use fire_core::gui_interaction::*;

fn fixture(kind: &str) -> (PanelTemplate, Vec<u8>) {
    let (w, h) = (80, 80);
    let mut image = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let border = x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
            let line = (15..65).contains(&x) && ([24, 25, 40, 41, 56, 57].contains(&y));
            let color = if border {
                240
            } else if line {
                60
            } else {
                180
            };
            image[(y * w + x) * 4..(y * w + x) * 4 + 4]
                .copy_from_slice(&[color, color, color, 255]);
        }
    }
    (
        PanelTemplate::from_rgba(
            kind.into(),
            "fixture".into(),
            "test".into(),
            w,
            h,
            false,
            &image,
        )
        .unwrap(),
        image,
    )
}
fn render(image: &[u8]) -> Vec<u8> {
    let mut frame = vec![31; 400 * 240 * 3];
    for y in 0..160 {
        for x in 0..160 {
            let src = ((y / 2) * 80 + x / 2) * 4;
            let dst = ((40 + y) * 400 + 120 + x) * 3;
            frame[dst..dst + 3].copy_from_slice(&image[src..src + 3]);
        }
    }
    frame
}
fn opts() -> Options {
    Options {
        min_scale: 2.,
        max_scale: 2.,
        ..Options::default()
    }
}

#[test]
fn finds_panel_without_any_hotbar_and_checks_whole_layout() {
    let (template, image) = fixture("known_inventory");
    let detection = detect(&render(&image), 400, 240, &[template], opts()).unwrap();
    let hit = detection.matched.unwrap();
    assert_eq!(hit.screen_type, "known_inventory");
    assert_eq!(
        hit.bounds,
        Rect {
            x: 120.,
            y: 40.,
            width: 160.,
            height: 160.
        }
    );
    assert_eq!(hit.score, 1.);
}

#[test]
fn same_shape_with_different_known_types_abstains_instead_of_guessing() {
    let (first, image) = fixture("furnace");
    let (second, _) = fixture("smoker");
    let result = detect(&render(&image), 400, 240, &[first, second], opts()).unwrap();
    assert!(result.matched.is_none());
    assert_eq!(result.reason, "ambiguous_known_types");
    assert_eq!(result.alternatives.len(), 2);
}

#[test]
fn old_and_new_source_variants_of_same_type_are_not_semantic_ambiguity() {
    let (first, image) = fixture("inventory");
    let (mut second, _) = fixture("inventory");
    second.version = "new_source_version".into();
    let result = detect(&render(&image), 400, 240, &[first, second], opts()).unwrap();
    assert_eq!(result.matched.unwrap().screen_type, "inventory");
    assert_eq!(result.reason, "known_panel_match");
}

#[test]
fn flat_grey_is_not_screen_evidence_and_bad_input_is_rejected() {
    let (template, _) = fixture("inventory");
    assert!(
        detect(&vec![180; 400 * 240 * 3], 400, 240, &[template], opts())
            .unwrap()
            .matched
            .is_none()
    );
    assert!(detect(&[0; 3], 400, 240, &[], opts()).is_err());
    assert!(detect(
        &vec![0; 400 * 240 * 3],
        400,
        240,
        &[],
        Options {
            scale_step: 0.,
            ..opts()
        }
    )
    .is_err());
}

#[test]
fn independent_panel_merge_preserves_existing_hud_classes_and_reliability() {
    let (template, image) = fixture("inventory");
    let result = detect(&render(&image), 400, 240, &[template], opts()).unwrap();
    let mut mask = fire_core::gui_mask::GuiMask {
        width: 400,
        height: 240,
        piece: vec![0; 400 * 240],
        class: vec![0; 400 * 240],
        fit: None,
        reliable: false,
        hits: vec![],
        notes: vec![],
    };
    let pixel = 45 * 400 + 125;
    mask.class[pixel] = 1;
    mask.piece[pixel] = 1;
    assert_eq!(
        result.merge_neutral_panel(&mut mask).unwrap(),
        160 * 160 - 1
    );
    assert_eq!(mask.class[pixel], 1);
    assert_eq!(mask.class[50 * 400 + 130], 3);
    assert!(!mask.reliable);
    assert!(mask.fit.is_none());
    mask.width = 200;
    mask.height = 480;
    assert!(result.merge_neutral_panel(&mut mask).is_err());
}
