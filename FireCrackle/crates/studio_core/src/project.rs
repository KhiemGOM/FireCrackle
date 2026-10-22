//! The project file: everything import learned about one video, saved next to the labels.

use crate::index::{FrameEntry, FrameIndex, IndexSummary};
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub const PROJECT_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VideoMeta {
    pub width: usize,
    pub height: usize,
    pub fps_num: u32,
    pub fps_den: u32,
    pub codec: String,
}

/// One frame (position in the vec = display-order frame number).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct FrameRecord {
    pub pts: f64,
    pub key: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub version: u32,
    pub video_path: String,
    pub video_size: u64,
    pub fingerprint: String,
    pub meta: VideoMeta,
    pub index: IndexSummary,
    /// Human-readable things the user should know (variable frame rate, duplicate timestamps, ...).
    pub warnings: Vec<String>,
    pub frames: Vec<FrameRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProjectError {
    Io(String),
    /// Empty, truncated or otherwise unparsable project file.
    Corrupt(String),
    /// Written by a newer FireCrackle.
    UnsupportedVersion {
        found: u32,
    },
    VideoMissing(String),
    /// The video at `video_path` is not the one the project was made from.
    VideoChanged,
}

impl Project {
    /// Build a project from the display-order index and collect timing warnings.
    pub fn assemble(
        video_path: &str,
        video_size: u64,
        fingerprint: String,
        meta: VideoMeta,
        index: &FrameIndex,
    ) -> Project {
        let ix = &index.summary;
        let mut warnings = Vec::new();
        if ix.vfr {
            warnings.push(format!(
                "Variable frame rate: {} of {} frame intervals deviate from the usual {:.1} ms.",
                ix.irregular_intervals,
                ix.frame_count.saturating_sub(1),
                ix.median_interval * 1000.0
            ));
        } else if ix.irregular_intervals > 0 {
            warnings.push(format!(
                "{} irregular frame gaps (largest {:.1} ms against the usual {:.1} ms): dropped footage or a cut?",
                ix.irregular_intervals,
                ix.max_gap * 1000.0,
                ix.median_interval * 1000.0
            ));
        }
        if ix.duplicate_pts > 0 {
            warnings.push(format!(
                "{} frames share a duplicate timestamp with the previous frame.",
                ix.duplicate_pts
            ));
        }
        if ix.missing_pts > 0 {
            warnings.push(format!(
                "{} packets have no timestamp and were left out of the index.",
                ix.missing_pts
            ));
        }
        Project {
            version: PROJECT_VERSION,
            video_path: video_path.to_string(),
            video_size,
            fingerprint,
            meta,
            index: ix.clone(),
            warnings,
            frames: index
                .frames
                .iter()
                .map(|f| FrameRecord {
                    pts: f.pts,
                    key: f.key,
                })
                .collect(),
        }
    }

    /// The display-order frame index this project was made from.
    pub fn frame_index(&self) -> FrameIndex {
        FrameIndex {
            frames: self
                .frames
                .iter()
                .enumerate()
                .map(|(n, f)| FrameEntry {
                    n: n as u32,
                    pts: f.pts,
                    key: f.key,
                })
                .collect(),
            summary: self.index.clone(),
        }
    }

    /// Write atomically (temp file + rename): a crash mid-save keeps the previous file intact.
    pub fn save(&self, path: &Path) -> Result<(), ProjectError> {
        let io = |e: std::io::Error| ProjectError::Io(e.to_string());
        let bytes = serde_json::to_vec(self).map_err(|e| ProjectError::Io(e.to_string()))?;
        crate::fsutil::write_atomic(path, &bytes).map_err(io)
    }

    pub fn load(path: &Path) -> Result<Project, ProjectError> {
        let bytes = std::fs::read(path)
            .map_err(|e| ProjectError::Io(format!("{}: {e}", path.display())))?;
        let value: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|e| ProjectError::Corrupt(format!("{}: {e}", path.display())))?;
        if let Some(found) = value.get("version").and_then(|v| v.as_u64()) {
            if found > PROJECT_VERSION as u64 {
                return Err(ProjectError::UnsupportedVersion {
                    found: found.min(u32::MAX as u64) as u32,
                });
            }
        }
        serde_json::from_value(value)
            .map_err(|e| ProjectError::Corrupt(format!("{}: {e}", path.display())))
    }

    /// The video must still exist and be the same one (fingerprint).
    pub fn verify_video(&self) -> Result<(), ProjectError> {
        let video = Path::new(&self.video_path);
        if !video.is_file() {
            return Err(ProjectError::VideoMissing(self.video_path.clone()));
        }
        let window = self
            .fingerprint
            .split(':')
            .nth(1)
            .filter(|_| self.fingerprint.split(':').count() == 3)
            .and_then(|w| w.parse::<u64>().ok())
            .ok_or_else(|| {
                ProjectError::Corrupt(format!("malformed fingerprint {:?}", self.fingerprint))
            })?;
        let now = fingerprint(video, window).map_err(|e| ProjectError::Io(e.to_string()))?;
        if now == self.fingerprint {
            Ok(())
        } else {
            Err(ProjectError::VideoChanged)
        }
    }
}

/// `"<size>:<window_bytes>:<hex fnv1a-64 of the first and last window_bytes>"`. Self-describing so
/// `verify_video` does not depend on the current settings. Cheap, and catches a different or
/// re-recorded file; it does not hash the middle of a huge file.
pub fn fingerprint(path: &Path, window_bytes: u64) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    let window = window_bytes.min(len);
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325; // FNV-1a 64 offset basis
    let mut feed = |bytes: &[u8]| {
        for &b in bytes {
            hash ^= b as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    let mut buf = vec![0u8; window as usize];
    f.read_exact(&mut buf)?;
    feed(&buf);
    f.seek(SeekFrom::Start(len - window))?;
    f.read_exact(&mut buf)?;
    feed(&buf);
    Ok(format!("{len}:{window_bytes}:{hash:016x}"))
}

/// `<video file name>.firecrackle` beside the video: the folder holding its project, labels and caches.
/// `None` when the path has no file name.
pub fn project_dir(video: &Path) -> Option<std::path::PathBuf> {
    let mut name = video.file_name()?.to_os_string();
    name.push(".firecrackle");
    Some(video.with_file_name(name))
}
