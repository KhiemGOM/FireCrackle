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

/// A 1.21 item tooltip (purple rim, near-black fill) drawn at x0..x1, y0..y1.
fn paint_tooltip(rgb: &mut [u8], x0: usize, x1: usize, y0: usize, y1: usize) {
    for y in y0..y1 {
        for x in x0..x1 {
            let rim = !(x0 + 2..x1 - 2).contains(&x) || !(y0 + 2..y1 - 2).contains(&y);
            let colour = if rim { [80, 16, 128] } else { [16, 0, 16] };
            rgb[(y * 400 + x) * 3..(y * 400 + x) * 3 + 3].copy_from_slice(&colour);
        }
    }
}

fn empty_mask() -> fire_core::gui_mask::GuiMask {
    fire_core::gui_mask::GuiMask {
        width: 400,
        height: 240,
        piece: vec![0; 400 * 240],
        class: vec![0; 400 * 240],
        fit: None,
        reliable: false,
        hits: vec![],
        notes: vec![],
    }
}

#[test]
fn an_item_tooltip_over_an_open_panel_is_part_of_the_screen_mask_even_outside_the_panel() {
    let (template, mut rgb) = fixture();
    // the panel is at x 120..280, y 40..200; the tooltip hangs off its lower right
    paint_tooltip(&mut rgb, 250, 340, 150, 220);
    let detector = InteractionDetector::with_workers(vec![template], 1).unwrap();
    let result = detector.detect(&rgb, 400, 240).unwrap();
    assert!(
        result.gui_detected,
        "the tooltip's pixels are neutral, not a mismatch"
    );
    assert_eq!(result.tooltips.len(), 1);
    let mut mask = empty_mask();
    result.merge_neutral_panel(&mut mask).unwrap();
    let tooltip = fire_core::gui_mask::PieceId::ItemTooltip as u8;
    let at = |x: usize, y: usize| (mask.piece[y * 400 + x], mask.class[y * 400 + x]);
    assert_eq!(at(320, 210), (tooltip, 3), "outside the panel");
    assert_eq!(
        at(150, 60).0,
        fire_core::gui_mask::PieceId::InventoryPanel as u8
    );
    assert_eq!(at(10, 10), (0, 0), "the world stays world");
    assert!(mask
        .hits
        .iter()
        .any(|h| h.piece == fire_core::gui_mask::PieceId::ItemTooltip));
}

#[test]
fn a_tooltip_shaped_box_without_an_open_panel_adds_nothing() {
    let (template, _) = fixture();
    let mut rgb = vec![180; 400 * 240 * 3];
    paint_tooltip(&mut rgb, 250, 340, 150, 220);
    let detector = InteractionDetector::with_workers(vec![template], 1).unwrap();
    let result = detector.detect(&rgb, 400, 240).unwrap();
    assert!(!result.gui_detected);
    let mut mask = empty_mask();
    assert_eq!(result.merge_neutral_panel(&mut mask).unwrap(), 0);
    assert!(mask.class.iter().all(|&c| c == 0));
}

#[test]
fn one_frame_has_one_gui_scale_so_a_panel_at_another_scale_than_the_hud_is_not_a_screen() {
    // the fixture panel is drawn at 2 video px per GUI px
    let (template, rgb) = fixture();
    let detector = InteractionDetector::with_workers(vec![template], 1).unwrap();
    assert!(
        detector
            .detect_with_scale(&rgb, 400, 240, Some(2.0))
            .unwrap()
            .gui_detected
    );
    assert!(
        detector
            .detect_with_scale(&rgb, 400, 240, None)
            .unwrap()
            .gui_detected,
        "no HUD: no constraint"
    );
    for hud in [1.0, 3.0, 6.0] {
        assert!(
            !detector
                .detect_with_scale(&rgb, 400, 240, Some(hud))
                .unwrap()
                .gui_detected,
            "HUD at {hud}"
        );
    }
}

#[test]
fn the_hud_scale_is_only_measured_when_a_panel_was_found_and_a_disagreeing_panel_is_rejected() {
    let (template, rgb) = fixture();
    let detector = InteractionDetector::with_workers(vec![template], 1).unwrap();
    let asked = std::cell::Cell::new(0);
    let hud = |scale: Option<f64>| {
        let asked = &asked;
        move || {
            asked.set(asked.get() + 1);
            Ok(scale)
        }
    };
    // the panel is at 2 video px per GUI px
    assert!(
        detector
            .detect_at_hud_scale(&rgb, 400, 240, hud(Some(2.0)))
            .unwrap()
            .gui_detected
    );
    assert!(
        detector
            .detect_at_hud_scale(&rgb, 400, 240, hud(None))
            .unwrap()
            .gui_detected,
        "no reliable HUD"
    );
    assert!(
        !detector
            .detect_at_hud_scale(&rgb, 400, 240, hud(Some(6.0)))
            .unwrap()
            .gui_detected,
        "the HUD majority wins"
    );
    assert_eq!(asked.get(), 3);
    // no panel: the HUD is never measured
    let world = vec![180; rgb.len()];
    assert!(
        !detector
            .detect_at_hud_scale(&world, 400, 240, hud(Some(2.0)))
            .unwrap()
            .gui_detected
    );
    assert_eq!(asked.get(), 3);
    // a failing HUD measurement is an error, not a silent pass
    assert!(detector
        .detect_at_hud_scale(&rgb, 400, 240, || Err("bad frame".to_string()))
        .is_err());
    // same decision as always restricting to the HUD scale
    for scale in [Some(2.0), Some(6.0), None] {
        assert_eq!(
            detector
                .detect_at_hud_scale(&rgb, 400, 240, hud(scale))
                .unwrap()
                .gui_detected,
            detector
                .detect_with_scale(&rgb, 400, 240, scale)
                .unwrap()
                .gui_detected
        );
    }
}

