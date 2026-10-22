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
        // The first readable frame at or after the change, but only if the frame right before it was readable
        // too: across an unreadable gap the change could sit anywhere inside, and guessing the far edge of the gap
        // would invent a phase shift.
        if let Some(k) = readable.iter().position(|(_, id)| *id >= row.frame) {
            let (video, _) = readable[k];
            let continuous = k == 0 || readable[k - 1].0 + 1 == video;
            if continuous && k > 0 {
                out.push(ExpectedChange { renderer_frame: row.frame, nanos: row.nanos, fps: row.fps, video_frame: video as u32 });
            }
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

/// Runs of consecutive strip-readable video frames of at least `min_len`, as (start, len).
pub fn segments(ids: &[Option<u32>], min_len: usize) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    for i in 0..=ids.len() {
        let readable = i < ids.len() && ids[i].is_some();
        match (readable, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                if i - s >= min_len {
                    out.push((s, i - s));
                }
                start = None;
            }
            _ => {}
        }
    }
    out
}

#[derive(Clone, Debug, PartialEq)]
pub struct Label {
    pub video_frame: u32,
    /// Seconds from the start of the scan window at the nominal frame rate.
    pub time: f64,
    pub renderer_frame: Option<u32>,
    pub nanos: Option<i64>,
    pub fps: Option<i32>,
    pub fps_changed: bool,
}

/// One label per video frame: the strip's renderer frame joined to the mod's row for it. Frames whose strip did
/// not decode get no renderer data; a decoded ID missing from the log keeps the ID only.
pub fn labels(rows: &[LogRow], ids: &[Option<u32>], fps: u32) -> Vec<Label> {
    let by_frame: std::collections::HashMap<u32, &LogRow> = rows.iter().map(|r| (r.frame, r)).collect();
    // `fps_changed` marks the first video frame that shows a new value: the renderer frame where the value changed
    // is rarely the one captured, so compare with the previous labelled value instead of the row's own flag.
    let mut previous: Option<i32> = None;
    ids.iter()
        .enumerate()
        .map(|(i, id)| {
            let row = id.and_then(|id| by_frame.get(&id).copied());
            let fps_value = row.map(|r| r.fps);
            let fps_changed = match (fps_value, previous) {
                (Some(v), Some(p)) => v != p,
                (Some(_), None) => true,
                (None, _) => false,
            };
            if fps_value.is_some() {
                previous = fps_value;
            }
            Label { video_frame: i as u32, time: i as f64 / fps as f64, renderer_frame: *id, nanos: row.map(|r| r.nanos), fps: fps_value, fps_changed }
        })
        .collect()
}
