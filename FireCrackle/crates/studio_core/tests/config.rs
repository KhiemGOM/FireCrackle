use studio_core::config::*;

const KEYS: [&str; 55] = [
    "phase.min_run",
    "phase.tick_rate",
    "phase.window_ticks",
    "phase.max_lag_ticks",
    "phase.min_shift_ticks",
    "phase.max_excursion_seconds",
    "phase_v2.bin_seconds",
    "phase_v2.penalty_ticks2",
    "phase_v2.anchor_bins",
    "phase_v2.held_seconds",
    "phase_v2.held_max_gap_seconds",
    "phase_v2.recovery_samples",
    "phase_v2.recovery_ticks",
    "phase_v2.supplement_min_ticks",
    "index.irregular_deviation",
    "index.vfr_fraction",
    "project.fingerprint_window_bytes",
    "label.advance_frames",
    "label.big_step_frames",
    "label.advance_to_unlabelled",
    "label.row_type_timeout_ms",
    "label.suggest_max_seconds",
    "label.suggest_calibration_seconds",
    "label.suggest_capture_frames",
    "label.max_play_speed",
    "label.min_play_tick_ms",
    "label.veil_min_share",
    "label.veil_margin",
    "label.veil_slack",
    "label.buffer_ahead",
    "label.buffer_behind",
    "label.buffer_decode_ahead",
    "label.buffer_parallel",
    "label.buffer_late_show",
    "decode.window_back",
    "decode.max_parallel",
    "decode.window_ahead",
    "decode.prefetch_fraction",
    "decode.cache_mb",
    "decode.max_width",
    "decode.max_gop_frames",
    "decode.seek_backoff_ms",
    "decode.align_tolerance",
    "decode.jpeg_quality",
    "autosave.compact_after_lines",
    "autosave.fsync",
    "timeline.zoom_factor",
    "timeline.max_px_per_frame",
    "timeline.thumb_width_px",
    "timeline.thumb_quality",
    "timeline.thumb_max_count",
    "timeline.thumbs_enabled",
    "timeline.follow_margin_px",
    "timeline.ruler_spacing_px",
    "timeline.drag_threshold_px",
];

// ------------------------------------------------------------- basics

#[test]
fn defaults_are_the_documented_values() {
    let s = Settings::default();
    assert_eq!(s.phase.min_run, 3);
    assert_eq!(s.phase.tick_rate, 20.0);
    assert_eq!(s.phase.window_ticks, 2.0);
    assert_eq!(s.phase.max_lag_ticks, 10.0);
    assert_eq!(s.phase.min_shift_ticks, 1.0);
    assert_eq!(s.phase.max_excursion_seconds, 30.0);
    assert_eq!(s.index.irregular_deviation, 0.5);
    assert_eq!(s.index.vfr_fraction, 0.01);
    assert_eq!(s.project.fingerprint_window_bytes, 1 << 20);
    assert_eq!(s.label.advance_frames, 1);
    assert_eq!(s.label.big_step_frames, 10);
    assert!(!s.label.advance_to_unlabelled);
    assert_eq!(s.label.row_type_timeout_ms, 700);
    assert_eq!(s.label.suggest_max_seconds, 30.0);
    assert_eq!(s.label.max_play_speed, 8);
    assert_eq!(s.label.min_play_tick_ms, 16);
    assert_eq!(s.label.veil_min_share, 0.9);
    assert_eq!(s.label.veil_margin, 0.2);
    assert_eq!(s.label.veil_slack, 2.0);
    assert_eq!(s.label.buffer_ahead, 90);
    assert_eq!(s.label.buffer_behind, 30);
    assert_eq!(s.label.buffer_decode_ahead, 8);
    assert_eq!(s.label.buffer_parallel, 3);
    assert_eq!(s.label.buffer_late_show, 30);
    assert_eq!(s.decode.window_back, 120);
    assert_eq!(s.decode.max_parallel, 2);
    assert_eq!(s.decode.window_ahead, 600);
    assert_eq!(s.decode.prefetch_fraction, 0.7);
    assert_eq!(s.decode.cache_mb, 512);
    assert_eq!(s.decode.max_width, 1280);
    assert_eq!(s.decode.max_gop_frames, 600);
    assert_eq!(s.decode.seek_backoff_ms, 0.5);
    assert_eq!(s.decode.align_tolerance, 0.5);
    assert_eq!(s.decode.jpeg_quality, 3);
    assert_eq!(s.autosave.compact_after_lines, 50_000);
    assert!(s.autosave.fsync);
    assert_eq!(s.timeline.zoom_factor, 1.25);
    assert_eq!(s.timeline.max_px_per_frame, 32.0);
    assert_eq!(s.timeline.thumb_width_px, 96);
    assert_eq!(s.timeline.thumb_quality, 5);
    assert_eq!(s.timeline.thumb_max_count, 600);
    assert!(s.timeline.thumbs_enabled);
    assert_eq!(s.timeline.follow_margin_px, 80);
    assert_eq!(s.timeline.ruler_spacing_px, 90);
    assert_eq!(s.timeline.drag_threshold_px, 4);
}

