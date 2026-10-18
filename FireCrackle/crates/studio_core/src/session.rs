//! The Label tab's brain: current frame, pick state, typed rows, suggestions, advance rules, undo and the
//! autosave queue, as one pure object. The UI calls one method per user action.

use crate::config::Settings;
use crate::label::{Label, LabelError, LabelSource, LabelStore};
use crate::phase::{Analysis, Flag, FrameObs, STEPS};
use crate::project::Project;
use serde::Serialize;

/// Result of the digit buffer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TyperResult {
    /// Waiting for a second digit (the first digit could start a two-digit row).
    Pending(u8),
    Commit(u8),
    /// Not a valid row (e.g. 35, or not a digit).
    Rejected,
}

/// Turns typed digits into a row 0..31: `1` waits for a second digit, `4`..`9` commit at once, `12` commits 12,
/// `35` is rejected.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RowTyper {
    pending: Option<u8>,
}

impl RowTyper {
    pub fn new() -> RowTyper {
        RowTyper { pending: None }
    }

    pub fn push(&mut self, digit: u8) -> TyperResult {
        if digit > 9 {
            self.pending = None;
            return TyperResult::Rejected;
        }
        match self.pending.take() {
            None if digit >= 4 => TyperResult::Commit(digit), // 40 and up are not rows
            None => {
                self.pending = Some(digit);
                TyperResult::Pending(digit)
            }
            Some(first) => {
                let row = first * 10 + digit;
                if row < STEPS {
                    TyperResult::Commit(row)
                } else {
                    TyperResult::Rejected
                }
            }
        }
    }

    /// Commit a pending single digit (Enter, or the timeout).
    pub fn flush(&mut self) -> Option<u8> {
        self.pending.take()
    }

    pub fn clear(&mut self) {
        self.pending = None;
    }

