use studio_core::config::{IndexConfig, Settings};
use studio_core::index::{build_index, Packet};
use studio_core::label::{log_line, Label, LabelError, LabelStore};
use studio_core::phase::FlagKind;
use studio_core::project::{Project, VideoMeta};
use studio_core::session::*;

// ------------------------------------------------------------ helpers

fn project(n: usize, fps: f64) -> Project {
    let pk: Vec<Packet> = (0..n)
        .map(|i| Packet {
            pts: Some(i as f64 / fps),
            dts: None,
            key: i == 0,
        })
        .collect();
    let idx = build_index(&pk, &IndexConfig::default()).unwrap();
    let meta = VideoMeta {
        width: 1920,
        height: 1080,
        fps_num: fps as u32,
        fps_den: 1,
        codec: "h264".into(),
    };
    Project::assemble("v.mkv", 1, "1:4096:0".into(), meta, &idx)
}

fn session_with(n: usize, fps: f64, mut settings: Settings) -> Session {
    // These original ideal-clock fixtures assume exact capture, not half-frame sampling uncertainty.
    settings.label.suggest_capture_frames = 0.0;
    Session::new(project(n, fps), LabelStore::new(n as u32), settings).unwrap()
}

fn session(n: usize) -> Session {
    session_with(n, 20.0, Settings::default())
}

fn fire(sheet: u8, row: u8, mirrored: bool) -> Label {
    Label::Fire {
        sheet,
        row,
        mirrored,
    }
}

// ================================================================ RowTyper

#[test]
fn digits_that_cannot_start_a_two_digit_row_commit_at_once() {
    for d in 4..=9u8 {
        let mut t = RowTyper::new();
        assert_eq!(t.push(d), TyperResult::Commit(d));
        assert_eq!(t.pending(), None);
    }
}

#[test]
fn digits_zero_to_three_wait_for_a_second_digit() {
    for d in 0..=3u8 {
        let mut t = RowTyper::new();
        assert_eq!(t.push(d), TyperResult::Pending(d));
        assert_eq!(t.pending(), Some(d));
    }
}

#[test]
fn two_digits_make_a_row_up_to_31() {
    let mut t = RowTyper::new();
    t.push(1);
    assert_eq!(t.push(2), TyperResult::Commit(12));
    t.push(3);
    assert_eq!(t.push(1), TyperResult::Commit(31));
    t.push(0);
    assert_eq!(t.push(5), TyperResult::Commit(5), "05 is row 5");
    t.push(2);
    assert_eq!(t.push(9), TyperResult::Commit(29));
    assert_eq!(t.pending(), None);
}

#[test]
fn a_row_above_31_is_rejected_and_clears_the_buffer() {
    let mut t = RowTyper::new();
    t.push(3);
    assert_eq!(t.push(2), TyperResult::Rejected);
    assert_eq!(t.pending(), None);
    assert_eq!(
        t.push(1),
        TyperResult::Pending(1),
        "a fresh start afterwards"
    );
}

#[test]
fn flush_commits_a_pending_digit_and_is_harmless_when_empty() {
    let mut t = RowTyper::new();
    assert_eq!(t.flush(), None);
    t.push(1);
    assert_eq!(t.flush(), Some(1));
    assert_eq!(t.pending(), None);
    assert_eq!(t.flush(), None);
    t.push(0);
    assert_eq!(t.flush(), Some(0), "row 0");
}

#[test]
fn clear_and_non_digits() {
    let mut t = RowTyper::new();
    t.push(2);
    t.clear();
    assert_eq!(t.pending(), None);
    t.push(1);
    assert_eq!(t.push(10), TyperResult::Rejected, "not a digit");
    assert_eq!(t.pending(), None, "and it cancels what was pending");
}

// ============================================================== creation

#[test]
fn a_session_starts_on_the_first_unlabelled_frame() {
    let p = project(10, 20.0);
    let mut store = LabelStore::new(10);
    store.set(0, Label::Skip).unwrap();
    store.set(1, Label::NoFire).unwrap();
    let s = Session::new(p, store, Settings::default()).unwrap();
    assert_eq!(s.current(), 2);
}

