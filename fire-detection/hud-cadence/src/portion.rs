//! `--from` / `--to`: a portion of the video. A bare integer is a frame number; a time has a colon
//! (`17:01.5`, `0:17:01.5`) or an `s` suffix (`1021.5s`).

/// The frame a position names, at `fps`.
pub fn parse_position(s: &str, fps: u32) -> Result<u32, String> {
    let s = s.trim();
    let bad = || format!("not a frame number or a time: {s:?} (frame: 61270; time: 1021.5s, 17:01.5 or 0:17:01.5)");
    if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) {
        return s.parse().map_err(|_| bad());
    }
    let seconds = if let Some(sec) = s.strip_suffix('s') {
        number(sec).ok_or_else(bad)?
    } else if s.contains(':') {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() > 3 {
            return Err(bad());
        }
        let (last, whole) = parts.split_last().unwrap();
        let mut t = 0.0;
        for p in whole {
            if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
                return Err(bad());
            }
            t = t * 60.0 + p.parse::<f64>().map_err(|_| bad())?;
        }
        t * 60.0 + number(last).ok_or_else(bad)?
    } else {
        return Err(bad());
    };
    Ok((seconds * fps as f64).round() as u32)
}

/// A non-negative decimal (digits with at most one point).
fn number(s: &str) -> Option<f64> {
    let ok = !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit() || b == b'.') && s.bytes().filter(|&b| b == b'.').count() <= 1 && s != ".";
    if ok { s.parse().ok() } else { None }
}

/// Where ffmpeg seeks to start at `frame`: half a frame early, because Matroska timestamps are rounded to the
/// millisecond and a frame stored a fraction early would otherwise be skipped.
pub fn seek_seconds(frame: u32, fps: u32) -> f64 {
    if frame == 0 { 0.0 } else { (frame as f64 - 0.5) / fps as f64 }
}

/// Frames in `from..=to`.
pub fn frame_count(from: u32, to: u32) -> Result<u32, String> {
    if to < from {
        return Err(format!("--to (frame {to}) is before --from (frame {from})"));
    }
    Ok(to - from + 1)
}
