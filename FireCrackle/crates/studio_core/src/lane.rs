//! Timeline lane summaries: how a range of frames is labelled, one bucket per pixel column.

use crate::label::{Label, LabelSource, LabelStore};
use crate::phase::{Flag, Severity};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Bucket {
    /// Frames in this bucket (may be 0 when there are more buckets than frames).
    pub frames: u32,
    pub unset: u32,
    pub fire: u32,
    pub no_fire: u32,
    pub skip: u32,
    /// Unchecked automatic labels only. Human confirmation keeps history but removes the strip.
    pub auto_first_person: u32,
    pub auto_no_fire: u32,
    pub auto_time_guess: u32,
    /// The worst flag whose extent (`frame..=end_frame`) overlaps this bucket.
    pub flag: Option<Severity>,
}

/// Summarise frames `start..end` (clamped to the store) into `n` buckets; bucket `i` covers
/// `start + i*len/n .. start + (i+1)*len/n`. Empty for `n == 0` or an empty range.
pub fn buckets(store: &LabelStore, flags: &[Flag], start: u32, end: u32, n: usize) -> Vec<Bucket> {
    let end = end.min(store.frame_count());
    if n == 0 || start >= end {
        return Vec::new();
    }
    let len = (end - start) as u64;
    let n64 = n as u64;
    let bound = |i: u64| start as u64 + i * len / n64;
    // the bucket whose range contains frame `f` (start <= f < end): the inverse of `bound`
    let bucket_of = |f: u32| -> usize { ((((f - start) as u64 + 1) * n64 - 1) / len) as usize };

    let mut out = vec![Bucket::default(); n];
    for (i, b) in out.iter_mut().enumerate() {
        b.frames = (bound(i as u64 + 1) - bound(i as u64)) as u32;
    }
    for (frame, label) in store.iter() {
        if frame < start || frame >= end {
            continue;
        }
        let b = &mut out[bucket_of(frame)];
        match label {
            Label::Fire { .. } => b.fire += 1,
            Label::NoFire => b.no_fire += 1,
            Label::Skip => b.skip += 1,
            Label::Unset => {}
        }
        let sources = store.sources(frame);
        if !sources.contains(&LabelSource::Manual) {
            b.auto_first_person += sources.contains(&LabelSource::FirstPerson) as u32;
            b.auto_no_fire += sources.contains(&LabelSource::NoFire) as u32;
            b.auto_time_guess += sources.contains(&LabelSource::TimeGuess) as u32;
        }
    }
    for b in out.iter_mut() {
        b.unset = b.frames - b.fire - b.no_fire - b.skip;
    }
    for f in flags {
        let (first, last) = (f.frame.max(start), f.end_frame.min(end - 1));
        if first > last {
            continue;
        }
        for b in &mut out[bucket_of(first)..=bucket_of(last)] {
            b.flag = match (b.flag, f.severity) {
                (Some(Severity::Hard), _) | (_, Severity::Hard) => Some(Severity::Hard),
                _ => Some(Severity::Soft),
            };
        }
    }
    out
}
