//! Timeline thumbnails: one fast ffmpeg pass over the keyframes, cached on disk.
//!
//! Decoding arbitrary frames one by one needs a seek each, so the strip is made from keyframes only
//! (`-skip_frame nokey`), thinned to `timeline.thumb_max_count`, in a single run. Every picture's timestamp is
//! matched to the frame index (a drifting or foreign stream is an error, not a wrong picture). The cache lives in
//! `<video>.firecrackle/thumbs/` and is only trusted when its `meta.json` (written last) matches the video and the
//! settings it was made with.

use crate::config::TimelineConfig;
use crate::frames::{parse_showinfo, split_jpegs};
use crate::import::Tools;
use crate::index::FrameIndex;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Debug, PartialEq)]
pub enum ThumbError {
    ToolMissing(String),
    Cancelled,
    Io(String),
    FfmpegFailed(String),
    /// ffmpeg produced no pictures (or there was nothing to save).
    NoPictures,
    /// The output is not what the plan asked for (counts, order, duplicates).
    BadStream(String),
    /// A picture's timestamp matches no frame of the index.
    Misaligned {
        pts: f64,
        nearest_frame: u32,
    },
    /// The frame source cannot make thumbnails.
    Unsupported,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Thumb {
    pub frame: u32,
    pub jpeg: Vec<u8>,
}

/// What one thumbnail pass has to produce.
#[derive(Clone, Debug, PartialEq)]
pub struct ThumbPlan {
    /// Take every `stride`-th keyframe.
    pub stride: u32,
    pub width: u32,
    pub quality: u32,
    /// The frames that are expected (every `stride`-th keyframe of the index).
    pub frames: Vec<u32>,
}

impl ThumbPlan {
    pub fn new(index: &FrameIndex, cfg: &TimelineConfig) -> ThumbPlan {
        let count = keyframes(index).len();
        let stride = stride(count, cfg.thumb_max_count);
        ThumbPlan {
            stride,
            width: cfg.thumb_width_px,
            quality: cfg.thumb_quality,
            frames: selected(index, stride),
        }
    }

    /// The cache key this plan produces for a video with `fingerprint`.
    pub fn key(&self, fingerprint: &str) -> ThumbKey {
        ThumbKey {
            fingerprint: fingerprint.to_string(),
            width: self.width,
            quality: self.quality,
            stride: self.stride,
        }
    }
}

/// The frames the index marks as keyframes, in order.
pub fn keyframes(index: &FrameIndex) -> Vec<u32> {
    index.frames.iter().filter(|f| f.key).map(|f| f.n).collect()
}

/// Smallest stride that keeps no more than `max_count` of `keyframe_count` keyframes (a cap of 0 counts as 1).
pub fn stride(keyframe_count: usize, max_count: u32) -> u32 {
    let cap = max_count.max(1) as usize;
    if keyframe_count == 0 {
        return 1;
    }
    keyframe_count.div_ceil(cap) as u32
}

/// Every `stride`-th keyframe, starting with the first.
pub fn selected(index: &FrameIndex, stride: u32) -> Vec<u32> {
    keyframes(index)
        .into_iter()
        .step_by(stride.max(1) as usize)
        .collect()
}

/// Map the timestamps of the pictures ffmpeg produced (absolute, in output order) to index frames. Every time must
/// be within `tolerance` of the local frame interval of its frame, times must increase and no frame may repeat.
pub fn assign(index: &FrameIndex, times: &[f64], tolerance: f64) -> Result<Vec<u32>, ThumbError> {
    if times.is_empty() || index.frames.is_empty() {
        return Err(ThumbError::NoPictures);
    }
    let n = index.frames.len();
    let mut out: Vec<u32> = Vec::with_capacity(times.len());
    let mut prev: Option<f64> = None;
    for &t in times {
        if !t.is_finite() {
            return Err(ThumbError::BadStream(format!("a picture has the time {t}")));
        }
        if prev.is_some_and(|p| t <= p) {
            return Err(ThumbError::BadStream(format!(
                "picture times do not increase at {t:.6}"
            )));
        }
        prev = Some(t);
        let after = index.frames.partition_point(|f| f.pts <= t);
        let i = match after {
            0 => 0,
            k if k == n => n - 1,
            k => {
                if t - index.frames[k - 1].pts <= index.frames[k].pts - t {
                    k - 1
                } else {
                    k
                }
            }
        };
        let pts = index.frames[i].pts;
        let interval = if i + 1 < n {
            index.frames[i + 1].pts - pts
        } else if i > 0 {
            pts - index.frames[i - 1].pts
        } else {
            0.0
        };
        let frame = index.frames[i].n;
        if (t - pts).abs() > tolerance * interval.max(1e-6) {
            return Err(ThumbError::Misaligned {
                pts: t,
                nearest_frame: frame,
            });
        }
        if out.last() == Some(&frame) {
            return Err(ThumbError::BadStream(format!(
                "two pictures map to frame {frame}"
            )));
        }
        out.push(frame);
    }
    Ok(out)
}

/// The thumbnail frame closest to `frame` (the earlier one on a tie). `frames` must be sorted.
pub fn nearest(frames: &[u32], frame: u32) -> Option<u32> {
    if frames.is_empty() {
        return None;
    }
    let after = frames.partition_point(|&f| f <= frame);
    if after == 0 {
        return Some(frames[0]);
    }
    if after == frames.len() {
        return Some(frames[after - 1]);
    }
    let before = frames[after - 1];
    let next = frames[after];
    Some(if frame - before <= next - frame {
        before
    } else {
        next
    })
}

// ============================================================ the cache

/// What a cache was made from; it is reused only when this is identical.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThumbKey {
    pub fingerprint: String,
    pub width: u32,
    pub quality: u32,
    pub stride: u32,
}

