use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use studio_core::config::{IndexConfig, Settings};
use studio_core::decode_plan::DecodeJob;
use studio_core::frames::{DecodeError, DecodedFrame};
use studio_core::import::Tools;
use studio_core::index::{build_index, Packet};
use studio_core::label::{log_line, Label};
use studio_core::phase::FlagKind;
use studio_core::project::{Project, ProjectError, VideoMeta};
use studio_core::session::SessionError;
use studio_core::workspace::*;

// ------------------------------------------------------------ helpers

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fc_ws_{}_{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn project(n: usize, fps: f64) -> Project {
    let pk: Vec<Packet> = (0..n)
        .map(|i| Packet {
            pts: Some(i as f64 / fps),
            dts: None,
            key: i % 30 == 0,
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

#[derive(Default)]
struct Fake {
    calls: Mutex<usize>,
    fail: AtomicBool,
}

impl FrameSource for Fake {
    fn decode(&self, job: &DecodeJob, _c: &AtomicBool) -> Result<Vec<DecodedFrame>, DecodeError> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(DecodeError::FfmpegFailed("boom".into()));
        }
        *self.calls.lock().unwrap() += 1;
        Ok((job.first..=job.last)
            .map(|f| DecodedFrame {
                frame: f,
                jpeg: vec![f as u8; 8],
            })
            .collect())
    }
}

fn open_in(dir: &Path, n: usize) -> Workspace {
    Workspace::from_parts(
        dir,
        project(n, 20.0),
        &Settings::default(),
        Arc::new(Fake::default()),
    )
    .unwrap()
}

fn ws(name: &str, n: usize) -> (PathBuf, Workspace) {
    let dir = scratch(name);
    let w = open_in(&dir, n);
    (dir, w)
}

fn fire(sheet: u8, row: u8, mirrored: bool) -> Label {
    Label::Fire {
        sheet,
        row,
        mirrored,
    }
}

fn manual(frames: i64) -> UiAction {
    serde_json::from_value(serde_json::json!({"type":"manualStep","frames":frames})).unwrap()
}

#[test]
fn manual_advance_keeps_guess_unsaved_and_returns_destination_suggestion() {
    let (dir, mut w)=ws("manual_prediction",20);
    click(&mut w,1,5);
    let v=w.apply(manual(3)).unwrap();
    assert_eq!(v.current,4);assert_eq!(v.labelled_count,1);
    assert_eq!(v.suggestion.unwrap().from_frame,0);
    w.apply(UiAction::GoTo{frame:1}).unwrap();
    assert_eq!(w.view().label,Label::Unset);
    assert_eq!(lines(&dir).len(),1);
    let mut reopened=open_in(&dir,20);
    reopened.apply(UiAction::GoTo{frame:1}).unwrap();
    assert_eq!(reopened.view().label,Label::Unset);
    let v=reopened.apply(UiAction::AcceptSuggestion).unwrap();
    assert_eq!(v.labelled_count,2);
    reopened.apply(UiAction::GoTo{frame:1}).unwrap();
    assert_eq!(reopened.view().label_sources,vec![studio_core::label::LabelSource::Manual]);
    reopened.apply(UiAction::Undo).unwrap();
    let mut reopened=open_in(&dir,20);
    reopened.apply(UiAction::GoTo{frame:1}).unwrap();
    assert_eq!(reopened.view().label,Label::Unset);
}

#[test]
fn navigation_only_actions_and_existing_labels_never_confirm_a_guess() {
    let (dir, mut w) = ws("manual_no_overwrite", 20);
    click(&mut w, 1, 5);
    w.apply(UiAction::Step { frames: 1 }).unwrap(); // playback
    w.apply(manual(-1)).unwrap();
    assert_eq!(w.view().labelled_count, 1);
    w.apply(UiAction::NoFire).unwrap();
    w.apply(UiAction::GoTo { frame: 1 }).unwrap();
    w.apply(manual(1)).unwrap();
    w.apply(UiAction::GoTo { frame: 1 }).unwrap();
    assert_eq!(w.view().label, Label::NoFire);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn manual_big_step_moves_once_without_writing_any_guess() {
    let (dir,mut w)=ws("manual_no_save",30);
    click(&mut w,1,5);
    let action:UiAction=serde_json::from_value(serde_json::json!({"type":"manualBigStep","dir":1})).unwrap();
    let v=w.apply(action).unwrap();
    assert_eq!(v.current,11);assert_eq!(v.labelled_count,1);
    assert!(v.save_error.is_none());assert_eq!(lines(&dir).len(),1);
    let mut reopened=open_in(&dir,30);
    reopened.apply(UiAction::GoTo{frame:1}).unwrap();
    assert_eq!(reopened.view().label,Label::Unset);
    assert_eq!(reopened.view().suggestion.unwrap().from_frame,0);
}

fn click(w: &mut Workspace, col: u32, row: u32) -> View {
    w.apply(UiAction::ClickCell { col, row }).unwrap()
}

fn lines(dir: &Path) -> Vec<String> {
    std::fs::read_to_string(dir.join("labels.jsonl"))
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

// ================================================================ the view

#[test]
fn a_fresh_workspace_shows_the_first_frame_unlabelled() {
    let (dir, mut w) = ws("fresh", 50);
    let v = w.view();
    assert_eq!((v.current, v.frame_count), (0, 50));
    assert_eq!(v.label, Label::Unset);
    assert_eq!((v.pick.sheet, v.pick.mirrored), (1, false));
    assert_eq!(
        (
            v.typed_pending,
            v.suggestion,
            v.labelled_count,
            v.flag_count
        ),
        (None, None, 0, 0)
    );
    assert_eq!(v.pts, 0.0);
    assert!((v.fps - 20.0).abs() < 0.01, "fps {}", v.fps);
    assert!(v.warnings.is_empty() && v.save_error.is_none());
    assert_eq!(w.dir(), dir);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_view_serialises_to_json_the_ui_can_read() {
    let (dir, mut w) = ws("json", 50);
    click(&mut w, 1, 5);
    w.apply(UiAction::GoTo { frame: 3 }).unwrap();
    let v = serde_json::to_value(w.view()).unwrap();
    assert_eq!(v["current"], 3);
    assert_eq!(v["label"], "unset");
    assert_eq!(
        v["pick"],
        serde_json::json!({"sheet": 1, "mirrored": false})
    );
    assert_eq!(v["suggestion"]["row"], 8);
    assert_eq!(v["suggestion"]["from_frame"], 0);
    assert_eq!(
        v["suggestion"]["alt_row"], 9,
        "whole ticks still have capture-boundary uncertainty by default"
    );
    assert_eq!(v["labelled_count"], 1);
    let first = serde_json::to_value(w.apply(UiAction::GoTo { frame: 0 }).unwrap()).unwrap();
    assert_eq!(
        first["label"],
        serde_json::json!({"fire": {"sheet": 1, "row": 5, "mirrored": false}})
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn actions_deserialise_from_the_json_the_ui_sends() {
    let cases = [
        (
            r#"{"type":"step","frames":-3}"#,
            UiAction::Step { frames: -3 },
        ),
        (
            r#"{"type":"bigStep","dir":1}"#,
            UiAction::BigStep { dir: 1 },
        ),
        (r#"{"type":"home"}"#, UiAction::Home),
        (
            r#"{"type":"goTo","frame":42}"#,
            UiAction::GoTo { frame: 42 },
        ),
        (r#"{"type":"toggleSheet"}"#, UiAction::ToggleSheet),
        (
            r#"{"type":"digit","digit":7}"#,
            UiAction::Digit { digit: 7 },
        ),
        (r#"{"type":"acceptSuggestion"}"#, UiAction::AcceptSuggestion),
        (
            r#"{"type":"clickCell","col":2,"row":9}"#,
            UiAction::ClickCell { col: 2, row: 9 },
        ),
        (
            r#"{"type":"fillRange","start":1,"end":5,"label":"no_fire"}"#,
            UiAction::FillRange {
                start: 1,
                end: 5,
                label: Label::NoFire,
            },
        ),
    ];
    for (json, action) in cases {
        assert_eq!(
            serde_json::from_str::<UiAction>(json).unwrap(),
            action,
            "{json}"
        );
    }
    assert!(serde_json::from_str::<UiAction>(r#"{"type":"nonsense"}"#).is_err());
}

// ============================================================== navigation

#[test]
fn stepping_and_jumping_clamp_at_the_ends() {
    let (dir, mut w) = ws("nav", 50);
    assert_eq!(w.apply(UiAction::Step { frames: 5 }).unwrap().current, 5);
    assert_eq!(w.apply(UiAction::Step { frames: -99 }).unwrap().current, 0);
    assert_eq!(w.apply(UiAction::End).unwrap().current, 49);
    assert_eq!(w.apply(UiAction::Step { frames: 1 }).unwrap().current, 49);
    assert_eq!(w.apply(UiAction::Home).unwrap().current, 0);
    assert_eq!(w.apply(UiAction::GoTo { frame: 25 }).unwrap().current, 25);
    assert_eq!(w.apply(UiAction::GoTo { frame: 9999 }).unwrap().current, 49);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn big_steps_use_the_setting_and_need_a_direction() {
    let (dir, mut w) = ws("big", 100);
    assert_eq!(w.apply(UiAction::BigStep { dir: 1 }).unwrap().current, 10);
    assert_eq!(w.apply(UiAction::BigStep { dir: -1 }).unwrap().current, 0);
    w.set_setting("label.big_step_frames", 25.0).unwrap();
    assert_eq!(w.apply(UiAction::BigStep { dir: 1 }).unwrap().current, 25);
    assert!(matches!(
        w.apply(UiAction::BigStep { dir: 0 }),
        Err(WorkspaceError::BadAction(_))
    ));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn next_unlabelled_and_next_flag_take_a_direction() {
    let (dir, mut w) = ws("jump", 50);
    w.apply(UiAction::FillRange {
        start: 0,
        end: 4,
        label: Label::Skip,
    })
    .unwrap();
    w.apply(UiAction::GoTo { frame: 2 }).unwrap();
    assert_eq!(
        w.apply(UiAction::NextUnlabelled { dir: 1 })
            .unwrap()
            .current,
        5
    );
    assert_eq!(
        w.apply(UiAction::NextUnlabelled { dir: -1 })
            .unwrap()
            .current,
        5,
        "nothing unlabelled before frame 5"
    );
    assert!(matches!(
        w.apply(UiAction::NextUnlabelled { dir: 0 }),
        Err(WorkspaceError::BadAction(_))
    ));
    assert!(matches!(
        w.apply(UiAction::NextFlag { dir: 0 }),
        Err(WorkspaceError::BadAction(_))
    ));
    assert_eq!(
        w.apply(UiAction::NextFlag { dir: 1 }).unwrap().current,
        5,
        "no flags: stay"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// ============================================================== labelling

#[test]
fn clicking_a_cell_labels_with_the_columns_sheet_and_mirror_and_advances() {
    let (dir, mut w) = ws("cells", 50);
    let cases = [
        (0u32, fire(0, 3, false)),
        (1, fire(1, 4, false)),
        (2, fire(0, 5, true)),
        (3, fire(1, 6, true)),
    ];
    for (i, (col, label)) in cases.iter().enumerate() {
        let v = click(&mut w, *col, 3 + i as u32);
        assert_eq!(v.current, i as u32 + 1);
        assert_eq!(
            w.apply(UiAction::GoTo { frame: i as u32 }).unwrap().label,
            *label,
            "column {col}"
        );
        w.apply(UiAction::GoTo {
            frame: i as u32 + 1,
        })
        .unwrap();
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_cell_outside_the_grid_is_refused_without_changing_anything() {
    let (dir, mut w) = ws("badcell", 50);
    assert!(matches!(
        w.apply(UiAction::ClickCell { col: 4, row: 0 }),
        Err(WorkspaceError::BadAction(_))
    ));
    assert!(w.apply(UiAction::ClickCell { col: 0, row: 32 }).is_err());
    assert_eq!(w.view().labelled_count, 0);
    assert!(lines(&dir).is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn typed_digits_label_the_frame() {
    let (dir, mut w) = ws("digits", 50);
    let v = w.apply(UiAction::Digit { digit: 1 }).unwrap();
    assert_eq!((v.typed_pending, v.labelled_count), (Some(1), 0));
    let v = w.apply(UiAction::Digit { digit: 2 }).unwrap();
    assert_eq!((v.typed_pending, v.labelled_count, v.current), (None, 1, 1));
    w.apply(UiAction::GoTo { frame: 0 }).unwrap();
    assert_eq!(w.view().label, fire(1, 12, false));
    w.apply(UiAction::Digit { digit: 3 }).unwrap();
    assert_eq!(w.apply(UiAction::CancelTyping).unwrap().typed_pending, None);
    assert_eq!(
        w.view().labelled_count,
        1,
        "the cancelled digit labelled nothing"
    );
    w.apply(UiAction::GoTo { frame: 5 }).unwrap();
    w.apply(UiAction::Digit { digit: 2 }).unwrap();
    let v = w.apply(UiAction::FlushTyped).unwrap();
    assert_eq!(v.labelled_count, 2);
    w.apply(UiAction::GoTo { frame: 5 }).unwrap();
    assert_eq!(w.view().label, fire(1, 2, false));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn toggles_and_the_other_labels() {
    let (dir, mut w) = ws("misc", 50);
    assert_eq!(w.apply(UiAction::ToggleSheet).unwrap().pick.sheet, 0);
    assert!(w.apply(UiAction::ToggleMirror).unwrap().pick.mirrored);
    assert_eq!(w.apply(UiAction::NoFire).unwrap().current, 1);
    assert_eq!(w.apply(UiAction::Skip).unwrap().current, 2);
    w.apply(UiAction::GoTo { frame: 0 }).unwrap();
    assert_eq!(w.view().label, Label::NoFire);
    assert_eq!(w.apply(UiAction::Clear).unwrap().label, Label::Unset);
    assert_eq!(w.view().labelled_count, 1);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn accepting_a_suggestion_and_the_case_without_one() {
    let (dir, mut w) = ws("sugg", 50);
    assert!(matches!(
        w.apply(UiAction::AcceptSuggestion),
        Err(WorkspaceError::Session(SessionError::NoSuggestion))
    ));
    click(&mut w, 1, 5);
    w.apply(UiAction::GoTo { frame: 3 }).unwrap();
    let v = w.apply(UiAction::AcceptSuggestion).unwrap();
    assert_eq!((v.labelled_count, v.current), (2, 4));
    w.apply(UiAction::GoTo { frame: 3 }).unwrap();
    assert_eq!(w.view().label, fire(1, 8, false));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn undo_and_fill_range() {
    let (dir, mut w) = ws("undo", 50);
    let v = w
        .apply(UiAction::FillRange {
            start: 3,
            end: 9,
            label: Label::NoFire,
        })
        .unwrap();
    assert_eq!(v.labelled_count, 7);
    let v = w.apply(UiAction::Undo).unwrap();
    assert_eq!((v.labelled_count, v.current), (0, 3));
    assert_eq!(
        w.apply(UiAction::Undo).unwrap().labelled_count,
        0,
        "nothing to undo is not an error"
    );
    assert!(w
        .apply(UiAction::FillRange {
            start: 9,
            end: 3,
            label: Label::Skip
        })
        .is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

// ============================================================== autosave

#[test]
fn every_action_is_written_to_the_log_and_survives_a_reopen() {
    let (dir, mut w) = ws("persist", 50);
    click(&mut w, 1, 5);
    click(&mut w, 2, 6);
    w.apply(UiAction::NoFire).unwrap();
    assert_eq!(
        lines(&dir),
        vec![
            log_line(0, fire(1, 5, false)),
            log_line(1, fire(0, 6, true)),
            log_line(2, Label::NoFire)
        ]
    );
    drop(w);
    let mut again = open_in(&dir, 50);
    let v = again.view();
    assert_eq!(
        (v.labelled_count, v.current),
        (3, 3),
        "reopens on the first unlabelled frame"
    );
    again.apply(UiAction::GoTo { frame: 1 }).unwrap();
    assert_eq!(again.view().label, fire(0, 6, true));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_failed_write_is_reported_and_retried_not_lost() {
    let (dir, mut w) = ws("savefail", 50);
    click(&mut w, 1, 1);
    std::fs::remove_dir_all(&dir).unwrap(); // the disk went away
    let v = click(&mut w, 1, 2);
    assert!(v.save_error.is_some(), "{v:?}");
    assert_eq!(v.labelled_count, 2, "the label is kept in memory");
    std::fs::create_dir_all(&dir).unwrap(); // and came back
    let v = click(&mut w, 1, 3);
    assert!(v.save_error.is_none(), "{:?}", v.save_error);
    assert_eq!(
        lines(&dir).len(),
        2,
        "the queued line and the new one are both written (the first went to the lost folder)"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_torn_log_is_repaired_and_the_user_is_told() {
    let dir = scratch("torn");
    std::fs::write(
        dir.join("labels.jsonl"),
        format!("{}\n{{\"frame\":1,\"lab", log_line(0, Label::Skip)),
    )
    .unwrap();
    let mut w = open_in(&dir, 50);
    let v = w.view();
    assert_eq!(v.labelled_count, 1);
    assert!(
        v.warnings
            .iter()
            .any(|m| m.to_lowercase().contains("repaired")),
        "{:?}",
        v.warnings
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_log_from_another_video_is_refused() {
    let dir = scratch("otherlog");
    std::fs::write(
        dir.join("labels.jsonl"),
        format!("{}\n", log_line(99999, Label::Skip)),
    )
    .unwrap();
    let r = Workspace::from_parts(
        &dir,
        project(50, 20.0),
        &Settings::default(),
        Arc::new(Fake::default()),
    );
    assert!(matches!(
        r,
        Err(WorkspaceError::Autosave(
            studio_core::autosave::AutosaveError::VideoMismatch { .. }
        ))
    ));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_log_is_compacted_when_it_grows_too_long() {
    let (dir, mut w) = ws("compact", 50);
    w.set_setting("autosave.compact_after_lines", 1000.0)
        .unwrap();
    for i in 0..1100u32 {
        w.apply(UiAction::GoTo { frame: 0 }).unwrap();
        click(&mut w, 1, i % 2 + 10); // alternating rows: every click changes frame 0
    }
    assert!(
        lines(&dir).len() < 200,
        "log has {} lines",
        lines(&dir).len()
    );
    drop(w);
    let mut again = open_in(&dir, 50);
    again.apply(UiAction::GoTo { frame: 0 }).unwrap();
    assert_eq!(
        again.view().label,
        fire(1, 11, false),
        "the last write wins after compaction"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// =============================================================== settings

#[test]
fn a_setting_takes_effect_at_once_and_survives_a_reopen() {
    let (dir, mut w) = ws("settings", 50);
    let v = w.set_setting("label.advance_frames", 0.0).unwrap();
    assert_eq!(v.current, 0);
    assert_eq!(
        click(&mut w, 1, 4).current,
        0,
        "advance 0 stays on the frame"
    );
    assert_eq!(w.settings().label.advance_frames, 0);
    assert!(dir.join("settings.json").is_file());
    drop(w);
    let again = open_in(&dir, 50);
    assert_eq!(again.settings().label.advance_frames, 0);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn bad_settings_are_refused_and_change_nothing() {
    let (dir, mut w) = ws("badset", 50);
    assert!(matches!(
        w.set_setting("nope.nope", 1.0),
        Err(WorkspaceError::Setting(_))
    ));
    assert!(matches!(
        w.set_setting("phase.min_run", 0.0),
        Err(WorkspaceError::Setting(_))
    ));
    assert_eq!(w.settings(), Settings::default());
    assert!(!dir.join("settings.json").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn unreadable_settings_fall_back_to_the_defaults_with_a_warning() {
    let dir = scratch("corruptset");
    std::fs::write(dir.join("settings.json"), "not json at all").unwrap();
    let mut w = open_in(&dir, 50);
    assert_eq!(w.settings(), Settings::default());
    assert!(
        w.view()
            .warnings
            .iter()
            .any(|m| m.to_lowercase().contains("settings")),
        "{:?}",
        w.view().warnings
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_settings_are_described_with_their_explanations() {
    let (dir, w) = ws("describe", 50);
    let d = w.describe_settings();
    assert_eq!(d.len(), 49);
    assert!(d.iter().all(|s| !s.explanation.is_empty()));
    let _ = std::fs::remove_dir_all(&dir);
}

// ========================================================= timeline / flags

#[test]
fn the_timeline_summarises_the_labels() {
    let (dir, mut w) = ws("timeline", 50);
    for _ in 0..10 {
        click(&mut w, 1, 3);
    }
    let b = w.timeline(0, 20, 2);
    assert_eq!((b[0].frames, b[0].fire, b[0].unset), (10, 10, 0));
    assert_eq!((b[1].frames, b[1].fire, b[1].unset), (10, 0, 10));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_mislabelled_frame_is_flagged() {
    let dir = scratch("flags");
    let mut w = Workspace::from_parts(
        &dir,
        project(600, 60.0),
        &Settings::default(),
        Arc::new(Fake::default()),
    )
    .unwrap();
    for i in 0..600u32 {
        let t = i as f64 / 60.0;
        let row = (9 + (20.0 * (t + 0.37)).floor() as i64).rem_euclid(32) as u32;
        click(&mut w, 1, row);
    }
    assert!(w.flags().is_empty());
    w.apply(UiAction::GoTo { frame: 300 }).unwrap();
    let wrong = (match w.view().label {
        Label::Fire { row, .. } => row as u32 + 6,
        other => panic!("{other:?}"),
    }) % 32;
    let v = click(&mut w, 1, wrong);
    assert_eq!(v.flag_count, 1);
    let flags = w.flags();
    assert_eq!(
        (flags[0].frame, flags[0].kind),
        (300, FlagKind::PhaseOutlier)
    );
    let j = serde_json::to_value(flags[0]).unwrap();
    assert_eq!(
        (j["kind"].as_str(), j["severity"].as_str()),
        (Some("phase_outlier"), Some("soft"))
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// =================================================================== frames

#[test]
fn frame_bytes_come_from_the_source_and_its_errors_surface() {
    let dir = scratch("framebytes");
    let src = Arc::new(Fake::default());
    let w =
        Workspace::from_parts(&dir, project(100, 20.0), &Settings::default(), src.clone()).unwrap();
    assert_eq!(*w.frame_jpeg(7).unwrap(), vec![7u8; 8]);
    assert!(matches!(
        w.frame_jpeg(100),
        Err(WorkspaceError::Frame(FrameError::OutOfRange(100)))
    ));
    src.fail.store(true, Ordering::SeqCst);
    // frame 7's window (0..=97) is cached; frame 99 is not
    assert!(matches!(
        w.frame_jpeg(99),
        Err(WorkspaceError::Frame(FrameError::Decode(_)))
    ));
    w.wait_idle();
    let _ = std::fs::remove_dir_all(&dir);
}

// ===================================================== the real thing (ffmpeg)

fn have_tools() -> bool {
    ["ffmpeg", "ffprobe"].iter().all(|t| {
        Command::new(t)
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    })
}

/// 60 frames, frame `i` flat brightness `6 + 4 i`.
fn make_video(path: &Path, shift: usize) {
    let (w, h) = (320usize, 180usize);
    let mut child = Command::new("ffmpeg")
        .args([
            "-y",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "gray",
            "-s",
            &format!("{w}x{h}"),
        ])
        .args([
            "-r", "30", "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "10",
            "-pix_fmt", "yuv420p",
        ])
        .args([
            "-bf",
            "2",
            "-g",
            "30",
            "-keyint_min",
            "30",
            "-sc_threshold",
            "0",
        ])
        .arg(path)
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let stdin = child.stdin.as_mut().unwrap();
        for i in 0..60usize {
            stdin
                .write_all(&vec![(6 + 4 * ((i + shift) % 60)) as u8; w * h])
                .unwrap();
        }
    }
    drop(child.stdin.take());
    assert!(child.wait().unwrap().success());
}

fn brightness_frame(jpeg: &[u8]) -> i64 {
    let mut d = jpeg_decoder::Decoder::new(jpeg);
    let px = d.decode().unwrap();
    let mean = px.iter().map(|&b| b as f64).sum::<f64>() / px.len() as f64;
    ((mean - 6.0) / 4.0).round() as i64
}

#[test]
fn a_real_video_opens_decodes_labels_and_reopens() {
    if !have_tools() {
        eprintln!("ffmpeg not found, skipping");
        return;
    }
    let dir = scratch("real").join("my clips ü");
    std::fs::create_dir_all(&dir).unwrap();
    let video = dir.join("clip 1.mkv");
    make_video(&video, 0);

    let mut w = Workspace::open(&Tools::default(), &video, &Settings::default()).unwrap();
    let pdir = dir.join("clip 1.mkv.firecrackle");
    assert_eq!(w.dir(), pdir);
    assert!(pdir.join("project.json").is_file());
    assert_eq!(w.view().frame_count, 60);
    for f in [0u32, 17, 45, 59] {
        assert_eq!(
            brightness_frame(&w.frame_jpeg(f).unwrap()),
            f as i64,
            "frame {f}"
        );
    }
    click(&mut w, 1, 9);
    w.wait_idle();
    drop(w);

    let mut again = Workspace::open(&Tools::default(), &video, &Settings::default()).unwrap();
    assert_eq!(again.view().labelled_count, 1);
    again.apply(UiAction::GoTo { frame: 0 }).unwrap();
    assert_eq!(again.view().label, fire(1, 9, false));
    again.wait_idle();
    drop(again);

    // the file is replaced by a different recording: the old labels must not be applied to it
    make_video(&video, 7);
    match Workspace::open(&Tools::default(), &video, &Settings::default()) {
        Err(WorkspaceError::Project(ProjectError::VideoChanged)) => {}
        other => panic!("{:?}", other.err()),
    }
    let _ = std::fs::remove_dir_all(dir.parent().unwrap());
}

#[test]
fn a_corrupt_project_file_is_an_error_not_a_silent_reimport() {
    if !have_tools() {
        return;
    }
    let dir = scratch("corruptproj");
    let video = dir.join("c.mkv");
    make_video(&video, 0);
    let w = Workspace::open(&Tools::default(), &video, &Settings::default()).unwrap();
    let pdir = w.dir().to_path_buf();
    drop(w);
    std::fs::write(pdir.join("project.json"), "{ half").unwrap();
    assert!(matches!(
        Workspace::open(&Tools::default(), &video, &Settings::default()),
        Err(WorkspaceError::Project(ProjectError::Corrupt(_)))
    ));
    let _ = std::fs::remove_dir_all(&dir);
}
