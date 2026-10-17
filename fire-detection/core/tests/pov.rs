use fire_core::{
    gui_mask::{compose_hud, GuiDetector, GuiFit, GuiOptions, GuiTextures, HudState},
    overlay::SilhouetteMatcher,
    pov::PovMatcher,
};

fn textures() -> GuiTextures {
    GuiTextures::load(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../data/assets/gui"
    )))
    .unwrap()
}
const SHEET: &[u8] = include_bytes!("../testdata/fire_1.rgba");

#[test]
fn compact_scores_and_candidate_bins_preserve_full_diagnostics() {
    let (w, h) = (640, 360);
    let mut frame = vec![0; w * h * 3];
    for (i, p) in frame.as_chunks_mut::<3>().0.iter_mut().enumerate() {
        p.copy_from_slice(&[
            (i * 17 % 256) as u8,
            (i * 31 % 256) as u8,
            (i * 43 % 256) as u8,
        ]);
    }
    let mask: Vec<u8> = (0..w * h).map(|i| u8::from(i % 7 == 0)).collect();
    let m = SilhouetteMatcher::new(SHEET, w, h, 70.).unwrap();
    for veiled in [false, true] {
        let full = m.inspect_frame(&frame, Some(&mask), veiled).unwrap();
        let compact = m.inspect_scores(&frame, Some(&mask), veiled).unwrap();
        let row = full.ranked_colour[0].0;
        let one = m.inspect_candidate(&frame, &mask, veiled, row).unwrap();
        assert_eq!(full.ranked_colour, compact.ranked_colour);
        assert_eq!(full.ranked_colour, one.ranked_colour);
        let a = full.diagnostics.unwrap();
        let b = compact.diagnostics.unwrap();
        let c = one.diagnostics.unwrap();
        assert_eq!(a.colour_sum, b.colour_sum);
        assert_eq!(a.colour_used, b.colour_used);
        assert!(b.colour_spatial_used.is_empty());
        assert_eq!(
            a.colour_spatial_hits[row as usize],
            c.colour_spatial_hits[row as usize]
        );
        assert_eq!(
            a.colour_spatial_used[row as usize],
            c.colour_spatial_used[row as usize]
        );
        for r in 0..32 {
            if r != row as usize {
                assert_eq!(c.colour_spatial_used[r], [0; 16]);
            }
        }
    }
    assert!(m.inspect_candidate(&frame, &mask, false, 32).is_err());
    assert!(m.inspect_scores(&frame, Some(&mask[..20]), false).is_err());
}

#[test]
fn reusable_gui_templates_do_not_carry_frame_state() {
    let tex = textures();
    let detector = GuiDetector::new(tex.clone(), GuiOptions::default()).unwrap();
    let (w, h) = (640, 360);
    for slot in [0, 8, 3] {
        let mut frame = vec![60; w * h * 3];
        compose_hud(
            &mut frame,
            w,
            h,
            &tex,
            &HudState {
                selected_slot: slot,
                ..HudState::default()
            },
            &GuiFit::framebuffer(w as u32, h as u32, 1, 1.),
        );
        let a = detector.detect(&frame, w, h).unwrap();
        let b =
            fire_core::gui_mask::detect_gui(&frame, w, h, &tex, &GuiOptions::default()).unwrap();
        assert_eq!(a, b);
    }
}

#[test]
fn empty_dark_frames_cannot_gain_matching_probes_from_masks() {
    let m = PovMatcher::new(SHEET, textures(), 640, 360).unwrap();
    let result = m.match_frame(&vec![0; 640 * 360 * 3]).unwrap();
    assert!(result.row.is_none());
    assert!(!result.used_gui);
    assert!(m.match_frame(&[0; 4]).is_err());
    assert!(PovMatcher::new(SHEET, textures(), 0, 360).is_err());
}
