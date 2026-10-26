use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::AtomicBool;
use studio_core::config::{IndexConfig, TimelineConfig};
use studio_core::import::{probe, Tools};
use studio_core::index::{build_index, FrameIndex, Packet};
use studio_core::thumbs::*;

// ------------------------------------------------------------ helpers

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fc_thumbs_{}_{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// `n` frames at `fps`, a keyframe every `gop` frames (frame 0 always).
fn index(n: usize, fps: f64, gop: usize) -> FrameIndex {
    let pk: Vec<Packet> = (0..n)
        .map(|i| Packet {
            pts: Some(i as f64 / fps),
            dts: None,
            key: i % gop == 0,
        })
        .collect();
    build_index(&pk, &IndexConfig::default()).unwrap()
}

fn key(stride: u32) -> ThumbKey {
    ThumbKey {
        fingerprint: "1:4096:0".into(),
        width: 96,
        quality: 5,
        stride,
    }
}

fn thumb(frame: u32) -> Thumb {
    Thumb {
        frame,
        jpeg: vec![frame as u8; 16],
    }
}

// ============================================================ stride / selection

#[test]
fn the_keyframes_of_an_index_are_listed_in_order() {
    assert_eq!(keyframes(&index(100, 30.0, 30)), vec![0, 30, 60, 90]);
}

#[test]
fn stride_is_one_while_the_keyframes_fit_the_cap() {
    assert_eq!(stride(10, 600), 1);
    assert_eq!(stride(600, 600), 1, "exactly the cap");
    assert_eq!(stride(0, 600), 1, "no keyframes is not a division by zero");
}

#[test]
fn stride_grows_so_the_selection_never_exceeds_the_cap() {
    assert_eq!(stride(601, 600), 2);
    assert_eq!(stride(1200, 600), 2);
    assert_eq!(stride(1201, 600), 3);
    assert_eq!(stride(5, 1), 5);
    for count in [1usize, 7, 100, 599, 600, 601, 5000, 123_457] {
        for cap in [1u32, 2, 3, 50, 600] {
            let k = stride(count, cap) as usize;
            let kept = count.div_ceil(k);
            assert!(
                kept <= cap as usize,
                "count {count} cap {cap} stride {k} keeps {kept}"
            );
        }
    }
}

#[test]
fn a_zero_cap_is_treated_as_one_not_a_panic() {
    assert_eq!(stride(10, 0), 10);
}

#[test]
fn selection_takes_every_stride_th_keyframe_starting_with_the_first() {
    let idx = index(300, 30.0, 30); // keyframes 0,30,...,270 (10)
    assert_eq!(
        selected(&idx, 1),
        vec![0, 30, 60, 90, 120, 150, 180, 210, 240, 270]
    );
    assert_eq!(selected(&idx, 3), vec![0, 90, 180, 270]);
    assert_eq!(selected(&idx, 100), vec![0]);
}

#[test]
fn an_index_with_only_the_first_keyframe_selects_it() {
    assert_eq!(selected(&index(50, 30.0, 1000), 1), vec![0]);
}

// ============================================================ assign

#[test]
fn times_map_to_the_frames_they_belong_to() {
    let idx = index(100, 20.0, 10);
    assert_eq!(
        assign(&idx, &[0.0, 0.5, 1.0], 0.5).unwrap(),
        vec![0, 10, 20]
    );
}

#[test]
fn a_time_slightly_off_still_maps_within_the_tolerance() {
    let idx = index(100, 20.0, 10);
    assert_eq!(assign(&idx, &[0.5 + 0.01], 0.5).unwrap(), vec![10]); // interval 0.05, tolerance 0.025
}

#[test]
fn a_time_between_frames_is_misaligned_not_guessed() {
    let idx = index(100, 20.0, 10);
    // 0.025 s off in a 0.05 s interval with tolerance 0.25 (0.0125 s) must be rejected
    assert!(matches!(
        assign(&idx, &[0.5 + 0.025], 0.25),
        Err(ThumbError::Misaligned { .. })
    ));
}

#[test]
fn a_time_far_outside_the_video_is_misaligned() {
    let idx = index(100, 20.0, 10);
    assert!(matches!(
        assign(&idx, &[99.0], 0.5),
        Err(ThumbError::Misaligned { .. })
    ));
    assert!(matches!(
        assign(&idx, &[-5.0], 0.5),
        Err(ThumbError::Misaligned { .. })
    ));
}

#[test]
fn an_empty_list_of_times_is_no_pictures() {
    assert_eq!(
        assign(&index(10, 20.0, 5), &[], 0.5),
        Err(ThumbError::NoPictures)
    );
}

#[test]
fn two_pictures_for_one_frame_are_a_bad_stream() {
    let idx = index(100, 20.0, 10);
    assert!(matches!(
        assign(&idx, &[0.5, 0.5], 0.5),
        Err(ThumbError::BadStream(_))
    ));
}

#[test]
fn times_that_go_backwards_are_a_bad_stream() {
    let idx = index(100, 20.0, 10);
    assert!(matches!(
        assign(&idx, &[1.0, 0.5], 0.5),
        Err(ThumbError::BadStream(_))
    ));
}

#[test]
fn nan_times_are_rejected() {
    let idx = index(100, 20.0, 10);
    assert!(assign(&idx, &[f64::NAN], 0.5).is_err());
}

// ============================================================ nearest

#[test]
fn nearest_finds_the_closest_thumbnail_frame() {
    let f = [0u32, 30, 60, 90];
    assert_eq!(nearest(&f, 0), Some(0));
    assert_eq!(nearest(&f, 14), Some(0));
    assert_eq!(nearest(&f, 16), Some(30));
    assert_eq!(nearest(&f, 89), Some(90));
}

#[test]
fn nearest_breaks_a_tie_toward_the_earlier_thumbnail() {
    assert_eq!(nearest(&[0, 30], 15), Some(0));
}

#[test]
fn nearest_clamps_outside_the_range_and_handles_nothing() {
    assert_eq!(nearest(&[10, 20], 0), Some(10));
    assert_eq!(nearest(&[10, 20], 999), Some(20));
    assert_eq!(nearest(&[], 5), None);
    assert_eq!(nearest(&[7], 5000), Some(7));
}

// ============================================================ plan

#[test]
fn a_plan_follows_the_settings_and_the_index() {
    let idx = index(3000, 30.0, 30); // 100 keyframes
    let cfg = TimelineConfig {
        thumb_width_px: 120,
        thumb_quality: 7,
        thumb_max_count: 40,
        ..TimelineConfig::default()
    };
    let p = ThumbPlan::new(&idx, &cfg);
    assert_eq!((p.width, p.quality, p.stride), (120, 7, 3));
    assert_eq!(p.frames.len(), 34); // ceil(100/3)
    assert_eq!(p.frames[0], 0);
    assert_eq!(p.frames[1], 90);
}

// ============================================================ store

#[test]
fn a_saved_store_loads_back_with_the_same_frames_and_bytes() {
    let dir = scratch("store");
    let s = ThumbStore::new(&dir.join("thumbs"));
    s.save(&key(2), &[thumb(0), thumb(60), thumb(120)]).unwrap();
    assert_eq!(s.frames(&key(2)), Some(vec![0, 60, 120]));
    assert_eq!(s.get(60).unwrap(), vec![60u8; 16]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_store_made_for_other_settings_or_another_video_is_stale() {
    let dir = scratch("stale");
    let s = ThumbStore::new(&dir.join("thumbs"));
    s.save(&key(2), &[thumb(0), thumb(60)]).unwrap();
    assert_eq!(s.frames(&key(3)), None, "stride");
    assert_eq!(
        s.frames(&ThumbKey {
            width: 128,
            ..key(2)
        }),
        None,
        "width"
    );
    assert_eq!(
        s.frames(&ThumbKey {
            quality: 9,
            ..key(2)
        }),
        None,
        "quality"
    );
    assert_eq!(
        s.frames(&ThumbKey {
            fingerprint: "other".into(),
            ..key(2)
        }),
        None,
        "video"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_missing_store_is_not_an_error() {
    let dir = scratch("none");
    let s = ThumbStore::new(&dir.join("thumbs"));
    assert_eq!(s.frames(&key(1)), None);
    assert!(s.get(0).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_missing_picture_makes_the_whole_store_stale() {
    let dir = scratch("missing");
    let t = dir.join("thumbs");
    let s = ThumbStore::new(&t);
    s.save(&key(1), &[thumb(0), thumb(30)]).unwrap();
    std::fs::remove_file(t.join("30.jpg")).unwrap();
    assert_eq!(s.frames(&key(1)), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_corrupt_or_truncated_meta_is_stale_not_a_crash() {
    let dir = scratch("corrupt");
    let t = dir.join("thumbs");
    let s = ThumbStore::new(&t);
    s.save(&key(1), &[thumb(0)]).unwrap();
    std::fs::write(t.join("meta.json"), b"{\"fingerprint\":\"1:40").unwrap();
    assert_eq!(s.frames(&key(1)), None);
    std::fs::write(t.join("meta.json"), b"").unwrap();
    assert_eq!(s.frames(&key(1)), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn pictures_without_a_meta_are_a_torn_run_and_not_trusted() {
    let dir = scratch("torn");
    let t = dir.join("thumbs");
    std::fs::create_dir_all(&t).unwrap();
    std::fs::write(t.join("0.jpg"), b"x").unwrap();
    assert_eq!(ThumbStore::new(&t).frames(&key(1)), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn saving_again_replaces_the_old_set_and_drops_its_leftovers() {
    let dir = scratch("replace");
    let t = dir.join("thumbs");
    let s = ThumbStore::new(&t);
    s.save(&key(1), &[thumb(0), thumb(30), thumb(60)]).unwrap();
    s.save(&key(2), &[thumb(0), thumb(60)]).unwrap();
    assert_eq!(s.frames(&key(2)), Some(vec![0, 60]));
    assert!(
        !t.join("30.jpg").exists(),
        "a thumbnail of the old set was left behind"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn saving_nothing_is_an_error() {
    let dir = scratch("empty");
    let s = ThumbStore::new(&dir.join("thumbs"));
    assert_eq!(s.save(&key(1), &[]), Err(ThumbError::NoPictures));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_frame_that_is_not_in_the_store_is_an_error() {
    let dir = scratch("nof");
    let s = ThumbStore::new(&dir.join("thumbs"));
    s.save(&key(1), &[thumb(0)]).unwrap();
    assert!(s.get(7).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_failed_save_keeps_the_previous_store_valid() {
    let dir = scratch("failsave");
    let t = dir.join("thumbs");
    let s = ThumbStore::new(&t);
    s.save(&key(1), &[thumb(0), thumb(30)]).unwrap();
    // a plain file where the staging folder (`thumbs.tmp`) must go makes the save fail
    std::fs::write(dir.join("thumbs.tmp"), b"in the way").unwrap();
    assert!(s.save(&key(2), &[thumb(0), thumb(90)]).is_err());
    assert_eq!(
        s.frames(&key(1)),
        Some(vec![0, 30]),
        "the old store must survive a failed save"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// ============================================================ real ffmpeg

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

/// Frame `i` is a flat-ish gradient whose mean brightness says which frame it is (see tests/frames.rs).
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
                    buf[y * w + x] = (6 + 2 * i + x % 8) as u8;
                }
            }
            stdin.write_all(&buf).unwrap();
        }
    }
    drop(child.stdin.take());
    assert!(child.wait().unwrap().success());
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

fn real(name: &str, n: usize, extra: &[&str]) -> (PathBuf, PathBuf, FrameIndex) {
    let dir = scratch(name);
    let v = dir.join("clip.mkv");
    make_video(&v, n, 640, 360, 30, extra);
    let (_, idx) = probe(&Tools::default(), &v, &IndexConfig::default()).unwrap();
    (dir, v, idx)
}

fn frame_of(jpeg: &[u8]) -> i64 {
    let mut d = jpeg_decoder::Decoder::new(jpeg);
    let px = d.decode().expect("a decodable JPEG");
    let sum: u64 = px.iter().map(|&b| b as u64).sum();
    (((sum as f64 / px.len() as f64) - 9.5) / 2.0).round() as i64
}

fn size_of(jpeg: &[u8]) -> (u16, u16) {
    let mut d = jpeg_decoder::Decoder::new(jpeg);
    d.decode().unwrap();
    let i = d.info().unwrap();
    (i.width, i.height)
}

fn gen(v: &Path, idx: &FrameIndex, cfg: &TimelineConfig) -> Result<Vec<Thumb>, ThumbError> {
    generate(
        &Tools::default(),
        v,
        idx,
        &ThumbPlan::new(idx, cfg),
        0.5,
        &AtomicBool::new(false),
    )
}

#[test]
fn one_pass_gives_one_correct_picture_per_keyframe() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = real("basic", 100, GOP);
    let t = gen(&v, &idx, &TimelineConfig::default()).unwrap();
    assert_eq!(
        t.iter().map(|x| x.frame).collect::<Vec<_>>(),
        vec![0, 30, 60, 90]
    );
    for x in &t {
        assert_eq!(
            frame_of(&x.jpeg),
            x.frame as i64,
            "the picture for frame {} shows another frame",
            x.frame
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn thumbnails_have_the_configured_width_and_keep_the_aspect() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = real("size", 70, GOP);
    let cfg = TimelineConfig {
        thumb_width_px: 160,
        ..TimelineConfig::default()
    };
    let t = gen(&v, &idx, &cfg).unwrap();
    assert_eq!(size_of(&t[0].jpeg), (160, 90));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_thumbnail_width_bigger_than_the_video_does_not_upscale() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = real("noup", 40, GOP);
    let cfg = TimelineConfig {
        thumb_width_px: 512,
        ..TimelineConfig::default()
    };
    let t = gen(&v, &idx, &cfg).unwrap();
    assert_eq!(size_of(&t[0].jpeg).0, 512);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_stride_thins_the_pictures() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = real("stride", 150, GOP); // keyframes 0,30,60,90,120
    let cfg = TimelineConfig {
        thumb_max_count: 3,
        ..TimelineConfig::default()
    }; // stride 2
    let t = gen(&v, &idx, &cfg).unwrap();
    assert_eq!(
        t.iter().map(|x| x.frame).collect::<Vec<_>>(),
        vec![0, 60, 120]
    );
    for x in &t {
        assert_eq!(frame_of(&x.jpeg), x.frame as i64);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_video_with_one_keyframe_gives_one_thumbnail() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = real("onekey", 20, &["-g", "1000", "-sc_threshold", "0"]);
    let t = gen(&v, &idx, &TimelineConfig::default()).unwrap();
    assert_eq!(t.iter().map(|x| x.frame).collect::<Vec<_>>(), vec![0]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_video_that_starts_at_a_nonzero_time_is_matched_correctly() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = real(
        "offset",
        70,
        &[
            "-bf",
            "2",
            "-g",
            "30",
            "-keyint_min",
            "30",
            "-sc_threshold",
            "0",
            "-output_ts_offset",
            "1.5",
        ],
    );
    assert!(idx.frames[0].pts > 1.0);
    let t = gen(&v, &idx, &TimelineConfig::default()).unwrap();
    assert_eq!(
        t.iter().map(|x| x.frame).collect::<Vec<_>>(),
        vec![0, 30, 60]
    );
    for x in &t {
        assert_eq!(frame_of(&x.jpeg), x.frame as i64);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_path_with_spaces_works() {
    if !have_tools() {
        return;
    }
    let dir = scratch("spaces");
    let v = dir.join("my clip (1).mkv");
    make_video(&v, 40, 640, 360, 30, GOP);
    let (_, idx) = probe(&Tools::default(), &v, &IndexConfig::default()).unwrap();
    assert_eq!(gen(&v, &idx, &TimelineConfig::default()).unwrap().len(), 2);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_cancelled_run_is_cancelled() {
    if !have_tools() {
        return;
    }
    let (dir, v, idx) = real("cancel", 40, GOP);
    let plan = ThumbPlan::new(&idx, &TimelineConfig::default());
    let r = generate(
        &Tools::default(),
        &v,
        &idx,
        &plan,
        0.5,
        &AtomicBool::new(true),
    );
    assert_eq!(r, Err(ThumbError::Cancelled));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_missing_ffmpeg_is_a_typed_error() {
    let idx = index(40, 30.0, 30);
    let tools = Tools {
        ffmpeg: "definitely-not-ffmpeg".into(),
        ffprobe: "definitely-not-ffprobe".into(),
    };
    let plan = ThumbPlan::new(&idx, &TimelineConfig::default());
    let r = generate(
        &tools,
        Path::new("x.mkv"),
        &idx,
        &plan,
        0.5,
        &AtomicBool::new(false),
    );
    assert!(matches!(r, Err(ThumbError::ToolMissing(_))), "{r:?}");
}

#[test]
fn a_file_ffmpeg_cannot_read_is_an_ffmpeg_error_not_a_panic() {
    if !have_tools() {
        return;
    }
    let dir = scratch("garbage");
    let v = dir.join("garbage.mkv");
    std::fs::write(&v, b"this is not a video").unwrap();
    let idx = index(40, 30.0, 30);
    let plan = ThumbPlan::new(&idx, &TimelineConfig::default());
    let r = generate(
        &Tools::default(),
        &v,
        &idx,
        &plan,
        0.5,
        &AtomicBool::new(false),
    );
    assert!(
        matches!(
            r,
            Err(ThumbError::FfmpegFailed(_)) | Err(ThumbError::NoPictures)
        ),
        "{r:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn av1_thumbnails_only_include_planned_keyframes_even_when_decoder_emits_inter_frames() {
    if !have_tools() {
        return;
    }
    let encoders = Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .unwrap();
    if !String::from_utf8_lossy(&encoders.stdout).contains("libaom-av1") {
        return;
    }
    let dir = scratch("av1_keyframes");
    let video = dir.join("av1.mkv");
    let result = Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=128x72:rate=30",
            "-frames:v",
            "90",
            "-an",
            "-c:v",
            "libaom-av1",
            "-cpu-used",
            "8",
            "-threads",
            "2",
            "-g",
            "30",
            "-crf",
            "45",
        ])
        .arg(&video)
        .status()
        .unwrap();
    assert!(result.success());
    let (_, idx) = probe(&Tools::default(), &video, &IndexConfig::default()).unwrap();
    assert!(keyframes(&idx).len() > 1);
    // Cover both direct keyframe selection and thinning AFTER keyframe selection.
    for cap in [600, 2] {
        let cfg = TimelineConfig {
            thumb_max_count: cap,
            ..TimelineConfig::default()
        };
        let plan = ThumbPlan::new(&idx, &cfg);
        let thumbs = gen(&video, &idx, &cfg).unwrap();
        assert_eq!(
            thumbs.iter().map(|t| t.frame).collect::<Vec<_>>(),
            plan.frames
        );
        assert!(thumbs.len() <= cap as usize);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

// ============================================================ a decoder whose keyframes differ from the index
// 0.6.1: "thumbnail keyframes differ from the index: expected 564 pictures, got 538" failed the whole strip, on every
// screen switch. Each picture is placed by its time; the ones that line up are kept, the rest dropped, never guessed.

#[test]
fn pictures_that_line_up_keep_their_frames_and_the_rest_are_dropped() {
    let idx = index(100, 20.0, 10); // a frame every 0.05 s
    assert_eq!(
        line_up(&idx, &[0.0, 0.5, 1.0], 0.5),
        vec![(0, 0), (1, 10), (2, 20)]
    );
    // between two frames, going backwards, the same frame again, and no time: dropped; the others keep their frames
    assert_eq!(
        line_up(&idx, &[0.0, 0.525, 1.0, 0.5, 1.0, f64::NAN, 1.5], 0.25),
        vec![(0, 0), (2, 20), (6, 30)]
    );
    assert!(line_up(&idx, &[99.0, -5.0], 0.5).is_empty());
    assert!(line_up(&idx, &[], 0.5).is_empty());
}

#[test]
fn an_index_whose_keyframes_differ_from_the_decoders_still_gets_its_thumbnails() {
    if !have_tools() {
        return;
    }
    let (dir, v, mut idx) = real("other_keys", 100, GOP);
    // the index lists two keyframes the decoder does not give, and misses one it does
    for f in [15, 45] {
        idx.frames[f].key = true;
    }
    idx.frames[60].key = false;
    let t = gen(&v, &idx, &TimelineConfig::default()).unwrap();
    assert_eq!(
        t.iter().map(|x| x.frame).collect::<Vec<_>>(),
        vec![0, 30, 60, 90]
    );
    for x in &t {
        assert_eq!(frame_of(&x.jpeg), x.frame as i64, "frame {}", x.frame);
    }
    let _ = std::fs::remove_dir_all(&dir);
}