#[test]
fn describe_lists_every_setting_exactly_once_in_order() {
    let info = Settings::default().describe();
    let keys: Vec<&str> = info.iter().map(|i| i.key).collect();
    assert_eq!(keys, KEYS.to_vec());
}

#[test]
fn every_setting_is_explained_and_consistent() {
    let s = Settings::default();
    for i in s.describe() {
        assert!(
            i.explanation.len() >= 60,
            "{}: explanation too thin: {:?}",
            i.key,
            i.explanation
        );
        assert!(!i.label.is_empty(), "{}", i.key);
        assert!(
            i.min <= i.default && i.default <= i.max,
            "{}: default outside range",
            i.key
        );
        assert_eq!(
            i.value, i.default,
            "{}: a fresh Settings holds the default",
            i.key
        );
        assert_eq!(s.get(i.key), Some(i.value), "{}", i.key);
        if i.integer {
            assert_eq!(i.default.fract(), 0.0, "{}", i.key);
        }
    }
}

#[test]
fn nothing_in_the_settings_mentions_a_sync_strip() {
    let s = Settings::default();
    for i in s.describe() {
        let text = format!("{} {} {}", i.key, i.label, i.explanation).to_lowercase();
        assert!(!text.contains("strip"), "{}: {text}", i.key);
    }
    let json = serde_json::to_string(&s).unwrap().to_lowercase();
    assert!(!json.contains("strip"), "{json}");
    assert_eq!(s.get("strip.max_ticks_per_frame"), None);
}

