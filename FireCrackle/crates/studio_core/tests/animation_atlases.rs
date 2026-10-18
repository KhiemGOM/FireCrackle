use studio_core::{
    config::{IndexConfig, Settings},
    index::{build_index, Packet},
    label::{AnimationAtlas, Label, LabelStore},
    project::{Project, VideoMeta},
    session::Session,
};

fn project() -> Project {
    let frames: Vec<_> = (0..90)
        .map(|i| Packet {
            pts: Some(i as f64 / 60.),
            dts: None,
            key: i == 0,
        })
        .collect();
    let index = build_index(&frames, &IndexConfig::default()).unwrap();
    Project::assemble(
        "v.mkv",
        1,
        "test".into(),
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
#[test]
fn soul_fire_and_fire_share_identical_phase_evidence() {
    let mut fire = LabelStore::new(90);
    let mut mixed = LabelStore::new(90);
    for frame in (0..90).step_by(3) {
        let row = (frame / 3) as u8;
        fire.set(
            frame,
            Label::Fire {
                sheet: 1,
                row,
                mirrored: false,
            },
        )
        .unwrap();
        mixed
            .set(
                frame,
                Label::Texture {
                    atlas: if frame % 2 == 0 {
                        AnimationAtlas::SoulFire0
                    } else {
                        AnimationAtlas::SoulFire1
                    },
                    row,
                    mirrored: false,
                },
            )
            .unwrap();
    }
    let mut a = Session::new(project(), fire, Settings::default()).unwrap();
    let mut b = Session::new(project(), mixed, Settings::default()).unwrap();
    assert_eq!(a.analysis().points, b.analysis().points);
    assert_eq!(a.analysis().flags, b.analysis().flags);
    assert!(matches!(
        b.store().get(0),
        Label::Texture {
            atlas: AnimationAtlas::SoulFire0,
            ..
        }
    ));
}
#[test]
fn fluid_labels_persist_but_never_enter_the_fire_phase() {
    let mut store = LabelStore::new(90);
    let label = Label::Texture {
        atlas: AnimationAtlas::LavaStill,
        row: 5,
        mirrored: true,
    };
    store.set(0, label).unwrap();
    let encoded = serde_json::to_string(&label).unwrap();
    assert_eq!(serde_json::from_str::<Label>(&encoded).unwrap(), label);
    assert!(!label.is_fire());
    let mut s = Session::new(project(), store, Settings::default()).unwrap();
    assert!(s.analysis().points.is_empty());
    assert!(Label::Texture {
        atlas: AnimationAtlas::LavaFlow,
        row: 16,
        mirrored: false
    }
    .validate()
    .is_err());
    assert!(Label::Texture {
        atlas: AnimationAtlas::LavaStill,
        row: 20,
        mirrored: false
    }
    .validate()
    .is_err());
}
