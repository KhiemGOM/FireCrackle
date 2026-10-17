use studio_core::config::{IndexConfig, Settings};
use studio_core::index::{build_index, Packet};
use studio_core::label::{Label, LabelStore};
use studio_core::project::{Project, VideoMeta};
use studio_core::session::{Move, Session};

fn project(pts: &[f64]) -> Project {
    let packets: Vec<_> = pts
        .iter()
        .map(|&pts| Packet {
            pts: Some(pts),
            dts: None,
            key: true,
        })
        .collect();
    let index = build_index(&packets, &IndexConfig::default()).unwrap();
    Project::assemble(
        "prediction.mkv",
        1,
        "fixture".into(),
        VideoMeta {
            width: 1920,
            height: 1080,
            fps_num: 60,
            fps_den: 1,
            codec: "h264".into(),
        },
        &index,
    )
}
fn session(pts: &[f64], labels: &[(u32, u8)]) -> Session {
    let mut store = LabelStore::new(pts.len() as u32);
    for &(n, row) in labels {
        store
            .set(
                n,
                Label::Fire {
                    sheet: 1,
                    row,
                    mirrored: false,
                },
            )
            .unwrap();
    }
    Session::new(project(pts), store, Settings::default()).unwrap()
}

#[test]
fn nearest_anchor_is_by_actual_pts_not_frame_distance() {
    let mut s = session(&[0.0, 0.01, 0.02, 10.0], &[(0, 5), (3, 20)]);
    s.go(Move::To(2));
    assert_eq!(s.suggestion().unwrap().from_frame, 0);
}

#[test]
fn recent_trusted_labels_resolve_an_avoidable_one_row_rounding_error() {
    // The transition between0.01 and0.02 constrains fractional phase to[0.6,0.8).
    let mut s = session(&[0.0, 0.01, 0.02, 0.05], &[(0, 0), (1, 0), (2, 1)]);
    s.go(Move::To(0)); // do not use the current frame as evidence
    s.go(Move::To(3));
    assert_eq!(s.suggestion().unwrap().row, 1);
    // At0.05 nearest-only rounding from0.02 predicts2; local phase still predicts1.
}

#[test]
fn exact_nominal_tick_delta_is_not_capture_certainty() {
    let mut s = session(&[3.783, 3.800, 3.817, 3.833], &[(0, 8)]);
    s.go(Move::To(3));
    let guess = s.suggestion().unwrap();
    assert_eq!(guess.row, 9);
    assert_eq!(guess.alt_row, Some(10));
}

#[test]
fn incompatible_lag_does_not_average_away_a_recent_trusted_anchor() {
    let mut s = session(&[0.0, 0.1, 0.2, 0.217], &[(0, 0), (2, 0)]);
    s.go(Move::To(3));
    assert_eq!(s.suggestion().unwrap().row, 0);
}

#[test]
fn navigating_many_guesses_keeps_them_unsaved_and_does_not_reanchor() {
    let pts: Vec<_> = (0..100).map(|n| n as f64 / 60.0).collect();
    let mut s = session(&pts, &[(0, 5)]);
    s.go(Move::To(1));
    for _ in 0..20 { s.manual_advance(1).unwrap(); }
    assert_eq!(s.store().labelled_count(),1);
    assert_eq!(s.suggestion().unwrap().from_frame,0);
    assert!(s.take_log().is_empty());
}

#[test]
fn explicitly_confirmed_guess_is_human_checked_without_time_guess_source() {
    use studio_core::label::LabelSource;
    let mut s=session(&[0.0,0.05,0.10],&[(0,5)]);
    s.go(Move::To(1));
    s.accept_suggestion().unwrap();
    assert_eq!(s.store().sources(1).into_iter().collect::<Vec<_>>(),vec![LabelSource::Manual]);
    assert!(!s.store().is_predicted(1));
    assert!(s.undo());
    assert_eq!(s.store().get(1),Label::Unset);
}