#[derive(Serialize, Deserialize)]
struct Meta {
    #[serde(flatten)]
    key: ThumbKey,
    frames: Vec<u32>,
}

/// The thumbnail folder of one project.
pub struct ThumbStore {
    dir: PathBuf,
}

fn io(e: std::io::Error) -> ThumbError {
    ThumbError::Io(e.to_string())
}

impl ThumbStore {
    pub fn new(dir: &Path) -> ThumbStore {
        ThumbStore {
            dir: dir.to_path_buf(),
        }
    }

    fn staging(&self) -> PathBuf {
        let mut name = self
            .dir
            .file_name()
            .map(|n| n.to_os_string())
            .unwrap_or_default();
        name.push(".tmp");
        self.dir.with_file_name(name)
    }

    /// Replace the store with `thumbs`: pictures and `meta.json` are written into a staging folder (next to the
    /// store, named `<store>.tmp`) and swapped in, so a failure at any point leaves the previous store as it was.
    pub fn save(&self, key: &ThumbKey, thumbs: &[Thumb]) -> Result<(), ThumbError> {
        if thumbs.is_empty() {
            return Err(ThumbError::NoPictures);
        }
        let staging = self.staging();
        match std::fs::remove_dir_all(&staging) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io(e)),
        }
        std::fs::create_dir_all(&staging).map_err(io)?;
        let written = (|| -> Result<(), ThumbError> {
            for t in thumbs {
                std::fs::write(staging.join(format!("{}.jpg", t.frame)), &t.jpeg).map_err(io)?;
            }
            let meta = Meta {
                key: key.clone(),
                frames: thumbs.iter().map(|t| t.frame).collect(),
            };
            let json = serde_json::to_vec(&meta).map_err(|e| ThumbError::Io(e.to_string()))?;
            std::fs::write(staging.join("meta.json"), json).map_err(io)
        })();
        if let Err(e) = written {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(e);
        }
        match std::fs::remove_dir_all(&self.dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                let _ = std::fs::remove_dir_all(&staging);
                return Err(io(e));
            }
        }
        std::fs::rename(&staging, &self.dir).map_err(io)
    }

    /// The frames of the stored thumbnails when the store is valid for `key`: `meta.json` parses, equals the key,
    /// and every listed picture exists. `None` otherwise (nothing stored, stale, torn, corrupt).
    pub fn frames(&self, key: &ThumbKey) -> Option<Vec<u32>> {
        let bytes = std::fs::read(self.dir.join("meta.json")).ok()?;
        let meta: Meta = serde_json::from_slice(&bytes).ok()?;
        if &meta.key != key || meta.frames.is_empty() {
            return None;
        }
        if !meta
            .frames
            .iter()
            .all(|f| self.dir.join(format!("{f}.jpg")).is_file())
        {
            return None;
        }
        let mut frames = meta.frames;
        frames.sort_unstable();
        frames.dedup();
        Some(frames)
    }

    pub fn get(&self, frame: u32) -> Result<Vec<u8>, ThumbError> {
        std::fs::read(self.dir.join(format!("{frame}.jpg"))).map_err(io)
    }
}

