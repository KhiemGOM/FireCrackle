use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use studio_core::config::{DecodeConfig, IndexConfig};
use studio_core::decode_plan::{plan, DecodeJob, FrameCache};
use studio_core::frames::*;
use studio_core::import::{probe, Tools};
use studio_core::index::{FrameEntry, FrameIndex};

// ------------------------------------------------------------ helpers

/// A structurally valid (but not decodable) JPEG: SOI, APP0, one SOS header, `entropy`, EOI.
fn fake_jpeg(entropy: &[u8]) -> Vec<u8> {
    let mut v = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
    v.extend(b"JFIF\0");
    v.extend([1, 1, 0, 0, 1, 0, 1, 0, 0]);
    v.extend([0xFF, 0xDA, 0x00, 0x08, 1, 1, 0x00, 0, 63, 0]);
    v.extend(entropy);
    v.extend([0xFF, 0xD9]);
    v
}

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

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fc_frames_{}_{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Frame `i` is a horizontal gradient whose mean brightness is `6 + 4 i + 3.5`: the picture says which frame it is.
fn make_video(path: &Path, n: usize, w: usize, h: usize, fps: u32, extra: &[&str]) {
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
            "-r",
            &fps.to_string(),
            "-i",
            "-",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "10",
        ])
        .args(["-pix_fmt", "yuv420p"])
        .args(extra)
        .arg(path)
        .stdin(Stdio::piped())
        .spawn()
        .expect("ffmpeg");
    {
        let stdin = child.stdin.as_mut().unwrap();
        for i in 0..n {
            let mut buf = vec![0u8; w * h];
            for y in 0..h {
                for x in 0..w {
                    buf[y * w + x] = (6 + 4 * i + x % 8) as u8;
                }
            }
            stdin.write_all(&buf).unwrap();
        }
    }
    drop(child.stdin.take());
    assert!(
        child.wait().unwrap().success(),
        "ffmpeg failed to encode the test video"
    );
}

const GOP: &[&str] = &[
    "-bf",
    "2",
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-sc_threshold",
    "0",
];

fn video(name: &str, n: usize, extra: &[&str]) -> (PathBuf, PathBuf, FrameIndex) {
    let dir = scratch(name);
    let v = dir.join("clip.mkv");
    make_video(&v, n, 640, 360, 30, extra);
    let (_, idx) = probe(&Tools::default(), &v, &IndexConfig::default()).unwrap();
    (dir, v, idx)
}

fn job_for(idx: &FrameIndex, want: u32, back: u32, ahead: u32) -> DecodeJob {
    let cfg = DecodeConfig {
        window_back: back,
        window_ahead: ahead,
        ..DecodeConfig::default()
    };
    plan(idx, &FrameCache::new(u64::MAX / 4), want, &cfg)
        .unwrap()
        .job
        .unwrap()
}

fn decode(v: &Path, idx: &FrameIndex, job: &DecodeJob) -> Result<Vec<DecodedFrame>, DecodeError> {
    decode_job(
        &Tools::default(),
        v,
        idx,
        job,
        &DecodeConfig::default(),
        &AtomicBool::new(false),
    )
}

/// Mean brightness of a decoded JPEG, and its size.
fn mean_and_size(jpeg: &[u8]) -> (f64, (u16, u16)) {
    let mut d = jpeg_decoder::Decoder::new(jpeg);
    let px = d.decode().expect("a decodable JPEG");
    let info = d.info().unwrap();
    let sum: u64 = px.iter().map(|&b| b as u64).sum();
    (sum as f64 / px.len() as f64, (info.width, info.height))
}

/// Which frame a decoded picture is, from its brightness.
fn frame_of(jpeg: &[u8]) -> i64 {
    let (m, _) = mean_and_size(jpeg);
    ((m - 9.5) / 4.0).round() as i64
}

// ============================================================ split_jpegs

