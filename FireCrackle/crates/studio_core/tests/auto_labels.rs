use studio_core::{
    config::{IndexConfig, Settings},
    index::{build_index, Packet},
    label::{Label, LabelSource, LabelStore},
    project::{Project, VideoMeta},
    session::{Move, Session},
};
fn session() -> Session {
    let packets: Vec<_> = (0..30)
        .map(|n| Packet {
            pts: Some(n as f64 / 20.),
            dts: None,
            key: n == 0,
        })
        .collect();
    let index = build_index(&packets, &IndexConfig::default()).unwrap();
    let project = Project::assemble(
        "v.mkv",
        1,
        "fp".into(),
        VideoMeta {
            width: 1920,
            height: 1080,
            fps_num: 20,
            fps_den: 1,
            codec: "h264".into(),
        },
        &index,
    );
    Session::new(project, LabelStore::new(30), Settings::default()).unwrap()
}
#[test]
fn bulk_predictions_preserve_existing_labels_and_undo_as_one_step() {
    let mut s = session();
    s.go(Move::Home);
    s.apply(Label::NoFire).unwrap();
    assert_eq!(
        s.add_auto_predictions(&[(0, 8), (1, 9), (2, 10)]).unwrap(),
        2
    );
    assert_eq!(s.store().get(0), Label::NoFire);
    assert!(s.store().sources(1).contains(&LabelSource::FirstPerson));
    assert!(!s.store().sources(1).contains(&LabelSource::Manual));
    assert!(s.store().is_predicted(1));
    assert_eq!(s.analysis().points.len(), 2);
    assert!(s.undo());
    assert_eq!(s.store().get(1), Label::Unset);
    assert_eq!(s.store().get(2), Label::Unset);
    assert_eq!(s.store().get(0), Label::NoFire);
}
#[test]
fn human_recheck_keeps_both_sources_across_save_reload_export_and_undo() {
    let mut s = session();
    s.add_auto_predictions(&[(5, 9)]).unwrap();
    s.go(Move::Home);
    s.go(Move::Frames(5));
    s.click_cell(1, 9, false).unwrap();
    assert_eq!(
        s.store().sources(5).into_iter().collect::<Vec<_>>(),
        vec![LabelSource::Manual, LabelSource::FirstPerson]
    );
    assert!(!s.store().is_predicted(5));
    let log = s.store().log_line(5);
    let replay = LabelStore::replay(&log, 30).unwrap();
    assert_eq!(replay.store.sources(5), s.store().sources(5));
    let export = s.store().export_json("fp");
    let mut imported = LabelStore::new(30);
    imported.import_json(&export, "fp").unwrap();
    assert_eq!(imported.sources(5), s.store().sources(5));
    assert!(s.undo());
    assert_eq!(
        s.store().sources(5).into_iter().collect::<Vec<_>>(),
        vec![LabelSource::FirstPerson]
    );
    s.go(Move::Home);
    s.go(Move::Frames(5));
    s.click_cell(1, 10, false).unwrap();
    assert_eq!(
        s.store().sources(5).into_iter().collect::<Vec<_>>(),
        vec![LabelSource::Manual]
    );
}
#[test]
fn invalid_batch_is_atomic_and_repeated_apply_does_not_overwrite() {
    let mut s = session();
    assert!(s.add_auto_predictions(&[(1, 9), (31, 8)]).is_err());
    assert_eq!(s.store().labelled_count(), 0);
    assert!(s.add_auto_predictions(&[(1, 9), (2, 32)]).is_err());
    assert_eq!(s.store().labelled_count(), 0);
    s.add_auto_predictions(&[(1, 9)]).unwrap();
    assert_eq!(s.add_auto_predictions(&[(1, 10)]).unwrap(), 0);
    assert_eq!(
        s.store().get(1),
        Label::Fire {
            sheet: 1,
            row: 9,
            mirrored: false
        }
    );
}
#[test]
fn source_filters_recompute_evidence_and_old_logs_keep_their_meaning() {
    let old = "{\"version\":2,\"frame\":0,\"label\":{\"fire\":{\"sheet\":1,\"row\":0,\"mirrored\":false}}}\n{\"version\":2,\"frame\":1,\"label\":{\"fire\":{\"sheet\":1,\"row\":1,\"mirrored\":false}},\"predicted\":true}";
    let replay = LabelStore::replay(old, 30).unwrap();
    assert!(replay.store.sources(0).contains(&LabelSource::Manual));
    assert!(replay.store.sources(1).contains(&LabelSource::TimeGuess));
    let mut s = session();
    s.import_labels(&replay.store.export_json("fp")).unwrap();
    s.add_auto_predictions(&[(2, 2)]).unwrap();
    assert_eq!(
        s.analysis()
            .points
            .iter()
            .map(|p| p.frame)
            .collect::<Vec<_>>(),
        vec![0, 2]
    );
    assert_eq!(s.analysis_for_source(LabelSource::Manual).points.len(), 1);
    assert_eq!(
        s.analysis_for_source(LabelSource::FirstPerson).points[0].frame,
        2
    );
    assert_eq!(
        s.analysis_for_source(LabelSource::TimeGuess).points[0].frame,
        1
    );
}

#[test]
fn automatic_no_fire_is_persistent_protected_and_one_undo_step() {
    let mut s = session();
    s.apply(Label::Skip).unwrap();
    s.add_auto_predictions(&[(1,9)]).unwrap();
    assert_eq!(s.add_auto_no_fire(&[0,1,2,2,3]).unwrap(),2);
    assert_eq!(s.store().get(0),Label::Skip);
    assert!(s.store().get(1).is_fire());
    assert_eq!(s.store().sources(2).into_iter().collect::<Vec<_>>(),vec![LabelSource::NoFire]);
    let export = s.store().export_json("fp");
    let mut imported = LabelStore::new(30);
    imported.import_json(&export,"fp").unwrap();
    let replay = LabelStore::replay(&s.store().log_line(2),30).unwrap();
    assert_eq!(imported.sources(2),s.store().sources(2));
    assert_eq!(replay.store.sources(2),s.store().sources(2));
    assert!(s.undo());
    assert_eq!(s.store().get(2),Label::Unset);
    assert_eq!(s.store().get(3),Label::Unset);
    assert!(s.store().get(1).is_fire());
    assert_eq!(s.store().get(0),Label::Skip);
}

#[test]
fn no_fire_batch_validates_before_writing_and_human_review_preserves_history() {
    let mut s = session();
    assert!(s.add_auto_no_fire(&[1,30]).is_err());
    assert_eq!(s.store().labelled_count(),0);
    s.add_auto_no_fire(&[5]).unwrap();
    s.go(Move::To(5));
    s.apply(Label::NoFire).unwrap();
    assert!(s.store().sources(5).contains(&LabelSource::Manual));
    assert!(s.store().sources(5).contains(&LabelSource::NoFire));
    assert!(s.undo());
    assert_eq!(s.store().sources(5).into_iter().collect::<Vec<_>>(),vec![LabelSource::NoFire]);
    assert_eq!(s.add_auto_no_fire(&[5]).unwrap(),0);
}