#[test]
fn a_fully_labelled_or_fresh_session_starts_at_the_beginning() {
    assert_eq!(session(10).current(), 0);
    let mut store = LabelStore::new(3);
    store.fill_range(0, 2, Label::Skip).unwrap();
    assert_eq!(
        Session::new(project(3, 20.0), store, Settings::default())
            .unwrap()
            .current(),
        0
    );
}

#[test]
fn a_store_that_does_not_match_the_project_is_refused() {
    let r = Session::new(project(10, 20.0), LabelStore::new(9), Settings::default());
    assert!(matches!(
        r,
        Err(SessionError::FrameCountMismatch {
            project: 10,
            store: 9
        })
    ));
}

// ============================================================ navigation

#[test]
fn moving_by_frames_clamps_at_both_ends() {
    let mut s = session(10);
    assert_eq!(s.go(Move::Frames(3)), 3);
    assert_eq!(s.go(Move::Frames(-1)), 2);
    assert_eq!(s.go(Move::Frames(-50)), 0);
    assert_eq!(s.go(Move::Frames(50)), 9);
    assert_eq!(s.go(Move::Frames(i64::MAX)), 9);
    assert_eq!(s.go(Move::Frames(i64::MIN)), 0);
}

#[test]
fn to_home_and_end() {
    let mut s = session(10);
    assert_eq!(s.go(Move::To(4)), 4);
    assert_eq!(s.go(Move::To(99)), 9, "clamped");
    assert_eq!(s.go(Move::Home), 0);
    assert_eq!(s.go(Move::End), 9);
    assert_eq!(s.current(), 9);
}

#[test]
fn next_and_previous_unlabelled_skip_labelled_frames() {
    let mut s = session(10);
    s.go(Move::To(3));
    s.fill_range(4, 6, Label::Skip).unwrap();
    s.set_pick(1, false);
    assert_eq!(s.go(Move::NextUnlabelled), 7);
    assert_eq!(s.go(Move::PrevUnlabelled), 3);
    assert_eq!(s.go(Move::PrevUnlabelled), 2);
}

#[test]
fn no_unlabelled_frame_in_that_direction_means_stay() {
    let mut s = session(5);
    s.fill_range(0, 4, Label::Skip).unwrap();
    s.go(Move::To(2));
    assert_eq!(s.go(Move::NextUnlabelled), 2);
    assert_eq!(s.go(Move::PrevUnlabelled), 2);
}

#[test]
fn a_one_frame_video_is_safe() {
    let mut s = session(1);
    assert_eq!(s.go(Move::Frames(5)), 0);
    assert_eq!(s.go(Move::NextUnlabelled), 0);
    let a = s.pick_row(3).unwrap();
    assert_eq!((a.frame, a.now_at), (0, 0));
    assert!(s.suggestion().is_none());
}

// ============================================================== labelling

#[test]
fn a_label_is_set_on_the_current_frame_and_the_playhead_advances() {
    let mut s = session(10);
    s.go(Move::To(5));
    let a = s.pick_row(7).unwrap();
    assert_eq!(
        a,
        Applied {
            frame: 5,
            now_at: 6
        }
    );
    assert_eq!(
        s.store().get(5),
        fire(1, 7, false),
        "default pick: sheet 1, normal"
    );
    assert_eq!(s.current(), 6);
}

#[test]
fn the_playhead_stays_on_the_last_frame() {
    let mut s = session(10);
    s.go(Move::End);
    let a = s.pick_row(7).unwrap();
    assert_eq!((a.frame, a.now_at), (9, 9));
}

#[test]
fn advance_frames_is_configurable_including_zero() {
    let mut st = Settings::default();
    st.label.advance_frames = 0;
    let mut s = session_with(20, 20.0, st);
    s.go(Move::To(5));
    assert_eq!(s.pick_row(1).unwrap().now_at, 5);
    st.label.advance_frames = 3;
    s.set_settings(st);
    assert_eq!(s.pick_row(2).unwrap().now_at, 8);
    st.label.advance_frames = 1000;
    s.set_settings(st);
    assert_eq!(s.pick_row(3).unwrap().now_at, 19, "clamped");
}

