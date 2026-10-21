//! Process-wide stage timers for the scan performance lab. One relaxed atomic
//! add per stage per frame; zero allocation. Not a correctness feature.

use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::Instant;

pub const STAGES: [&str; 20] = [
    "pov.veil",
    "pov.raw_silhouette",
    "pov.gui_detect",
    "pov.screen_masks",
    "pov.masked_hard",
    "pov.masked_soft",
    "gui.hotbar_fit",
    "gui.pieces",
    "gui.text",
    "gui.interactions",
    "nf.fragments",
    "nf.veil",
    "nf.cnn",
    "nf.portal",
    "nf.gui",
    "nf.material",
    "gui.tooltips",
    "gui.panel_find",
    "pov.opaque_broad",
    "pov.screen_confirm",
];
static NANOS: [AtomicU64; 20] = [const { AtomicU64::new(0) }; 20];
static CALLS: [AtomicU64; 20] = [const { AtomicU64::new(0) }; 20];

pub struct Timer(usize, Instant);
/// Start timing `stage` (an index into [`STAGES`]); dropping records it.
pub fn start(stage: usize) -> Timer {
    Timer(stage, Instant::now())
}
impl Drop for Timer {
    fn drop(&mut self) {
        NANOS[self.0].fetch_add(self.1.elapsed().as_nanos() as u64, Relaxed);
        CALLS[self.0].fetch_add(1, Relaxed);
    }
}
/// Record an already measured duration for `stage`.
pub fn record_ms(stage: usize, ms: f64) {
    NANOS[stage].fetch_add((ms * 1e6) as u64, Relaxed);
    CALLS[stage].fetch_add(1, Relaxed);
}
pub fn reset() {
    for i in 0..STAGES.len() {
        NANOS[i].store(0, Relaxed);
        CALLS[i].store(0, Relaxed);
    }
}
/// (stage, calls, total milliseconds) for every stage that ran.
pub fn snapshot() -> Vec<(&'static str, u64, f64)> {
    (0..STAGES.len())
        .filter(|&i| CALLS[i].load(Relaxed) > 0)
        .map(|i| (STAGES[i], CALLS[i].load(Relaxed), NANOS[i].load(Relaxed) as f64 / 1e6))
        .collect()
}
