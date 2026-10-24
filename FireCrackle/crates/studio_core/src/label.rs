//! Per-frame label store: set / clear / undo, tick-run fill, navigation and an append-only JSONL log.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// What a frame is labelled as.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Label {
    /// Not labelled (the default).
    Unset,
    /// Looked at, no fire visible.
    NoFire,
    /// Looked at, this alternative animation source is absent. Does not imply no fire.
    NoTexture { atlas: AnimationAtlas },
    /// Looked at, deliberately skipped.
    Skip,
    /// A fire sprite: sheet 0 or 1, animation index 0..31, normal or mirrored.
    Fire { sheet: u8, row: u8, mirrored: bool },
    /// Two simultaneous readings of the shared fire clock, retaining appearance and evidence origin.
    FirePair {
        normal: FireReading,
        soul: FireReading,
    },
    /// Alternative manual texture observation. Soul-fire rows use normalized animation indices.
    Texture {
        atlas: AnimationAtlas,
        row: u8,
        mirrored: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FireReading {
    pub sheet: u8,
    pub row: u8,
    pub mirrored: bool,
    pub sources: u8,
}
impl FireReading {
    pub fn label(self, soul: bool) -> Label {
        if soul {
            Label::Texture {
                atlas: if self.sheet == 0 {
                    AnimationAtlas::SoulFire0
                } else {
                    AnimationAtlas::SoulFire1
                },
                row: self.row,
                mirrored: self.mirrored,
            }
        } else {
            Label::Fire {
                sheet: self.sheet,
                row: self.row,
                mirrored: self.mirrored,
            }
        }
    }
    pub fn has_source(self, source: LabelSource) -> bool {
        self.sources & source.bit() != 0
    }
}

/// Vanilla block-atlas families; fluids remain separate observations, never fire detector outputs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnimationAtlas {
    SoulFire0,
    SoulFire1,
    LavaStill,
    LavaFlow,
    WaterStill,
    WaterFlow,
}
impl AnimationAtlas {
    pub fn rows(self) -> u8 {
        match self {
            Self::LavaStill => 20,
            Self::LavaFlow => 16,
            _ => 32,
        }
    }
    pub fn fire_sheet(self) -> Option<u8> {
        match self {
            Self::SoulFire0 => Some(0),
            Self::SoulFire1 => Some(1),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LabelError {
    InvalidSheet(u8),
    InvalidRow(u8),
    FrameOutOfRange {
        frame: u32,
        count: u32,
    },
    /// `fill_range` with `start > end`.
    BadRange {
        start: u32,
        end: u32,
    },
    /// A log line that cannot be parsed (1-based line number).
    Parse {
        line: usize,
        msg: String,
    },
}

impl Label {
    /// A validated fire label.
    pub fn fire(sheet: u8, row: u8, mirrored: bool) -> Result<Label, LabelError> {
        let label = Label::Fire {
            sheet,
            row,
            mirrored,
        };
        label.validate()?;
        Ok(label)
    }

    pub fn validate(&self) -> Result<(), LabelError> {
        match *self {
            Label::Fire { sheet, .. } if sheet >= 2 => Err(LabelError::InvalidSheet(sheet)),
            Label::Fire { row, .. } if row >= 32 => Err(LabelError::InvalidRow(row)),
            Label::Texture { atlas, row, .. } if row >= atlas.rows() => {
                Err(LabelError::InvalidRow(row))
            }
            Label::FirePair { normal, soul } => {
                normal.label(false).validate()?;
                soul.label(true).validate()?;
                if normal.sheet >= 2
                    || soul.sheet >= 2
                    || normal.sources == 0
                    || soul.sources == 0
                    || normal.sources > 15
                    || soul.sources > 15
                {
                    return Err(LabelError::InvalidSheet(normal.sheet.max(soul.sheet)));
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    pub fn canonical_fire(&self) -> Option<Label> {
        match *self {
            Label::Fire { .. } => Some(*self),
            Label::FirePair { normal, .. } => Some(normal.label(false)),
            Label::Texture {
                atlas,
                row,
                mirrored,
            } => atlas.fire_sheet().map(|sheet| Label::Fire {
                sheet,
                row,
                mirrored,
            }),
            _ => None,
        }
    }

    pub fn is_fire(&self) -> bool {
        self.canonical_fire().is_some()
    }

    pub fn fire_reading(self, soul: bool, sources: &BTreeSet<LabelSource>) -> Option<FireReading> {
        let bits = sources.iter().fold(0, |bits, source| bits | source.bit());
        match self {
            Label::FirePair {
                normal,
                soul: other,
            } => Some(if soul { other } else { normal }),
            Label::Fire {
                sheet,
                row,
                mirrored,
            } if !soul => Some(FireReading {
                sheet,
                row,
                mirrored,
                sources: bits,
            }),
            Label::Texture {
                atlas,
                row,
                mirrored,
            } if soul => atlas.fire_sheet().map(|sheet| FireReading {
                sheet,
                row,
                mirrored,
                sources: bits,
            }),
            _ => None,
        }
    }
    pub fn merge_fire(
        self,
        incoming: Label,
        old_sources: &BTreeSet<LabelSource>,
        new_sources: &BTreeSet<LabelSource>,
    ) -> Label {
        let updated = |soul| {
            let mut next = incoming.fire_reading(soul, new_sources).unwrap();
            if let Some(old) = self.fire_reading(soul, old_sources) {
                if old.sheet == next.sheet && old.row == next.row && old.mirrored == next.mirrored {
                    next.sources |= old.sources;
                }
            }
            next
        };
        if let Label::Fire { .. } = incoming {
            if let Some(soul) = self.fire_reading(true, old_sources) {
                return Label::FirePair {
                    normal: updated(false),
                    soul,
                };
            }
        }
        if let Label::Texture { atlas, .. } = incoming {
            if atlas.fire_sheet().is_some() {
                if let Some(normal) = self.fire_reading(false, old_sources) {
                    return Label::FirePair {
                        normal,
                        soul: updated(true),
                    };
                }
            }
        }
        incoming
    }
}

/// Result of replaying a log.
#[derive(Debug)]
pub struct Replay {
    pub store: LabelStore,
    /// True when an unparsable final line was dropped (crash while appending).
    pub torn_tail: bool,
}

/// One log line.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LabelSource {
    Manual,
    FirstPerson,
    TimeGuess,
    NoFire,
}
impl LabelSource {
    pub fn bit(self) -> u8 {
        match self {
            Self::Manual => 1,
            Self::FirstPerson => 2,
            Self::TimeGuess => 4,
            Self::NoFire => 8,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Entry {
    #[serde(default)]
    version: u32,
    frame: u32,
    label: Label,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    predicted: bool,
    #[serde(default, skip_serializing_if = "default_sources")]
    sources: Vec<LabelSource>,
}

fn default_sources(sources: &Vec<LabelSource>) -> bool {
    sources.is_empty() || sources.as_slice() == [LabelSource::Manual]
}

impl Entry {
    fn sources(&self) -> BTreeSet<LabelSource> {
        if self.label == Label::Unset {
            return BTreeSet::new();
        }
        if !self.sources.is_empty() {
            return self.sources.iter().copied().collect();
        }
        [if self.predicted {
            LabelSource::TimeGuess
        } else {
            LabelSource::Manual
        }]
        .into_iter()
        .collect()
    }
}

#[derive(Serialize, Deserialize)]
struct LabelArchive {
    format: String,
    version: u32,
    fingerprint: String,
    frame_count: u32,
    labels: Vec<Entry>,
}

/// Previous labels of the frames one undo step restores.
type UndoStep = Vec<(u32, Label, bool, BTreeSet<LabelSource>)>;

#[derive(Debug, Clone)]
pub struct LabelStore {
    frame_count: u32,
    labels: BTreeMap<u32, Label>,
    predicted: BTreeSet<u32>,
    sources: BTreeMap<u32, BTreeSet<LabelSource>>,
    undo: Vec<UndoStep>,
    /// Steps undone since the last change, newest last: what `redo` re-applies.
    redo: Vec<UndoStep>,
}

impl LabelStore {
    pub fn new(frame_count: u32) -> LabelStore {
        LabelStore {
            frame_count,
            labels: BTreeMap::new(),
            predicted: BTreeSet::new(),
            sources: BTreeMap::new(),
            undo: Vec::new(),
            redo: Vec::new(),
        }
    }

    pub fn frame_count(&self) -> u32 {
        self.frame_count
    }

    /// Number of actual reversible label changes (navigation and no-op writes add none).
    pub fn undo_depth(&self) -> usize {
        self.undo.len()
    }

    /// Number of undone changes `redo` can re-apply.
    pub fn redo_depth(&self) -> usize {
        self.redo.len()
    }

    /// Record one reversible change. A new change drops what could be redone.
    fn push_undo(&mut self, step: UndoStep) {
        self.undo.push(step);
        self.redo.clear();
    }

    /// Portable snapshot: animation indices and prediction provenance are preserved.
    pub fn export_json(&self, fingerprint: &str) -> String {
        let archive = LabelArchive {
            format: "firecrackle-labels".into(),
            version: if self
                .labels
                .values()
                .any(|l| matches!(l, Label::FirePair { .. }))
            {
                3
            } else {
                2
            },
            fingerprint: fingerprint.into(),
            frame_count: self.frame_count,
            labels: self
                .iter()
                .into_iter()
                .map(|(frame, label)| Entry {
                    version: if matches!(label, Label::FirePair { .. }) {
                        3
                    } else {
                        2
                    },
                    frame,
                    label,
                    predicted: self.is_predicted(frame),
                    sources: self.sources(frame).into_iter().collect(),
                })
                .collect(),
        };
        serde_json::to_string_pretty(&archive).expect("plain label archive")
    }

    /// Validate the entire snapshot before merging; the whole import is one undo step.
    pub fn import_json(&mut self, text: &str, fingerprint: &str) -> Result<Vec<u32>, LabelError> {
        let bad = |msg: &str| LabelError::Parse {
            line: 0,
            msg: msg.into(),
        };
        let archive: LabelArchive = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|e| bad(&format!("Invalid label file: {e}")))?;
        if archive.format != "firecrackle-labels" || ![2, 3].contains(&archive.version) {
            return Err(bad("Unsupported label export format or version"));
        }
        if archive.frame_count != self.frame_count || archive.fingerprint != fingerprint {
            return Err(bad(
                "These labels belong to a different video. Open the matching video first.",
            ));
        }
        let mut seen = BTreeSet::new();
        for entry in &archive.labels {
            self.check_frame(entry.frame)?;
            entry.label.validate()?;
            if ![2, 3].contains(&entry.version)
                || !seen.insert(entry.frame)
                || (entry.predicted && !entry.label.is_fire())
            {
                return Err(bad("Invalid or duplicate label entry"));
            }
        }
        let mut undo = Vec::new();
        for entry in archive.labels {
            let previous = self.get(entry.frame);
            let predicted = self.is_predicted(entry.frame);
            let sources = entry.sources();
            let old_sources = self.sources(entry.frame);
            if previous == entry.label && sources == old_sources {
                continue;
            }
            undo.push((entry.frame, previous, predicted, old_sources));
            self.put(entry.frame, entry.label);
            self.put_sources(entry.frame, sources);
        }
        let mut frames: Vec<_> = undo.iter().map(|(frame, _, _, _)| *frame).collect();
        frames.sort_unstable();
        if !undo.is_empty() {
            self.push_undo(undo);
        }
        Ok(frames)
    }

    /// Label of a frame; `Label::Unset` when none (also for out-of-range frames).
    pub fn get(&self, frame: u32) -> Label {
        self.labels.get(&frame).copied().unwrap_or(Label::Unset)
    }

    pub fn is_predicted(&self, frame: u32) -> bool {
        self.predicted.contains(&frame)
    }

    pub fn sources(&self, frame: u32) -> BTreeSet<LabelSource> {
        self.sources.get(&frame).cloned().unwrap_or_default()
    }

    fn put_sources(&mut self, frame: u32, sources: BTreeSet<LabelSource>) {
        if sources.is_empty() {
            return;
        }
        if self.get(frame).is_fire() && !sources.contains(&LabelSource::Manual) {
            self.predicted.insert(frame);
        } else {
            self.predicted.remove(&frame);
        }
        self.sources.insert(frame, sources);
    }

    /// Persist both value and source; accepted guesses must not become calibration evidence on restart.
    pub fn log_line(&self, frame: u32) -> String {
        serde_json::to_string(&Entry {
            version: if matches!(self.get(frame), Label::FirePair { .. }) {
                3
            } else {
                2
            },
            frame,
            label: self.get(frame),
            predicted: self.is_predicted(frame),
            sources: self.sources(frame).into_iter().collect(),
        })
        .expect("plain log entry")
    }

    fn check_frame(&self, frame: u32) -> Result<(), LabelError> {
        if frame < self.frame_count {
            Ok(())
        } else {
            Err(LabelError::FrameOutOfRange {
                frame,
                count: self.frame_count,
            })
        }
    }

    fn put(&mut self, frame: u32, label: Label) {
        self.predicted.remove(&frame);
        self.sources.remove(&frame);
        if label == Label::Unset {
            self.labels.remove(&frame);
        } else {
            self.labels.insert(frame, label);
        }
    }

    /// Set a label. `Ok(true)` if it changed something (and pushed one undo entry),
    /// `Ok(false)` if it equalled the current label. `Label::Unset` clears.
    pub fn set(&mut self, frame: u32, label: Label) -> Result<bool, LabelError> {
        self.set_with_source(frame, label, false)
    }

    pub fn set_predicted(&mut self, frame: u32, label: Label) -> Result<bool, LabelError> {
        self.set_with_source(frame, label, true)
    }

    fn set_with_source(
        &mut self,
        frame: u32,
        label: Label,
        predicted: bool,
    ) -> Result<bool, LabelError> {
        label.validate()?;
        self.check_frame(frame)?;
        let prev = self.get(frame);
        let was_predicted = self.is_predicted(frame);
        let old_sources = self.sources(frame);
        let mut sources = if prev == label {
            old_sources.clone()
        } else {
            BTreeSet::new()
        };
        if label != Label::Unset {
            sources.insert(if predicted && label.is_fire() {
                LabelSource::TimeGuess
            } else {
                LabelSource::Manual
            });
        }
        let label = prev.merge_fire(label, &old_sources, &sources);
        if let Label::FirePair { normal, soul } = label {
            sources = [
                LabelSource::Manual,
                LabelSource::FirstPerson,
                LabelSource::TimeGuess,
                LabelSource::NoFire,
            ]
            .into_iter()
            .filter(|s| normal.has_source(*s) || soul.has_source(*s))
            .collect();
        }
        if prev == label && old_sources == sources {
            return Ok(false);
        }
        self.push_undo(vec![(frame, prev, was_predicted, old_sources)]);
        self.put(frame, label);
        self.put_sources(frame, sources);
        Ok(true)
    }

    pub fn clear(&mut self, frame: u32) -> Result<bool, LabelError> {
        self.set(frame, Label::Unset)
    }

    /// Undo the last change (a whole `fill_tick_run` is one change). False when nothing to undo.
    pub fn undo(&mut self) -> bool {
        self.undo_step().is_some()
    }

    /// Undo the last change like `undo`, returning the frames it restored (ascending).
    pub fn undo_step(&mut self) -> Option<Vec<u32>> {
        let step = self.undo.pop()?;
        let (frames, current) = self.restore(step);
        self.redo.push(current);
        Some(frames)
    }

    /// Re-apply the last undone change. False when nothing to redo.
    pub fn redo(&mut self) -> bool {
        self.redo_step().is_some()
    }

    /// Redo like `redo`, returning the frames it re-applied (ascending). The change is undoable again.
    pub fn redo_step(&mut self) -> Option<Vec<u32>> {
        let step = self.redo.pop()?;
        let (frames, current) = self.restore(step);
        self.undo.push(current);
        Some(frames)
    }

    /// Put a step's labels and sources back; returns its frames (ascending) and the step that puts back what was there.
    fn restore(&mut self, step: UndoStep) -> (Vec<u32>, UndoStep) {
        let mut frames: Vec<u32> = Vec::with_capacity(step.len());
        let mut current: UndoStep = Vec::with_capacity(step.len());
        for (frame, label, _predicted, sources) in step {
            current.push((
                frame,
                self.get(frame),
                self.is_predicted(frame),
                self.sources(frame),
            ));
            self.put(frame, label);
            self.put_sources(frame, sources);
            frames.push(frame);
        }
        frames.sort_unstable();
        (frames, current)
    }

    /// Label every frame in `start..=end` (inclusive). Returns the number of frames whose label changed.
    /// One undo entry for the whole range, restoring each frame's previous label exactly.
    /// `Label::Unset` clears the range.
    pub fn fill_range(&mut self, start: u32, end: u32, label: Label) -> Result<usize, LabelError> {
        label.validate()?;
        if start > end {
            return Err(LabelError::BadRange { start, end });
        }
        self.check_frame(end)?; // start <= end, so start is in range too
        let mut step: UndoStep = Vec::new();
        for f in start..=end {
            let prev = self.get(f);
            if prev != label
                || (label != Label::Unset && !self.sources(f).contains(&LabelSource::Manual))
            {
                let old_sources = self.sources(f);
                let mut sources = if prev == label {
                    old_sources.clone()
                } else {
                    BTreeSet::new()
                };
                if label != Label::Unset {
                    sources.insert(LabelSource::Manual);
                }
                let label = prev.merge_fire(label, &old_sources, &sources);
                if let Label::FirePair { normal, soul } = label {
                    sources = [
                        LabelSource::Manual,
                        LabelSource::FirstPerson,
                        LabelSource::TimeGuess,
                        LabelSource::NoFire,
                    ]
                    .into_iter()
                    .filter(|s| normal.has_source(*s) || soul.has_source(*s))
                    .collect();
                }
                if prev == label && old_sources == sources {
                    continue;
                }
                step.push((f, prev, self.is_predicted(f), old_sources));
                self.put(f, label);
                self.put_sources(f, sources);
            }
        }
        let changed = step.len();
        if changed > 0 {
            self.push_undo(step);
        }
        Ok(changed)
    }

    /// First frame strictly after (forward) or before (backward) `from` that is `Unset`.
    /// `NoFire` and `Skip` count as labelled.
    pub fn next_unlabelled(&self, from: u32, forward: bool) -> Option<u32> {
        if forward {
            (from.saturating_add(1)..self.frame_count).find(|f| !self.labels.contains_key(f))
        } else {
            (0..from.min(self.frame_count))
                .rev()
                .find(|f| !self.labels.contains_key(f))
        }
    }

    /// Number of frames whose label is not `Unset`.
    pub fn labelled_count(&self) -> usize {
        self.labels.len()
    }

    /// All labelled frames in ascending frame order.
    pub fn iter(&self) -> Vec<(u32, Label)> {
        self.labels.iter().map(|(&f, &l)| (f, l)).collect()
    }

    /// Rebuild a store from an append-only log (last line per frame wins).
    /// Blank lines are ignored; an unparsable *last* line is dropped (`torn_tail`);
    /// an unparsable earlier line, an invalid label or a frame >= `frame_count` is an error.
    pub fn replay(text: &str, frame_count: u32) -> Result<Replay, LabelError> {
        let lines: Vec<(usize, &str)> = text
            .lines()
            .enumerate()
            .map(|(i, l)| (i + 1, l.trim()))
            .filter(|(_, l)| !l.is_empty())
            .collect();
        let mut store = LabelStore::new(frame_count);
        let mut torn_tail = false;
        for (idx, &(line_no, line)) in lines.iter().enumerate() {
            let mut entry: Entry = match serde_json::from_str(line) {
                Ok(e) => e,
                Err(_) if idx + 1 == lines.len() => {
                    torn_tail = true;
                    break;
                }
                Err(e) => {
                    return Err(LabelError::Parse {
                        line: line_no,
                        msg: e.to_string(),
                    })
                }
            };
            entry.label.validate()?;
            if entry.version > 3 {
                return Err(LabelError::Parse {
                    line: line_no,
                    msg: "Unsupported label log version".into(),
                });
            }
            // Only the legacy file reader performs v1 -> v2 migration.
            if entry.version < 2 {
                if let Label::Fire { sheet: 0, row, .. } = &mut entry.label {
                    *row = (*row + 16) % 32;
                }
            }
            store.check_frame(entry.frame)?;
            store.put(entry.frame, entry.label);
            store.put_sources(entry.frame, entry.sources());
        }
        Ok(Replay { store, torn_tail })
    }
}

/// One versioned animation-index log entry, without a trailing newline.
pub fn log_line(frame: u32, label: Label) -> String {
    serde_json::to_string(&Entry {
        version: if matches!(label, Label::FirePair { .. }) {
            3
        } else {
            2
        },
        frame,
        label,
        predicted: false,
        sources: if label == Label::Unset {
            vec![]
        } else {
            vec![LabelSource::Manual]
        },
    })
    .expect("a plain struct always serialises")
}

/// Clamp a (possibly negative / past-the-end) frame index into `0..count`. `None` when `count == 0`.
pub fn clamp_frame(frame: i64, count: u32) -> Option<u32> {
    if count == 0 {
        None
    } else {
        Some(frame.clamp(0, count as i64 - 1) as u32)
    }
}
