//! Production first-person acceptance, frozen from the GUI/dual-veil experiment.
//! GUI exclusions are neutral; every score uses current pixels and no clock.
//! Scans may propose prior GUI geometry, rechecked on the current frame.
use crate::{
    gui_mask::{add_screen_masks, GuiDetector, GuiFitHint, GuiOptions, GuiTextures},
    overlay::{MatchDiagnostics, SilhouetteMatcher, SilhouetteResult},
    veil::{detect_pixels, Options},
};

const THRESHOLD: f64 = 0.5;
const DUAL_DISTANCE: f64 = 0.03;

pub struct PovMatcher {
    width: usize,
    height: usize,
    matchers: [SilhouetteMatcher; 2],
    gui: GuiDetector,
}

/// The view-model FOVs the two matchers are built for (normal, and the narrower one under water).
const FOVS: [u8; 2] = [70, 60];

#[derive(Debug, Clone, Copy)]
pub struct PovResult {
    pub row: Option<u8>,
    /// The FOV (70 or 60) of the accepted row; None with no row.
    pub fov: Option<u8>,
    pub used_gui: bool,
    pub evaluated_alternate: bool,
}

/// A row to offer for one frame: its FOV, colour evidence and whether it is the labeller's accepted answer.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PovCandidate {
    pub row: u8,
    pub fov: u8,
    pub evidence: f64,
    pub accepted: bool,
}

/// One frame's first-person match: the labeller's verdict and up to three rows, its answer first.
#[derive(Debug, Clone)]
pub struct PovCandidates {
    pub result: PovResult,
    pub ranked: Vec<PovCandidate>,
}

struct Branch {
    veiled: bool,
    fov: usize,
    row: u8,
    possible: bool,
    accepted: bool,
    evidence: f64,
}

fn evidence(d: &MatchDiagnostics, row: usize) -> f64 {
    if d.colour_used[row] >= 5 {
        d.colour_sum[row] / d.colour_used[row] as f64
    } else {
        0.
    }
}

impl PovMatcher {
    pub fn new(
        sheet: &[u8],
        textures: GuiTextures,
        width: usize,
        height: usize,
    ) -> Result<Self, String> {
        if width == 0
            || height == 0
            || width
                .checked_mul(height)
                .and_then(|n| n.checked_mul(3))
                .is_none()
        {
            return Err("invalid first-person frame dimensions".into());
        }
        let gui = GuiDetector::new(textures, GuiOptions::default())?;
        gui.prepare(width, height);
        Ok(Self {
            width,
            height,
            matchers: [
                SilhouetteMatcher::new(sheet, width, height, 70.)?,
                SilhouetteMatcher::new(sheet, width, height, 60.)?,
            ],
            gui,
        })
    }

    fn raw(&self, frame: &[u8], veiled: bool) -> Result<Branch, String> {
        let a = self.matchers[0].inspect_scores(frame, None, veiled)?;
        let b = self.matchers[1].inspect_scores(frame, None, veiled)?;
        let fov = usize::from(b.colour_evidence > a.colour_evidence);
        let r = if fov == 1 { b } else { a };
        let row = r.ranked_colour[0].0;
        let d = r.diagnostics.as_ref().expect("score diagnostics");
        let used = d.colour_used[row as usize];
        let hits = (used as f64 + d.colour_sum[row as usize]) / 2.;
        // Removing probes cannot create matching probes. Any eligible masked
        // subset has >=5 probes and >=75% matches, so it needs at least4 hits.
        let possible = used >= 5 && hits >= 4.;
        Ok(Branch {
            veiled,
            fov,
            row,
            possible,
            accepted: r.colour_evidence >= THRESHOLD,
            evidence: r.colour_evidence,
        })
    }

    /// The accepted branch's (row, FOV) with the most evidence.
    fn selected(branches: &[Branch]) -> Option<(u8, u8)> {
        let mut best: Option<&Branch> = None;
        for b in branches.iter().filter(|b| b.accepted) {
            // Automatic branch is first and wins exact evidence ties.
            if best.is_none_or(|a| b.evidence > a.evidence) {
                best = Some(b);
            }
        }
        best.map(|b| (b.row, FOVS[b.fov]))
    }

    /// Whether the frame looks veiled (an open screen's darkening) by the automatic test, and the share it measured.
    fn auto_veil(&self, frame: &[u8]) -> Result<(bool, f64), String> {
        detect_pixels(
            frame,
            self.width,
            self.height,
            3,
            16.min(self.height - 1),
            Options::default(),
        )
    }

    /// One frame's match for the app: the labeller's verdict (exactly `match_frame`) and up to three rows to offer,
    /// one per row, its answer first and then by colour evidence over both FOVs (scores of the same two matchers).
    pub fn candidates(&self, frame: &[u8]) -> Result<PovCandidates, String> {
        let result = self.match_frame(frame)?;
        let (veiled, _) = self.auto_veil(frame)?;
        let mut all = Vec::new();
        for (i, m) in self.matchers.iter().enumerate() {
            let r = m.inspect_scores(frame, None, veiled)?;
            let d = r.diagnostics.as_ref().expect("score diagnostics");
            for &(row, _) in r.ranked_colour.iter().take(6) {
                all.push(PovCandidate {
                    row,
                    fov: FOVS[i],
                    evidence: evidence(d, row as usize),
                    accepted: false,
                });
            }
        }
        all.sort_by(|a, b| b.evidence.total_cmp(&a.evidence));
        let mut ranked: Vec<PovCandidate> = Vec::new();
        if let (Some(row), Some(fov)) = (result.row, result.fov) {
            let evidence = all
                .iter()
                .find(|k| k.row == row && k.fov == fov)
                .map_or(f64::NAN, |k| k.evidence);
            ranked.push(PovCandidate {
                row,
                fov,
                evidence,
                accepted: true,
            });
        }
        for k in all {
            if ranked.len() == 3 {
                break;
            }
            if !ranked.iter().any(|r| r.row == k.row) {
                ranked.push(k);
            }
        }
        Ok(PovCandidates { result, ranked })
    }