#[test]
fn one_picture_is_one_range() {
    let j = fake_jpeg(&[1, 2, 3, 4]);
    let s = split_jpegs(&j);
    assert_eq!(
        s,
        Split {
            frames: std::iter::once(0..j.len()).collect(),
            incomplete_tail: 0
        }
    );
}

#[test]
fn concatenated_pictures_are_split_exactly() {
    let a = fake_jpeg(&[1, 2, 3]);
    let b = fake_jpeg(&[9, 8, 7, 6, 5]);
    let c = fake_jpeg(&[]);
    let all: Vec<u8> = [a.clone(), b.clone(), c.clone()].concat();
    let s = split_jpegs(&all);
    assert_eq!(
        s.frames,
        vec![
            0..a.len(),
            a.len()..a.len() + b.len(),
            a.len() + b.len()..all.len()
        ]
    );
    assert_eq!(s.incomplete_tail, 0);
}

#[test]
fn a_stuffed_ff00_followed_by_d9_is_not_the_end() {
    let j = fake_jpeg(&[0x12, 0xFF, 0x00, 0xD9, 0x34]);
    assert_eq!(split_jpegs(&j).frames, vec![0..j.len()]);
}

#[test]
fn restart_markers_inside_the_data_do_not_end_the_picture() {
    let j = fake_jpeg(&[1, 2, 0xFF, 0xD0, 3, 0xFF, 0xD7, 4, 0xFF, 0xD3]);
    assert_eq!(split_jpegs(&j).frames, vec![0..j.len()]);
}

#[test]
fn fill_bytes_before_the_end_marker_are_allowed() {
    let mut j = fake_jpeg(&[1, 2, 3]);
    j.pop();
    j.pop();
    j.extend([0xFF, 0xFF, 0xFF, 0xD9]);
    assert_eq!(split_jpegs(&j).frames, vec![0..j.len()]);
}

#[test]
fn a_multi_scan_picture_with_a_table_between_the_scans_is_one_picture() {
    let mut v = vec![0xFF, 0xD8];
    v.extend([0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 63, 0, 0x11, 0x22]); // scan 1
    v.extend([0xFF, 0xC4, 0x00, 0x04, 0x00, 0x00]); // a table segment
    v.extend([0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 63, 0, 0x33]); // scan 2
    v.extend([0xFF, 0xD9]);
    assert_eq!(split_jpegs(&v).frames, vec![0..v.len()]);
}

#[test]
fn bytes_before_a_start_marker_are_skipped() {
    let j = fake_jpeg(&[1, 2]);
    let mut all = vec![0u8, 1, 2];
    all.extend(&j);
    assert_eq!(split_jpegs(&all).frames, vec![3..3 + j.len()]);
}

#[test]
fn a_truncated_last_picture_is_reported_as_an_incomplete_tail() {
    let a = fake_jpeg(&[1, 2, 3]);
    let b = fake_jpeg(&[4, 5, 6, 7]);
    let mut all = a.clone();
    all.extend(&b[..b.len() - 3]);
    let s = split_jpegs(&all);
    assert_eq!(s.frames, vec![0..a.len()]);
    assert_eq!(s.incomplete_tail, b.len() - 3);
    let only = split_jpegs(&b[..10]);
    assert_eq!((only.frames.len(), only.incomplete_tail), (0, 10));
    assert_eq!(split_jpegs(&[0xFF, 0xD8]).incomplete_tail, 2);
}

#[test]
fn empty_and_garbage_input_have_no_pictures() {
    assert_eq!(
        split_jpegs(&[]),
        Split {
            frames: vec![],
            incomplete_tail: 0
        }
    );
    let s = split_jpegs(&[1, 2, 3, 4, 5, 0xFF, 0x00, 7]);
    assert_eq!(
        (s.frames.len(), s.incomplete_tail),
        (0, 0),
        "nothing started, nothing incomplete"
    );
}

