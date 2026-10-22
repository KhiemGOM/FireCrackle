//! Decoding the frames a `DecodeJob` asks for, with ffmpeg, as JPEG bytes.
//!
//! One ffmpeg run per job: seek to the keyframe, decode forward, scale, encode MJPEG on stdout. Every decoded
//! frame's timestamp (ffmpeg `showinfo`, made absolute from the seek point) is checked against the frame index,
//! so a drifting seek, a dropped frame or an index that does not match the file is an error, never a wrong picture.

use crate::config::DecodeConfig;
use crate::decode_plan::DecodeJob;
use crate::import::Tools;
use crate::index::FrameIndex;
use std::ops::Range;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodedFrame {
    pub frame: u32,
    pub jpeg: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DecodeError {
    ToolMissing(String),
    Cancelled,
    Io(String),
    /// ffmpeg produced fewer frames than the job needs.
    ShortRead {
        expected: u32,
        got: u32,
    },
    /// A decoded frame's timestamp does not match the index entry it would be shown as.
    Misaligned {
        frame: u32,
        expected_pts: f64,
        got_pts: f64,
    },
    /// The MJPEG stream could not be split into whole pictures.
    BadStream(String),
    FfmpegFailed(String),
    /// The job does not fit the index (inverted range, past the end, inconsistent counts).
    BadJob(String),
}

/// Result of splitting an MJPEG byte stream into pictures.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Split {
    /// Byte ranges of the complete pictures, in order.
    pub frames: Vec<Range<usize>>,
    /// Bytes at the end that belong to an incomplete picture.
    pub incomplete_tail: usize,
}

/// Split concatenated JPEGs by walking their structure (segments, entropy-coded data with `FF00` stuffing and
/// restart markers), not by searching for the end marker. Bytes before a picture's start marker are skipped.
pub fn split_jpegs(bytes: &[u8]) -> Split {
    let mut frames = Vec::new();
    let mut incomplete_tail = 0;
    let mut from = 0;
    while let Some(start) = find_soi(bytes, from) {
        match parse_picture(bytes, start) {
            Parsed::End(end) => {
                frames.push(start..end);
                from = end;
            }
            Parsed::Incomplete => {
                incomplete_tail = bytes.len() - start;
                break;
            }
            Parsed::Corrupt => from = start + 2,
        }
    }
    Split {
        frames,
        incomplete_tail,
    }
}

enum Parsed {
    End(usize),
    Incomplete,
    Corrupt,
}

fn find_soi(bytes: &[u8], from: usize) -> Option<usize> {
    (from..bytes.len().saturating_sub(1)).find(|&i| bytes[i] == 0xFF && bytes[i + 1] == 0xD8)
}

/// Walk one picture that starts with SOI at `start`: marker segments, entropy-coded data after each SOS (with
/// `FF00` stuffing, restart markers and fill bytes), until EOI.
fn parse_picture(b: &[u8], start: usize) -> Parsed {
    let n = b.len();
    let mut p = start + 2;
    loop {
        while p + 1 < n && b[p] == 0xFF && b[p + 1] == 0xFF {
            p += 1; // fill bytes before a marker
        }
        if p + 1 >= n {
            return Parsed::Incomplete;
        }
        if b[p] != 0xFF {
            return Parsed::Corrupt;
        }
        let marker = b[p + 1];
        p += 2;
        match marker {
            0xD9 => return Parsed::End(p),
            0x00 | 0xD8 => return Parsed::Corrupt,
            0x01 | 0xD0..=0xD7 => continue, // standalone markers carry no length
            _ => {}
        }
        if p + 2 > n {
            return Parsed::Incomplete;
        }
        let len = u16::from_be_bytes([b[p], b[p + 1]]) as usize;
        if len < 2 {
            return Parsed::Corrupt;
        }
        if p + len > n {
            return Parsed::Incomplete;
        }
        p += len;
        if marker == 0xDA {
            // entropy-coded data: runs until a marker that is not a stuffed zero, a restart or fill
            loop {
                while p < n && b[p] != 0xFF {
                    p += 1;
                }
                if p + 1 >= n {
                    return Parsed::Incomplete;
                }
                match b[p + 1] {
                    0x00 | 0xD0..=0xD7 => p += 2,
                    0xFF => p += 1,
                    _ => break,
                }
            }
        }
    }
}

/// The `pts_time` of every frame line in ffmpeg's `showinfo` output, in order (other lines are ignored).
pub fn parse_showinfo(stderr: &str) -> Vec<f64> {
    stderr
        .lines()
        .filter(|l| l.contains("showinfo") && l.contains("] n:"))
        .filter_map(|l| {
            let rest = l.split_once("pts_time:")?.1;
            rest.split_whitespace().next()?.parse::<f64>().ok()
        })
        .collect()
}