#[test]
fn advance_to_unlabelled_skips_what_is_already_done() {
    let mut st = Settings::default();
    st.label.advance_to_unlabelled = true;
    let mut s = session_with(12, 20.0, st);
    s.fill_range(6, 7, Label::Skip).unwrap();
    s.go(Move::To(5));
    assert_eq!(s.pick_row(1).unwrap().now_at, 8);
    s.go(Move::To(11));
    assert_eq!(
        s.pick_row(1).unwrap().now_at,
        11,
        "nothing unlabelled after: stay"
    );
}

#[test]
fn clearing_a_label_does_not_advance() {
    let mut s = session(10);
    s.go(Move::To(4));
    s.pick_row(2).unwrap(); // now at 5
    s.go(Move::To(4));
    let a = s.apply(Label::Unset).unwrap();
    assert_eq!((a.frame, a.now_at), (4, 4));
    assert_eq!(s.store().get(4), Label::Unset);
}

#[test]
fn no_fire_and_skip_advance_like_a_fire_label() {
    let mut s = session(10);
    assert_eq!(
        s.apply(Label::NoFire).unwrap(),
        Applied {
            frame: 0,
            now_at: 1
        }
    );
    assert_eq!(
        s.apply(Label::Skip).unwrap(),
        Applied {
            frame: 1,
            now_at: 2
        }
    );
    assert_eq!(
        (s.store().get(0), s.store().get(1)),
        (Label::NoFire, Label::Skip)
    );
}

#[test]
fn the_pick_state_chooses_sheet_and_mirror_for_typed_rows() {
    let mut s = session(10);
    assert_eq!(
        s.pick(),
        PickState {
            sheet: 1,
            mirrored: false
        }
    );
    s.toggle_sheet();
    assert_eq!(s.pick().sheet, 0);
    s.toggle_sheet();
    assert_eq!(s.pick().sheet, 1);
    s.toggle_mirror();
    assert!(s.pick().mirrored);
    s.pick_row(9).unwrap();
    assert_eq!(s.store().get(0), fire(1, 9, true));
    s.set_pick(0, false);
    s.pick_row(4).unwrap();
    assert_eq!(s.store().get(1), fire(0, 4, false));
}

#[test]
fn clicking_a_cell_sets_the_pick_and_the_label() {
    let mut s = session(10);
    let a = s.click_cell(0, 7, true).unwrap();
    assert_eq!(
        a,
        Applied {
            frame: 0,
            now_at: 1
        }
    );
    assert_eq!(s.store().get(0), fire(0, 7, true));
    assert_eq!(
        s.pick(),
        PickState {
            sheet: 0,
            mirrored: true
        }
    );
}

#[test]
fn an_invalid_row_or_sheet_changes_nothing() {
    let mut s = session(10);
    assert_eq!(
        s.pick_row(32).unwrap_err(),
        SessionError::Label(LabelError::InvalidRow(32))
    );
    assert_eq!(
        s.click_cell(2, 0, false).unwrap_err(),
        SessionError::Label(LabelError::InvalidSheet(2))
    );
    assert_eq!(s.current(), 0);
    assert_eq!(s.store().labelled_count(), 0);
    assert!(s.take_log().is_empty());
    assert!(!s.undo());
}

// ================================================================ typing

#[test]
fn typing_two_digits_labels_the_frame() {
    let mut s = session(10);
    assert_eq!(s.type_digit(1).unwrap(), TypeOutcome::Pending(1));
    assert_eq!(
        s.store().labelled_count(),
        0,
        "nothing is labelled until the row is complete"
    );
    match s.type_digit(2).unwrap() {
        TypeOutcome::Committed(a) => assert_eq!(
            a,
            Applied {
                frame: 0,
                now_at: 1
            }
        ),
        other => panic!("{other:?}"),
    }
    assert_eq!(s.store().get(0), fire(1, 12, false));
}

#[test]
fn a_digit_from_four_up_labels_immediately() {
    let mut s = session(10);
    assert!(matches!(
        s.type_digit(5).unwrap(),
        TypeOutcome::Committed(_)
    ));
    assert_eq!(s.store().get(0), fire(1, 5, false));
}