#[test]
fn a_corrupt_segment_length_resyncs_to_the_next_picture() {
    let good = fake_jpeg(&[1, 2, 3]);
    let mut all = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x01, 9, 9]; // a segment claiming length 1 (impossible)
    all.extend(&good);
    let s = split_jpegs(&all);
    assert_eq!(s.frames, vec![8..8 + good.len()]);
}

// ======================================================== parse_showinfo

#[test]
fn showinfo_lines_give_the_frame_times_in_order() {
    let text = "ffmpeg version 8\n\
        [Parsed_showinfo_1 @ 0x1] config in time_base: 1/1000, frame_rate: 60/1\n\
        [Parsed_showinfo_1 @ 0x1] n:   0 pts:   4000 pts_time:4       duration: 16 duration_time:0.016 fmt:yuv420p\n\
        [Parsed_showinfo_1 @ 0x1] n:   1 pts:   4017 pts_time:4.017   duration: 16 duration_time:0.016 fmt:yuv420p\r\n\
        frame=    2 fps=0.0 q=3.0 size=N/A\n\
        [Parsed_showinfo_1 @ 0x1] n:   2 pts:   4033 pts_time:4.033   duration: 16 fmt:yuv420p\n";
    assert_eq!(parse_showinfo(text), vec![4.0, 4.017, 4.033]);
}

#[test]
fn showinfo_with_no_frame_lines_is_empty_and_unreadable_times_are_skipped() {
    assert!(parse_showinfo("").is_empty());
    assert!(
        parse_showinfo("random text pts_time:7\n").is_empty(),
        "only showinfo frame lines count"
    );
    let t = "[Parsed_showinfo_1 @ 0x1] n: 0 pts: N/A pts_time:N/A duration: 1\n[Parsed_showinfo_1 @ 0x1] n: 1 pts: 5 pts_time:0.5 duration: 1\n";
    assert_eq!(parse_showinfo(t), vec![0.5]);
}

#[test]
fn showinfo_times_use_the_exact_integer_pts_not_the_rounded_pts_time() {
    // Half an hour into a 90 kHz stream showinfo prints pts_time with 6 significant digits ("1800.02"),
    // which is 3 ms off: a fifth of a 60 fps frame. The integer pts and the time base are exact.
    let text = "[Parsed_showinfo_1 @ 0x1] config in time_base: 1/90000, frame_rate: 60/1
        [Parsed_showinfo_1 @ 0x1] n:   0 pts:162001501 pts_time:1800.02 duration: 1500
";
    assert_eq!(parse_showinfo(text), vec![162001501.0 / 90000.0]);
}

#[test]
fn showinfo_times_fall_back_to_pts_time_without_a_time_base_line() {
    let text = "[Parsed_showinfo_1 @ 0x1] n: 0 pts: 77 pts_time:1.25 duration: 1
";
    assert_eq!(parse_showinfo(text), vec![1.25]);
}

#[test]
fn the_streaming_parser_keeps_one_entry_per_frame_line_for_alignment() {
    let mut parser = ShowinfoTimes::default();
    assert_eq!(
        parser.line("[Parsed_showinfo_1 @ 0x1] config in time_base: 1/1000, frame_rate: 60/1"),
        None
    );
    assert_eq!(parser.line("frame=    2 fps=0.0"), None);
    assert_eq!(
        parser.line("[Parsed_showinfo_1 @ 0x1] n: 0 pts: 4017 pts_time:4.017 duration: 16"),
        Some(4.017)
    );
    // An unreadable frame still counts as a frame (NaN), so later frames are not shifted.
    assert!(parser
        .line("[Parsed_showinfo_1 @ 0x1] n: 1 pts: N/A pts_time:N/A duration: 16")
        .unwrap()
        .is_nan());
}

// ============================================================ seek_arg

