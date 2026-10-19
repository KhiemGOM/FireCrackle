use studio_core::{
    config::{IndexConfig, Settings},
    index::{build_index, Packet},
    label::{AnimationAtlas, Label, LabelSource, LabelStore},
    lane::buckets,
    phase::{FlagKind, Severity},
    project::{Project, VideoMeta},
    session::Session,
};

fn normal(row: u8) -> Label {
    Label::Fire {
        sheet: 1,
        row,
        mirrored: false,
    }
}
fn soul(row: u8) -> Label {
    Label::Texture {
        atlas: AnimationAtlas::SoulFire0,
        row,
        mirrored: true,
    }
}
fn session(store: LabelStore) -> Session {
    let packets: Vec<_> = (0..store.frame_count())
        .map(|i| Packet {
            pts: Some(i as f64 / 60.),
            dts: None,
            key: i == 0,
        })
        .collect();
    let index = build_index(&packets, &IndexConfig::default()).unwrap();
    let meta = VideoMeta {
        width: 1920,
        height: 1080,
        fps_num: 60,
        fps_den: 1,
        codec: "h264".into(),
    };
    let project = Project::assemble("test.mp4", 1, "video".into(), meta, &index);
    Session::new(project, store, Settings::default()).unwrap()
}
#[test]
fn matching_rows_count_once_and_ignore_sheet_and_mirroring() {
    let mut store = LabelStore::new(3);
    store.set(0, normal(7)).unwrap();
    store.set(0, soul(7)).unwrap();
    assert_eq!(store.labelled_count(), 1);
    assert_eq!(store.next_unlabelled(0, true), Some(1));
    assert!(matches!(store.get(0), Label::FirePair { .. }));
    assert_eq!(buckets(&store, &[], 0, 1, 1)[0].fire, 1);
    let mut session = session(store);
    assert_eq!(session.analysis().points.len(), 1);
    assert!(session.flags().is_empty());
}
#[test]
fn even_one_tick_same_frame_disagreement_is_immediate_hard() {
    let mut store = LabelStore::new(2);
    store.set(0, normal(7)).unwrap();
    store.set(0, soul(8)).unwrap();
    let mut session = session(store);
    let flags = session.flags();
    assert_eq!(flags.len(), 1);
    assert_eq!(flags[0].kind, FlagKind::FireConflict);
    assert_eq!(flags[0].severity, Severity::Hard);
    assert_eq!((flags[0].frame, flags[0].end_frame), (0, 0));
}
#[test]
fn all_sources_mode_separates_clocks_without_changing_labels() {
    let mut store = LabelStore::new(2);
    store.set(0, soul(31)).unwrap();
    store.set(0, normal(1)).unwrap();
    let before = store.get(0);
    let mut session = session(store);
    assert_eq!(session.flags().len(), 1);
    session.set_combined_fire(false);
    assert!(session.flags().is_empty());
    assert_eq!(session.store().get(0), before);
    assert_eq!(
        session.fire_observations(None, Some(false))[0].label,
        normal(1)
    );
    assert_eq!(
        session.fire_observations(None, Some(true))[0].label,
        Label::Fire {
            sheet: 0,
            row: 31,
            mirrored: true
        }
    );
    session.set_combined_fire(true);
    assert_eq!(session.flags()[0].kind, FlagKind::FireConflict);
}
#[test]
fn paired_readings_survive_log_export_import_and_undo() {
    let mut store = LabelStore::new(3);
    store.set(0, normal(7)).unwrap();
    store.set(0, soul(8)).unwrap();
    let pair = store.get(0);
    let line = store.log_line(0);
    assert!(line.contains("\"version\":3"));
    let replay = LabelStore::replay(&line, 3).unwrap().store;
    assert_eq!(replay.get(0), pair);
    let mut imported = LabelStore::new(3);
    imported
        .import_json(&store.export_json("video"), "video")
        .unwrap();
    assert_eq!(imported.get(0), pair);
    store.undo();
    assert_eq!(store.get(0), normal(7));
    store.set(0, soul(8)).unwrap();
    store.clear(0).unwrap();
    assert_eq!(store.get(0), Label::Unset);
    store.undo();
    assert_eq!(store.get(0), pair);
}
#[test]
fn updating_one_family_preserves_the_other() {
    let mut store = LabelStore::new(3);
    store.fill_range(0, 1, normal(4)).unwrap();
    store.fill_range(0, 1, soul(4)).unwrap();
    store.set(0, soul(5)).unwrap();
    let Label::FirePair {
        normal: fire,
        soul: other,
    } = store.get(0)
    else {
        panic!("pair missing")
    };
    assert_eq!(fire.row, 4);
    assert_eq!(other.row, 5);
    assert_eq!(store.labelled_count(), 2);
    store.undo();
    assert_eq!(store.get(0), store.get(1));
}
#[test]
fn a_time_guess_does_not_turn_into_independent_normal_fire_evidence() {
    let mut store = LabelStore::new(2);
    store.set_predicted(0, normal(7)).unwrap();
    store.set(0, soul(8)).unwrap();
    let mut session = session(store);
    assert!(session.flags().is_empty());
    assert_eq!(session.analysis().points[0].step, 8);
    assert!(session
        .fire_observations(Some(LabelSource::Manual), Some(false))
        .is_empty());
    assert_eq!(
        session
            .fire_observations(Some(LabelSource::TimeGuess), Some(false))
            .len(),
        1
    );
}
#[test]
fn soul_only_counts_as_labelled_and_no_fire_clears_both() {
    let mut store = LabelStore::new(3);
    store.set(0, soul(3)).unwrap();
    assert_eq!(store.labelled_count(), 1);
    store.set(0, normal(3)).unwrap();
    store.set(0, Label::NoFire).unwrap();
    assert_eq!(store.get(0), Label::NoFire);
    store.undo();
    assert!(matches!(store.get(0), Label::FirePair { .. }));
}
