use studio_core::label::*;

fn fire(sheet: u8, row: u8, mirrored: bool) -> Label {
    Label::fire(sheet, row, mirrored).unwrap()
}

// ---------------------------------------------------------------- basics

#[test]
fn new_store_is_empty() {
    let s = LabelStore::new(10);
    assert_eq!(s.frame_count(), 10);
    assert_eq!(s.labelled_count(), 0);
    assert_eq!(s.get(0), Label::Unset);
    assert_eq!(s.get(9), Label::Unset);
    assert!(s.iter().is_empty());
}

#[test]
fn set_then_get() {
    let mut s = LabelStore::new(10);
    assert_eq!(s.set(3, fire(1, 5, false)), Ok(true));
    assert_eq!(s.get(3), fire(1, 5, false));
    assert_eq!(s.labelled_count(), 1);
}

#[test]
fn set_overwrites() {
    let mut s = LabelStore::new(10);
    s.set(3, fire(1, 5, false)).unwrap();
    assert_eq!(s.set(3, fire(0, 7, true)), Ok(true));
    assert_eq!(s.get(3), fire(0, 7, true));
    assert_eq!(s.labelled_count(), 1);
}

#[test]
fn all_label_kinds_roundtrip_through_set() {
    let mut s = LabelStore::new(4);
    s.set(0, Label::NoFire).unwrap();
    s.set(1, Label::Skip).unwrap();
    s.set(2, fire(0, 31, true)).unwrap();
    assert_eq!(s.get(0), Label::NoFire);
    assert_eq!(s.get(1), Label::Skip);
    assert_eq!(s.get(2), fire(0, 31, true));
    assert_eq!(s.labelled_count(), 3);
}

#[test]
fn clear_removes_label() {
    let mut s = LabelStore::new(10);
    s.set(3, fire(1, 5, false)).unwrap();
    assert_eq!(s.clear(3), Ok(true));
    assert_eq!(s.get(3), Label::Unset);
    assert_eq!(s.labelled_count(), 0);
}

#[test]
fn setting_unset_clears() {
    let mut s = LabelStore::new(10);
    s.set(3, Label::Skip).unwrap();
    assert_eq!(s.set(3, Label::Unset), Ok(true));
    assert_eq!(s.get(3), Label::Unset);
}

#[test]
fn undo_restores_previous_label() {
    let mut s = LabelStore::new(10);
    s.set(3, fire(1, 5, false)).unwrap();
    s.set(3, fire(1, 6, false)).unwrap();
    assert!(s.undo());
    assert_eq!(s.get(3), fire(1, 5, false));
    assert!(s.undo());
    assert_eq!(s.get(3), Label::Unset);
    assert!(!s.undo(), "nothing left to undo");
}

#[test]
fn undo_of_clear_restores_label() {
    let mut s = LabelStore::new(10);
    s.set(3, fire(1, 5, false)).unwrap();
    s.clear(3).unwrap();
    assert!(s.undo());
    assert_eq!(s.get(3), fire(1, 5, false));
}

#[test]
fn undo_on_fresh_store_is_harmless() {
    let mut s = LabelStore::new(3);
    assert!(!s.undo());
    assert_eq!(s.labelled_count(), 0);
}

#[test]
fn iter_is_in_ascending_frame_order() {
    let mut s = LabelStore::new(10);
    s.set(7, Label::Skip).unwrap();
    s.set(2, Label::NoFire).unwrap();
    s.set(5, fire(1, 1, false)).unwrap();
    let frames: Vec<u32> = s.iter().into_iter().map(|(f, _)| f).collect();
    assert_eq!(frames, vec![2, 5, 7]);
}

// ------------------------------------------------------------ navigation

#[test]
fn next_unlabelled_forward_and_backward() {
    let mut s = LabelStore::new(6);
    s.set(1, Label::Skip).unwrap();
    s.set(2, fire(1, 0, false)).unwrap();
    assert_eq!(
        s.next_unlabelled(0, true),
        Some(3),
        "1 and 2 are labelled, 0 is the start"
    );
    assert_eq!(s.next_unlabelled(3, true), Some(4));
    assert_eq!(s.next_unlabelled(3, false), Some(0));
    assert_eq!(s.next_unlabelled(0, false), None);
}

#[test]
fn next_unlabelled_is_strictly_after_from() {
    let s = LabelStore::new(5);
    assert_eq!(s.next_unlabelled(2, true), Some(3));
    assert_eq!(s.next_unlabelled(2, false), Some(1));
}

