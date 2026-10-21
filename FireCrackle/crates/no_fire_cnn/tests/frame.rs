use no_fire_cnn::{DEFAULT_VIEW_ORDER, THRESHOLD, clear_frame_with, views};
use std::sync::atomic::{AtomicBool, Ordering};

#[test]
fn scorer_receives_frozen_views_in_the_default_order() {
    let raw: Vec<u8> = (0..1920 * 1080 * 3)
        .map(|i| ((i * 17 + i / 1920 * 31) % 256) as u8)
        .collect();
    let auto: Vec<u8> = raw.iter().map(|v| v.saturating_add(19)).collect();
    let passes = [views(&raw).unwrap(), views(&auto).unwrap()];
    let expected: Vec<_> = DEFAULT_VIEW_ORDER
        .iter()
        .map(|&(pass, tile)| passes[pass as usize][tile as usize].clone())
        .collect();
    let mut index = 0;
    assert!(
        clear_frame_with(&raw, Some(&auto), &AtomicBool::new(false), |view| {
            assert_eq!(view, expected[index]);
            index += 1;
            Ok(-2.0)
        })
        .unwrap()
    );
    assert_eq!(index, 18);
}

#[test]
fn rejection_and_errors_stop_before_later_views_and_restored_input() {
    let raw = vec![37; 1920 * 1080 * 3];
    let cancel = AtomicBool::new(false);
    let mut calls = 0;
    assert!(
        !clear_frame_with(&raw, Some(&[]), &cancel, |_| {
            calls += 1;
            Ok(THRESHOLD)
        })
        .unwrap()
    );
    assert_eq!(calls, 1);
    let mut calls = 0;
    assert_eq!(
        clear_frame_with(&raw, None, &cancel, |_| {
            calls += 1;
            Err("inference failed".into())
        }),
        Err("inference failed".into())
    );
    assert_eq!(calls, 1);
}

#[test]
fn cancellation_before_and_between_views_stops_scoring() {
    let raw = vec![37; 1920 * 1080 * 3];
    let cancel = AtomicBool::new(true);
    assert!(!clear_frame_with(&raw, None, &cancel, |_| panic!("cancelled scorer called")).unwrap());
    cancel.store(false, Ordering::Relaxed);
    let mut calls = 0;
    assert!(
        !clear_frame_with(&raw, None, &cancel, |_| {
            calls += 1;
            cancel.store(true, Ordering::Relaxed);
            Ok(-2.0)
        })
        .unwrap()
    );
    assert_eq!(calls, 1);
}

#[test]
fn invalid_input_never_reaches_the_scorer() {
    assert!(
        clear_frame_with(&[], None, &AtomicBool::new(false), |_| panic!(
            "invalid view scored"
        ))
        .is_err()
    );
}
