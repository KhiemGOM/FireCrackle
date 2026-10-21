use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

pub(crate) trait Scorer {
    fn is_gpu(&self) -> bool;
    fn score(&mut self, view: &[u8]) -> Result<f32, String>;
}

pub(crate) fn clear_shared<M: Scorer>(
    engine: &Mutex<M>,
    raw: &[u8],
    auto: Option<&[u8]>,
    cancel: &AtomicBool,
    load_cpu: impl FnOnce() -> Result<M, String>,
) -> Result<bool, String> {
    let started_on_gpu = engine.lock().map_err(|_| "AI state unavailable")?.is_gpu();
    let result = clear_frame_with(raw, auto, cancel, |view| {
        let mut model = engine.lock().map_err(|_| "AI state unavailable")?;
        // Cancellation can arrive while this view waits for the session. A
        // non-clearing score ends the frame without another inference call.
        if cancel.load(Ordering::Relaxed) {
            return Ok(crate::THRESHOLD);
        }
        model.score(view)
    });
    let mut model = engine.lock().map_err(|_| "AI state unavailable")?;
    if result.is_err() && model.is_gpu() {
        *model = load_cpu()?;
        return clear_frame_with(raw, auto, cancel, |view| model.score(view));
    }
    // A different frame can switch the session between our views. Recheck all
    // earlier GPU evidence as well; do not accept a mixed-backend continuation.
    if started_on_gpu && !model.is_gpu() {
        return clear_frame_with(raw, auto, cancel, |view| model.score(view));
    }
    result
}

/// Prepare one view at a time before calling the scorer. Shared-session callers
/// can lock only inside `score`, allowing other workers to resize concurrently.
/// View order, early rejection and frozen resize rounding remain unchanged.
pub fn clear_frame_with(
    raw: &[u8],
    auto: Option<&[u8]>,
    cancel: &AtomicBool,
    mut score: impl FnMut(&[u8]) -> Result<f32, String>,
) -> Result<bool, String> {
    let frames = [Some(raw), auto];
    let boxes = crate::tile_boxes();
    // A frame clears only if every view of every pass clears, so the order in
    // which views are scored cannot change the result — only how soon a
    // rejected frame stops. `DEFAULT_VIEW_ORDER` is the measured order.
    for (ordinal, &(pass, tile)) in view_order().iter().enumerate() {
        let Some(rgb) = frames[pass as usize] else {
            continue;
        };
        if rgb.len() != 1920 * 1080 * 3 {
            return Err("Invalid AI video frame".into());
        }
        if cancel.load(Ordering::Relaxed) {
            return Ok(false);
        }
        let cropped = &rgb[1920 * 12 * 3..];
        let timer = fire_core::profile::start(20);
        let view = crate::resize(cropped, 1920, boxes[tile as usize]);
        drop(timer);
        let timer = fire_core::profile::start(21);
        let clear = crate::clear_score(score(&view)?);
        drop(timer);
        if !clear {
            fire_core::profile::count(fire_core::profile::NF_REJECT_BASE + ordinal.min(17), 1);
            return Ok(false);
        }
    }
    Ok(true)
}

/// (pass, tile) pairs: pass 0 = raw frame, 1 = unveiled frame; tile indexes `tile_boxes()`.
static VIEW_ORDER: std::sync::OnceLock<Vec<(u8, u8)>> = std::sync::OnceLock::new();
fn view_order() -> &'static [(u8, u8)] {
    VIEW_ORDER.get_or_init(|| DEFAULT_VIEW_ORDER.to_vec())
}
/// Scoring order of the eighteen views. Views that most often reject a frame come
/// first; it was chosen from the full rejection matrix of 1,200 frames the rules
/// would send to the model, from four segments of two recordings
/// (`fire-detection/perf-lab/plan_view_order.py`). The frame decision is the same
/// for every order; only how soon a rejected frame stops differs.
pub const DEFAULT_VIEW_ORDER: [(u8, u8); 18] = [
    (0, 0),
    (0, 5),
    (1, 4),
    (0, 2),
    (0, 4),
    (0, 6),
    (0, 8),
    (0, 3),
    (0, 1),
    (0, 7),
    (1, 0),
    (1, 1),
    (1, 2),
    (1, 3),
    (1, 5),
    (1, 6),
    (1, 7),
    (1, 8),
];
fn every_view() -> Vec<(u8, u8)> {
    (0..2u8)
        .flat_map(|pass| (0..9u8).map(move |tile| (pass, tile)))
        .collect()
}
/// Install another view order for this process (perf lab). Must contain every
/// (pass, tile) pair exactly once; returns false if the order was already fixed.
pub fn set_view_order(order: Vec<(u8, u8)>) -> Result<bool, String> {
    let mut sorted = order.clone();
    sorted.sort_unstable();
    if sorted != every_view() {
        return Err("view order must contain every (pass, tile) pair exactly once".into());
    }
    Ok(VIEW_ORDER.set(order).is_ok())
}

