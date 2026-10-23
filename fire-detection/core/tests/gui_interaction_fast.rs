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

/// A fixed-controls source pack: an 80x80 button-like panel (1-texel bevel lines, so a one-texel
/// misplacement fails its structure) with white glyph anchors, as `prepare_assets.py` writes them.
fn controls_pack(layout: &str, identity: &[(f64, f64, f64)]) -> (PanelTemplate, Vec<u8>) {
    let mut rgba = vec![0; 80 * 80 * 4];
    for y in 0..80 {
        for x in 0..80 {
            let edge = x < 3 || y < 3 || x >= 77 || y >= 77;
            let line = (15..65).contains(&x) && [24, 32, 40, 48, 56, 64].contains(&y);
            let c = if edge {
                200
            } else if line {
                40
            } else {
                110
            };
            rgba[(y * 80 + x) * 4..(y * 80 + x) * 4 + 4].copy_from_slice(&[c, c, c, 255]);
        }
    }
    let mut header = format!(
        "GUIT2\noptions.test_screen\nfixture\nfixed_controls_test\n80 80 0\n{}\n",
        layout.replace("{n}", &identity.len().to_string())
    );
    for (x, y, viewport) in identity {
        header.push_str(&format!("{x} {y} 255 255 255 {viewport}\n"));
    }
    let bytes = [header.as_bytes(), rgba.as_slice()].concat();
    (PanelTemplate::from_bytes(&bytes).unwrap(), rgba)
}

/// Area-average a layer of texels (RGBA, alpha 0 keeps the frame) into the frame at a fractional
/// origin and scale, like a capture resampled from the game window.
#[allow(clippy::too_many_arguments)]
fn draw(frame: &mut [u8], fw: usize, layer: &[u8], lw: usize, lh: usize, x0: f64, y0: f64, s: f64) {
    let fh = frame.len() / 3 / fw;
    let (px0, py0) = (x0.floor().max(0.) as usize, y0.floor().max(0.) as usize);
    let px1 = ((x0 + lw as f64 * s).ceil() as usize).min(fw);
    let py1 = ((y0 + lh as f64 * s).ceil() as usize).min(fh);
    for py in py0..py1 {
        for px in px0..px1 {
            let at = (py * fw + px) * 3;
            let mut sum = [0.; 3];
            let mut covered = 0.;
            // texels overlapping this pixel, weighted by overlap area
            let tx0 = ((px as f64 - x0) / s).floor().max(0.) as usize;
            let ty0 = ((py as f64 - y0) / s).floor().max(0.) as usize;
            for ty in ty0..lh.min(ty0 + 4) {
                for tx in tx0..lw.min(tx0 + 4) {
                    let ox = (x0 + (tx + 1) as f64 * s).min(px as f64 + 1.)
                        - (x0 + tx as f64 * s).max(px as f64);
                    let oy = (y0 + (ty + 1) as f64 * s).min(py as f64 + 1.)
                        - (y0 + ty as f64 * s).max(py as f64);
                    let t = (ty * lw + tx) * 4;
                    if ox <= 0. || oy <= 0. || layer[t + 3] == 0 {
                        continue;
                    }
                    for k in 0..3 {
                        sum[k] += layer[t + k] as f64 * ox * oy;
                    }
                    covered += ox * oy;
                }
            }
            for k in 0..3 {
                let value = sum[k] + frame[at + k] as f64 * (1. - covered).max(0.);
                frame[at + k] = value.round().clamp(0., 255.) as u8;
            }
        }
    }
}

/// One row of glyph texels (x 20..44) at `row` of a transparent `w` x `h` layer; optionally with
/// Minecraft's text shadow (one texel down and right, the colour / 4).
fn glyph_row(w: usize, h: usize, row: usize, glyph: u8, shadow: Option<u8>) -> Vec<u8> {
    let mut layer = vec![0; w * h * 4];
    for x in 20..44 {
        if let Some(s) = shadow {
            let at = ((row + 1) * w + x + 1) * 4;
            layer[at..at + 4].copy_from_slice(&[s, s, s, 255]);
        }
    }
    for x in 20..44 {
        let at = (row * w + x) * 4;
        layer[at..at + 4].copy_from_slice(&[glyph, glyph, glyph, 255]);
    }
    layer
}