/// The `-ss` value for a keyframe at `keyframe_pts`: `backoff_ms` before it, six decimals; `None` when that is
/// not after the start of the file (decode from the beginning, no `-ss`).
pub fn seek_arg(keyframe_pts: f64, backoff_ms: f64) -> Option<String> {
    let t = keyframe_pts - backoff_ms / 1000.0;
    if t > 0.0 {
        Some(format!("{t:.6}"))
    } else {
        None
    }
}

/// Decode the frames `job.first..=job.last`. The frames between the keyframe and `job.first` are decoded and
/// dropped. `cancel` stops the run early.
pub fn decode_job(
    tools: &Tools,
    video: &Path,
    index: &FrameIndex,
    job: &DecodeJob,
    cfg: &DecodeConfig,
    cancel: &AtomicBool,
) -> Result<Vec<DecodedFrame>, DecodeError> {
    decode_selected(tools, video, index, job, cfg, cancel, Picture::Display)
}

/// Exact previews omit the unwanted keyframe prefix before scaling and JPEG encoding.
pub fn decode_preview(
    tools: &Tools,
    video: &Path,
    index: &FrameIndex,
    job: &DecodeJob,
    cfg: &DecodeConfig,
    cancel: &AtomicBool,
) -> Result<Vec<DecodedFrame>, DecodeError> {
    decode_selected(tools, video, index, job, cfg, cancel, Picture::Preview)
}

