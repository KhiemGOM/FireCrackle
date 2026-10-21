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
    for rgb in std::iter::once(raw).chain(auto) {
        if rgb.len() != 1920 * 1080 * 3 {
            return Err("Invalid AI video frame".into());
        }
        let cropped = &rgb[1920 * 12 * 3..];
        for rect in crate::tile_boxes() {
            if cancel.load(Ordering::Relaxed) {
                return Ok(false);
            }
            let timer = fire_core::profile::start(20);
            let view = crate::resize(cropped, 1920, rect);
            drop(timer);
            let timer = fire_core::profile::start(21);
            let clear = crate::clear_score(score(&view)?);
            drop(timer);
            if !clear {
                return Ok(false);
            }
        }
    }
    Ok(true)
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
        assert_eq!(cpu.calls, [vec![37; 9], vec![83; 9]].concat());
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
        let expected = [vec![37; 9], vec![83; 9]].concat();
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