/// Perf-lab variant: all nine views of a frame (then of its unveiled copy) are
/// resized first and scored in one batch. Same views, same rounding, same
/// clear rule; only the early exit between views is gone, which cannot change
/// the frame's boolean result.
pub fn clear_frame_batched(
    raw: &[u8],
    auto: Option<&[u8]>,
    cancel: &AtomicBool,
    mut score_batch: impl FnMut(&[u8], usize) -> Result<Vec<f32>, String>,
) -> Result<bool, String> {
    let boxes = crate::tile_boxes();
    for rgb in std::iter::once(raw).chain(auto) {
        if rgb.len() != 1920 * 1080 * 3 {
            return Err("Invalid AI video frame".into());
        }
        if cancel.load(Ordering::Relaxed) {
            return Ok(false);
        }
        let cropped = &rgb[1920 * 12 * 3..];
        let mut views = Vec::with_capacity(boxes.len() * 224 * 224 * 3);
        for rect in &boxes {
            views.extend_from_slice(&crate::resize(cropped, 1920, *rect));
        }
        if score_batch(&views, boxes.len())?
            .into_iter()
            .any(|score| !crate::clear_score(score))
        {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Mock {
        gpu: bool,
        calls: Vec<u8>,
        fail_at: Option<usize>,
        switch_after_first: bool,
    }
    impl Scorer for Mock {
        fn is_gpu(&self) -> bool {
            self.gpu
        }
        fn score(&mut self, view: &[u8]) -> Result<f32, String> {
            self.calls.push(view[0]);
            if self.switch_after_first && self.calls.len() == 1 {
                self.gpu = false;
            }
            if self.fail_at == Some(self.calls.len()) {
                return Err("device failed".into());
            }
            Ok(-2.0)
        }
    }
    /// The first byte of each view in scoring order: raw views carry `raw`, unveiled `auto`.
    fn ordered_views(raw: u8, auto: u8) -> Vec<u8> {
        view_order()
            .iter()
            .map(|&(pass, _)| if pass == 0 { raw } else { auto })
            .collect()
    }
    #[test]
    fn default_order_covers_every_view_once_and_starts_with_the_full_raw_view() {
        let mut seen = DEFAULT_VIEW_ORDER.to_vec();
        seen.sort_unstable();
        assert_eq!(seen, every_view());
        assert_eq!(DEFAULT_VIEW_ORDER[0], (0, 0));
        assert_eq!(view_order().len(), 18);
    }
    #[test]
    fn a_rejecting_view_stops_the_frame_wherever_it_is_in_the_order() {
        let raw = vec![37; 1920 * 1080 * 3];
        let auto = vec![83; raw.len()];
        for stop in 0..18 {
            let mut calls = 0;
            let clear = clear_frame_with(&raw, Some(&auto), &AtomicBool::new(false), |_| {
                calls += 1;
                Ok(if calls == stop + 1 { 0.0 } else { -2.0 })
            })
            .unwrap();
            assert!(!clear);
            assert_eq!(calls, stop + 1);
        }
        let mut calls = 0;
        assert!(
            clear_frame_with(&raw, Some(&auto), &AtomicBool::new(false), |_| {
                calls += 1;
                Ok(-2.0)
            })
            .unwrap()
        );
        assert_eq!(calls, 18);
    }
    fn model(gpu: bool) -> Mock {
        Mock {
            gpu,
            calls: Vec::new(),
            fail_at: None,
            switch_after_first: false,
        }
    }

    #[test]
    fn gpu_failure_rechecks_all_raw_and_restored_views_on_cpu() {
        let mut gpu = model(true);
        gpu.fail_at = Some(3);
        let engine = Mutex::new(gpu);
        let raw = vec![37; 1920 * 1080 * 3];
        let auto = vec![83; raw.len()];
        assert!(
            clear_shared(&engine, &raw, Some(&auto), &AtomicBool::new(false), || Ok(
                model(false)
            ))
            .unwrap()
        );
        let cpu = engine.lock().unwrap();
        assert!(!cpu.gpu);
        assert_eq!(cpu.calls, ordered_views(37, 83));
    }

    #[test]
    fn backend_change_between_views_rechecks_the_complete_frame() {
        let mut gpu = model(true);
        // Simulates another worker switching the shared backend after our
        // first score, while this worker is outside the lock preparing a view.
        gpu.switch_after_first = true;
        let engine = Mutex::new(gpu);
        let raw = vec![37; 1920 * 1080 * 3];
        let auto = vec![83; raw.len()];
        assert!(
            clear_shared(
                &engine,
                &raw,
                Some(&auto),
                &AtomicBool::new(false),
                || panic!("already on CPU")
            )
            .unwrap()
        );
        let expected = ordered_views(37, 83);
        assert_eq!(
            engine.lock().unwrap().calls,
            [expected.clone(), expected].concat()
        );
    }

    #[test]
    fn cpu_errors_and_fallback_load_errors_are_returned() {
        let raw = vec![37; 1920 * 1080 * 3];
        let cancel = AtomicBool::new(false);
        let mut cpu = model(false);
        cpu.fail_at = Some(1);
        assert_eq!(
            clear_shared(&Mutex::new(cpu), &raw, None, &cancel, || panic!(
                "CPU error must not reload"
            )),
            Err("device failed".into())
        );
        let mut gpu = model(true);
        gpu.fail_at = Some(1);
        assert_eq!(
            clear_shared(&Mutex::new(gpu), &raw, None, &cancel, || Err(
                "CPU runtime missing".into()
            )),
            Err("CPU runtime missing".into())
        );
    }
}