#[test]
fn nofire_and_skip_count_as_labelled() {
    let mut s = LabelStore::new(4);
    s.set(1, Label::NoFire).unwrap();
    s.set(2, Label::Skip).unwrap();
    assert_eq!(s.next_unlabelled(0, true), Some(3));
}

#[test]
fn next_unlabelled_none_when_all_done_or_at_end() {
    let mut s = LabelStore::new(3);
    for f in 0..3 {
        s.set(f, Label::Skip).unwrap();
    }
    assert_eq!(s.next_unlabelled(0, true), None);
    let s2 = LabelStore::new(3);
    assert_eq!(
        s2.next_unlabelled(2, true),
        None,
        "nothing after the last frame"
    );
}

#[test]
fn clamp_frame_clamps_both_ends() {
    assert_eq!(clamp_frame(5, 10), Some(5));
    assert_eq!(clamp_frame(-3, 10), Some(0));
    assert_eq!(clamp_frame(10, 10), Some(9));
    assert_eq!(clamp_frame(i64::MAX, 10), Some(9));
    assert_eq!(clamp_frame(i64::MIN, 10), Some(0));
    assert_eq!(clamp_frame(0, 0), None);
}

// ----------------------------------------------------------- range fill

#[test]
fn fill_range_labels_the_inclusive_range() {
    let mut s = LabelStore::new(10);
    assert_eq!(s.fill_range(2, 5, fire(1, 4, false)), Ok(4));
    for f in 2..=5 {
        assert_eq!(s.get(f), fire(1, 4, false));
    }
    assert_eq!(s.get(1), Label::Unset);
    assert_eq!(s.get(6), Label::Unset);
}

#[test]
fn fill_range_of_one_frame_and_of_the_whole_store() {
    let mut s = LabelStore::new(5);
    assert_eq!(s.fill_range(3, 3, Label::Skip), Ok(1));
    assert_eq!(s.get(3), Label::Skip);
    assert_eq!(s.fill_range(0, 4, Label::NoFire), Ok(5));
    assert_eq!(s.labelled_count(), 5);
}

#[test]
fn fill_range_is_one_undo_step() {
    let mut s = LabelStore::new(10);
    s.fill_range(0, 6, fire(1, 4, false)).unwrap();
    assert!(s.undo());
    assert_eq!(s.labelled_count(), 0);
    assert!(!s.undo());
}

#[test]
fn fill_range_counts_only_changed_frames_and_undo_restores_each_previous_label() {
    let mut s = LabelStore::new(6);
    s.set(1, fire(1, 4, false)).unwrap(); // already what we will fill
    s.set(2, Label::Skip).unwrap(); // will be overwritten
    assert_eq!(
        s.fill_range(0, 3, fire(1, 4, false)),
        Ok(3),
        "frame 1 already had it"
    );
    assert!(s.undo());
    assert_eq!(s.get(0), Label::Unset);
    assert_eq!(
        s.get(1),
        fire(1, 4, false),
        "restored to its earlier label, not Unset"
    );
    assert_eq!(s.get(2), Label::Skip);
    assert_eq!(s.get(3), Label::Unset);
}

#[test]
fn fill_range_that_changes_nothing_leaves_no_undo_entry() {
    let mut s = LabelStore::new(4);
    s.set(0, Label::Skip).unwrap();
    s.fill_range(1, 2, Label::NoFire).unwrap();
    assert_eq!(s.fill_range(1, 2, Label::NoFire), Ok(0));
    assert!(s.undo());
    assert_eq!(
        s.get(1),
        Label::Unset,
        "undo reverted the real fill, not the no-op"
    );
    assert_eq!(s.get(0), Label::Skip);
}

#[test]
fn fill_range_with_unset_clears_the_range() {
    let mut s = LabelStore::new(6);
    s.fill_range(0, 5, Label::Skip).unwrap();
    assert_eq!(s.fill_range(1, 3, Label::Unset), Ok(3));
    assert_eq!(s.get(0), Label::Skip);
    assert_eq!(s.get(2), Label::Unset);
    assert_eq!(s.labelled_count(), 3);
    assert!(s.undo());
    assert_eq!(s.get(2), Label::Skip);
}