/// A heading anchored to the viewport (pause "Game Menu", options titles) is drawn at a fixed logical y,
/// independent of the rounding that places the button grid. Observed at 2.25 video px per GUI px: the grid
/// matched only with its half-texel origin candidate and the heading was then sampled one pixel too high.
#[test]
fn a_viewport_anchored_heading_does_not_inherit_the_panel_origin_rounding() {
    let s = 2.25;
    let (w, h) = (400usize, 300usize);
    // Footer 100 GUI px above the bottom (viewport 1); heading row 108 relative to it, viewport -1.
    let identity: Vec<_> = (20..44).map(|x| (x as f64 + 0.5, 108.5, -1.)).collect();
    let (template, rgba) = controls_pack("0 -100 {n} 1", &identity);
    let detector = InteractionDetector::with_workers(vec![template], 1).unwrap();
    let nominal_y = h as f64 - 100. * s;
    let x = (w as f64 - 80. * s) / 2.;
    let frame = |heading: bool, panel_jitter: f64| {
        let mut rgb = vec![31; w * h * 3];
        draw(
            &mut rgb,
            w,
            &rgba,
            80,
            80,
            x,
            nominal_y + panel_jitter * s,
            s,
        );
        if heading {
            // at its own fixed place, a quarter pixel later as the capture rounds it
            let layer = glyph_row(80, 1, 0, 255, None);
            draw(
                &mut rgb,
                w,
                &layer,
                80,
                1,
                x,
                nominal_y + 108. * s - h as f64 + 0.25,
                s,
            );
        }
        rgb
    };
    // basic: grid at its nominal place, heading where the game draws it
    assert!(
        detector
            .detect(&frame(true, 0.), w, h)
            .unwrap()
            .gui_detected
    );
    // the grid rounded half a texel up, the heading unchanged: still the same screen
    assert!(
        detector
            .detect(&frame(true, -0.5), w, h)
            .unwrap()
            .gui_detected,
        "the heading must not move with the grid's origin rounding"
    );
    // without its heading the footer is not this screen, whichever rounding the grid has
    for jitter in [0., -0.5, 0.5] {
        assert!(
            !detector
                .detect(&frame(false, jitter), w, h)
                .unwrap()
                .gui_detected
        );
    }
}

/// Below one video pixel per GUI pixel (GUI scale 1 of a 1440p window in 1080p footage) a one-texel glyph is
/// resampled together with its shadow, far from white. The fixed-control text must still identify the screen,
/// while a plain button without its text, and blurred text at full size, still do not.
#[test]
fn small_scale_fixed_control_text_blends_with_its_shadow_but_plain_buttons_stay_rejected() {
    let (w, h) = (400usize, 300usize);
    let identity: Vec<_> = (20..44).map(|x| (x as f64 + 0.5, 10.5, 0.)).collect();
    let (template, rgba) = controls_pack("0 -1 {n} 0", &identity);
    let detector = InteractionDetector::with_workers(vec![template], 1).unwrap();
    let frame = |s: f64, text: Option<(u8, Option<u8>)>| {
        let mut rgb = vec![31; w * h * 3];
        // centred like the game: an integer origin in the logical viewport
        let logical = |v: usize| (v as f64 / s).ceil();
        let x = ((logical(w) - 80.) / 2.).floor() * s;
        let y = ((logical(h) - 80.) / 2.).floor() * s;
        let mut layer = rgba.clone();
        if let Some((glyph, shadow)) = text {
            let glyphs = glyph_row(80, 80, 10, glyph, shadow);
            for (t, g) in layer.chunks_mut(4).zip(glyphs.chunks(4)) {
                if g[3] != 0 {
                    t.copy_from_slice(g);
                }
            }
        }
        draw(&mut rgb, w, &layer, 80, 80, x, y, s);
        rgb
    };
    let found = |s, text| detector.detect(&frame(s, text), w, h).unwrap().gui_detected;
    // basics: crisp text at full size and above is found; no text is not
    assert!(found(1.0, Some((255, Some(63)))));
    assert!(found(2.0, Some((255, Some(63)))));
    assert!(!found(1.0, None));
    assert!(!found(2.0, None));
    // small scale: the text resampled with its shadow is the screen
    assert!(
        found(0.75, Some((255, Some(63)))),
        "GUI 0.75 text with shadow"
    );
    // small scale: a plain button (no text) or a dark smudge where the text should be is not
    assert!(!found(0.75, None));
    assert!(!found(0.75, Some((90, None))));
    // at full size, a text-coloured blur is still not the fixed white text
    assert!(!found(1.0, Some((175, None))));
}

