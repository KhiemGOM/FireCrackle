use std::sync::{atomic::AtomicBool, Arc};
use studio_core::{
    config::{IndexConfig, Settings},
    decode_plan::DecodeJob,
    frames::{DecodeError, DecodedFrame},
    index::{build_index, Packet},
    label::{Label, LabelStore},
    project::{Project, VideoMeta},
    workspace::{FrameSource, UiAction, Workspace},
};

fn fire(row: u8) -> Label {
    Label::Fire {
        sheet: 0,
        row,
        mirrored: true,
    }
}
fn source() -> LabelStore {
    let mut store = LabelStore::new(6);
    store.set(0, fire(0)).unwrap();
    store.set_predicted(1, fire(31)).unwrap();
    store.set(2, Label::NoFire).unwrap();
    store.set(3, Label::Skip).unwrap();
    store
}

#[test]
fn roundtrip_merge_and_single_undo_preserve_values_and_prediction_source() {
    let original = source();
    let json = original.export_json("video-id");
    let mut target = LabelStore::new(6);
    target.set(0, Label::Skip).unwrap();
    target.set(4, Label::NoFire).unwrap();
    assert_eq!(
        target.import_json(&json, "video-id").unwrap(),
        vec![0, 1, 2, 3]
    );
    for (f, label) in original.iter() {
        assert_eq!(target.get(f), label);
        assert_eq!(target.is_predicted(f), original.is_predicted(f));
    }
    assert_eq!(target.get(4), Label::NoFire);
    assert!(target.import_json(&json, "video-id").unwrap().is_empty());
    assert!(target.undo()); // identical re-import did not add an undo entry
    assert_eq!(target.iter(), vec![(0, Label::Skip), (4, Label::NoFire)]);
    assert!(!target.is_predicted(1));
}

#[test]
fn bad_imports_are_atomic_including_invalid_late_entries_and_wrong_video() {
    let json = source().export_json("video-id");
    let mut cases = vec!["{".to_string(), json.replace("video-id", "other-video")];
    let base: serde_json::Value = serde_json::from_str(&json).unwrap();
    for (key, value) in [
        ("version", serde_json::json!(4)),
        ("frame_count", serde_json::json!(7)),
        ("format", serde_json::json!("other")),
    ] {
        let mut v = base.clone();
        v[key] = value;
        cases.push(v.to_string());
    }
    for entry in [
        serde_json::json!({"version":2,"frame":6,"label":"skip"}),
        serde_json::json!({"version":2,"frame":5,"label":{"fire":{"sheet":0,"row":32,"mirrored":false}}}),
        serde_json::json!({"version":2,"frame":0,"label":"skip"}),
        serde_json::json!({"version":2,"frame":5,"label":"skip","predicted":true}),
    ] {
        let mut v = base.clone();
        v["labels"].as_array_mut().unwrap().push(entry);
        cases.push(v.to_string());
    }
    for bad in cases {
        let mut store = source();
        let before = store.export_json("video-id");
        assert!(
            store.import_json(&bad, "video-id").is_err(),
            "accepted invalid archive: {bad}"
        );
        assert_eq!(store.export_json("video-id"), before);
    }
}

struct Fake;
impl FrameSource for Fake {
    fn decode(&self, _: &DecodeJob, _: &AtomicBool) -> Result<Vec<DecodedFrame>, DecodeError> {
        Ok(vec![])
    }
}
fn project() -> Project {
    let packets: Vec<_> = (0..6)
        .map(|f| Packet {
            pts: Some(f as f64 / 20.0),
            dts: None,
            key: true,
        })
        .collect();
    let index = build_index(&packets, &IndexConfig::default()).unwrap();
    Project::assemble(
        "video.mkv",
        1,
        "video-id".into(),
        VideoMeta {
            width: 16,
            height: 16,
            fps_num: 20,
            fps_den: 1,
            codec: "h264".into(),
        },
        &index,
    )
}

#[test]
fn workspace_import_autosaves_and_undo_survives_export_and_restart() {
    let dir = std::env::temp_dir().join(format!("fc_label_transfer_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let open =
        || Workspace::from_parts(&dir, project(), &Settings::default(), Arc::new(Fake)).unwrap();
    let mut ws = open();
    let v = ws.import_labels(&source().export_json("video-id")).unwrap();
    assert_eq!(v.labelled_count, 4);
    assert!(v.save_error.is_none());
    let export = dir.join("export.json");
    ws.export_labels_to(&export).unwrap();
    assert_eq!(
        std::fs::read_to_string(&export).unwrap(),
        source().export_json("video-id")
    );
    drop(ws);
    let mut ws = open();
    assert_eq!(ws.export_labels(), source().export_json("video-id"));
    let empty = LabelStore::new(6).export_json("video-id");
    assert!(ws.import_labels(&empty).is_ok());
    // Replacing matching frames remains one reversible edit after a restart.
    let mut replacement = LabelStore::new(6);
    replacement.set(1, Label::Skip).unwrap();
    ws.import_labels(&replacement.export_json("video-id"))
        .unwrap();
    ws.apply(UiAction::Undo).unwrap();
    assert_eq!(ws.export_labels(), source().export_json("video-id"));
    drop(ws);
    assert_eq!(open().export_labels(), source().export_json("video-id"));
    std::fs::remove_dir_all(dir).unwrap();
}