#[test]
fn fill_range_rejects_bad_input_without_changing_anything() {
    let mut s = LabelStore::new(5);
    assert_eq!(
        s.fill_range(3, 1, Label::Skip),
        Err(LabelError::BadRange { start: 3, end: 1 })
    );
    assert_eq!(
        s.fill_range(2, 5, Label::Skip),
        Err(LabelError::FrameOutOfRange { frame: 5, count: 5 })
    );
    assert_eq!(
        s.fill_range(7, 9, Label::Skip),
        Err(LabelError::FrameOutOfRange { frame: 9, count: 5 })
    );
    assert!(s
        .fill_range(
            0,
            2,
            Label::Fire {
                sheet: 2,
                row: 0,
                mirrored: false
            }
        )
        .is_err());
    assert!(s
        .fill_range(
            0,
            2,
            Label::Fire {
                sheet: 0,
                row: 32,
                mirrored: false
            }
        )
        .is_err());
    assert_eq!(s.labelled_count(), 0);
    assert!(!s.undo(), "failed fills leave no undo entry");
}

#[test]
fn fill_range_on_an_empty_store_is_an_error_not_a_panic() {
    let mut s = LabelStore::new(0);
    assert!(s.fill_range(0, 0, Label::Skip).is_err());
}

// ---------------------------------------------------------- bad input

#[test]
fn invalid_labels_are_rejected() {
    assert_eq!(Label::fire(2, 0, false), Err(LabelError::InvalidSheet(2)));
    assert_eq!(Label::fire(0, 32, false), Err(LabelError::InvalidRow(32)));
    assert!(Label::fire(1, 31, true).is_ok());
    assert!(Label::fire(0, 0, false).is_ok());
    assert!(Label::Skip.validate().is_ok());
    assert_eq!(
        Label::Fire {
            sheet: 9,
            row: 0,
            mirrored: false
        }
        .validate(),
        Err(LabelError::InvalidSheet(9))
    );
}

#[test]
fn set_rejects_invalid_label_and_out_of_range_frame_without_side_effects() {
    let mut s = LabelStore::new(5);
    assert_eq!(
        s.set(
            0,
            Label::Fire {
                sheet: 0,
                row: 40,
                mirrored: false
            }
        ),
        Err(LabelError::InvalidRow(40))
    );
    assert_eq!(
        s.set(5, Label::Skip),
        Err(LabelError::FrameOutOfRange { frame: 5, count: 5 })
    );
    assert_eq!(
        s.clear(99),
        Err(LabelError::FrameOutOfRange {
            frame: 99,
            count: 5
        })
    );
    assert_eq!(s.labelled_count(), 0);
    assert!(!s.undo());
}

#[test]
fn setting_the_same_label_is_a_noop_with_no_undo_entry() {
    let mut s = LabelStore::new(5);
    s.set(1, Label::Skip).unwrap();
    s.set(2, Label::NoFire).unwrap();
    assert_eq!(s.set(2, Label::NoFire), Ok(false));
    assert_eq!(
        s.clear(4),
        Ok(false),
        "clearing an unlabelled frame changes nothing"
    );
    assert!(s.undo());
    assert_eq!(
        s.get(2),
        Label::Unset,
        "undo reverted the real change, not the no-op"
    );
    assert_eq!(s.get(1), Label::Skip);
}

#[test]
fn zero_frame_store_is_safe() {
    let mut s = LabelStore::new(0);
    assert_eq!(
        s.set(0, Label::Skip),
        Err(LabelError::FrameOutOfRange { frame: 0, count: 0 })
    );
    assert_eq!(s.next_unlabelled(0, true), None);
    assert_eq!(s.get(0), Label::Unset);
}

// ---------------------------------------------------------- persistence

#[test]
fn log_line_format_is_stable() {
    assert_eq!(
        log_line(3, fire(1, 5, false)),
        r#"{"version":2,"frame":3,"label":{"fire":{"sheet":1,"row":5,"mirrored":false}}}"#
    );
    assert_eq!(
        log_line(0, Label::NoFire),
        r#"{"version":2,"frame":0,"label":"no_fire"}"#
    );
    assert_eq!(
        log_line(9, Label::Skip),
        r#"{"version":2,"frame":9,"label":"skip"}"#
    );
    assert_eq!(
        log_line(9, Label::Unset),
        r#"{"version":2,"frame":9,"label":"unset"}"#
    );
}

