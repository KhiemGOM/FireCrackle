//! The append-only label log on disk (format: `label::log_line`), opened with crash repair.

use crate::config::AutosaveConfig;
use crate::label::{LabelError, LabelStore};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AutosaveError {
    Io(String),
    /// A line in the middle of the log cannot be parsed or holds an invalid label.
    Corrupt(LabelError),
    /// The log refers to a frame the video does not have: a log from another video.
    VideoMismatch {
        frame: u32,
        count: u32,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OpenReport {
    /// Non-blank lines replayed.
    pub lines: usize,
    /// A torn last line (crash while appending) was cut off the file.
    pub torn_tail_repaired: bool,
}

pub struct AutosaveLog {
    path: PathBuf,
    cfg: AutosaveConfig,
    lines: usize,
}

fn io(e: std::io::Error) -> AutosaveError {
    AutosaveError::Io(e.to_string())
}

impl AutosaveLog {
    /// Open (or create) the log and replay it into a store of `frame_count` frames.
    /// A torn last line is removed from the file *before* anything is appended, so the next append cannot glue
    /// onto it. A missing file is a new, empty log.
    pub fn open(
        path: &Path,
        frame_count: u32,
        cfg: &AutosaveConfig,
    ) -> Result<(AutosaveLog, LabelStore, OpenReport), AutosaveError> {
        if path.is_dir() {
            return Err(AutosaveError::Io(format!(
                "{} is a directory, not a label log",
                path.display()
            )));
        }
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(io(e)),
        };
        let text = String::from_utf8_lossy(&bytes);
        let replay = LabelStore::replay(&text, frame_count).map_err(|e| match e {
            LabelError::FrameOutOfRange { frame, count } => {
                AutosaveError::VideoMismatch { frame, count }
            }
            other => AutosaveError::Corrupt(other),
        })?;

        let mut lines = text.lines().filter(|l| !l.trim().is_empty()).count();
        if replay.torn_tail {
            lines -= 1;
            // cut the torn last line (the last non-blank one) out of the file itself
            let body = bytes.trim_ascii_end();
            let keep = body
                .iter()
                .rposition(|&b| b == b'\n')
                .map(|i| i + 1)
                .unwrap_or(0);
            let file = std::fs::OpenOptions::new()
                .write(true)
                .open(path)
                .map_err(io)?;
            file.set_len(keep as u64).map_err(io)?;
            file.sync_all().map_err(io)?;
        }
        let report = OpenReport {
            lines,
            torn_tail_repaired: replay.torn_tail,
        };
        Ok((
            AutosaveLog {
                path: path.to_path_buf(),
                cfg: *cfg,
                lines,
            },
            replay.store,
            report,
        ))
    }

    /// Append lines (each one log line without its newline). All or an error; the caller keeps the lines on error.
    pub fn append(&mut self, lines: &[String]) -> Result<(), AutosaveError> {
        if lines.is_empty() {
            return Ok(());
        }
        let mut buf = String::new();
        for l in lines {
            buf.push_str(l);
            buf.push('\n');
        }
        // one handle per call: a vanished folder or a replaced file is noticed instead of written into the void
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(io)?;
        file.write_all(buf.as_bytes()).map_err(io)?;
        if self.cfg.fsync {
            file.sync_data().map_err(io)?;
        }
        self.lines += lines.len();
        Ok(())
    }

    /// Apply new settings (compaction threshold, fsync).
    pub fn set_config(&mut self, cfg: &AutosaveConfig) {
        self.cfg = *cfg;
    }

    /// Lines in the file now.
    pub fn lines_written(&self) -> usize {
        self.lines
    }

    /// Rewrite the log from `store` (atomic: temp file + rename) when it holds more lines than
    /// `compact_after_lines`. Returns whether it compacted.
    pub fn compact_if_needed(&mut self, store: &LabelStore) -> Result<bool, AutosaveError> {
        if self.lines <= self.cfg.compact_after_lines as usize {
            return Ok(false);
        }
        let labelled = store.iter();
        let mut text = String::new();
        for (frame, _) in &labelled {
            text.push_str(&store.log_line(*frame));
            text.push('\n');
        }
        crate::fsutil::write_atomic(&self.path, text.as_bytes()).map_err(io)?;
        self.lines = labelled.len();
        Ok(true)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}