#[test]
fn set_changes_exactly_the_named_field() {
    let mut s = Settings::default();
    s.set("phase.min_run", 5.0).unwrap();
    s.set("phase.tick_rate", 19.5).unwrap();
    s.set("phase.window_ticks", 3.0).unwrap();
    s.set("phase.max_lag_ticks", 8.0).unwrap();
    s.set("phase.min_shift_ticks", 0.5).unwrap();
    s.set("phase.max_excursion_seconds", 12.5).unwrap();
    s.set("index.irregular_deviation", 0.25).unwrap();
    s.set("index.vfr_fraction", 0.1).unwrap();
    s.set("project.fingerprint_window_bytes", 8192.0).unwrap();
    s.set("label.advance_frames", 0.0).unwrap();
    s.set("label.big_step_frames", 25.0).unwrap();
    s.set("label.advance_to_unlabelled", 1.0).unwrap();
    s.set("label.row_type_timeout_ms", 400.0).unwrap();
    s.set("label.suggest_max_seconds", 12.5).unwrap();
    s.set("label.max_play_speed", 4.0).unwrap();
    s.set("label.min_play_tick_ms", 33.0).unwrap();
    s.set("label.veil_min_share", 0.75).unwrap();
    s.set("label.veil_margin", 0.3).unwrap();
    s.set("label.veil_slack", 4.0).unwrap();
    s.set("label.buffer_ahead", 200.0).unwrap();
    s.set("label.buffer_behind", 10.0).unwrap();
    s.set("label.buffer_decode_ahead", 16.0).unwrap();
    s.set("label.buffer_parallel", 2.0).unwrap();
    s.set("label.buffer_late_show", 12.0).unwrap();
    s.set("decode.window_back", 10.0).unwrap();
    s.set("decode.max_parallel", 4.0).unwrap();
    s.set("decode.window_ahead", 200.0).unwrap();
    s.set("decode.prefetch_fraction", 0.25).unwrap();
    s.set("decode.cache_mb", 128.0).unwrap();
    s.set("decode.max_width", 960.0).unwrap();
    s.set("decode.max_gop_frames", 300.0).unwrap();
    s.set("decode.seek_backoff_ms", 2.0).unwrap();
    s.set("decode.align_tolerance", 0.25).unwrap();
    s.set("decode.jpeg_quality", 5.0).unwrap();
    s.set("autosave.compact_after_lines", 2000.0).unwrap();
    s.set("autosave.fsync", 0.0).unwrap();
    s.set("timeline.zoom_factor", 1.5).unwrap();
    s.set("timeline.max_px_per_frame", 64.0).unwrap();
    s.set("timeline.thumb_width_px", 128.0).unwrap();
    s.set("timeline.thumb_quality", 8.0).unwrap();
    s.set("timeline.thumb_max_count", 1000.0).unwrap();
    s.set("timeline.thumbs_enabled", 0.0).unwrap();
    s.set("timeline.follow_margin_px", 120.0).unwrap();
    s.set("timeline.ruler_spacing_px", 60.0).unwrap();
    s.set("timeline.drag_threshold_px", 8.0).unwrap();
    assert_eq!(s.label.advance_frames, 0);
    assert_eq!(s.label.big_step_frames, 25);
    assert!(s.label.advance_to_unlabelled);
    assert_eq!(s.label.row_type_timeout_ms, 400);
    assert_eq!(s.label.suggest_max_seconds, 12.5);
    assert_eq!(s.label.max_play_speed, 4);
    assert_eq!(s.label.min_play_tick_ms, 33);
    assert_eq!(s.label.veil_min_share, 0.75);
    assert_eq!(s.label.veil_margin, 0.3);
    assert_eq!(s.label.veil_slack, 4.0);
    assert_eq!(s.label.buffer_ahead, 200);
    assert_eq!(s.label.buffer_behind, 10);
    assert_eq!(s.label.buffer_decode_ahead, 16);
    assert_eq!(s.label.buffer_parallel, 2);
    assert_eq!(s.label.buffer_late_show, 12);
    assert_eq!(s.decode.window_back, 10);
    assert_eq!(s.decode.max_parallel, 4);
    assert_eq!(s.decode.window_ahead, 200);
    assert_eq!(s.decode.prefetch_fraction, 0.25);
    assert_eq!(s.decode.cache_mb, 128);
    assert_eq!(s.decode.max_width, 960);
    assert_eq!(s.decode.max_gop_frames, 300);
    assert_eq!(s.decode.seek_backoff_ms, 2.0);
    assert_eq!(s.decode.align_tolerance, 0.25);
    assert_eq!(s.decode.jpeg_quality, 5);
    assert_eq!(s.autosave.compact_after_lines, 2000);
    assert!(!s.autosave.fsync);
    assert_eq!(s.timeline.zoom_factor, 1.5);
    assert_eq!(s.timeline.max_px_per_frame, 64.0);
    assert_eq!(s.timeline.thumb_width_px, 128);
    assert_eq!(s.timeline.thumb_quality, 8);
    assert_eq!(s.timeline.thumb_max_count, 1000);
    assert!(!s.timeline.thumbs_enabled);
    assert_eq!(s.timeline.follow_margin_px, 120);
    assert_eq!(s.timeline.ruler_spacing_px, 60);
    assert_eq!(s.timeline.drag_threshold_px, 8);
    assert_eq!(s.phase.min_run, 5);
    assert_eq!(s.phase.tick_rate, 19.5);
    assert_eq!(s.phase.window_ticks, 3.0);
    assert_eq!(s.phase.max_lag_ticks, 8.0);
    assert_eq!(s.phase.min_shift_ticks, 0.5);
    assert_eq!(s.phase.max_excursion_seconds, 12.5);
    assert_eq!(s.index.irregular_deviation, 0.25);
    assert_eq!(s.index.vfr_fraction, 0.1);
    assert_eq!(s.project.fingerprint_window_bytes, 8192);
    for k in KEYS {
        assert!(s.get(k).is_some(), "{k}");
    }
    assert_eq!(s.get("phase.tick_rate"), Some(19.5));
}