#[test]
fn typed_indices_are_identical_on_both_sheets() {
    let mut s = session(10);
    s.toggle_sheet(); // sheet 0
    s.type_digit(0).unwrap();
    s.flush_typed().unwrap();
    assert_eq!(s.store().get(0), fire(0, 0, false));
    s.type_digit(5).unwrap();
    assert_eq!(s.store().get(1), fire(0, 5, false));
    s.type_digit(3).unwrap();
    s.type_digit(1).unwrap();
    assert_eq!(s.store().get(2), fire(0, 31, false));
    s.toggle_sheet(); // sheet 1
    s.type_digit(0).unwrap();
    s.flush_typed().unwrap();
    assert_eq!(s.store().get(3), fire(1, 0, false));
}

#[test]
fn flushing_commits_a_pending_digit_and_cancelling_drops_it() {
    let mut s = session(10);
    s.type_digit(2).unwrap();
    let a = s.flush_typed().unwrap().unwrap();
    assert_eq!(a.frame, 0);
    assert_eq!(s.store().get(0), fire(1, 2, false));
    s.type_digit(3).unwrap();
    s.cancel_typed();
    assert_eq!(s.flush_typed().unwrap(), None);
    assert_eq!(s.store().get(1), Label::Unset);
}

#[test]
fn a_rejected_row_leaves_the_buffer_fresh() {
    let mut s = session(10);
    s.type_digit(3).unwrap();
    assert_eq!(s.type_digit(2).unwrap(), TypeOutcome::Rejected);
    assert_eq!(s.type_digit(1).unwrap(), TypeOutcome::Pending(1));
    assert_eq!(
        s.type_digit(12).unwrap(),
        TypeOutcome::Rejected,
        "not a digit"
    );
}

#[test]
fn moving_the_playhead_cancels_a_half_typed_row() {
    let mut s = session(10);
    s.type_digit(1).unwrap();
    s.go(Move::Frames(1));
    assert_eq!(s.flush_typed().unwrap(), None);
    assert_eq!(s.store().labelled_count(), 0);
}

// ============================================================ suggestions

#[test]
fn nothing_is_suggested_without_a_labelled_fire_frame() {
    let mut s = session(10);
    assert!(s.suggestion().is_none());
    s.apply(Label::NoFire).unwrap();
    s.apply(Label::Skip).unwrap();
    assert!(
        s.suggestion().is_none(),
        "no-fire and skip frames carry no sprite"
    );
    assert!(matches!(
        s.accept_suggestion(),
        Err(SessionError::NoSuggestion)
    ));
}

#[test]
fn a_whole_number_of_ticks_gives_one_certain_row() {
    // 20 fps = one tick per frame: frame 3 is exactly 3 ticks after frame 0
    let mut s = session(100);
    s.click_cell(1, 5, true).unwrap();
    s.go(Move::To(3));
    assert_eq!(
        s.suggestion(),
        Some(Suggestion {
            sheet: 1,
            mirrored: true,
            row: 8,
            alt_row: None,
            from_frame: 0
        })
    );
}

#[test]
fn a_fraction_of_a_tick_suggests_the_likelier_row_and_offers_the_other() {
    // 60 fps: 1/3 tick per frame, so the sprite has advanced 0 or 1 ticks (E7: 1 with probability frac(x))
    let mut s = session_with(100, 60.0, Settings::default());
    s.click_cell(1, 5, false).unwrap();
    s.go(Move::To(1)); // x = 0.33: 0 more likely
    let a = s.suggestion().unwrap();
    assert_eq!((a.row, a.alt_row), (5, Some(6)));
    s.go(Move::To(2)); // x = 0.67: 1 more likely
    let b = s.suggestion().unwrap();
    assert_eq!((b.row, b.alt_row), (6, Some(5)));
    s.go(Move::To(3)); // x = 1.0: certain
    let c = s.suggestion().unwrap();
    assert_eq!((c.row, c.alt_row), (6, None));
}

#[test]
fn a_half_tick_rounds_up_and_still_offers_the_other_row() {
    let mut s = session_with(100, 40.0, Settings::default());
    s.click_cell(1, 5, false).unwrap();
    s.go(Move::To(1)); // x = 0.5
    let a = s.suggestion().unwrap();
    assert_eq!((a.row, a.alt_row), (6, Some(5)));
}