    pub fn pending(&self) -> Option<u8> {
        self.pending
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Move {
    Frames(i64),
    To(u32),
    Home,
    End,
    NextUnlabelled,
    PrevUnlabelled,
    NextFlag,
    PrevFlag,
}

/// Which sprite the next typed row refers to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct PickState {
    pub sheet: u8,
    pub mirrored: bool,
}

/// A label was set at `frame`; the playhead is now at `now_at`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Applied {
    pub frame: u32,
    pub now_at: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TypeOutcome {
    Pending(u8),
    Committed(Applied),
    Rejected,
}

/// Nominal clock prediction from trusted labels; never a claim that lag cannot occur.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Suggestion {
    pub sheet: u8,
    pub mirrored: bool,
    pub row: u8,
    /// Closest alternate supported by phase/capture uncertainty. Larger lag may exceed either candidate.
    pub alt_row: Option<u8>,
    pub from_frame: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SessionError {
    Label(LabelError),
    /// The project and the label store disagree on the number of frames.
    FrameCountMismatch {
        project: usize,
        store: u32,
    },
    NoSuggestion,
}

impl From<LabelError> for SessionError {
    fn from(e: LabelError) -> SessionError {
        SessionError::Label(e)
    }
}

/// Floating-point tolerance for whole-tick arithmetic; does not remove capture uncertainty.
const WHOLE_TICK_EPS: f64 = 1e-6;

pub struct Session {
    project: Project,
    store: LabelStore,
    settings: Settings,
    current: u32,
    pick: PickState,
    typer: RowTyper,
    log: Vec<String>,
    analysis: Option<Analysis>,
}

impl Session {
    /// The playhead starts on the first unlabelled frame (frame 0 when everything is labelled).
    pub fn new(
        project: Project,
        store: LabelStore,
        settings: Settings,
    ) -> Result<Session, SessionError> {
        if project.frames.len() != store.frame_count() as usize {
            return Err(SessionError::FrameCountMismatch {
                project: project.frames.len(),
                store: store.frame_count(),
            });
        }
        let current = if store.get(0) == Label::Unset {
            0
        } else {
            store.next_unlabelled(0, true).unwrap_or(0)
        };
        Ok(Session {
            project,
            store,
            settings,
            current,
            pick: PickState {
                sheet: 1,
                mirrored: false,
            },
            typer: RowTyper::new(),
            log: Vec::new(),
            analysis: None,
        })
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn store(&self) -> &LabelStore {
        &self.store
    }

    pub fn import_labels(&mut self, text: &str) -> Result<usize, SessionError> {
        let frames = self.store.import_json(text, &self.project.fingerprint)?;
        self.typer.clear();
        for &frame in &frames {
            self.log.push(self.store.log_line(frame));
        }
        if !frames.is_empty() {
            self.analysis = None;
        }
        Ok(frames.len())
    }

    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    /// Fill only untouched frames with detector predictions, as one undoable import.
    pub fn add_auto_predictions(&mut self, rows: &[(u32, u8)]) -> Result<usize, SessionError> {
        let mut entries = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for &(frame, row) in rows {
            if frame >= self.store.frame_count() {
                return Err(LabelError::FrameOutOfRange {
                    frame,
                    count: self.store.frame_count(),
                }
                .into());
            }
            if row >= 32 {
                return Err(LabelError::InvalidRow(row).into());
            }
            if seen.insert(frame) && self.store.get(frame) == Label::Unset {
                entries.push(serde_json::json!({"version":2,"frame":frame,"label":Label::Fire {sheet:1,row,mirrored:false},"predicted":true,"sources":["first_person"]}));
            }
        }
        let text = serde_json::json!({"format":"firecrackle-labels","version":2,"fingerprint":self.project.fingerprint,"frame_count":self.store.frame_count(),"labels":entries}).to_string();
        self.import_labels(&text)
    }

    /// Save only untouched frames, preserving detector provenance and one grouped undo step.
    pub fn add_auto_no_fire(&mut self, frames: &[u32]) -> Result<usize, SessionError> {
        let mut entries = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for &frame in frames {
            if frame >= self.store.frame_count() {
                return Err(LabelError::FrameOutOfRange {
                    frame,
                    count: self.store.frame_count(),
                }
                .into());
            }
            if seen.insert(frame) && self.store.get(frame) == Label::Unset {
                entries.push(serde_json::json!({"version":2,"frame":frame,"label":Label::NoFire,"sources":["no_fire"]}));
            }
        }
        let text = serde_json::json!({"format":"firecrackle-labels","version":2,"fingerprint":self.project.fingerprint,"frame_count":self.store.frame_count(),"labels":entries}).to_string();
        self.import_labels(&text)
    }

    pub fn set_settings(&mut self, settings: Settings) {
        self.settings = settings;
        self.analysis = None; // the phase thresholds may have changed
    }

    pub fn current(&self) -> u32 {
        self.current
    }

    fn last(&self) -> u32 {
        self.store.frame_count().saturating_sub(1)
    }

    /// Label of the current frame.
    pub fn label(&self) -> Label {
        self.store.get(self.current)
    }

    pub fn pick(&self) -> PickState {
        self.pick
    }

    /// The first digit of a two-digit row typed so far, if any.
    pub fn typed_pending(&self) -> Option<u8> {
        self.typer.pending()
    }

    pub fn go(&mut self, m: Move) -> u32 {
        self.typer.clear();
        let (cur, last) = (self.current, self.last());
        self.current = match m {
            Move::Frames(d) => (cur as i64).saturating_add(d).clamp(0, last as i64) as u32,
            Move::To(n) => n.min(last),
            Move::Home => 0,
            Move::End => last,
            Move::NextUnlabelled => self.store.next_unlabelled(cur, true).unwrap_or(cur),
            Move::PrevUnlabelled => self.store.next_unlabelled(cur, false).unwrap_or(cur),
            Move::NextFlag => self
                .analysis()
                .flags
                .iter()
                .map(|f| f.frame)
                .find(|&f| f > cur)
                .unwrap_or(cur),
            Move::PrevFlag => self
                .analysis()
                .flags
                .iter()
                .rev()
                .map(|f| f.frame)
                .find(|&f| f < cur)
                .unwrap_or(cur),
        };
        self.current
    }

    pub fn toggle_sheet(&mut self) {
        self.pick.sheet = 1 - self.pick.sheet.min(1);
    }

    pub fn toggle_mirror(&mut self) {
        self.pick.mirrored = !self.pick.mirrored;
    }

    pub fn set_pick(&mut self, sheet: u8, mirrored: bool) {
        self.pick = PickState { sheet, mirrored };
    }

    /// Set the label of the current frame, then advance per the settings. `Unset` clears and stays.
    pub fn apply(&mut self, label: Label) -> Result<Applied, SessionError> {
        self.apply_with_source(label, false)
    }

    fn apply_with_source(
        &mut self,
        label: Label,
        predicted: bool,
    ) -> Result<Applied, SessionError> {
        self.typer.clear();
        let frame = self.current;
        let changed = if predicted {
            self.store.set_predicted(frame, label)?
        } else {
            self.store.set(frame, label)?
        };
        if changed {
            self.log.push(self.store.log_line(frame));
            self.analysis = None;
        }
        let last = self.last();
        let now_at = if label == Label::Unset {
            frame
        } else if self.settings.label.advance_to_unlabelled {
            self.store.next_unlabelled(frame, true).unwrap_or(frame)
        } else {
            (frame as u64 + self.settings.label.advance_frames as u64).min(last as u64) as u32
        };
        self.current = now_at;
        Ok(Applied { frame, now_at })
    }

    /// Label the current frame as the picked sheet/mirror with `row`.
    pub fn pick_row(&mut self, row: u8) -> Result<Applied, SessionError> {
        self.apply(Label::Fire {
            sheet: self.pick.sheet,
            row,
            mirrored: self.pick.mirrored,
        })
    }

    /// A click on a picker cell: sets the pick state and labels the frame.
    pub fn click_cell(
        &mut self,
        sheet: u8,
        row: u8,
        mirrored: bool,
    ) -> Result<Applied, SessionError> {
        let label = Label::fire(sheet, row, mirrored)?; // validated before the pick state changes
        self.pick = PickState { sheet, mirrored };
        self.apply(label)
    }

    /// Typed rows use the normalized animation index shown in both picker sheets.
    pub fn type_digit(&mut self, digit: u8) -> Result<TypeOutcome, SessionError> {
        Ok(match self.typer.push(digit) {
            TyperResult::Pending(d) => TypeOutcome::Pending(d),
            TyperResult::Commit(row) => TypeOutcome::Committed(self.pick_row(row)?),
            TyperResult::Rejected => TypeOutcome::Rejected,
        })
    }

    /// Commit a pending typed digit (Enter or the timeout).
    pub fn flush_typed(&mut self) -> Result<Option<Applied>, SessionError> {
        match self.typer.flush() {
            Some(row) => Ok(Some(self.pick_row(row)?)),
            None => Ok(None),
        }
    }

    pub fn cancel_typed(&mut self) {
        self.typer.clear();
    }

    pub fn suggestion(&self) -> Option<Suggestion> {
        let max_seconds = self.settings.label.suggest_max_seconds;
        if max_seconds <= 0.0 {
            return None;
        }
        let now = self.project.frames[self.current as usize].pts;
        let mut trusted = Vec::new();
        for (frame, label) in self.store.iter() {
            let Label::Fire {
                sheet,
                row,
                mirrored,
            } = label
            else {
                continue;
            };
            if frame == self.current || self.store.is_predicted(frame) {
                continue;
            }
            let pts = self.project.frames[frame as usize].pts;
            if (pts - now).abs() <= max_seconds {
                trusted.push((frame, pts, sheet, row, mirrored));
            }
        }
        let &(from_frame, anchor_pts, sheet, row, mirrored) = trusted.iter().min_by(|a, b| {
            (a.1 - now)
                .abs()
                .total_cmp(&(b.1 - now).abs())
                .then(a.0.cmp(&b.0))
        })?;
        let dt = now - anchor_pts;
        if dt.abs() > max_seconds {
            return None;
        }
        let rate = self.settings.phase.tick_rate;
        let snap = |x: f64| {
            if (x - x.round()).abs() < WHOLE_TICK_EPS {
                x.round()
            } else {
                x
            }
        };
        // At the anchor the unknown fractional tick phase lies in [0,1). Nearby trusted rows
        // intersect that interval. Stop at conflicting timing instead of smoothing over a stall.
        let (mut lo, mut hi) = (0.0f64, 1.0f64);
        trusted.retain(|t| {
            (t.1 - anchor_pts).abs() <= self.settings.label.suggest_calibration_seconds
        });
        trusted.sort_by(|a, b| {
            (a.1 - anchor_pts)
                .abs()
                .total_cmp(&(b.1 - anchor_pts).abs())
                .then(a.0.cmp(&b.0))
        });
        for &(frame, pts, _, other_row, _) in &trusted {
            if frame == from_frame {
                continue;
            }
            if (pts - anchor_pts).abs() > self.settings.label.suggest_calibration_seconds {
                break;
            }
            let x = snap(rate * (pts - anchor_pts));
            let nominal = x.round() as i64;
            let observed = nominal
                + (other_row as i64 - row as i64 - nominal + 16).rem_euclid(STEPS as i64)
                - 16;
            let a = lo.max(observed as f64 - x);
            let b = hi.min(observed as f64 + 1.0 - x);
            if b - a <= WHOLE_TICK_EPS {
                break;
            }
            lo = a;
            hi = b;
        }
        let x = snap(rate * dt);
        let a = snap(lo + x);
        let b = snap(hi + x);
        let advance = snap((a + b) / 2.0).floor() as i64;
        let low = a.floor() as i64;
        let high = (b - WHOLE_TICK_EPS).floor() as i64;
        let alt = if low != high {
            Some(if advance == low { high } else { low })
        } else {
            let frames = &self.project.frames;
            let i = self.current as usize;
            let before = frames[..i]
                .iter()
                .rev()
                .find(|f| f.pts < now)
                .map(|f| now - f.pts);
            let after = frames[i + 1..]
                .iter()
                .find(|f| f.pts > now)
                .map(|f| f.pts - now);
            let interval = match (before, after) {
                (Some(a), Some(b)) => a.min(b),
                (Some(a), None) | (None, Some(a)) => a,
                _ => 0.0,
            };
            let uncertainty = rate * interval * self.settings.label.suggest_capture_frames;
            let down = a - advance as f64;
            let up = advance as f64 + 1.0 - b;
            if uncertainty > 0.0
                && up <= uncertainty + WHOLE_TICK_EPS
                && up <= down + WHOLE_TICK_EPS
            {
                Some(advance + 1)
            } else if uncertainty > 0.0 && down <= uncertainty + WHOLE_TICK_EPS {
                Some(advance - 1)
            } else {
                None
            }
        };
        let to_row = |a: i64| (row as i64 + a).rem_euclid(STEPS as i64) as u8;
        Some(Suggestion {
            sheet,
            mirrored,
            row: to_row(advance),
            alt_row: alt.map(to_row),
            from_frame,
        })
    }

    /// Explicit Confirm/Enter is a human decision, even when the candidate came from the clock.
    pub fn accept_suggestion(&mut self) -> Result<Applied, SessionError> {
        let s = self.suggestion().ok_or(SessionError::NoSuggestion)?;
        self.pick = PickState {
            sheet: s.sheet,
            mirrored: s.mirrored,
        };
        self.apply(Label::Fire {
            sheet: s.sheet,
            row: s.row,
            mirrored: s.mirrored,
        })
    }

    /// Navigation updates the preview suggestion without saving the departing frame.
    pub fn manual_advance(&mut self, frames: i64) -> Result<u32, SessionError> {
        Ok(self.go(Move::Frames(frames)))
    }

    pub fn fill_range(
        &mut self,
        start: u32,
        end: u32,
        label: Label,
    ) -> Result<usize, SessionError> {
        let in_range = start <= end && end < self.store.frame_count();
        let before: Vec<_> = if in_range {
            (start..=end)
                .map(|f| (self.store.get(f), self.store.is_predicted(f)))
                .collect()
        } else {
            Vec::new()
        };
        let changed = self.store.fill_range(start, end, label)?;
        if changed > 0 {
            for (i, frame) in (start..=end).enumerate() {
                if before[i] != (label, false) {
                    self.log.push(self.store.log_line(frame));
                }
            }
            self.analysis = None;
        }
        Ok(changed)
    }

    /// Undo the last change; the playhead moves to the first frame it restored.
    pub fn undo(&mut self) -> bool {
        match self.store.undo_step() {
            Some(frames) => {
                for &f in &frames {
                    self.log.push(self.store.log_line(f));
                }
                self.current = frames[0];
                self.typer.clear();
                self.analysis = None;
                true
            }
            None => false,
        }
    }

    /// Phase evidence uses independently chosen labels, never accepted clock predictions.
    pub fn analysis(&mut self) -> &Analysis {
        if self.analysis.is_none() {
            let obs: Vec<FrameObs> =
                self.store
                    .iter()
                    .into_iter()
                    .filter(|(frame, l)| {
                        l.is_fire()
                            && self.store.sources(*frame).iter().any(|s| {
                                matches!(s, LabelSource::Manual | LabelSource::FirstPerson)
                            })
                    })
                    .map(|(frame, label)| FrameObs {
                        frame,
                        pts: self.project.frames[frame as usize].pts,
                        label: label.canonical_fire().unwrap_or(label),
                    })
                    .collect();
            self.analysis = Some(
                crate::phase_v2::analyze(&obs, &self.settings)
                    .expect("labels, settings and project timestamps are valid"),
            );
        }
        self.analysis.as_ref().expect("just computed")
    }

    pub fn flags(&mut self) -> &[Flag] {
        &self.analysis().flags
    }

    pub fn analysis_for_source(&self, source: LabelSource) -> Analysis {
        let obs: Vec<_> = self
            .store
            .iter()
            .into_iter()
            .filter(|(frame, label)| {
                label.is_fire() && self.store.sources(*frame).contains(&source)
            })
            .map(|(frame, label)| FrameObs {
                frame,
                pts: self.project.frames[frame as usize].pts,
                label: label.canonical_fire().unwrap_or(label),
            })
            .collect();
        crate::phase_v2::analyze(&obs, &self.settings).expect("valid labels and timestamps")
    }

    /// Log lines for every change since the last call (undo included), ready for `AutosaveLog::append`.
    pub fn take_log(&mut self) -> Vec<String> {
        std::mem::take(&mut self.log)
    }

    /// Put lines back in front of the queue after a failed write.
    pub fn requeue_log(&mut self, lines: Vec<String>) {
        let mut v = lines;
        v.append(&mut self.log);
        self.log = v;
    }
}