#[test]
fn settings_feed_the_phase_config() {
    let mut s = Settings::default();
    s.set("phase.tick_rate", 10.0).unwrap();
    s.set("phase.window_ticks", 1.5).unwrap();
    assert_eq!(s.phase.tick_rate, 10.0);
    let cfg: studio_core::phase::Config = s.phase;
    assert_eq!(cfg.window_ticks, 1.5);
}

#[test]
fn reset_restores_the_default_of_one_setting_only() {
    let mut s = Settings::default();
    s.set("phase.min_run", 9.0).unwrap();
    s.set("index.vfr_fraction", 0.2).unwrap();
    s.reset("phase.min_run").unwrap();
    assert_eq!(s.phase.min_run, 3);
    assert_eq!(s.index.vfr_fraction, 0.2);
}

#[test]
fn settings_survive_a_json_round_trip() {
    let mut s = Settings::default();
    s.set("phase.min_run", 6.0).unwrap();
    s.set("phase.tick_rate", 19.0).unwrap();
    let json = serde_json::to_string(&s).unwrap();
    let back: Settings = serde_json::from_str(&json).unwrap();
    assert_eq!(back, s);
}

#[test]
fn an_older_or_partial_settings_file_falls_back_to_defaults() {
    let s: Settings = serde_json::from_str(r#"{"phase":{"min_run":7}}"#).unwrap();
    assert_eq!(s.phase.min_run, 7);
    assert_eq!(s.phase.tick_rate, 20.0);
    assert_eq!(s.index, IndexConfig::default());
    let empty: Settings = serde_json::from_str("{}").unwrap();
    assert_eq!(empty, Settings::default());
}

#[test]
fn an_old_settings_file_with_removed_strip_fields_still_loads() {
    let s: Settings = serde_json::from_str(
        r#"{"strip":{"max_ticks_per_frame":7},"phase":{"max_ticks_per_frame":9,"min_run":4}}"#,
    )
    .unwrap();
    assert_eq!(s.phase.min_run, 4);
}

// ------------------------------------------------------- bad input

#[test]
fn unknown_keys_are_rejected() {
    let mut s = Settings::default();
    assert_eq!(
        s.set("phase.nope", 1.0),
        Err(SettingError::UnknownKey("phase.nope".into()))
    );
    assert_eq!(
        s.reset("nope"),
        Err(SettingError::UnknownKey("nope".into()))
    );
    assert_eq!(s.get("nope"), None);
}

#[test]
fn out_of_range_values_are_rejected_and_change_nothing() {
    let mut s = Settings::default();
    let before = s;
    for (k, v) in [
        ("phase.min_run", 0.0),
        ("phase.tick_rate", 0.5),
        ("phase.tick_rate", 1001.0),
        ("phase.window_ticks", 0.5),
        ("phase.window_ticks", 17.0),
        ("phase.max_lag_ticks", -1.0),
        ("phase.max_lag_ticks", 17.0),
        ("phase.min_shift_ticks", -0.1),
        ("phase.min_shift_ticks", 17.0),
        ("phase.max_excursion_seconds", -1.0),
        ("phase.max_excursion_seconds", 100000.0),
        ("index.irregular_deviation", 0.0),
        ("index.irregular_deviation", 11.0),
        ("index.vfr_fraction", -0.1),
        ("index.vfr_fraction", 1.5),
        ("project.fingerprint_window_bytes", 10.0),
        ("label.advance_frames", -1.0),
        ("label.advance_frames", 10001.0),
        ("label.big_step_frames", 1.0),
        ("label.advance_to_unlabelled", 2.0),
        ("label.row_type_timeout_ms", 50.0),
        ("label.row_type_timeout_ms", 10000.0),
        ("label.suggest_max_seconds", -1.0),
        ("label.max_play_speed", 0.0),
        ("label.max_play_speed", 65.0),
        ("label.min_play_tick_ms", 3.0),
        ("label.min_play_tick_ms", 201.0),
        ("label.veil_min_share", 0.0),
        ("label.veil_min_share", 1.01),
        ("label.veil_margin", 0.0),
        ("label.veil_margin", 0.51),
        ("label.veil_slack", -1.0),
        ("label.veil_slack", 17.0),
        ("label.buffer_ahead", -1.0),
        ("label.buffer_ahead", 1201.0),
        ("label.buffer_behind", 601.0),
        ("label.buffer_decode_ahead", 65.0),
        ("label.buffer_parallel", 0.0),
        ("label.buffer_parallel", 9.0),
        ("label.buffer_late_show", -1.0),
        ("label.buffer_late_show", 601.0),
        ("decode.window_ahead", 0.0),
        ("decode.max_parallel", 0.0),
        ("decode.max_parallel", 9.0),
        ("decode.prefetch_fraction", 1.5),
        ("decode.cache_mb", 8.0),
        ("decode.max_width", 100.0),
        ("decode.max_gop_frames", 0.0),
        ("decode.seek_backoff_ms", -0.1),
        ("decode.seek_backoff_ms", 101.0),
        ("decode.align_tolerance", 0.0),
        ("decode.align_tolerance", 11.0),
        ("decode.jpeg_quality", 1.0),
        ("decode.jpeg_quality", 32.0),
        ("autosave.compact_after_lines", 10.0),
        ("autosave.fsync", -1.0),
        ("timeline.zoom_factor", 1.0),
        ("timeline.zoom_factor", 5.0),
        ("timeline.max_px_per_frame", 0.5),
        ("timeline.thumb_width_px", 8.0),
        ("timeline.thumb_quality", 1.0),
        ("timeline.thumb_quality", 32.0),
        ("timeline.thumb_max_count", 0.0),
        ("timeline.thumb_max_count", 100001.0),
        ("timeline.thumbs_enabled", 2.0),
        ("timeline.follow_margin_px", -1.0),
        ("timeline.follow_margin_px", 2001.0),
        ("timeline.ruler_spacing_px", 5.0),
        ("timeline.ruler_spacing_px", 1001.0),
        ("timeline.drag_threshold_px", 0.0),
        ("timeline.drag_threshold_px", 101.0),
    ] {
        assert!(
            matches!(s.set(k, v), Err(SettingError::OutOfRange { .. })),
            "{k} = {v}"
        );
    }
    assert_eq!(s, before);
}

#[test]
fn non_finite_values_are_rejected() {
    let mut s = Settings::default();
    for v in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(matches!(
            s.set("phase.tick_rate", v),
            Err(SettingError::NotFinite(_))
        ));
    }
    assert_eq!(s, Settings::default());
}