#[test]
fn the_suggested_row_wraps_around_32() {
    let mut s = session_with(100, 60.0, Settings::default());
    s.click_cell(0, 31, false).unwrap();
    s.go(Move::To(6)); // exactly 2 ticks
    let a = s.suggestion().unwrap();
    assert_eq!((a.sheet, a.row, a.alt_row), (0, 1, None));
}

#[test]
fn a_label_after_the_playhead_also_gives_a_suggestion_looking_backwards() {
    let mut s = session(100);
    s.go(Move::To(10));
    s.click_cell(1, 20, false).unwrap();
    s.go(Move::To(7)); // 3 ticks earlier
    let a = s.suggestion().unwrap();
    assert_eq!((a.row, a.alt_row, a.from_frame), (17, None, 10));
    // a fractional step backwards: 60 fps, label on frame 3, look at frame 2
    let mut t = session_with(100, 60.0, Settings::default());
    t.go(Move::To(3));
    t.click_cell(1, 10, false).unwrap();
    t.go(Move::To(2));
    let b = t.suggestion().unwrap();
    assert_eq!(
        (b.row, b.alt_row),
        (10, Some(9)),
        "0 ticks earlier is the likelier"
    );
}

#[test]
fn the_nearest_labelled_fire_frame_is_the_source_and_ties_go_to_the_earlier_one() {
    let mut s = session(100);
    s.click_cell(1, 5, false).unwrap(); // frame 0
    s.go(Move::To(20));
    s.click_cell(1, 25, false).unwrap();
    s.go(Move::To(12)); // 8 from frame 20, 12 from frame 0
    let near = s.suggestion().unwrap();
    assert_eq!((near.from_frame, near.row), (20, 17));
    s.go(Move::To(10)); // 10 from both: the earlier wins
    let tie = s.suggestion().unwrap();
    assert_eq!((tie.from_frame, tie.row), (0, 15));
}

#[test]
fn the_labelled_frame_itself_is_not_its_own_source() {
    let mut s = session(100);
    s.click_cell(1, 5, false).unwrap();
    s.go(Move::To(0));
    assert!(s.suggestion().is_none());
}

#[test]
fn no_suggestion_beyond_suggest_max_seconds() {
    let mut s = session(1000);
    s.click_cell(1, 5, false).unwrap();
    s.go(Move::To(600)); // exactly 30 s at 20 fps: allowed
    assert!(s.suggestion().is_some());
    s.go(Move::To(601));
    assert!(s.suggestion().is_none());
    let mut st = Settings::default();
    st.label.suggest_max_seconds = 100.0;
    s.set_settings(st);
    assert!(s.suggestion().is_some());
    st.label.suggest_max_seconds = 0.0;
    s.set_settings(st);
    assert!(s.suggestion().is_none(), "0 turns suggestions off");
}

#[test]
fn accepting_a_suggestion_labels_the_frame_and_takes_over_the_pick() {
    let mut s = session(100);
    s.click_cell(0, 5, true).unwrap();
    s.go(Move::To(3));
    s.set_pick(1, false);
    let a = s.accept_suggestion().unwrap();
    assert_eq!((a.frame, a.now_at), (3, 4));
    assert_eq!(s.store().get(3), fire(0, 8, true));
    assert_eq!(
        s.pick(),
        PickState {
            sheet: 0,
            mirrored: true
        }
    );
}

// ============================================================= fill / undo

#[test]
fn fill_range_labels_the_range_without_moving_the_playhead() {
    let mut s = session(20);
    s.go(Move::To(3));
    assert_eq!(s.fill_range(5, 9, Label::NoFire).unwrap(), 5);
    assert_eq!(s.current(), 3);
    assert_eq!(s.store().get(7), Label::NoFire);
    assert!(s.fill_range(9, 5, Label::Skip).is_err());
}

#[test]
fn undo_restores_the_label_and_moves_the_playhead_to_it() {
    let mut s = session(10);
    s.go(Move::To(5));
    s.pick_row(7).unwrap(); // at 6 now
    assert!(s.undo());
    assert_eq!(s.current(), 5);
    assert_eq!(s.store().get(5), Label::Unset);
    assert!(!s.undo(), "nothing left");
    assert_eq!(s.current(), 5);
}