#[test]
fn v1_entries_migrate_once_and_v2_entries_keep_animation_indices() {
    let legacy = r#"{"frame":0,"label":{"fire":{"sheet":0,"row":16,"mirrored":true}}}"#;
    let first = LabelStore::replay(legacy, 4).unwrap();
    assert_eq!(first.store.get(0), fire(0, 0, true));
    let rewritten = log_line(0, first.store.get(0));
    let reopened = LabelStore::replay(&rewritten, 4).unwrap();
    assert_eq!(reopened.store.get(0), fire(0, 0, true));
    let mixed = format!("{legacy}\n{}", log_line(0, fire(0, 5, false)));
    assert_eq!(
        LabelStore::replay(&mixed, 4).unwrap().store.get(0),
        fire(0, 5, false)
    );
}

#[test]
fn future_log_versions_are_rejected_without_treating_them_as_a_torn_tail() {
    let text = r#"{"version":999,"frame":0,"label":"skip"}"#;
    assert!(matches!(
        LabelStore::replay(text, 4),
        Err(LabelError::Parse { .. })
    ));
}

#[test]
fn replay_roundtrips_a_log() {
    let log = [
        log_line(0, fire(1, 5, false)),
        log_line(4, Label::NoFire),
        log_line(2, fire(0, 31, true)),
    ]
    .join("\n")
        + "\n";
    let r = LabelStore::replay(&log, 10).unwrap();
    assert!(!r.torn_tail);
    assert_eq!(r.store.get(0), fire(1, 5, false));
    assert_eq!(r.store.get(2), fire(0, 31, true));
    assert_eq!(r.store.get(4), Label::NoFire);
    assert_eq!(r.store.labelled_count(), 3);
}

#[test]
fn replay_last_write_wins_and_unset_clears() {
    let log = [
        log_line(1, fire(1, 1, false)),
        log_line(1, fire(1, 2, false)),
        log_line(2, Label::Skip),
        log_line(2, Label::Unset),
    ]
    .join("\n");
    let r = LabelStore::replay(&log, 5).unwrap();
    assert_eq!(r.store.get(1), fire(1, 2, false));
    assert_eq!(r.store.get(2), Label::Unset);
}

#[test]
fn replay_has_no_undo_history() {
    let r = LabelStore::replay(&log_line(1, Label::Skip), 5).unwrap();
    let mut s = r.store;
    assert!(!s.undo(), "undo does not reach back across a restart");
    assert_eq!(s.get(1), Label::Skip);
}

#[test]
fn replay_tolerates_blank_lines_and_crlf() {
    let log = format!(
        "{}\r\n\r\n{}\r\n",
        log_line(0, Label::Skip),
        log_line(1, Label::NoFire)
    );
    let r = LabelStore::replay(&log, 3).unwrap();
    assert_eq!(r.store.labelled_count(), 2);
    assert!(!r.torn_tail);
}

#[test]
fn replay_empty_text_is_an_empty_store() {
    let r = LabelStore::replay("", 3).unwrap();
    assert_eq!(r.store.labelled_count(), 0);
    assert!(!r.torn_tail);
}

#[test]
fn replay_drops_a_torn_last_line() {
    let log = format!(
        "{}\n{}",
        log_line(0, Label::Skip),
        r#"{"frame":1,"label":{"fire":{"sheet":1,"ro"#
    );
    let r = LabelStore::replay(&log, 3).unwrap();
    assert!(r.torn_tail);
    assert_eq!(r.store.get(0), Label::Skip);
    assert_eq!(r.store.get(1), Label::Unset);
}

#[test]
fn replay_torn_tail_also_when_newline_terminated_garbage_is_last() {
    let log = format!("{}\n{{\"frame\":1,\"la\n", log_line(0, Label::Skip));
    let r = LabelStore::replay(&log, 3).unwrap();
    assert!(r.torn_tail);
    assert_eq!(r.store.labelled_count(), 1);
}

#[test]
fn replay_corrupt_middle_line_is_an_error_with_its_line_number() {
    let log = format!(
        "{}\nnot json\n{}\n",
        log_line(0, Label::Skip),
        log_line(1, Label::Skip)
    );
    match LabelStore::replay(&log, 3) {
        Err(LabelError::Parse { line, .. }) => assert_eq!(line, 2),
        other => panic!("expected Parse error on line 2, got {other:?}"),
    }
}

