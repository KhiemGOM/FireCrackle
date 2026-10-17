//! Decoding the frames a `DecodeJob` asks for, with ffmpeg, as JPEG bytes.
//!
//! One ffmpeg run per job: seek to the keyframe, decode forward, scale, encode MJPEG on stdout. Every decoded
//! frame's timestamp (ffmpeg `showinfo`, made absolute from the seek point) is checked against the frame index,
//! so a drifting seek, a dropped frame or an index that does not match the file is an error, never a wrong picture.

use crate::config::DecodeConfig;
use crate::decode_plan::DecodeJob;
use crate::import::Tools;
use crate::index::FrameIndex;
use std::io::Read;
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

    let mut cmd = crate::proc::background_command(&tools.ffmpeg);
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
    cmd.arg("-i")
        .arg(video)
        .args(crate::import::passthrough_args(&tools.ffmpeg))
        .arg("-frames:v")
        .arg(job.decode_count.to_string())
        .arg("-vf")
        .arg(format!("scale=w=min({}\\,iw):h=-2,showinfo", cfg.max_width))
        .args(["-f", "image2pipe", "-c:v", "mjpeg", "-q:v"])
        .arg(cfg.jpeg_quality.to_string())
        .arg("-")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| DecodeError::ToolMissing(format!("could not run {:?}: {e}", tools.ffmpeg)))?;

    // ffmpeg's log goes to stderr; drain it on its own thread so a full pipe cannot stall the video output
    let mut err_pipe = child.stderr.take().expect("stderr was piped");
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let mut buf = Vec::new();
        let _ = err_pipe.read_to_end(&mut buf);
        s.push_str(&String::from_utf8_lossy(&buf));
        s
    });
    let mut out_pipe = child.stdout.take().expect("stdout was piped");
    let mut bytes: Vec<u8> = Vec::new();
    let mut chunk = vec![0u8; 1 << 16];
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = err_thread.join();
            return Err(DecodeError::Cancelled);
        }
        match out_pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(k) => bytes.extend_from_slice(&chunk[..k]),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = err_thread.join();
                return Err(DecodeError::Io(e.to_string()));
            }
        }
    }
    let status = child.wait().map_err(|e| DecodeError::Io(e.to_string()))?;
    let stderr = err_thread.join().unwrap_or_default();

    let split = split_jpegs(&bytes);
    let got = split.frames.len() as u32;
    if !status.success() {
        let tail: Vec<&str> = stderr.lines().rev().take(3).collect();
        return Err(DecodeError::FfmpegFailed(format!(
            "{status}: {}",
            tail.into_iter().rev().collect::<Vec<_>>().join(" | ")
        )));
    }
    if got < job.decode_count {
        return Err(DecodeError::ShortRead {
            expected: job.decode_count,
            got,
        });
    }

    // every decoded frame must be the index entry it will be shown as
    let times = parse_showinfo(&stderr);
    if (times.len() as u32) < job.decode_count {
        return Err(DecodeError::BadStream(format!(
            "ffmpeg reported {} frame times for {} pictures",
            times.len(),
            job.decode_count
        )));
    }
    for k in 0..job.decode_count {
        let frame = job.keyframe + k;
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
            jpeg: bytes[split.frames[(frame - job.keyframe) as usize].clone()].to_vec(),
        })
        .collect())
}