#[test]
fn undoing_a_range_fill_moves_to_its_first_frame() {
    let mut s = session(20);
    s.fill_range(8, 12, Label::Skip).unwrap();
    s.go(Move::To(15));
    assert!(s.undo());
    assert_eq!(s.current(), 8);
    assert_eq!(s.store().labelled_count(), 0);
}

// ================================================================ flags

/// A clean 60 fps game on sheet 1 (see docs/PHASE-EVIDENCE.md E7), labelled frame by frame through the session.
fn labelled_game(n: usize) -> Session {
    let mut s = session_with(n, 60.0, Settings::default());
    for i in 0..n {
        let t = i as f64 / 60.0;
        let step = (9 + (20.0 * (t + 0.37)).floor() as i64).rem_euclid(32) as u8;
        s.go(Move::To(i as u32));
        s.pick_row(step).unwrap();
    }
    s
}

#[test]
fn analysis_covers_the_labelled_fire_frames_and_a_clean_game_has_no_flags() {
    let mut s = labelled_game(600);
    assert_eq!(s.analysis().points.len(), 600);
    assert!(s.flags().is_empty(), "{:?}", s.flags());
}

#[test]
fn analysis_is_recomputed_after_a_label_changes() {
    let mut s = labelled_game(600);
    assert!(s.flags().is_empty());
    s.go(Move::To(300));
    let Label::Fire { row, .. } = s.store().get(300) else {
        panic!()
    };
    s.pick_row((row + 5) % 32).unwrap();
    let flagged: Vec<u32> = s.flags().iter().map(|f| f.frame).collect();
    assert_eq!(flagged, vec![300]);
    assert_eq!(s.flags()[0].kind, FlagKind::PhaseOutlier);
    // fixing it clears the flag again
    s.go(Move::To(300));
    s.pick_row(row).unwrap();
    assert!(s.flags().is_empty());
}

#[test]
fn analysis_ignores_non_fire_labels() {
    let mut s = labelled_game(100);
    s.go(Move::To(10));
    s.apply(Label::NoFire).unwrap();
    assert_eq!(s.analysis().points.len(), 99);
}

#[test]
fn predicted_labels_do_not_supply_phase_evidence_or_flags() {
    let mut store = LabelStore::new(100);
    for f in 0..100 {
        // Dense, contradictory predictions must not outweigh independent anchors.
        store
            .set_predicted(f, fire(1, ((f + 12) % 32) as u8, false))
            .unwrap();
    }
    let mut s = Session::new(project(100, 20.0), store, Settings::default()).unwrap();
    assert!(s.analysis().points.is_empty());
    assert!(s.analysis().runs.is_empty());
    assert!(s.flags().is_empty());
    for f in [0, 40, 80] {
        s.go(Move::To(f));
        s.pick_row((f % 32) as u8).unwrap();
    }
    assert_eq!(
        s.analysis()
            .points
            .iter()
            .map(|p| p.frame)
            .collect::<Vec<_>>(),
        vec![0, 40, 80]
    );
    assert!(s.flags().is_empty());
    assert_eq!(s.store().labelled_count(), 100, "predictions stay saved");
    assert!(s.store().is_predicted(41));
}

#[test]
fn manually_confirming_a_prediction_refreshes_phase_evidence() {
    let mut s = session(10);
    s.pick_row(0).unwrap();
    let legacy = serde_json::json!({"format":"firecrackle-labels","version":2,
        "fingerprint":s.project().fingerprint,"frame_count":10,
        "labels":[{"version":2,"frame":1,"label":fire(1,0,false),"predicted":true,"sources":["time_guess"]}]});
    s.import_labels(&legacy.to_string()).unwrap();
    assert!(s.store().is_predicted(1));
    assert_eq!(s.analysis().points.len(), 1);
    let label = s.store().get(1);
    s.go(Move::To(1));
    s.apply(label).unwrap();
    assert!(!s.store().is_predicted(1));
    assert_eq!(
        s.analysis().points.len(),
        2,
        "same row with independent provenance invalidates cache"
    );
    assert!(s.undo());
    assert!(s.store().is_predicted(1));
    assert_eq!(s.analysis().points.len(), 1);
}

