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
    assert!(result.gui_detected);
    assert_eq!(result.candidate_types, vec!["furnace", "smoker"]);
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
    assert!(result.gui_detected);
    assert_eq!(result.candidate_types, vec!["inventory"]);
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

#[test]
fn fixed_controls_disambiguate_shared_panel_and_missing_controls_abstain() {
    let (mut edit, mut image) = fixture("inventory.book_edit_screen");
    let (mut view, _) = fixture("inventory.book_view_screen");
    let mut edit_pixels = Vec::new();
    let mut view_pixels = Vec::new();
    for x in 15..47 {
        let color = if x % 2 == 0 { 255 } else { 0 };
        image[(10 * 80 + x) * 4..(10 * 80 + x) * 4 + 3].fill(color);
        edit_pixels.push((x as f64 + 0.5, 10.5, [color; 3]));
        view_pixels.push((x as f64 + 0.5, 10.5, [255 - color; 3]));
    }
    edit.require_identity(&edit_pixels).unwrap();
    view.require_identity(&view_pixels).unwrap();
    let result = detect(
        &render(&image),
        400,
        240,
        &[edit.clone(), view.clone()],
        opts(),
    )
    .unwrap();
    assert_eq!(
        result.matched.unwrap().screen_type,
        "inventory.book_edit_screen"
    );
    // Identical panel alone is insufficient evidence for either control layout.
    let (_, blank) = fixture("anything");
    assert!(detect(&render(&blank), 400, 240, &[edit, view], opts())
        .unwrap()
        .matched
        .is_none());
}

#[test]
fn top_anchored_source_geometry_does_not_follow_screen_vertical_centre() {
    let (mut template, image) = fixture("known_inventory");
    template.top_y = Some(4.);
    template.offset_x = -12.;
    let mut frame = vec![31; 400 * 320 * 3];
    for y in 0..160 {
        for x in 0..160 {
            let src = ((y / 2) * 80 + x / 2) * 4;
            let dst = ((8 + y) * 400 + 96 + x) * 3;
            frame[dst..dst + 3].copy_from_slice(&image[src..src + 3]);
        }
    }
    let hit = detect(&frame, 400, 320, &[template], opts())
        .unwrap()
        .matched
        .unwrap();
    assert_eq!((hit.bounds.x, hit.bounds.y), (96., 8.));
}

#[test]
fn identity_anchors_reject_invalid_coordinates_and_underspecified_evidence() {
    let (mut template, _) = fixture("inventory");
    assert!(template
        .require_identity(&[(1., 1., [255; 3]); 15])
        .is_err());
    assert!(template
        .require_identity(&[(f64::NAN, 1., [255; 3]); 16])
        .is_err());
    assert!(template
        .require_identity(&[(1., 2048., [255; 3]); 16])
        .is_err());
}

#[test]
fn container_title_changes_do_not_supply_type_evidence() {
    let (first, mut image) = fixture("furnace");
    let (second, _) = fixture("smoker");
    // Freely rename the container in the title band. Both source layouts
    // remain possible: text must not manufacture an exact semantic type.
    for x in 8..70 {
        for y in 6..14 {
            let c = if (x + y) % 3 == 0 { 64 } else { 180 };
            image[(y * 80 + x) * 4..(y * 80 + x) * 4 + 3].fill(c);
        }
    }
    let result = detect(&render(&image), 400, 240, &[first, second], opts()).unwrap();
    assert!(result.matched.is_none());
    assert!(result.gui_detected);
    assert_eq!(result.reason, "ambiguous_known_types");
}

#[test]
fn type_ambiguity_keeps_gui_presence_and_neutral_mask() {
    let (first, image) = fixture("furnace");
    let (second, _) = fixture("smoker");
    let result = detect(&render(&image), 400, 240, &[first, second], opts()).unwrap();
    assert!(result.gui_detected);
    assert!(result.matched.is_none());
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
    assert_eq!(result.merge_neutral_panel(&mut mask).unwrap(), 160 * 160);
    assert!(!mask.reliable);
    let (template, _) = fixture("furnace");
    let blank = detect(&vec![31; 400 * 240 * 3], 400, 240, &[template], opts()).unwrap();
    assert!(!blank.gui_detected);
    assert!(blank.candidate_types.is_empty());
    assert_eq!(blank.merge_neutral_panel(&mut mask).unwrap(), 0);
}

#[test]
fn source_pack_places_footer_and_header_independently_of_viewport_height() {
    let (_, image) = fixture("known_inventory");
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("gui-pack-{}-{unique}.guit", std::process::id()));
    let mut header =
        String::from("GUIT2\noptions.test_screen\nfixture\nfixed_controls\n80 80 0\n0 -84 16 1\n");
    for x in 12..28 {
        header.push_str(&format!("{}.5 94.5 255 255 255 -1\n", x));
    }
    let bytes = [header.as_bytes(), image.as_slice()].concat();
    std::fs::write(&path, &bytes).unwrap();
    let loaded = PanelTemplate::load(&path);
    std::fs::remove_file(&path).unwrap();
    let template = loaded.unwrap();
    for height in [320, 400] {
        let mut frame = vec![31; 400 * height * 3];
        for y in 0..160 {
            for x in 0..160 {
                let src = ((y / 2) * 80 + x / 2) * 4;
                let dst = ((height - 168 + y) * 400 + 120 + x) * 3;
                frame[dst..dst + 3].copy_from_slice(&image[src..src + 3]);
            }
        }
        for x in 12..28 {
            let dst = (21 * 400 + 120 + x * 2 + 1) * 3;
            frame[dst..dst + 3].fill(255);
        }
        let result = detect(&frame, 400, height, std::slice::from_ref(&template), opts()).unwrap();
        assert_eq!(result.matched.unwrap().bounds.y, (height - 168) as f64);
        // A footer without its screen-specific heading is not a typed GUI.
        for x in 12..28 {
            let dst = (21 * 400 + 120 + x * 2 + 1) * 3;
            frame[dst..dst + 3].fill(31);
        }
        assert!(
            detect(&frame, 400, height, std::slice::from_ref(&template), opts())
                .unwrap()
                .matched
                .is_none()
        );
    }
    // Corrupt viewport metadata must not reach floating-point sampling.
    std::fs::write(
        &path,
        [
            header.replace("0 -84 16 1", "0 -84 16 NaN").as_bytes(),
            image.as_slice(),
        ]
        .concat(),
    )
    .unwrap();
    let invalid = PanelTemplate::load(&path);
    std::fs::remove_file(&path).unwrap();
    assert!(invalid.is_err());
}