/// The installed bundle's two-button footers (language select: Font Settings... + Done; resource packs:
/// Open Pack Folder + Done), drawn from their own source pack at GUI scale 3 where the game puts them,
/// are found as their screens; the same buttons without their fixed labels are not.
#[test]
fn installed_two_button_footers_identify_language_and_pack_screens() {
    let bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data/assets/gui/interaction.bundle"),
    )
    .unwrap();
    let detector = InteractionDetector::from_bundle(&bytes).unwrap().serial();
    let mut records = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let n = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
        records.push(&bytes[cursor + 4..cursor + 4 + n]);
        cursor += 4 + n;
    }
    for kind in [
        "options.language_select_screen",
        "packs.pack_selection_screen",
    ] {
        let record = records
            .iter()
            .find(|r| {
                let text = String::from_utf8_lossy(&r[..r.len().min(200)]).to_string();
                let lines: Vec<_> = text.lines().collect();
                lines.get(1) == Some(&kind) && lines.get(3) == Some(&"fixed_controls_en_us_button")
            })
            .unwrap_or_else(|| panic!("{kind} is in the installed source bank"));
        // GUIT2 header: magic, kind, version, variant, "w h shift", "ox top n viewport", n anchors, then RGBA
        let mut lines: Vec<String> = Vec::new();
        let mut at = 0;
        while lines.len() < 6
            || lines.len()
                < 6 + lines[5]
                    .split(' ')
                    .nth(2)
                    .unwrap()
                    .parse::<usize>()
                    .unwrap()
        {
            let end = at + record[at..].iter().position(|&b| b == b'\n').unwrap();
            lines.push(String::from_utf8(record[at..end].to_vec()).unwrap());
            at = end + 1;
        }
        let size: Vec<usize> = lines[4].split(' ').map(|v| v.parse().unwrap()).collect();
        let (pw, ph) = (size[0], size[1]);
        // the language footer's buttons sit above its translation warning line
        let top = if kind.starts_with("options.language") {
            28
        } else {
            26
        };
        assert_eq!(
            (pw, lines[5].split(' ').collect::<Vec<_>>()[..2].join(" ")),
            (308, format!("0 -{top}"))
        );
        let rgba = &record[at..at + pw * ph * 4];
        let (w, h, s) = (1920usize, 1080usize, 3usize);
        let (x0, y0) = ((w / s - pw) / 2 * s, (h / s - top) * s);
        let frame = |labels: bool| {
            let mut rgb = vec![31; w * h * 3];
            for ty in 0..ph {
                for tx in 0..pw {
                    let t = (ty * pw + tx) * 4;
                    if rgba[t + 3] == 0 {
                        continue;
                    }
                    for dy in 0..s {
                        for dx in 0..s {
                            let p = ((y0 + ty * s + dy) * w + x0 + tx * s + dx) * 3;
                            if p + 3 <= rgb.len() {
                                rgb[p..p + 3].copy_from_slice(&rgba[t..t + 3]);
                            }
                        }
                    }
                }
            }
            // the button face under the labels (cleared in the source pack): plain button grey
            for ty in 4..16 {
                for tx in (8..pw - 8).filter(|x| !(142..166).contains(x)) {
                    for dy in 0..s {
                        for dx in 0..s {
                            let p = ((y0 + ty * s + dy) * w + x0 + tx * s + dx) * 3;
                            rgb[p..p + 3].fill(111);
                        }
                    }
                }
            }
            if labels {
                for line in &lines[6..] {
                    let v: Vec<f64> = line.split(' ').map(|v| v.parse().unwrap()).collect();
                    let (tx, ty) = (v[0].floor() as usize, v[1].floor() as usize);
                    for dy in 0..s {
                        for dx in 0..s {
                            let p = ((y0 + ty * s + dy) * w + x0 + tx * s + dx) * 3;
                            rgb[p..p + 3].fill(255);
                        }
                    }
                }
            }
            rgb
        };
        let hit = detector.detect(&frame(true), w, h).unwrap();
        assert_eq!(
            hit.alternatives.first().map(|p| p.screen_type.as_str()),
            Some(kind)
        );
        let blank = detector.detect(&frame(false), w, h).unwrap();
        assert!(
            blank
                .alternatives
                .first()
                .is_none_or(|p| p.screen_type != kind),
            "{kind} without its labels"
        );
    }
}