#[test]
fn next_and_previous_flag_jump_between_flagged_frames() {
    let mut s = labelled_game(600);
    for f in [150u32, 450] {
        s.go(Move::To(f));
        let Label::Fire { row, .. } = s.store().get(f) else {
            panic!()
        };
        s.pick_row((row + 6) % 32).unwrap();
    }
    s.go(Move::Home);
    assert_eq!(s.go(Move::NextFlag), 150);
    assert_eq!(s.go(Move::NextFlag), 450);
    assert_eq!(s.go(Move::NextFlag), 450, "none after the last: stay");
    assert_eq!(s.go(Move::PrevFlag), 150);
    assert_eq!(s.go(Move::PrevFlag), 150, "none before the first: stay");
}

// ============================================================ autosave log

#[test]
fn every_change_is_queued_as_a_log_line_exactly_once() {
    let mut s = session(10);
    s.pick_row(4).unwrap();
    s.apply(Label::Skip).unwrap();
    assert_eq!(
        s.take_log(),
        vec![log_line(0, fire(1, 4, false)), log_line(1, Label::Skip)]
    );
    assert!(s.take_log().is_empty(), "taken lines are not repeated");
}

#[test]
fn a_no_op_label_queues_nothing() {
    let mut s = session(10);
    s.apply(Label::Skip).unwrap();
    s.take_log();
    s.go(Move::To(0));
    s.apply(Label::Skip).unwrap();
    assert!(s.take_log().is_empty());
}

#[test]
fn fill_range_queues_only_the_changed_frames_in_order() {
    let mut s = session(10);
    s.go(Move::To(3));
    s.apply(Label::Skip).unwrap();
    s.take_log();
    s.fill_range(2, 5, Label::Skip).unwrap();
    assert_eq!(
        s.take_log(),
        vec![
            log_line(2, Label::Skip),
            log_line(4, Label::Skip),
            log_line(5, Label::Skip)
        ]
    );
}

#[test]
fn undo_logs_the_restored_labels_including_unset() {
    let mut s = session(10);
    s.pick_row(4).unwrap();
    s.go(Move::To(0));
    s.pick_row(9).unwrap(); // overwrote frame 0
    s.take_log();
    assert!(s.undo());
    assert_eq!(s.take_log(), vec![log_line(0, fire(1, 4, false))]);
    assert!(s.undo());
    assert_eq!(s.take_log(), vec![log_line(0, Label::Unset)]);
}

#[test]
fn requeued_lines_go_back_in_front_of_new_ones() {
    let mut s = session(10);
    s.pick_row(1).unwrap();
    s.pick_row(2).unwrap();
    let lines = s.take_log();
    assert_eq!(lines.len(), 2);
    s.pick_row(3).unwrap();
    s.requeue_log(lines.clone());
    let again = s.take_log();
    assert_eq!(&again[..2], &lines[..]);
    assert_eq!(again.len(), 3);
}

#[test]
fn replaying_the_queued_log_rebuilds_the_store_exactly() {
    let mut s = session(40);
    let mut log: Vec<String> = Vec::new();
    // a mixed session: labels, overwrites, a fill, a clear, undos, a fill undone
    for i in 0..10u32 {
        s.go(Move::To(i));
        s.pick_row((i * 3 % 32) as u8).unwrap();
        log.extend(s.take_log());
    }
    s.go(Move::To(3));
    s.apply(Label::NoFire).unwrap();
    s.fill_range(20, 30, Label::Skip).unwrap();
    s.go(Move::To(25));
    s.apply(Label::Unset).unwrap();
    log.extend(s.take_log());
    s.undo();
    s.undo();
    log.extend(s.take_log());
    s.fill_range(0, 39, Label::NoFire).unwrap();
    s.undo();
    s.go(Move::To(7));
    s.click_cell(0, 9, true).unwrap();
    log.extend(s.take_log());

    let replayed = LabelStore::replay(&log.join("\n"), 40).unwrap();
    assert!(!replayed.torn_tail);
    assert_eq!(replayed.store.iter(), s.store().iter());
}
