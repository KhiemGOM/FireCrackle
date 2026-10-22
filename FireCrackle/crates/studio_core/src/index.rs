//! Frame index from `ffprobe` packets: display order, keyframes, timing regularity.
//!
//! Input is `ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,dts_time,flags -of csv=p=0`,
//! one line per packet in decode order: `0.067000,N/A,K__`. Packets are not frames, but each video packet
//! decodes to one frame and ffprobe lists them without decoding (0.5 s for 9,400 packets).

use crate::config::IndexConfig;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Packet {
    /// Presentation time in seconds (`None` = `N/A`).
    pub pts: Option<f64>,
    pub dts: Option<f64>,
    pub key: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IndexError {
    /// A line that is not `pts,dts,flags` (1-based line number).
    Parse {
        line: usize,
        msg: String,
    },
    NoPackets,
    /// Packets exist but none has a presentation time.
    NoTimestamps,
}

/// One frame in display order; `n` is its position.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct FrameEntry {
    pub n: u32,
    pub pts: f64,
    pub key: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct IndexSummary {
    pub frame_count: usize,
    /// Last pts minus first pts, seconds.
    pub duration: f64,
    /// Median positive interval between consecutive frames, seconds (0 for fewer than 2 frames).
    pub median_interval: f64,
    /// Average frame rate `(frame_count - 1) / duration` (0 for fewer than 2 frames or zero duration).
    /// Not `1 / median_interval`: timestamps are rounded (mkv: 1 ms), so 60 fps has a 17 ms median.
    pub fps: f64,
    /// Intervals deviating from the median by more than half of it (duplicates and real gaps).
    pub irregular_intervals: usize,
    /// More than 1% of intervals irregular.
    pub vfr: bool,
    /// Adjacent frames with exactly equal pts.
    pub duplicate_pts: usize,
    /// Packets without a presentation time (left out of the index).
    pub missing_pts: usize,
    /// Largest interval between consecutive frames, seconds.
    pub max_gap: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FrameIndex {
    pub frames: Vec<FrameEntry>,
    pub summary: IndexSummary,
}

/// Parse ffprobe packet CSV. Blank lines and CRLF are tolerated; `N/A` fields become `None`.
pub fn parse_packets(text: &str) -> Result<Vec<Packet>, IndexError> {
    let mut packets = Vec::new();
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let err = |msg: String| IndexError::Parse { line: i + 1, msg };
        let fields: Vec<&str> = line.split(',').map(str::trim).collect();
        if fields.len() != 3 {
            return Err(err(format!(
                "expected pts,dts,flags but got {} field(s): {line:?}",
                fields.len()
            )));
        }
        let time = |field: &str| -> Result<Option<f64>, IndexError> {
            if field == "N/A" {
                return Ok(None);
            }
            match field.parse::<f64>() {
                Ok(v) if v.is_finite() => Ok(Some(v)),
                _ => Err(err(format!("not a time: {field:?}"))),
            }
        };
        packets.push(Packet {
            pts: time(fields[0])?,
            dts: time(fields[1])?,
            key: fields[2].contains('K'),
        });
    }
    Ok(packets)
}

/// Sort packets into display order and summarise their timing.
pub fn build_index(packets: &[Packet], cfg: &IndexConfig) -> Result<FrameIndex, IndexError> {
    if packets.is_empty() {
        return Err(IndexError::NoPackets);
    }
    let mut timed: Vec<(f64, bool)> = packets
        .iter()
        .filter_map(|p| p.pts.map(|t| (t, p.key)))
        .collect();
    let missing_pts = packets.len() - timed.len();
    if timed.is_empty() {
        return Err(IndexError::NoTimestamps);
    }
    // stable: packets with equal pts keep decode order
    timed.sort_by(|a, b| a.0.partial_cmp(&b.0).expect("pts values are finite"));

    let frames: Vec<FrameEntry> = timed
        .iter()
        .enumerate()
        .map(|(n, &(pts, key))| FrameEntry {
            n: n as u32,
            pts,
            key,
        })
        .collect();

    let intervals: Vec<f64> = frames.windows(2).map(|w| w[1].pts - w[0].pts).collect();
    let duplicate_pts = intervals.iter().filter(|&&d| d == 0.0).count();
    let mut positive: Vec<f64> = intervals.iter().copied().filter(|&d| d > 0.0).collect();
    positive.sort_by(|a, b| a.partial_cmp(b).expect("intervals are finite"));
    let median_interval = positive.get(positive.len() / 2).copied().unwrap_or(0.0);
    let irregular_intervals = if median_interval > 0.0 {
        intervals
            .iter()
            .filter(|&&d| (d - median_interval).abs() > cfg.irregular_deviation * median_interval)
            .count()
    } else {
        0
    };
    let duration = frames[frames.len() - 1].pts - frames[0].pts;
    let fps = if frames.len() >= 2 && duration > 0.0 {
        (frames.len() - 1) as f64 / duration
    } else {
        0.0
    };
    let max_gap = intervals.iter().copied().fold(0.0, f64::max);
    let vfr = irregular_intervals as f64 > cfg.vfr_fraction * intervals.len() as f64;

    let summary = IndexSummary {
        frame_count: frames.len(),
        duration,
        median_interval,
        fps,
        irregular_intervals,
        vfr,
        duplicate_pts,
        missing_pts,
        max_gap,
    };
    Ok(FrameIndex { frames, summary })
}

impl FrameIndex {
    /// Nearest keyframe at or before frame `n` (`n` past the end is clamped); `None` if there is none.
    pub fn keyframe_at_or_before(&self, n: u32) -> Option<u32> {
        let last = self.frames.len().checked_sub(1)?;
        let from = (n as usize).min(last);
        self.frames[..=from]
            .iter()
            .rev()
            .find(|f| f.key)
            .map(|f| f.n)
    }

    /// Last frame whose pts is `<= t`; `None` if `t` is before the first frame or the index is empty.
    pub fn frame_at_time(&self, t: f64) -> Option<u32> {
        let after = self.frames.partition_point(|f| f.pts <= t);
        after.checked_sub(1).map(|i| self.frames[i].n)
    }
}

/// The frame shown closest to time `t` (seconds); on an exact tie, the earlier frame. 0 for an empty index.
pub fn nearest_frame(frames: &[FrameEntry], t: f64) -> usize {
    nearest_by(frames, t, |f| f.pts)
}

/// [`nearest_frame`] for any frame list sorted by presentation time (`pts` reads each entry's time).
pub fn nearest_by<T>(frames: &[T], t: f64, pts: impl Fn(&T) -> f64) -> usize {
    let after = frames.partition_point(|f| pts(f) <= t);
    match after {
        0 => 0,
        k if k == frames.len() => k - 1,
        k if t - pts(&frames[k - 1]) <= pts(&frames[k]) - t => k - 1,
        k => k,
    }
}