#[test]
fn integer_settings_reject_fractions() {
    let mut s = Settings::default();
    assert!(matches!(
        s.set("phase.min_run", 2.5),
        Err(SettingError::NotAnInteger(_))
    ));
    assert!(matches!(
        s.set("project.fingerprint_window_bytes", 5000.5),
        Err(SettingError::NotAnInteger(_))
    ));
    assert_eq!(s, Settings::default());
    // fractional settings accept fractions
    assert!(matches!(
        s.set("decode.cache_mb", 100.5),
        Err(SettingError::NotAnInteger(_))
    ));
    assert!(matches!(
        s.set("decode.jpeg_quality", 3.5),
        Err(SettingError::NotAnInteger(_))
    ));
    assert!(matches!(
        s.set("label.advance_to_unlabelled", 0.5),
        Err(SettingError::NotAnInteger(_))
    ));
    assert!(s.set("phase.tick_rate", 19.97).is_ok());
    assert!(s.set("timeline.zoom_factor", 1.3).is_ok());
    assert!(s.set("index.irregular_deviation", 0.3).is_ok());
}

#[test]
fn range_edges_are_inclusive() {
    let mut s = Settings::default();
    for i in Settings::default().describe() {
        assert!(s.set(i.key, i.min).is_ok(), "{} min", i.key);
        assert!(s.set(i.key, i.max).is_ok(), "{} max", i.key);
    }
}
