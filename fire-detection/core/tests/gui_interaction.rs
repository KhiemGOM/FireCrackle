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
fn shared_player_slots_can_establish_presence_without_claiming_exact_type() {
    let (w, h) = (176, 166);
    let mut image = vec![0; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let border = x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
            let edge = (7..169).contains(&x)
                && y >= 17
                && y < 155
                && ((x - 7) % 18 == 0 || (y - 17) % 18 == 0);
            let c = if border {
                240
            } else if edge {
                60
            } else {
                180
            };
            image[(y * w + x) * 4..(y * w + x) * 4 + 4].copy_from_slice(&[c, c, c, 255]);
        }
    }
    let template = PanelTemplate::from_rgba(
        "inventory.dispenser_screen".into(),
        "fixture".into(),
        "test".into(),
        w,
        h,
        false,
        &image,
    )
    .unwrap();
    let mut frame = vec![31; 400 * 400 * 3];
    for y in 0..h * 2 {
        for x in 0..w * 2 {
            let src = ((y / 2) * w + x / 2) * 4;
            let dst = ((34 + y) * 400 + 24 + x) * 3;
            frame[dst..dst + 3].copy_from_slice(&image[src..src + 3]);
        }
    }
    for y in 18..55 {
        for x in 62..113 {
            // Item-like sparse foreground, not an inferred neutral mask.
            if (x + y) % 3 != 0 {
                continue;
            }
            for dy in 0..2 {
                for dx in 0..2 {
                    let dst = ((34 + y * 2 + dy) * 400 + 24 + x * 2 + dx) * 3;
                    frame[dst..dst + 3].copy_from_slice(&[30, 100, 220]);
                }
            }
        }
    }
    let result = detect(&frame, 400, 400, &[template.clone()], opts()).unwrap();
    assert!(result.gui_detected);
    assert_eq!(result.reason, "known_panel_presence");
    assert!(result.matched.is_none());
    assert!(result.alternatives[0].presence_only);
    assert!(
        !detect(&vec![180; 400 * 400 * 3], 400, 400, &[template], opts())
            .unwrap()
            .gui_detected
    );
}