// ============================================================ ffmpeg

/// Run `cmd` to the end, collecting stdout and stderr; `cancel` kills it.
fn run(
    mut cmd: Command,
    tool: &std::ffi::OsStr,
    cancel: &AtomicBool,
) -> Result<(std::process::ExitStatus, Vec<u8>, String), ThumbError> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| ThumbError::ToolMissing(format!("could not run {tool:?}: {e}")))?;
    let mut err_pipe = child.stderr.take().expect("stderr was piped");
    let err_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = err_pipe.read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).into_owned()
    });
    let mut out_pipe = child.stdout.take().expect("stdout was piped");
    let mut bytes: Vec<u8> = Vec::new();
    let mut chunk = vec![0u8; 1 << 16];
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = err_thread.join();
            return Err(ThumbError::Cancelled);
        }
        match out_pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(k) => bytes.extend_from_slice(&chunk[..k]),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = err_thread.join();
                return Err(io(e));
            }
        }
    }
    let status = child.wait().map_err(io)?;
    let stderr = err_thread.join().unwrap_or_default();
    Ok((status, bytes, stderr))
}

/// One ffmpeg pass over the keyframes of `video`: a picture per selected keyframe, matched to the index by time.
pub fn generate(
    tools: &Tools,
    video: &Path,
    index: &FrameIndex,
    plan: &ThumbPlan,
    align_tolerance: f64,
    cancel: &AtomicBool,
) -> Result<Vec<Thumb>, ThumbError> {
    if cancel.load(Ordering::SeqCst) {
        return Err(ThumbError::Cancelled);
    }
    if index.frames.is_empty() {
        return Err(ThumbError::NoPictures);
    }
    let mut filter = String::new();
    if plan.stride > 1 {
        filter.push_str(&format!("select=not(mod(n\\,{})),", plan.stride));
    }
    filter.push_str(&format!("scale=w=min({}\\,iw):h=-2,showinfo", plan.width));

    let mut cmd = crate::proc::hidden_command(&tools.ffmpeg);
    cmd.args([
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "info",
        "-nostats",
        "-skip_frame",
        "nokey",
        "-i",
    ])
    .arg(video)
    .args(crate::import::passthrough_args(&tools.ffmpeg))
    .arg("-vf")
    .arg(filter)
    .args(["-f", "image2pipe", "-c:v", "mjpeg", "-q:v"])
    .arg(plan.quality.to_string())
    .arg("-");
    let (status, bytes, stderr) = run(cmd, &tools.ffmpeg, cancel)?;
    if !status.success() {
        let tail: Vec<&str> = stderr.lines().rev().take(3).collect();
        return Err(ThumbError::FfmpegFailed(format!(
            "{status}: {}",
            tail.into_iter().rev().collect::<Vec<_>>().join(" | ")
        )));
    }

    let split = split_jpegs(&bytes);
    if split.frames.is_empty() {
        return Err(ThumbError::NoPictures);
    }
    // like the frame decoder: without a seek, ffmpeg's times are relative to the first frame
    let times = parse_showinfo(&stderr);
    if times.len() < split.frames.len() {
        return Err(ThumbError::BadStream(format!(
            "ffmpeg reported {} picture times for {} pictures",
            times.len(),
            split.frames.len()
        )));
    }
    let base = index.frames[0].pts;
    let absolute: Vec<f64> = times[..split.frames.len()]
        .iter()
        .map(|t| base + t)
        .collect();
    let frames = assign(index, &absolute, align_tolerance)?;
    Ok(frames
        .into_iter()
        .zip(split.frames)
        .map(|(frame, r)| Thumb {
            frame,
            jpeg: bytes[r].to_vec(),
        })
        .collect())
}
