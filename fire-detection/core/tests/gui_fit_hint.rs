use fire_core::gui_mask::*;
use std::path::Path;

fn detector() -> GuiDetector {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/assets/gui");
    GuiDetector::new(GuiTextures::load(&path).unwrap(), GuiOptions::default()).unwrap()
}

fn frame(detector: &GuiDetector, w: usize, h: usize, scale: u32, slot: u8) -> Vec<u8> {
    let mut rgb: Vec<u8> = (0..w * h * 3)
        .map(|i| ((i * 17 + i / 73) % 256) as u8)
        .collect();
    let state = HudState {
        selected_slot: slot,
        ..HudState::default()
    };
    compose_hud(
        &mut rgb,
        w,
        h,
        detector.textures(),
        &state,
        &GuiFit::framebuffer(w as u32, h as u32, scale, 1.),
    );
    rgb
}

fn same_geometry_and_mask(a: &GuiMask, b: &GuiMask) {
    assert_eq!(a.fit, b.fit);
    assert_eq!(a.reliable, b.reliable);
    assert_eq!(a.class, b.class);
    assert_eq!(a.piece, b.piece);
    assert_eq!(a.notes, b.notes);
}

#[test]
fn stable_fit_is_verified_and_current_selection_is_not_reused() {
    let detector = detector();
    let mut hint = GuiFitHint::default();
    let rgb = frame(&detector, 640, 480, 2, 0);
    let cold = detector.detect(&rgb, 640, 480).unwrap();
    assert!(cold.reliable);
    same_geometry_and_mask(
        &cold,
        &detector
            .detect_with_hint(&rgb, 640, 480, &mut hint)
            .unwrap(),
    );
    assert!(!hint.reused());
    same_geometry_and_mask(
        &cold,
        &detector
            .detect_with_hint(&rgb, 640, 480, &mut hint)
            .unwrap(),
    );
    assert!(hint.reused());
    let changed = frame(&detector, 640, 480, 2, 7);
    let current = detector
        .detect_with_hint(&changed, 640, 480, &mut hint)
        .unwrap();
    assert!(hint.reused());
    assert!(current
        .hits
        .iter()
        .any(|hit| hit.piece == PieceId::SelectedSlot && hit.index == 7));
    same_geometry_and_mask(&detector.detect(&changed, 640, 480).unwrap(), &current);
}

#[test]
fn changed_scale_dimensions_hidden_hud_and_bad_inputs_fall_back() {
    let detector = detector();
    let mut hint = GuiFitHint::default();
    let a = frame(&detector, 640, 480, 2, 0);
    detector.detect_with_hint(&a, 640, 480, &mut hint).unwrap();
    let b = frame(&detector, 640, 480, 1, 0);
    let changed = detector.detect_with_hint(&b, 640, 480, &mut hint).unwrap();
    assert!(!hint.reused());
    same_geometry_and_mask(&detector.detect(&b, 640, 480).unwrap(), &changed);
    detector.detect_with_hint(&b, 640, 480, &mut hint).unwrap();
    assert!(hint.reused());
    let resized = frame(&detector, 960, 720, 3, 0);
    detector
        .detect_with_hint(&resized, 960, 720, &mut hint)
        .unwrap();
    assert!(!hint.reused());
    let absent = detector
        .detect_with_hint(&vec![31; 960 * 720 * 3], 960, 720, &mut hint)
        .unwrap();
    assert!(!hint.reused() && !absent.reliable);
    detector
        .detect_with_hint(&resized, 960, 720, &mut hint)
        .unwrap();
    assert!(!hint.reused());
    assert!(detector
        .detect_with_hint(&resized[..100], 960, 720, &mut hint)
        .is_err());
    detector
        .detect_with_hint(&resized, 960, 720, &mut hint)
        .unwrap();
    assert!(!hint.reused());
}

#[test]
fn state_is_private_to_each_ordered_worker_and_new_scan() {
    use fire_core::video::parallel_frames_indexed_with_state;
    use std::{
        io::Cursor,
        sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    };
    for _ in 0..2 {
        let initialized = AtomicUsize::new(0);
        let mut output = Vec::new();
        parallel_frames_indexed_with_state(
            Cursor::new(vec![0; 64 * 3]),
            3,
            64,
            4,
            &AtomicBool::new(false),
            || (initialized.fetch_add(1, Ordering::Relaxed), None),
            |(worker, previous), n, _| {
                if let Some(before) = *previous {
                    assert!(before < n);
                }
                let result = (*worker, *previous);
                *previous = Some(n);
                Ok(result)
            },
            |n, value| output.push((n, value)),
        )
        .unwrap();
        assert_eq!(initialized.load(Ordering::Relaxed), 4);
        assert_eq!(output.len(), 64);
        output.sort_by_key(|r| r.0);
        let mut previous = [None; 4];
        for (n, (worker, before)) in output {
            assert_eq!(before, previous[worker]);
            previous[worker] = Some(n);
        }
    }
}
