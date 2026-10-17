use studio_core::{
    label::{Label, LabelSource, LabelStore},
    lane::buckets,
};

#[test]
fn saved_no_fire_and_tool_strips_survive_workspace_reopen() {
    use std::sync::{atomic::AtomicBool, Arc};
    use studio_core::{
        config::{IndexConfig, Settings},
        decode_plan::DecodeJob,
        frames::{DecodeError, DecodedFrame},
        index::{build_index, Packet},
        project::{Project, VideoMeta},
        workspace::{FrameSource, Workspace},
    };
    struct Fake;
    impl FrameSource for Fake {
        fn decode(
            &self,
            job: &DecodeJob,
            _: &AtomicBool,
        ) -> Result<Vec<DecodedFrame>, DecodeError> {
            Ok((job.first..=job.last)
                .map(|frame| DecodedFrame {
                    frame,
                    jpeg: vec![0; 8],
                })
                .collect())
        }
    }
    let packets: Vec<_> = (0..4)
        .map(|i| Packet {
            pts: Some(i as f64 / 60.0),
            dts: None,
            key: i == 0,
        })
        .collect();
    let index = build_index(&packets, &IndexConfig::default()).unwrap();
    let project = Project::assemble(
        "v.mkv",
        1,
        "auto-no-fire-reopen".into(),
        VideoMeta {
            width: 1920,
            height: 1080,
            fps_num: 60,
            fps_den: 1,
            codec: "h264".into(),
        },
        &index,
    );
    let dir = std::env::temp_dir().join(format!(
        "fc_auto_reopen_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let mut workspace =
        Workspace::from_parts(&dir, project.clone(), &Settings::default(), Arc::new(Fake)).unwrap();
    let (view, count) = workspace.add_auto_no_fire(&[1, 2]).unwrap();
    assert_eq!(count, 2);
    assert!(view.save_error.is_none());
    drop(workspace);
    let mut reopened =
        Workspace::from_parts(&dir, project, &Settings::default(), Arc::new(Fake)).unwrap();
    let bucket = reopened.timeline(0, 4, 1)[0];
    assert_eq!((bucket.no_fire, bucket.auto_no_fire), (2, 2));
    let archive: serde_json::Value = serde_json::from_str(&reopened.export_labels()).unwrap();
    assert_eq!(
        archive["labels"][0]["sources"],
        serde_json::json!(["no_fire"])
    );
}

#[test]
fn strips_keep_all_tools_in_mixed_buckets_and_disappear_after_human_review() {
    let mut labels = LabelStore::new(4);
    let archive = r#"{"format":"firecrackle-labels","version":2,"fingerprint":"fp","frame_count":4,"labels":[
      {"version":2,"frame":0,"label":"no_fire","sources":["no_fire"]},
      {"version":2,"frame":1,"label":{"fire":{"sheet":1,"row":2,"mirrored":false}},"sources":["first_person"]},
      {"version":2,"frame":2,"label":{"fire":{"sheet":1,"row":3,"mirrored":false}},"sources":["time_guess"]},
      {"version":2,"frame":3,"label":"no_fire"}]}"#;
    labels.import_json(archive, "fp").unwrap();
    let b = buckets(&labels, &[], 0, 4, 1)[0];
    assert_eq!(
        (b.auto_no_fire, b.auto_first_person, b.auto_time_guess),
        (1, 1, 1)
    );
    assert_eq!((b.no_fire, b.fire), (2, 2));
    labels.set(0, Label::NoFire).unwrap();
    assert!(labels.sources(0).contains(&LabelSource::NoFire));
    assert!(labels.sources(0).contains(&LabelSource::Manual));
    assert_eq!(buckets(&labels, &[], 0, 4, 1)[0].auto_no_fire, 0);
    labels.undo();
    assert_eq!(buckets(&labels, &[], 0, 4, 1)[0].auto_no_fire, 1);
    labels.fill_range(0, 0, Label::NoFire).unwrap();
    assert_eq!(buckets(&labels, &[], 0, 4, 1)[0].auto_no_fire, 0);
}
