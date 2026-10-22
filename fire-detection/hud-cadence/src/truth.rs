//! Ground truth from a mod-hud recording: the strip gives each video frame's renderer frame ID, the mod's log
//! gives each renderer frame's clock and displayed value.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LogRow {
    pub frame: u32,
    pub nanos: i64,
    pub fps: i32,
    pub changed: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Alignment {
    pub readable: usize,
    /// Video frames whose ID is exactly the previous readable ID + 1.
    pub new: usize,
    /// Video frames repeating the previous readable ID (the recorder re-sent a frame).
    pub duplicates: usize,
    /// Renderer frames that never appeared in the video (sum over forward gaps larger than 1).
    pub skipped_renderer_frames: usize,
    /// IDs lower than the previous one: a mis-decoded or torn strip, excluded from the counts above.
    pub backwards: usize,
}

pub fn align(ids: &[Option<u32>]) -> Alignment {
    let mut a = Alignment::default();
    let mut prev: Option<u32> = None;
    for id in ids.iter().flatten() {
        a.readable += 1;
        if let Some(p) = prev {
            if *id == p {
                a.duplicates += 1;
            } else if *id == p + 1 {
                a.new += 1;
            } else if *id > p {
                a.skipped_renderer_frames += (*id - p - 1) as usize;
                a.new += 1;
            } else {
                a.backwards += 1;
                continue;
            }
        }
        prev = Some(*id);
    }
    a
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExpectedChange {
    pub renderer_frame: u32,
    pub nanos: i64,
    pub fps: i32,
    /// First video frame whose readable ID is at or after `renderer_frame`.
    pub video_frame: u32,
}

/// Every logged FPS change that falls inside the captured ID range, mapped to the video frame that first shows it.
pub fn expected_changes(rows: &[LogRow], ids: &[Option<u32>]) -> Vec<ExpectedChange> {
    let readable: Vec<(usize, u32)> = ids.iter().enumerate().filter_map(|(i, id)| id.map(|id| (i, id))).collect();
    let Some(&(_, first)) = readable.first() else { return Vec::new() };
    let mut out = Vec::new();
    for row in rows.iter().filter(|r| r.changed) {
        if row.frame < first {
            continue;
        }
        if let Some(&(video, _)) = readable.iter().find(|(_, id)| *id >= row.frame) {
            out.push(ExpectedChange { renderer_frame: row.frame, nanos: row.nanos, fps: row.fps, video_frame: video as u32 });
        }
    }
    out
}

/// Parses mod-hud's JSONL (only `record == "frame"` rows).
pub fn parse_log(text: &str) -> Vec<LogRow> {
    text.lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|v| v["record"] == "frame")
        .map(|v| LogRow {
            frame: v["frame"].as_u64().unwrap_or(0) as u32,
            nanos: v["nanos"].as_i64().unwrap_or(0),
            fps: v["fps"].as_i64().unwrap_or(0) as i32,
            changed: v["fps_changed"].as_bool().unwrap_or(false),
        })
        .collect()
}