#[test]
fn the_seek_is_a_little_before_the_keyframe() {
    assert_eq!(seek_arg(4.0, 0.5), Some("3.999500".to_string()));
    assert_eq!(seek_arg(120.034, 0.5), Some("120.033500".to_string()));
    assert_eq!(seek_arg(4.0, 0.0), Some("4.000000".to_string()));
    assert_eq!(seek_arg(4.0, 2.0), Some("3.998000".to_string()));
}

#[test]
fn a_keyframe_at_the_start_of_the_file_needs_no_seek() {
    assert_eq!(seek_arg(0.0, 0.5), None);
    assert_eq!(seek_arg(0.0003, 0.5), None);
    assert_eq!(
        seek_arg(0.0005, 0.5),
        None,
        "exactly zero after the back-off"
    );
    assert_eq!(seek_arg(-0.033, 0.5), None);
    assert!(seek_arg(0.001, 0.5).is_some());
}

// ============================================== decoding (needs ffmpeg)

#[test]
fn exact_small_previews_keep_frame_identity_after_the_gop_prefix() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = video("preview_identity", 60, GOP);
    let job = job_for(&idx, 40, 3, 3);
    let cfg = DecodeConfig {
        max_width: 32,
        jpeg_quality: 14,
        ..DecodeConfig::default()
    };
    let result = decode_preview(
        &Tools::default(),
        &v,
        &idx,
        &job,
        &cfg,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        result.iter().map(|f| f.frame).collect::<Vec<_>>(),
        (37..=43).collect::<Vec<_>>()
    );
    for frame in result {
        assert_eq!(frame_of(&frame.jpeg), frame.frame as i64);
        assert_eq!(mean_and_size(&frame.jpeg).1 .0, 32);
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn exact_small_previews_reject_a_shifted_index() {
    if !have_tools() {
        return;
    }
    let (dir, v, mut idx) = video("preview_wrong_index", 60, GOP);
    idx.frames[40].pts += 1.;
    let job = job_for(&idx, 40, 0, 0);
    let result = decode_preview(
        &Tools::default(),
        &v,
        &idx,
        &job,
        &DecodeConfig::default(),
        &AtomicBool::new(false),
    );
    assert!(matches!(result, Err(DecodeError::Misaligned { .. })));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_window_decodes_to_the_right_pictures_in_order() {
    if !have_tools() {
        eprintln!("ffmpeg not found, skipping");
        return;
    }
    let (dir, v, idx) = video("window", 60, GOP);
    // keyframes at 0 and 30; the window starts mid-GOP, so the keyframe frames 30..34 are decoded and dropped
    let job = job_for(&idx, 40, 5, 5);
    assert_eq!((job.first, job.last, job.keyframe), (35, 45, 30));
    let frames = decode(&v, &idx, &job).unwrap();
    assert_eq!(
        frames.iter().map(|f| f.frame).collect::<Vec<_>>(),
        (35..=45).collect::<Vec<u32>>()
    );
    for f in &frames {
        assert_eq!(
            frame_of(&f.jpeg),
            f.frame as i64,
            "picture of frame {}",
            f.frame
        );
        assert_eq!(&f.jpeg[..2], &[0xFF, 0xD8]);
        assert_eq!(&f.jpeg[f.jpeg.len() - 2..], &[0xFF, 0xD9]);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_first_and_the_last_frames_of_the_video_decode() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = video("ends", 60, GOP);
    let head = decode(&v, &idx, &job_for(&idx, 0, 3, 6)).unwrap();
    assert_eq!(
        head.iter().map(|f| f.frame).collect::<Vec<_>>(),
        (0..=6).collect::<Vec<u32>>()
    );
    assert!(head.iter().all(|f| frame_of(&f.jpeg) == f.frame as i64));
    let tail = decode(&v, &idx, &job_for(&idx, 59, 6, 3)).unwrap();
    assert_eq!(
        tail.iter().map(|f| f.frame).collect::<Vec<_>>(),
        (53..=59).collect::<Vec<u32>>()
    );
    assert!(tail.iter().all(|f| frame_of(&f.jpeg) == f.frame as i64));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn videos_with_and_without_b_frames_both_stay_aligned() {
    if !have_tools() {
        return;
    }
    for (name, extra) in [
        (
            "nob",
            vec![
                "-bf",
                "0",
                "-g",
                "30",
                "-keyint_min",
                "30",
                "-sc_threshold",
                "0",
            ],
        ),
        (
            "b3",
            vec![
                "-bf",
                "3",
                "-g",
                "20",
                "-keyint_min",
                "20",
                "-sc_threshold",
                "0",
            ],
        ),
    ] {
        let (dir, v, idx) = video(name, 60, &extra);
        for want in [1u32, 19, 20, 21, 33, 58] {
            let job = job_for(&idx, want, 4, 4);
            let frames = decode(&v, &idx, &job).unwrap();
            assert_eq!(
                frames.len() as u32,
                job.last - job.first + 1,
                "{name} want {want}"
            );
            for f in &frames {
                assert_eq!(
                    frame_of(&f.jpeg),
                    f.frame as i64,
                    "{name} want {want} frame {}",
                    f.frame
                );
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn a_single_frame_job_returns_just_that_frame() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = video("single", 60, GOP);
    let cfg = DecodeConfig {
        window_back: 0,
        window_ahead: 0,
        ..DecodeConfig::default()
    };
    let job = plan(&idx, &FrameCache::new(1 << 30), 47, &cfg)
        .unwrap()
        .job
        .unwrap();
    assert_eq!((job.first, job.last, job.keyframe), (47, 47, 30));
    let frames = decode(&v, &idx, &job).unwrap();
    assert_eq!(frames.len(), 1);
    assert_eq!((frames[0].frame, frame_of(&frames[0].jpeg)), (47, 47));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_video_that_does_not_start_at_time_zero_decodes() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = video(
        "offset",
        40,
        &["-bf", "2", "-g", "30", "-output_ts_offset", "1.5"],
    );
    assert!(idx.frames[0].pts > 1.0, "start {}", idx.frames[0].pts);
    let frames = decode(&v, &idx, &job_for(&idx, 5, 5, 5)).unwrap();
    assert_eq!(frames.first().map(|f| f.frame), Some(0));
    assert!(frames.iter().all(|f| frame_of(&f.jpeg) == f.frame as i64));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_width_is_capped_and_the_aspect_kept() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = video("width", 40, GOP);
    let job = job_for(&idx, 10, 1, 1);
    let small = DecodeConfig {
        max_width: 320,
        ..DecodeConfig::default()
    };
    let f = decode_job(
        &Tools::default(),
        &v,
        &idx,
        &job,
        &small,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(mean_and_size(&f[0].jpeg).1, (320, 180));
    let big = DecodeConfig {
        max_width: 4000,
        ..DecodeConfig::default()
    };
    let g = decode_job(
        &Tools::default(),
        &v,
        &idx,
        &job,
        &big,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(mean_and_size(&g[0].jpeg).1, (640, 360), "never scaled up");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn paths_with_spaces_and_non_ascii_decode() {
    if !have_tools() {
        return;
    }
    let dir = scratch("paths").join("my clips ü 火");
    std::fs::create_dir_all(&dir).unwrap();
    let v = dir.join("2026-10-15 14-15-51 ü.mkv");
    make_video(&v, 40, 640, 360, 30, GOP);
    let (_, idx) = probe(&Tools::default(), &v, &IndexConfig::default()).unwrap();
    let frames = decode(&v, &idx, &job_for(&idx, 12, 2, 2)).unwrap();
    assert!(frames.iter().all(|f| frame_of(&f.jpeg) == f.frame as i64));
    let _ = std::fs::remove_dir_all(dir.parent().unwrap());
}

// ------------------------------------------------------------ failures

#[test]
fn a_cancelled_decode_returns_cancelled() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = video("cancel", 60, GOP);
    let cancel = AtomicBool::new(true);
    let r = decode_job(
        &Tools::default(),
        &v,
        &idx,
        &job_for(&idx, 40, 5, 5),
        &DecodeConfig::default(),
        &cancel,
    );
    assert_eq!(r, Err(DecodeError::Cancelled));
    cancel.store(false, Ordering::SeqCst);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_missing_ffmpeg_is_a_typed_error() {
    let (idx, job) = fabricated();
    let tools = Tools {
        ffmpeg: "definitely-not-ffmpeg-xyz".into(),
        ffprobe: "x".into(),
    };
    let r = decode_job(
        &tools,
        Path::new("whatever.mkv"),
        &idx,
        &job,
        &DecodeConfig::default(),
        &AtomicBool::new(false),
    );
    assert!(matches!(r, Err(DecodeError::ToolMissing(_))), "{r:?}");
}

fn fabricated() -> (FrameIndex, DecodeJob) {
    let frames: Vec<FrameEntry> = (0..60)
        .map(|n| FrameEntry {
            n,
            pts: n as f64 / 30.0,
            key: n % 30 == 0,
        })
        .collect();
    let pk: Vec<studio_core::index::Packet> = frames
        .iter()
        .map(|f| studio_core::index::Packet {
            pts: Some(f.pts),
            dts: None,
            key: f.key,
        })
        .collect();
    let idx = studio_core::index::build_index(&pk, &IndexConfig::default()).unwrap();
    let job = job_for(&idx, 40, 5, 5);
    (idx, job)
}

#[test]
fn a_job_that_does_not_fit_the_index_is_refused() {
    let (idx, good) = fabricated();
    let none = AtomicBool::new(false);
    let run = |job: DecodeJob| {
        decode_job(
            &Tools::default(),
            Path::new("x.mkv"),
            &idx,
            &job,
            &DecodeConfig::default(),
            &none,
        )
    };
    assert!(matches!(
        run(DecodeJob {
            first: 20,
            last: 10,
            ..good
        }),
        Err(DecodeError::BadJob(_))
    ));
    assert!(matches!(
        run(DecodeJob { last: 60, ..good }),
        Err(DecodeError::BadJob(_))
    ));
    assert!(matches!(
        run(DecodeJob {
            keyframe: good.first + 1,
            ..good
        }),
        Err(DecodeError::BadJob(_))
    ));
    assert!(matches!(
        run(DecodeJob {
            decode_count: good.decode_count + 1,
            ..good
        }),
        Err(DecodeError::BadJob(_))
    ));
    assert!(matches!(
        run(DecodeJob {
            decode_count: 0,
            ..good
        }),
        Err(DecodeError::BadJob(_))
    ));
}

#[test]
fn an_index_longer_than_the_file_is_a_short_read() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = video("short", 60, GOP);
    // pretend the video has 40 more frames than it really has
    let mut frames = idx.frames.clone();
    for k in 0..40u32 {
        frames.push(FrameEntry {
            n: 60 + k,
            pts: idx.frames[59].pts + (k + 1) as f64 / 30.0,
            key: false,
        });
    }
    let long = FrameIndex {
        frames,
        summary: idx.summary.clone(),
    };
    let job = DecodeJob {
        keyframe: 30,
        seek_pts: long.frames[30].pts,
        first: 58,
        last: 70,
        decode_count: 41,
        slow: false,
    };
    match decode(&v, &long, &job) {
        // Only the requested frames are encoded now; the discarded seek prefix
        // is excluded from both the expected and actual picture counts.
        Err(DecodeError::ShortRead { expected, got }) => assert_eq!((expected, got), (13, 2)),
        other => panic!("{other:?}"),
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_index_that_lost_a_frame_is_caught_as_misaligned_not_shown_wrongly() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = video("misaligned", 60, GOP);
    // the index forgot frame 45: from there on, index frame n is really video frame n + 1
    let mut frames: Vec<FrameEntry> = idx.frames.iter().filter(|f| f.n != 45).copied().collect();
    for (i, f) in frames.iter_mut().enumerate() {
        f.n = i as u32;
    }
    let skewed = FrameIndex {
        frames,
        summary: idx.summary.clone(),
    };
    let job = job_for(&skewed, 45, 8, 4);
    match decode(&v, &skewed, &job) {
        Err(DecodeError::Misaligned {
            frame,
            expected_pts,
            got_pts,
        }) => {
            assert_eq!(frame, 45);
            assert!(
                (got_pts - expected_pts).abs() > 0.02,
                "{expected_pts} vs {got_pts}"
            );
        }
        other => panic!("{other:?}"),
    }
    // a huge tolerance accepts it: the check is a setting, not a hard-coded rule
    let lax = DecodeConfig {
        align_tolerance: 10.0,
        ..DecodeConfig::default()
    };
    assert!(decode_job(
        &Tools::default(),
        &v,
        &skewed,
        &job,
        &lax,
        &AtomicBool::new(false)
    )
    .is_ok());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_jpeg_quality_setting_changes_the_size() {
    if !have_tools() {
        return;
    }
    let dir = scratch("quality");
    let v = dir.join("noise.mkv");
    // pseudo-random noise frames: size depends strongly on the quantiser
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
            "320x180",
            "-r",
            "30",
            "-i",
            "-",
        ])
        .args([
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "8", "-pix_fmt", "yuv420p",
        ])
        .arg(&v)
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let stdin = child.stdin.as_mut().unwrap();
        let mut s: u64 = 88172645463325252;
        for _ in 0..6 {
            let buf: Vec<u8> = (0..320 * 180)
                .map(|_| {
                    s ^= s << 13;
                    s ^= s >> 7;
                    s ^= s << 17;
                    (s >> 24) as u8
                })
                .collect();
            stdin.write_all(&buf).unwrap();
        }
    }
    drop(child.stdin.take());
    assert!(child.wait().unwrap().success());
    let (_, idx) = probe(&Tools::default(), &v, &IndexConfig::default()).unwrap();
    let job = job_for(&idx, 2, 0, 0);
    let size = |q: u32| {
        let c = DecodeConfig {
            jpeg_quality: q,
            ..DecodeConfig::default()
        };
        decode_job(
            &Tools::default(),
            &v,
            &idx,
            &job,
            &c,
            &AtomicBool::new(false),
        )
        .unwrap()[0]
            .jpeg
            .len()
    };
    assert!(size(2) > size(31) * 2, "q2 {} vs q31 {}", size(2), size(31));
    let _ = std::fs::remove_dir_all(&dir);
}

// ============================================================ decode_exact_png

/// A wide clip (wider than the 1280-pixel display JPEGs) with keyframes every 30 frames and B-frames.
fn wide_video(name: &str, n: usize) -> (PathBuf, PathBuf, FrameIndex) {
    let dir = scratch(name);
    let v = dir.join("clip.mkv");
    make_video(&v, n, 1600, 900, 30, GOP);
    let (_, idx) = probe(&Tools::default(), &v, &IndexConfig::default()).unwrap();
    (dir, v, idx)
}

/// RGB pixels and size of a PNG.
fn png_rgb(bytes: &[u8]) -> (Vec<u8>, (u32, u32)) {
    let mut reader = png::Decoder::new(bytes).read_info().expect("a PNG");
    let mut px = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut px).unwrap();
    assert_eq!(
        info.color_type,
        png::ColorType::Rgb,
        "lossless RGB, no alpha or palette"
    );
    px.truncate(info.buffer_size());
    (px, (info.width, info.height))
}

/// FFmpeg's own decode of picture `k`, straight from the start of the file: the reference for exactness.
fn reference_rgb(v: &Path, k: u32) -> Vec<u8> {
    let out = Command::new("ffmpeg")
        .args(["-loglevel", "error", "-i"])
        .arg(v)
        .args([
            "-vf",
            &format!(r"select=eq(n\,{k})"),
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    out.stdout
}

fn exact(v: &Path, idx: &FrameIndex, frame: u32) -> Result<Vec<u8>, DecodeError> {
    decode_exact_png(
        &Tools::default(),
        v,
        idx,
        frame,
        &DecodeConfig::default(),
        &AtomicBool::new(false),
    )
}

#[test]
fn an_exact_frame_is_native_size_and_pixel_identical_to_a_full_decode() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = wide_video("exact_native", 45);
    // a keyframe, a mid-GOP frame (B-frames before it) and the last frame
    for frame in [0, 37, 44] {
        let (px, size) = png_rgb(&exact(&v, &idx, frame).unwrap());
        assert_eq!(
            size,
            (1600, 900),
            "frame {frame} keeps the video's own resolution"
        );
        assert!(
            px == reference_rgb(&v, frame),
            "frame {frame} differs from FFmpeg's decode of that frame"
        );
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn exact_frames_are_not_neighbours() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = wide_video("exact_identity", 45);
    let a = png_rgb(&exact(&v, &idx, 36).unwrap()).0;
    let b = png_rgb(&exact(&v, &idx, 37).unwrap()).0;
    assert!(a != b);
    assert!(b == reference_rgb(&v, 37));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_exact_frame_rejects_a_shifted_index() {
    if !have_tools() {
        return;
    }
    let (dir, v, mut idx) = wide_video("exact_wrong_index", 45);
    idx.frames[37].pts += 1.;
    assert!(matches!(
        exact(&v, &idx, 37),
        Err(DecodeError::Misaligned { .. })
    ));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_exact_frame_outside_the_video_is_a_bad_job() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = wide_video("exact_outside", 10);
    assert!(matches!(exact(&v, &idx, 10), Err(DecodeError::BadJob(_))));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_cancelled_exact_frame_never_decodes() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = wide_video("exact_cancel", 10);
    let result = decode_exact_png(
        &Tools::default(),
        &v,
        &idx,
        3,
        &DecodeConfig::default(),
        &AtomicBool::new(true),
    );
    assert!(matches!(result, Err(DecodeError::Cancelled)));
    let _ = std::fs::remove_dir_all(dir);
}

/// Names of the chunks in a PNG, in order.
fn png_chunks(bytes: &[u8]) -> Vec<String> {
    let (mut at, mut names) = (8, vec![]);
    while at + 8 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        names.push(String::from_utf8_lossy(&bytes[at + 4..at + 8]).into_owned());
        at += 12 + len;
    }
    names
}

#[test]
fn an_exact_frame_carries_no_colour_tags_so_it_shows_the_decoded_values() {
    if !have_tools() {
        return;
    }
    let dir = scratch("exact_untagged");
    let v = dir.join("clip.mkv");
    // BT.709 tags in the stream itself, as screen recorders write them
    let tags = [
        "-bsf:v",
        "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1",
    ];
    make_video(&v, 10, 1600, 900, 30, &[GOP, &tags].concat());
    let (_, idx) = probe(&Tools::default(), &v, &IndexConfig::default()).unwrap();
    let png = exact(&v, &idx, 4).unwrap();
    let chunks = png_chunks(&png);
    for tag in ["gAMA", "cHRM", "cICP", "iCCP", "sRGB"] {
        assert!(
            !chunks.iter().any(|c| c == tag),
            "{tag} would make the viewer colour-manage: {chunks:?}"
        );
    }
    assert_eq!(chunks.first().map(String::as_str), Some("IHDR"));
    assert_eq!(chunks.last().map(String::as_str), Some("IEND"));
    assert!(png_rgb(&png).0 == reference_rgb(&v, 4));
    let _ = std::fs::remove_dir_all(dir);
}