/// One frame at the video's own resolution as a lossless RGB PNG: no scaling and no JPEG, for inspecting a paused
/// picture pixel by pixel. Same seek and timestamp check as the display JPEGs, so it is never a neighbouring frame.
pub fn decode_exact_png(
    tools: &Tools,
    video: &Path,
    index: &FrameIndex,
    frame: u32,
    cfg: &DecodeConfig,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, DecodeError> {
    if frame as usize >= index.frames.len() {
        return Err(DecodeError::BadJob(
            "the frame is past the last frame of the index".into(),
        ));
    }
    let job = crate::decode_plan::job_for(index, frame, frame, cfg);
    let mut decoded = decode_selected(tools, video, index, &job, cfg, cancel, Picture::ExactPng)?;
    let png = decoded.pop().map(|f| f.jpeg).unwrap_or_default();
    without_colour_tags(&png)
        .ok_or_else(|| DecodeError::BadStream("ffmpeg wrote an invalid PNG".into()))
}

/// The PNG without its colour-space chunks. FFmpeg copies the video's BT.709 tags into gAMA/cHRM/cICP, which makes a
/// viewer colour-manage the picture; the display JPEGs carry none, so both show the decoded values unchanged.
fn without_colour_tags(png: &[u8]) -> Option<Vec<u8>> {
    const DROPPED: [&[u8; 4]; 5] = [b"gAMA", b"cHRM", b"cICP", b"iCCP", b"sRGB"];
    let mut out = png.get(..8)?.to_vec();
    let mut at = 8;
    while at < png.len() {
        let len = u32::from_be_bytes(png.get(at..at + 4)?.try_into().ok()?) as usize;
        let chunk = png.get(at..at.checked_add(12 + len)?)?;
        if !DROPPED.iter().any(|name| &chunk[4..8] == *name) {
            out.extend_from_slice(chunk);
        }
        at += chunk.len();
    }
    Some(out)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Picture {
    /// Scaled display JPEGs.
    Display,
    /// Scaled JPEGs on the small thumbnail thread budget.
    Preview,
    /// One unscaled lossless PNG.
    ExactPng,
}

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
const PNG_OUTPUT: [&str; 8] = [
    "-f",
    "image2pipe",
    "-c:v",
    "png",
    "-pix_fmt",
    "rgb24",
    "-compression_level",
    "1",
];

fn decode_selected(
    tools: &Tools,
    video: &Path,
    index: &FrameIndex,
    job: &DecodeJob,
    cfg: &DecodeConfig,
    cancel: &AtomicBool,
    picture: Picture,
) -> Result<Vec<DecodedFrame>, DecodeError> {
    let n = index.frames.len() as u32;
    let bad = |why: &str| DecodeError::BadJob(why.to_string());
    if job.first > job.last {
        return Err(bad("first frame is after the last"));
    }
    if job.last >= n {
        return Err(bad("the job runs past the last frame of the index"));
    }
    if job.keyframe > job.first {
        return Err(bad("the keyframe is after the first wanted frame"));
    }
    if job.decode_count == 0 || job.decode_count != job.last - job.keyframe + 1 {
        return Err(bad("decode_count does not cover keyframe..=last"));
    }
    if cancel.load(Ordering::SeqCst) {
        return Err(DecodeError::Cancelled);
    }

    // At most `decode.max_parallel` decodes run at once, however many frames are asked for (crate::decode_gate). A decode
    // that is cancelled while it waits for its turn never starts.
    let gate = crate::decode_gate::decode_gate();
    gate.set_limit(cfg.max_parallel as usize);
    let _slot = gate.acquire(cancel).ok_or(DecodeError::Cancelled)?;

    let mut cmd = crate::proc::ffmpeg_command(&tools.ffmpeg);
    if picture == Picture::ExactPng && job.first != job.last {
        return Err(bad("an exact picture is one frame"));
    }
    if picture != Picture::Preview {
        // Interactive AV1 decoding needs more than the conservative thumbnail
        // budget. Bound total fanout across the configured simultaneous decodes.
        let cpus = std::thread::available_parallelism().map_or(2, usize::from);
        let threads = (cpus.saturating_sub(2) / cfg.max_parallel.max(1) as usize).clamp(2, 8);
        cmd.args(["-threads", &threads.to_string()]);
    }
    cmd.args(["-nostdin", "-hide_banner", "-loglevel", "info", "-nostats"]);
    // ffmpeg reports frame times relative to the seek point (or to the first frame when there is no seek), so the
    // absolute time of decoded frame `k` is `time_base + showinfo time`. `-copyts` would keep absolute times but
    // breaks seeking in files that do not start at 0, so it is not used.
    let seek = seek_arg(job.seek_pts, cfg.seek_backoff_ms);
    let time_base = match &seek {
        Some(ss) => {
            // -seek_timestamp: -ss is an absolute timestamp, not an offset from the file's start time (a file whose
            // first frame is at 1.5 s would otherwise be sought 1.5 s too far)
            cmd.args(["-seek_timestamp", "1", "-ss"]).arg(ss);
            ss.parse::<f64>().unwrap_or(job.seek_pts)
        }
        None => index.frames[0].pts,
    };
    let first_output = job.first;
    let output_count = job.last - first_output + 1;
    // Decode the seek prefix, but do not scale, JPEG-encode or transfer frames
    // that the caller will discard. trim preserves their original timestamps.
    let trim = format!(
        "trim=start_frame={}:end_frame={}",
        job.first - job.keyframe,
        job.last - job.keyframe + 1
    );
    let filter = match picture {
        Picture::ExactPng => format!("{trim},showinfo"),
        _ => format!("{trim},scale=w=min({}\\,iw):h=-2,showinfo", cfg.max_width),
    };
    cmd.arg("-i")
        .arg(video)
        .args(crate::import::passthrough_args(&tools.ffmpeg))
        .arg("-frames:v")
        .arg(output_count.to_string())
        .arg("-vf")
        .arg(filter);
    match picture {
        // zlib level 1: still lossless, in a fraction of the default encode time
        Picture::ExactPng => cmd.args(PNG_OUTPUT),
        _ => cmd
            .args(crate::proc::JPEG_OUTPUT)
            .arg(cfg.jpeg_quality.to_string()),
    };
    cmd.arg("-")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output =
        crate::proc::capture(&mut cmd, cancel, 128 * 1024 * 1024).map_err(|e| match e.kind() {
            std::io::ErrorKind::Interrupted => DecodeError::Cancelled,
            std::io::ErrorKind::NotFound => {
                DecodeError::ToolMissing(format!("could not run {:?}: {e}", tools.ffmpeg))
            }
            _ => DecodeError::Io(e.to_string()),
        })?;
    let (status, bytes) = (output.status, output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let split = match picture {
        Picture::ExactPng => Split {
            frames: if bytes.starts_with(&PNG_SIGNATURE) {
                std::iter::once(0..bytes.len()).collect()
            } else {
                vec![]
            },
            incomplete_tail: 0,
        },
        _ => split_jpegs(&bytes),
    };
    let got = split.frames.len() as u32;
    if !status.success() {
        let tail: Vec<&str> = stderr.lines().rev().take(3).collect();
        return Err(DecodeError::FfmpegFailed(format!(
            "{status}: {}",
            tail.into_iter().rev().collect::<Vec<_>>().join(" | ")
        )));
    }
    if got < output_count {
        return Err(DecodeError::ShortRead {
            expected: output_count,
            got,
        });
    }

    // every decoded frame must be the index entry it will be shown as
    let times = parse_showinfo(&stderr);
    if (times.len() as u32) < output_count {
        return Err(DecodeError::BadStream(format!(
            "ffmpeg reported {} frame times for {} pictures",
            times.len(),
            output_count
        )));
    }
    for k in 0..output_count {
        let frame = first_output + k;
        let expected = index.frames[frame as usize].pts;
        let interval = if frame + 1 < n {
            index.frames[frame as usize + 1].pts - expected
        } else if frame > 0 {
            expected - index.frames[frame as usize - 1].pts
        } else {
            0.0
        };
        let got_pts = time_base + times[k as usize];
        if (got_pts - expected).abs() > cfg.align_tolerance * interval.max(1e-6) {
            return Err(DecodeError::Misaligned {
                frame,
                expected_pts: expected,
                got_pts,
            });
        }
    }

    Ok((job.first..=job.last)
        .map(|frame| DecodedFrame {
            frame,
            jpeg: bytes[split.frames[(frame - first_output) as usize].clone()].to_vec(),
        })
        .collect())
}