/// A fixed-controls source pack matches one button patch, but the open screen is the whole control grid and its
/// heading (pause: five button rows below "Back to Game", "Game Menu" above). The reported region, which the
/// screen mask fills, spans the declared screen extent and the identity anchors; the decision is unchanged.
#[test]
fn a_fixed_controls_match_reports_the_whole_screen_extent_and_its_heading() {
    let s = 2.25;
    let (w, h) = (400usize, 300usize);
    let identity: Vec<_> = (20..44).map(|x| (x as f64 + 0.5, 108.5, -1.)).collect();
    let nominal_y = h as f64 - 100. * s;
    let x = (w as f64 - 80. * s) / 2.;
    let mut rgb = vec![31; w * h * 3];
    let (_, rgba) = controls_pack("0 -100 {n} 1", &identity);
    draw(&mut rgb, w, &rgba, 80, 80, x, nominal_y, s);
    let layer = glyph_row(80, 1, 0, 255, None);
    let heading_y = nominal_y + 108. * s - h as f64;
    draw(&mut rgb, w, &layer, 80, 1, x, heading_y + 0.25, s);
    let found = |layout: &str| {
        let (template, _) = controls_pack(layout, &identity);
        let hit = InteractionDetector::with_workers(vec![template], 1)
            .unwrap()
            .detect(&rgb, w, h)
            .unwrap();
        assert!(hit.gui_detected, "{layout}");
        hit.alternatives[0].bounds
    };
    // basic: without a declared extent the region is the patch and its heading
    let plain = found("0 -100 {n} 1");
    assert!((plain.x - x).abs() < 1. && (plain.width - 80. * s).abs() < 1.);
    assert!(plain.y <= heading_y + 1. && plain.y + plain.height >= nominal_y + 80. * s - 1.);
    // a declared 120 x 100 GUI px screen, centred on the patch, from its top
    let screen = found("0 -100 {n} 1 120 100");
    assert!((screen.x - (w as f64 - 120. * s) / 2.).abs() < 1.);
    assert!((screen.width - 120. * s).abs() < 1.);
    assert!(
        screen.y <= heading_y + 1.,
        "the heading above the grid is the screen"
    );
    assert!((screen.y + screen.height - (nominal_y + 100. * s)).abs() < 1.);
    // a malformed or out-of-range extent is rejected, never guessed
    for bad in [
        "0 -100 {n} 1 120",
        "0 -100 {n} 1 -5 100",
        "0 -100 {n} 1 NaN 100",
        "0 -100 {n} 1 5000 100",
    ] {
        let header = format!(
            "GUIT2\noptions.test_screen\nfixture\nfixed_controls_test\n80 80 0\n{}\n",
            bad.replace("{n}", "0")
        );
        let bytes = [header.as_bytes(), rgba.as_slice()].concat();
        assert!(PanelTemplate::from_bytes(&bytes).is_err(), "{bad}");
    }
}