#[test]
fn replay_rejects_frames_beyond_the_video() {
    let log = log_line(7, Label::Skip);
    assert_eq!(
        LabelStore::replay(&log, 5).unwrap_err(),
        LabelError::FrameOutOfRange { frame: 7, count: 5 }
    );
}

#[test]
fn replay_rejects_invalid_labels() {
    let log = r#"{"frame":0,"label":{"fire":{"sheet":3,"row":0,"mirrored":false}}}"#;
    assert_eq!(
        LabelStore::replay(log, 5).unwrap_err(),
        LabelError::InvalidSheet(3)
    );
}

// ------------------------------------------------------------ undo_step

#[test]
fn undo_step_returns_the_frames_it_restored() {
    let mut s = LabelStore::new(10);
    s.set(3, fire(1, 5, false)).unwrap();
    assert_eq!(s.undo_step(), Some(vec![3]));
    assert_eq!(s.get(3), Label::Unset);
    assert_eq!(s.undo_step(), None, "nothing left to undo");
}

#[test]
fn undo_step_after_a_range_fill_lists_only_the_changed_frames_ascending() {
    let mut s = LabelStore::new(10);
    s.set(4, Label::Skip).unwrap();
    s.fill_range(2, 6, Label::Skip).unwrap(); // frame 4 already had it
    assert_eq!(s.undo_step(), Some(vec![2, 3, 5, 6]));
    assert_eq!(
        s.get(4),
        Label::Skip,
        "the earlier label of frame 4 is untouched"
    );
    assert_eq!(s.undo_step(), Some(vec![4]));
}

#[test]
fn undo_and_undo_step_agree() {
    let mut a = LabelStore::new(5);
    let mut b = LabelStore::new(5);
    for s in [&mut a, &mut b] {
        s.set(1, Label::Skip).unwrap();
        s.set(1, Label::NoFire).unwrap();
        s.fill_range(0, 3, Label::Skip).unwrap();
    }
    for _ in 0..4 {
        let ok = a.undo();
        let step = b.undo_step();
        assert_eq!(ok, step.is_some());
        assert_eq!(a.iter(), b.iter());
    }
}

#[test]
fn redo_reapplies_what_undo_took_back_in_order() {
    let mut s = LabelStore::new(10);
    s.set(3, fire(1, 5, false)).unwrap();
    s.set(3, fire(1, 6, false)).unwrap();
    assert!(s.undo() && s.undo());
    assert_eq!((s.undo_depth(), s.redo_depth()), (0, 2));
    assert_eq!(s.redo_step(), Some(vec![3]));
    assert_eq!(s.get(3), fire(1, 5, false));
    assert!(s.redo());
    assert_eq!(s.get(3), fire(1, 6, false));
    assert!(!s.redo(), "nothing left to redo");
    assert_eq!((s.undo_depth(), s.redo_depth()), (2, 0));
    assert!(s.undo());
    assert_eq!(
        s.get(3),
        fire(1, 5, false),
        "a redone change is undoable again"
    );
}

#[test]
fn redo_of_a_range_fill_is_one_step_with_its_sources() {
    let mut s = LabelStore::new(10);
    s.set(2, Label::Skip).unwrap();
    s.fill_range(0, 6, fire(1, 4, false)).unwrap();
    let filled: Vec<_> = (0..7).map(|f| (s.get(f), s.sources(f))).collect();
    assert!(s.undo());
    assert_eq!(s.get(2), Label::Skip);
    assert_eq!(s.redo_step(), Some((0..7).collect()));
    assert_eq!(
        (0..7).map(|f| (s.get(f), s.sources(f))).collect::<Vec<_>>(),
        filled
    );
}

#[test]
fn a_new_change_after_an_undo_drops_what_could_be_redone() {
    let mut s = LabelStore::new(10);
    s.set(3, fire(1, 5, false)).unwrap();
    assert!(s.undo());
    s.set(4, Label::Skip).unwrap();
    assert_eq!(s.redo_depth(), 0);
    assert!(!s.redo());
    assert_eq!(s.get(3), Label::Unset);
    // a write that changes nothing is not a new change
    s.set(5, Label::Skip).unwrap();
    assert!(s.undo());
    s.set(4, Label::Skip).unwrap();
    assert_eq!(s.redo_depth(), 1);
}

#[test]
fn redo_on_a_fresh_store_is_harmless() {
    let mut s = LabelStore::new(3);
    assert!(!s.redo());
    assert_eq!(s.redo_step(), None);
}
