use fire_core::video::{parse_probe, read_frame, VideoInfo};
use std::io::{Cursor, ErrorKind, Read};

// ---------- ffprobe output (key=value lines, order independent) ----------

#[test]
fn parses_a_normal_probe_output() {
    let info = parse_probe("width=1920\nheight=1080\nr_frame_rate=60/1\n").unwrap();
    assert_eq!(
        info,
        VideoInfo {
            width: 1920,
            height: 1080,
            fps_num: 60,
            fps_den: 1
        }
    );
}

#[test]
fn key_order_and_extra_keys_do_not_matter() {
    let info = parse_probe(
        "codec_name=h264\nr_frame_rate=30000/1001\nheight=720\nwidth=1280\nprofile=High\n",
    )
    .unwrap();
    assert_eq!(info.width, 1280);
    assert_eq!(info.height, 720);
    assert_eq!((info.fps_num, info.fps_den), (30000, 1001));
}

#[test]
fn windows_line_endings_are_fine() {
    let info = parse_probe("width=854\r\nheight=480\r\nr_frame_rate=25/1\r\n").unwrap();
    assert_eq!((info.width, info.height), (854, 480));
}

#[test]
fn missing_or_invalid_fields_are_errors_not_panics() {
    assert!(parse_probe("").is_err());
    assert!(
        parse_probe("width=1920\nheight=1080\n").is_err(),
        "no frame rate"
    );
    assert!(
        parse_probe("width=1920\nr_frame_rate=60/1\n").is_err(),
        "no height"
    );
    assert!(parse_probe("width=abc\nheight=1080\nr_frame_rate=60/1\n").is_err());
    assert!(parse_probe("width=0\nheight=1080\nr_frame_rate=60/1\n").is_err());
    assert!(parse_probe("width=1920\nheight=0\nr_frame_rate=60/1\n").is_err());
    assert!(parse_probe("width=1920\nheight=1080\nr_frame_rate=0/0\n").is_err());
    assert!(
        parse_probe("width=1920\nheight=1080\nr_frame_rate=60\n").is_err(),
        "not a fraction"
    );
}

#[test]
fn only_the_first_stream_counts_if_ffprobe_prints_several() {
    let info = parse_probe(
        "width=1920\nheight=1080\nr_frame_rate=60/1\nwidth=640\nheight=360\nr_frame_rate=30/1\n",
    )
    .unwrap();
    assert_eq!(info.width, 1920);
}

// ---------- exact-size frame reads ----------

#[test]
fn reads_whole_frames_then_reports_a_clean_end() {
    let data: Vec<u8> = (0..30).collect(); // 3 frames of 10 bytes
    let mut r = Cursor::new(data);
    let mut buf = [0u8; 10];
    for i in 0..3u8 {
        assert!(read_frame(&mut r, &mut buf).unwrap());
        assert_eq!(buf[0], i * 10);
        assert_eq!(buf[9], i * 10 + 9);
    }
    assert!(
        !read_frame(&mut r, &mut buf).unwrap(),
        "clean EOF at a frame boundary"
    );
}

#[test]
fn a_truncated_last_frame_is_an_error() {
    let mut r = Cursor::new(vec![1u8; 25]); // 2.5 frames
    let mut buf = [0u8; 10];
    assert!(read_frame(&mut r, &mut buf).unwrap());
    assert!(read_frame(&mut r, &mut buf).unwrap());
    let err = read_frame(&mut r, &mut buf).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::UnexpectedEof);
}

#[test]
fn an_empty_stream_is_a_clean_end() {
    let mut r = Cursor::new(Vec::<u8>::new());
    let mut buf = [0u8; 10];
    assert!(!read_frame(&mut r, &mut buf).unwrap());
}

/// A reader that hands out one byte at a time, like a slow pipe.
struct Trickle(Cursor<Vec<u8>>);
impl Read for Trickle {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        let n = out.len().min(1);
        self.0.read(&mut out[..n])
    }
}

#[test]
fn short_reads_from_a_pipe_are_stitched_together() {
    let mut r = Trickle(Cursor::new((0..20).collect()));
    let mut buf = [0u8; 10];
    assert!(read_frame(&mut r, &mut buf).unwrap());
    assert_eq!(buf, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert!(read_frame(&mut r, &mut buf).unwrap());
    assert_eq!(buf[0], 10);
}

#[test]
fn spawning_rgb_frames_of_a_missing_video_is_an_error() {
    assert!(fire_core::video::spawn_rgb24("no/such/video.mkv").is_err());
}
