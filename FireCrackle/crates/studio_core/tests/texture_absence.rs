use studio_core::{
    label::{AnimationAtlas, Label, LabelStore},
    lane,
};

#[test]
fn texture_absence_roundtrips_without_becoming_fire_or_no_fire() {
    let mut store = LabelStore::new(10);
    let label = Label::NoTexture {
        atlas: AnimationAtlas::WaterStill,
    };
    store.set(2, label).unwrap();
    assert!(!label.is_fire());
    assert_eq!(label.canonical_fire(), None);
    let json = store.export_json("clip");
    let mut restored = LabelStore::new(10);
    restored.import_json(&json, "clip").unwrap();
    assert_eq!(restored.get(2), label);
    assert_eq!(restored.sources(2), store.sources(2));
    let buckets = lane::buckets(&restored, &[], 0, 10, 1);
    assert_eq!(buckets[0].no_texture, 1);
    assert_eq!(buckets[0].no_fire, 0);
    assert_eq!(buckets[0].fire, 0);
    assert_eq!(buckets[0].unset, 9);
    restored.undo();
    assert_eq!(restored.get(2), Label::Unset);
}