#[test]
fn subpixel_source_edges_survive_resampling_without_accepting_flat_or_wrong_layout() {
    let (template, image) = fixture("known_inventory");
    let (width, height) = (200, 140);
    let mut frame = vec![31; width * height * 3];
    // Area-downsample the 80x80 source into 60x60, independently of the
    // detector's source-neighbourhood model. No captured frame is used.
    for y in 0..60 {
        for x in 0..60 {
            let mut sum = [0.; 3];
            let mut area = 0.;
            let x0 = x as f64 / 0.75;
            let x1 = (x + 1) as f64 / 0.75;
            let y0 = y as f64 / 0.75;
            let y1 = (y + 1) as f64 / 0.75;
            for yy in y0.floor() as usize..y1.ceil() as usize {
                for xx in x0.floor() as usize..x1.ceil() as usize {
                    let weight = (x1.min((xx + 1) as f64) - x0.max(xx as f64))
                        * (y1.min((yy + 1) as f64) - y0.max(yy as f64));
                    area += weight;
                    for k in 0..3 {
                        sum[k] += weight * f64::from(image[(yy * 80 + xx) * 4 + k]);
                    }
                }
            }
            let dst = ((40 + y) * width + 70 + x) * 3;
            for k in 0..3 {
                frame[dst + k] = (sum[k] / area).round() as u8;
            }
        }
    }
    let options = Options {
        min_scale: 0.75,
        max_scale: 0.75,
        ..Options::default()
    };
    assert!(
        detect(&frame, width, height, &[template.clone()], options)
            .unwrap()
            .gui_detected
    );
    assert!(
        !detect(
            &vec![180; width * height * 3],
            width,
            height,
            &[template.clone()],
            options
        )
        .unwrap()
        .gui_detected
    );
    // Preserve the frame/border but erase interior layout evidence.
    for y in 45..95 {
        for x in 75..125 {
            let dst = (y * width + x) * 3;
            frame[dst..dst + 3].fill(180);
        }
    }
    assert!(
        !detect(&frame, width, height, &[template], options)
            .unwrap()
            .gui_detected
    );
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
fn integer_gui_origin_is_applied_before_fractional_capture_scale() {
    let (template, image) = fixture("known_inventory");
    let mut frame = vec![31; 400 * 240 * 3];
    let scale = 2.25;
    // Logical viewport ceil(400/2.25) x ceil(240/2.25) =178x107.
    // AbstractContainerScreen uses integer (viewport-panel)/2 first.
    let (left, top) = (110.25, 29.25);
    for y in 0..240 {
        for x in 0..400 {
            let xx = (x as f64 + 0.5 - left) / scale;
            let yy = (y as f64 + 0.5 - top) / scale;
            if (0.0..80.).contains(&xx) && (0.0..80.).contains(&yy) {
                let src = (yy.floor() as usize * 80 + xx.floor() as usize) * 4;
                let dst = (y * 400 + x) * 3;
                frame[dst..dst + 3].copy_from_slice(&image[src..src + 3]);
            }
        }
    }
    let result = detect(
        &frame,
        400,
        240,
        &[template],
        Options {
            min_scale: scale,
            max_scale: scale,
            ..Options::default()
        },
    )
    .unwrap();
    assert!(result.gui_detected);
    // Several subpixel poses can rasterize identically; do not claim their
    // underlying fractional position is identifiable from this fixture.
    let bounds = result.matched.unwrap().bounds;
    assert!((bounds.x - left).abs() < 1. && (bounds.y - top).abs() < 1.);
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

fn cover(frame: &mut [u8], mask: &mut [u8], x0: usize, y0: usize, x1: usize, y1: usize) {
    for y in y0..y1 {
        for x in x0..x1 {
            let p = y * 400 + x;
            mask[p] = 255;
            frame[p * 3..p * 3 + 3].copy_from_slice(&[17, 220, 3]);
        }
    }
}

#[test]
fn covered_half_is_neutral_in_both_score_and_spatial_quorum() {
    let (template, image) = fixture("inventory");
    let mut frame = render(&image);
    let mut mask = vec![0; 400 * 240];
    cover(&mut frame, &mut mask, 120, 40, 200, 200);
    assert!(
        !detect(&frame, 400, 240, std::slice::from_ref(&template), opts())
            .unwrap()
            .gui_detected
    );
    let result = detect_with_occlusion(&frame, 400, 240, &[template], opts(), &mask).unwrap();
    let hit = result.matched.unwrap();
    assert_eq!(hit.score, 1.);
    assert_eq!(hit.border_score, 1.);
    assert_eq!(hit.structure_score, 1.);
    assert!(hit.visible_probes[0] > 0 && hit.visible_probes[1] > 0);
}

#[test]
fn fully_covered_border_is_unavailable_not_required_or_negative() {
    let (template, image) = fixture("inventory");
    let mut frame = render(&image);
    let mut mask = vec![0; 400 * 240];
    cover(&mut frame, &mut mask, 120, 40, 280, 48);
    cover(&mut frame, &mut mask, 120, 192, 280, 200);
    cover(&mut frame, &mut mask, 120, 40, 128, 200);
    cover(&mut frame, &mut mask, 272, 40, 280, 200);
    let hit = detect_with_occlusion(&frame, 400, 240, &[template], opts(), &mask)
        .unwrap()
        .matched
        .unwrap();
    assert_eq!(hit.visible_probes[0], 0);
    assert_eq!(hit.structure_score, 1.);
    assert_eq!(hit.score, 1.);
}

#[test]
fn no_masked_pixels_preserves_original_result_and_unknown_errors_still_count() {
    let (template, image) = fixture("inventory");
    let frame = render(&image);
    let empty = vec![0; 400 * 240];
    let original = detect(&frame, 400, 240, std::slice::from_ref(&template), opts()).unwrap();
    let masked = detect_with_occlusion(
        &frame,
        400,
        240,
        std::slice::from_ref(&template),
        opts(),
        &empty,
    )
    .unwrap();
    assert_eq!(original.candidate_types, masked.candidate_types);
    assert_eq!(
        original.matched.as_ref().unwrap().bounds,
        masked.matched.as_ref().unwrap().bounds
    );
    assert_eq!(
        original.matched.unwrap().score,
        masked.matched.unwrap().score
    );
    let mut broken = frame;
    let mut mask = empty;
    cover(&mut broken, &mut mask, 120, 40, 200, 200);
    // A second corrupt region has no occlusion evidence, so its errors remain.
    for y in 40..200 {
        for x in 200..280 {
            let p = (y * 400 + x) * 3;
            broken[p..p + 3].fill(0);
        }
    }
    assert!(
        !detect_with_occlusion(&broken, 400, 240, &[template], opts(), &mask)
            .unwrap()
            .gui_detected
    );
}

#[test]
fn entirely_or_almost_hidden_gui_is_uncertain_and_bad_mask_dimensions_fail() {
    let (template, image) = fixture("inventory");
    let frame = render(&image);
    let mut mask = vec![1; 400 * 240];
    let all = detect_with_occlusion(
        &frame,
        400,
        240,
        std::slice::from_ref(&template),
        opts(),
        &mask,
    )
    .unwrap();
    assert!(!all.gui_detected);
    assert_eq!(all.reason, "insufficient_visible_gui_evidence");
    mask[41 * 400 + 123] = 0;
    assert!(
        !detect_with_occlusion(
            &frame,
            400,
            240,
            std::slice::from_ref(&template),
            opts(),
            &mask
        )
        .unwrap()
        .gui_detected
    );
    assert!(detect_with_occlusion(&frame, 400, 240, &[template], opts(), &[0; 3]).is_err());
}
