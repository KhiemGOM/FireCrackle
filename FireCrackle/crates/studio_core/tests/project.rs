use std::path::{Path, PathBuf};
use studio_core::config::IndexConfig;
use studio_core::index::{build_index, Packet};
use studio_core::project::*;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fc_project_{}_{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn meta() -> VideoMeta {
    VideoMeta {
        width: 1920,
        height: 1080,
        fps_num: 60,
        fps_den: 1,
        codec: "h264".into(),
    }
}

fn index_of(n: usize) -> studio_core::index::FrameIndex {
    let pk: Vec<Packet> = (0..n)
        .map(|i| Packet {
            pts: Some(i as f64 / 60.0),
            dts: None,
            key: i % 4 == 0,
        })
        .collect();
    build_index(&pk, &IndexConfig::default()).unwrap()
}

fn assemble(index: &studio_core::index::FrameIndex) -> Project {
    Project::assemble("v.mkv", 1234, "1234:abcd".into(), meta(), index)
}

fn has(p: &Project, word: &str) -> bool {
    p.warnings.iter().any(|w| w.to_lowercase().contains(word))
}

// ------------------------------------------------------------ assemble

#[test]
fn assemble_copies_the_display_order_index_into_frames() {
    let idx = index_of(8);
    let p = assemble(&idx);
    assert_eq!(p.version, PROJECT_VERSION);
    assert_eq!(p.frames.len(), 8);
    for (n, f) in p.frames.iter().enumerate() {
        assert_eq!(f.pts, idx.frames[n].pts);
        assert_eq!(f.key, n % 4 == 0);
    }
    assert_eq!(p.video_path, "v.mkv");
    assert_eq!(p.video_size, 1234);
    assert_eq!(p.fingerprint, "1234:abcd");
    assert_eq!(p.meta, meta());
    assert_eq!(p.index, idx.summary);
}

#[test]
fn a_clean_import_has_no_warnings() {
    let p = assemble(&index_of(60));
    assert!(p.warnings.is_empty(), "{:?}", p.warnings);
}

#[test]
fn timing_problems_in_the_index_are_reported() {
    let pk = [
        Packet {
            pts: Some(0.0),
            dts: None,
            key: true,
        },
        Packet {
            pts: Some(0.1),
            dts: None,
            key: false,
        },
        Packet {
            pts: Some(0.1),
            dts: None,
            key: false,
        },
        Packet {
            pts: None,
            dts: None,
            key: false,
        },
    ];
    let idx = build_index(&pk, &IndexConfig::default()).unwrap();
    let p = assemble(&idx);
    assert!(has(&p, "duplicate"), "{:?}", p.warnings);
    assert!(has(&p, "timestamp"), "{:?}", p.warnings);

    let mut t = 0.0;
    let vfr: Vec<Packet> = (0..100)
        .map(|i| {
            t += if i % 2 == 0 { 0.01 } else { 0.04 };
            Packet {
                pts: Some(t),
                dts: None,
                key: i == 0,
            }
        })
        .collect();
    let idx = build_index(&vfr, &IndexConfig::default()).unwrap();
    assert!(has(&assemble(&idx), "variable frame rate"));
}

#[test]
fn a_single_dropped_footage_gap_is_reported_with_its_size() {
    let mut pk: Vec<Packet> = (0..1000)
        .map(|i| Packet {
            pts: Some((i as f64 * 1000.0 / 60.0).round() / 1000.0),
            dts: None,
            key: i == 0,
        })
        .collect();
    for x in pk.iter_mut().skip(500) {
        x.pts = x.pts.map(|v| v + 0.2);
    }
    let idx = build_index(&pk, &IndexConfig::default()).unwrap();
    let p = assemble(&idx);
    assert!(
        has(&p, "gap"),
        "a 200 ms hole is worth a warning even though the video is not VFR: {:?}",
        p.warnings
    );
}

#[test]
fn no_warning_mentions_a_sync_strip() {
    // the serialised project has no strip-related field, and a one-frame video (the most degenerate
    // case) warns about nothing strip-related either
    let json = serde_json::to_string(&assemble(&index_of(10)))
        .unwrap()
        .to_lowercase();
    assert!(!json.contains("strip"), "{json}");
    let single = [Packet {
        pts: Some(0.0),
        dts: None,
        key: true,
    }];
    let w = assemble(&build_index(&single, &IndexConfig::default()).unwrap()).warnings;
    assert!(
        w.iter().all(|x| !x.to_lowercase().contains("strip")),
        "{w:?}"
    );
}

// ---------------------------------------------------------- save / load

fn sample() -> Project {
    assemble(&index_of(40))
}

#[test]
fn save_then_load_round_trips_exactly() {
    let dir = scratch("rt");
    let path = dir.join("project.json");
    let p = sample();
    p.save(&path).unwrap();
    assert_eq!(Project::load(&path).unwrap(), p);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn save_leaves_no_temp_file_behind_and_overwrites_cleanly() {
    let dir = scratch("tmp");
    let path = dir.join("project.json");
    let mut p = sample();
    p.save(&path).unwrap();
    p.warnings.push("changed".into());
    p.save(&path).unwrap();
    assert_eq!(Project::load(&path).unwrap(), p);
    let names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        names,
        vec!["project.json".to_string()],
        "no temp files: {names:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_stale_temp_file_from_a_crashed_save_does_not_break_the_next_save() {
    let dir = scratch("stale");
    let path = dir.join("project.json");
    let p = sample();
    p.save(&path).unwrap();
    // simulate a crash mid-save: garbage next to the real file
    for name in ["project.json.tmp", "project.tmp", ".project.json.tmp"] {
        std::fs::write(dir.join(name), b"{ half a proj").unwrap();
    }
    assert_eq!(
        Project::load(&path).unwrap(),
        p,
        "the real file is untouched by the stale temp"
    );
    let mut p2 = p.clone();
    p2.warnings.push("second".into());
    p2.save(&path).unwrap();
    assert_eq!(Project::load(&path).unwrap(), p2);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_failed_save_keeps_the_previous_file() {
    let dir = scratch("fail");
    let path = dir.join("project.json");
    let p = sample();
    p.save(&path).unwrap();
    let bad = dir.join("no_such_dir").join("project.json");
    assert!(matches!(p.save(&bad), Err(ProjectError::Io(_))));
    assert_eq!(Project::load(&path).unwrap(), p);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn paths_with_spaces_and_non_ascii_work() {
    let dir = scratch("uni").join("my proj Ã¼ ç«");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("project file.json");
    let p = sample();
    p.save(&path).unwrap();
    assert_eq!(Project::load(&path).unwrap(), p);
    let _ = std::fs::remove_dir_all(dir.parent().unwrap());
}

#[test]
fn loading_bad_files_gives_typed_errors() {
    let dir = scratch("bad");
    assert!(matches!(
        Project::load(&dir.join("missing.json")),
        Err(ProjectError::Io(_))
    ));
    let empty = dir.join("empty.json");
    std::fs::write(&empty, b"").unwrap();
    assert!(matches!(
        Project::load(&empty),
        Err(ProjectError::Corrupt(_))
    ));
    let garbage = dir.join("garbage.json");
    std::fs::write(&garbage, b"not json at all").unwrap();
    assert!(matches!(
        Project::load(&garbage),
        Err(ProjectError::Corrupt(_))
    ));
    // truncated mid-write
    let full = serde_json::to_string(&sample()).unwrap();
    let trunc = dir.join("trunc.json");
    std::fs::write(&trunc, &full.as_bytes()[..full.len() / 2]).unwrap();
    assert!(matches!(
        Project::load(&trunc),
        Err(ProjectError::Corrupt(_))
    ));
    // valid JSON of the wrong shape
    let wrong = dir.join("wrong.json");
    std::fs::write(&wrong, b"{\"hello\":1}").unwrap();
    assert!(matches!(
        Project::load(&wrong),
        Err(ProjectError::Corrupt(_))
    ));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_newer_file_version_is_refused_not_misread() {
    let dir = scratch("ver");
    let path = dir.join("project.json");
    let mut p = sample();
    p.version = PROJECT_VERSION + 41;
    std::fs::write(&path, serde_json::to_string(&p).unwrap()).unwrap();
    assert_eq!(
        Project::load(&path),
        Err(ProjectError::UnsupportedVersion {
            found: PROJECT_VERSION + 41
        })
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// ----------------------------------------------- fingerprint / verify

fn write(path: &Path, bytes: &[u8]) {
    std::fs::write(path, bytes).unwrap();
}

fn data(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i.wrapping_mul(31) % 251) as u8).collect()
}

#[test]
fn fingerprint_is_size_window_and_a_16_hex_digit_hash() {
    let dir = scratch("fp1");
    let f = dir.join("a.bin");
    write(&f, &data(20_000));
    let fp = fingerprint(&f, 4096).unwrap();
    let parts: Vec<&str> = fp.split(':').collect();
    assert_eq!(parts.len(), 3, "{fp}");
    assert_eq!(parts[0], "20000");
    assert_eq!(
        parts[1], "4096",
        "the window is recorded so verify does not depend on today's settings"
    );
    let hash = parts[2];
    assert_eq!(hash.len(), 16);
    assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(fp, fingerprint(&f, 4096).unwrap(), "stable");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fingerprint_notices_changes_at_the_start_the_end_and_the_size() {
    let dir = scratch("fp2");
    let f = dir.join("a.bin");
    let base = data(20_000);
    write(&f, &base);
    let fp = fingerprint(&f, 4096).unwrap();

    let mut head = base.clone();
    head[100] ^= 0xFF;
    write(&f, &head);
    assert_ne!(fingerprint(&f, 4096).unwrap(), fp, "start of file");

    let mut tail = base.clone();
    tail[19_990] ^= 0xFF;
    write(&f, &tail);
    assert_ne!(fingerprint(&f, 4096).unwrap(), fp, "end of file");

    let mut longer = base.clone();
    longer.push(7);
    write(&f, &longer);
    assert_ne!(fingerprint(&f, 4096).unwrap(), fp, "size");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fingerprint_window_is_configurable_and_the_middle_is_a_documented_blind_spot() {
    let dir = scratch("fp3");
    let f = dir.join("a.bin");
    let base = data(20_000);
    write(&f, &base);
    let mut mid = base.clone();
    mid[10_000] ^= 0xFF;
    let small = fingerprint(&f, 4096).unwrap();
    write(&f, &mid);
    assert_eq!(
        fingerprint(&f, 4096).unwrap(),
        small,
        "middle bytes are not hashed with a 4 KiB window"
    );
    assert_ne!(
        fingerprint(&f, 20_000).unwrap(),
        {
            write(&f, &base);
            fingerprint(&f, 20_000).unwrap()
        },
        "a window covering the file hashes the middle too"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fingerprint_handles_tiny_empty_and_missing_files() {
    let dir = scratch("fp4");
    let f = dir.join("tiny.bin");
    write(&f, b"abc");
    assert!(fingerprint(&f, 4096).unwrap().starts_with("3:4096:"));
    write(&f, b"");
    assert!(fingerprint(&f, 4096).unwrap().starts_with("0:4096:"));
    assert!(fingerprint(&dir.join("nope.bin"), 4096).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn verify_uses_the_window_recorded_in_the_fingerprint_and_rejects_a_malformed_one() {
    let dir = scratch("fp5");
    let f = dir.join("a.bin");
    write(&f, &data(50_000));
    let mut p = sample();
    p.video_path = f.to_string_lossy().into_owned();
    p.video_size = 50_000;
    for window in [4096u64, 8192, 1 << 20] {
        p.fingerprint = fingerprint(&f, window).unwrap();
        assert_eq!(p.verify_video(), Ok(()), "window {window}");
    }
    p.fingerprint = "garbage".into();
    assert!(matches!(p.verify_video(), Err(ProjectError::Corrupt(_))));
    p.fingerprint = "50000:notanumber:0123456789abcdef".into();
    assert!(matches!(p.verify_video(), Err(ProjectError::Corrupt(_))));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn verify_video_checks_existence_and_identity() {
    let dir = scratch("verify");
    let f = dir.join("clip Ã¼.mkv");
    let base = data(30_000);
    write(&f, &base);
    let mut p = sample();
    p.video_path = f.to_string_lossy().into_owned();
    p.video_size = base.len() as u64;
    p.fingerprint = fingerprint(&f, 4096).unwrap();
    assert_eq!(p.verify_video(), Ok(()));

    let mut changed = base.clone();
    changed[5] ^= 1;
    write(&f, &changed);
    assert_eq!(
        p.verify_video(),
        Err(ProjectError::VideoChanged),
        "same size, different head"
    );

    write(&f, &base);
    assert_eq!(p.verify_video(), Ok(()));
    std::fs::remove_file(&f).unwrap();
    assert!(matches!(
        p.verify_video(),
        Err(ProjectError::VideoMissing(_))
    ));
    let _ = std::fs::remove_dir_all(&dir);
}

// ------------------------------------------------------------ frame_index

#[test]
fn a_project_rebuilds_the_frame_index_it_was_made_from() {
    let idx = index_of(120);
    let p = assemble(&idx);
    let back = p.frame_index();
    assert_eq!(back.frames, idx.frames);
    assert_eq!(back.summary, idx.summary);
    assert_eq!(back.keyframe_at_or_before(7), idx.keyframe_at_or_before(7));
    assert_eq!(back.frame_at_time(0.5), idx.frame_at_time(0.5));
    // and survives the file
    let dir = scratch("frameindex");
    let path = dir.join("project.json");
    p.save(&path).unwrap();
    assert_eq!(
        Project::load(&path).unwrap().frame_index().frames,
        idx.frames
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_project_folder_sits_beside_the_video() {
    use std::path::Path;
    use studio_core::project::project_dir;
    assert_eq!(
        project_dir(Path::new("D:/clips/fire.mkv")).unwrap(),
        Path::new("D:/clips/fire.mkv.firecrackle")
    );
    assert_eq!(
        project_dir(Path::new("fire.mp4")).unwrap(),
        Path::new("fire.mp4.firecrackle")
    );
    assert!(project_dir(Path::new("/")).is_none());
}