#[test]
fn a_detection_on_the_native_frame_scaled_to_the_display_size_masks_the_same_screen_there() {
    // the panel is at x 120..280, y 40..200 of the 400x240 "native" frame; the display picture is half that size
    let (template, mut rgb) = fixture();
    paint_tooltip(&mut rgb, 250, 340, 150, 220);
    let detector = InteractionDetector::with_workers(vec![template], 1).unwrap();
    let native = detector.detect(&rgb, 400, 240).unwrap();
    assert!(native.gui_detected);
    let display = native.scaled(200, 120);
    assert_eq!((display.image_width, display.image_height), (200, 120));
    let (n, d) = (&native.alternatives[0], &display.alternatives[0]);
    assert_eq!(
        (d.bounds.x, d.bounds.y, d.bounds.width, d.bounds.height),
        (
            n.bounds.x / 2.,
            n.bounds.y / 2.,
            n.bounds.width / 2.,
            n.bounds.height / 2.
        )
    );
    assert_eq!((d.scale_x, d.scale_y), (n.scale_x / 2., n.scale_y / 2.));
    assert_eq!(display.tooltips[0].width, native.tooltips[0].width / 2.);
    let mut mask = fire_core::gui_mask::GuiMask {
        width: 200,
        height: 120,
        piece: vec![0; 200 * 120],
        class: vec![0; 200 * 120],
        fit: None,
        reliable: false,
        hits: vec![],
        notes: vec![],
    };
    display.merge_neutral_panel(&mut mask).unwrap();
    assert_eq!(
        mask.piece[60 * 200 + 100],
        fire_core::gui_mask::PieceId::InventoryPanel as u8
    );
    assert_eq!(
        mask.piece[105 * 200 + 160],
        fire_core::gui_mask::PieceId::ItemTooltip as u8,
        "the tooltip, past the panel"
    );
    assert_eq!(mask.class[5 * 200 + 5], 0);
}

#[test]
fn the_shared_mask_takes_screens_found_on_another_picture_and_rejects_the_wrong_size() {
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/assets/gui");
    let mask_detector = fire_core::gui_mask::GuiDetector::new(
        fire_core::gui_mask::GuiTextures::load(&dir).unwrap(),
        Default::default(),
    )
    .unwrap();
    let (template, rgb) = fixture();
    let screens = InteractionDetector::with_workers(vec![template], 1)
        .unwrap()
        .detect(&rgb, 400, 240)
        .unwrap();
    // the display picture (here the same frame scaled down by half) gets its HUD mask plus the native screens
    let half: Vec<u8> = (0..120)
        .flat_map(|y| {
            (0..200).flat_map(move |x| {
                let i = ((2 * y) * 400 + 2 * x) * 3;
                [i, i + 1, i + 2]
            })
        })
        .map(|i| rgb[i])
        .collect();
    let mask = mask_detector
        .detect_with_screens(&half, 200, 120, &screens.scaled(200, 120))
        .unwrap();
    assert_eq!(
        mask.piece[60 * 200 + 100],
        fire_core::gui_mask::PieceId::InventoryPanel as u8
    );
    assert!(
        mask_detector
            .detect_with_screens(&half, 200, 120, &screens)
            .is_err(),
        "a 400x240 detection on a 200x120 picture"
    );
}

#[test]
fn the_engines_no_screen_answer_masks_nothing_and_scales_like_any_other() {
    let none = fire_core::gui_interaction::Detection::none(2560, 1440);
    assert!(!none.gui_detected && none.alternatives.is_empty() && none.tooltips.is_empty());
    let display = none.scaled(1280, 720);
    assert_eq!((display.image_width, display.image_height), (1280, 720));
    let mut mask = fire_core::gui_mask::GuiMask {
        width: 1280,
        height: 720,
        piece: vec![0; 1280 * 720],
        class: vec![0; 1280 * 720],
        fit: None,
        reliable: false,
        hits: vec![],
        notes: vec![],
    };
    assert_eq!(display.merge_neutral_panel(&mut mask).unwrap(), 0);
    assert!(mask.class.iter().all(|&c| c == 0));
}