#[test]
fn manual_forward_only_moves_and_keeps_destination_guess() {
    let mut s=session(&[0.0,0.05,0.10,0.15,0.20],&[(0,5)]);
    let mut cfg=Settings::default();cfg.label.advance_frames=4;cfg.label.advance_to_unlabelled=true;
    s.set_settings(cfg);s.go(Move::To(1));s.manual_advance(2).unwrap();
    assert_eq!(s.current(),3);
    assert_eq!(s.store().get(1),Label::Unset);
    assert_eq!(s.store().get(2),Label::Unset);
    assert_eq!(s.suggestion().unwrap().from_frame,0);
    assert!(s.take_log().is_empty());
    assert!(s.undo()); // only the original manual anchor is on the undo stack
    assert_eq!(s.current(),0);
    assert_eq!(s.store().labelled_count(),0);
}

#[test]
fn backward_plain_navigation_and_end_of_video_do_not_confirm() {
    let mut s = session(&[0.0, 0.05, 0.10], &[(0, 5)]);
    s.go(Move::To(1));
    s.manual_advance(-1).unwrap();
    s.go(Move::To(2));
    s.manual_advance(1).unwrap();
    assert_eq!(s.store().get(1), Label::Unset);
    assert_eq!(s.store().get(2), Label::Unset);
}

#[test]
fn manual_forward_preserves_explicit_labels_and_no_suggestion_still_moves() {
    let mut s = session(&[0.0, 0.05, 0.10, 0.15], &[]);
    s.manual_advance(1).unwrap();
    assert_eq!(s.current(), 1);
    assert_eq!(s.store().labelled_count(), 0);
    s.apply(Label::NoFire).unwrap();
    s.go(Move::To(1));
    s.manual_advance(1).unwrap();
    assert_eq!(s.store().get(1), Label::NoFire);
}

#[test]
fn trusted_phase_constraints_keep_the_correct_row_under_millisecond_pts_jitter() {
    for offset in [0.05, 0.23, 0.47, 0.71, 0.95] {
        let pts: Vec<_> = (0..100)
            .map(|n| n as f64 / 60.0 + if n % 2 == 0 { 0.0004 } else { -0.0004 })
            .collect();
        let truth = |n: usize| ((20.0 * n as f64 / 60.0 + offset).floor() as u8 + 29) % 32;
        let labels: Vec<_> = (0..12).map(|n| (n as u32, truth(n))).collect();
        let mut s = session(&pts, &labels);
        for n in 12..100 {
            s.go(Move::To(n as u32));
            let g = s.suggestion().unwrap();
            assert!(
                g.row == truth(n) || g.alt_row == Some(truth(n)),
                "offset{offset} frame{n}: {g:?}"
            );
        }
    }
}

#[test]
fn explicit_confirmation_undo_and_compaction_preserve_prediction_source() {
    use studio_core::autosave::AutosaveLog;
    let label = Label::Fire {
        sheet: 1,
        row: 5,
        mirrored: false,
    };
    let mut store = LabelStore::new(10);
    store.set(0, label).unwrap();
    store.set_predicted(1, label).unwrap();
    assert!(store.set(1, label).unwrap());
    assert!(!store.is_predicted(1));
    store.undo();
    assert!(store.is_predicted(1));
    assert_eq!(store.fill_range(0, 1, label).unwrap(), 1);
    assert!(!store.is_predicted(1));
    store.undo();
    assert!(store.is_predicted(1));
    let dir = std::env::temp_dir().join(format!(
        "fc_prediction_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("labels.jsonl");
    let mut cfg = Settings::default().autosave;
    cfg.compact_after_lines = 1;
    let (mut log, _, _) = AutosaveLog::open(&path, 10, &cfg).unwrap();
    log.append(&[store.log_line(0), store.log_line(1)]).unwrap();
    assert!(log.compact_if_needed(&store).unwrap());
    let (_, reopened, _) = AutosaveLog::open(&path, 10, &cfg).unwrap();
    assert!(reopened.is_predicted(1));
    assert!(!reopened.is_predicted(0));
    std::fs::remove_file(path).unwrap();
    std::fs::remove_dir(dir).unwrap();
}