    pub fn match_frame(&self, frame: &[u8]) -> Result<PovResult, String> {
        self.match_frame_inner(frame, None)
    }

    pub fn match_frame_with_hint(
        &self,
        frame: &[u8],
        hint: &mut GuiFitHint,
    ) -> Result<PovResult, String> {
        hint.begin_frame();
        self.match_frame_inner(frame, Some(hint))
    }

    fn match_frame_inner(
        &self,
        frame: &[u8],
        hint: Option<&mut GuiFitHint>,
    ) -> Result<PovResult, String> {
        let timer = crate::profile::start(0);
        let (auto, share) = self.auto_veil(frame)?;
        drop(timer);
        let dual = (share - Options::default().min_share).abs() <= DUAL_DISTANCE + 1e-12;
        let timer = crate::profile::start(1);
        let mut branches = vec![self.raw(frame, auto)?];
        if dual {
            branches.push(self.raw(frame, !auto)?);
        }
        drop(timer);
        let result = |pick: Option<(u8, u8)>, used_gui| PovResult {
            row: pick.map(|p| p.0),
            fov: pick.map(|p| p.1),
            used_gui,
            evaluated_alternate: dual,
        };
        let possible: Vec<_> = branches.iter().filter(|b| b.possible).collect();
        if possible.is_empty() {
            return Ok(result(None, false));
        }
        // With a single possible row, a raw acceptance already fixes the final
        // answer. GUI work can improve a score but cannot change the label.
        if possible.iter().all(|b| b.row == possible[0].row) && possible.iter().any(|b| b.accepted)
        {
            let b = possible
                .iter()
                .find(|b| b.accepted)
                .expect("an accepted branch");
            return Ok(result(Some((b.row, FOVS[b.fov])), false));
        }
        let timer = crate::profile::start(2);
        let mut gui = match hint {
            Some(hint) => self
                .gui
                .detect_with_hint(frame, self.width, self.height, hint)?,
            None => self.gui.detect(frame, self.width, self.height)?,
        };
        drop(timer);
        if !gui.reliable
            && !gui.hits.iter().any(|hit| {
                matches!(
                    hit.piece,
                    crate::gui_mask::PieceId::InventoryPanel | crate::gui_mask::PieceId::MenuButton
                )
            })
        {
            return Ok(result(Self::selected(&branches), true));
        }
        let timer = crate::profile::start(3);
        let inner = crate::profile::start(19);
        add_screen_masks(
            frame,
            self.width,
            self.height,
            self.gui.textures(),
            &mut gui,
        )?;
        drop(inner);
        let inner = crate::profile::start(18);
        // The silhouette matcher reads the exclusions only at its sparse probe
        // pixels, so they are predicates over (class, piece) rather than two
        // frame-sized masks. Same rules as the former `opaque`/`broad` vectors.
        let (class, piece) = (&gui.class, &gui.piece);
        let opaque = |p: usize| {
            let (c, id) = (class[p], piece[p]);
            c == 1 || [24, 25, 26].contains(&id)
        };
        let broad = |p: usize| {
            let (c, id) = (class[p], piece[p]);
            c == 1 || c == 2 || [4, 5, 11].contains(&id) || [24, 25, 26].contains(&id)
        };
        drop(inner);
        drop(timer);
        let viable = branches.iter().filter(|b| b.possible).count();
        for b in branches.iter_mut().filter(|b| b.possible) {
            let matcher = &self.matchers[b.fov];
            let row = b.row as usize;
            let timer = crate::profile::start(4);
            let hard = matcher.inspect_scores_excluding(frame, &opaque, b.veiled)?;
            drop(timer);
            let hard = evidence(hard.diagnostics.as_ref().expect("opaque diagnostics"), row);
            b.evidence = b.evidence.max(hard);
            b.accepted |= hard >= THRESHOLD;
            if viable == 1 && b.accepted {
                return Ok(result(Some((b.row, FOVS[b.fov])), true));
            }
            let timer = crate::profile::start(5);
            let soft: SilhouetteResult =
                matcher.inspect_candidate_excluding(frame, &broad, b.veiled, b.row)?;
            drop(timer);
            let d = soft.diagnostics.as_ref().expect("broad diagnostics");
            let score = |r: usize| d.silhouette_z[r] + d.colour_weight * d.colour_z[r];
            let margin = score(row)
                - (0..32)
                    .filter(|&r| r != row)
                    .map(score)
                    .fold(f64::NEG_INFINITY, f64::max);
            let mut columns = Vec::new();
            for x in 0..4 {
                if (0..4).any(|y| {
                    let bin = y * 4 + x;
                    let used = d.colour_spatial_used[row][bin] as f64;
                    let hits = d.colour_spatial_hits[row][bin] as f64;
                    hits >= 5. && 2. * hits - used >= 0.5 * used
                }) {
                    columns.push(x);
                }
            }
            let span = columns
                .first()
                .zip(columns.last())
                .map_or(0, |(a, b)| b - a + 1);
            if margin >= 0.5 && span >= 2 {
                let soft = evidence(d, row);
                b.evidence = b.evidence.max(soft);
                b.accepted |= soft >= THRESHOLD;
            }
        }
        Ok(result(Self::selected(&branches), true))
    }
}
