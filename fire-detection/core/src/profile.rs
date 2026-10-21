//! Process-wide stage timers for the scan performance lab. One relaxed atomic
//! add per stage per frame; zero allocation. Not a correctness feature.

use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::Instant;

pub const STAGES: [&str; 24] = [
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
    "nf.resize",
    "nf.infer",
    "nf.unveil",
    "nf.fragments_bfs",
];
static NANOS: [AtomicU64; 24] = [const { AtomicU64::new(0) }; 24];
static CALLS: [AtomicU64; 24] = [const { AtomicU64::new(0) }; 24];

pub struct Timer(usize, Instant, u64);
/// Start timing `stage` (an index into [`STAGES`]); dropping records it.
pub fn start(stage: usize) -> Timer {
    Timer(stage, Instant::now(), thread_cycles())
}
impl Drop for Timer {
    fn drop(&mut self) {
        NANOS[self.0].fetch_add(self.1.elapsed().as_nanos() as u64, Relaxed);
        CYCLES[self.0].fetch_add(thread_cycles().wrapping_sub(self.2), Relaxed);
        CALLS[self.0].fetch_add(1, Relaxed);
    }
}
static CYCLES: [AtomicU64; 24] = [const { AtomicU64::new(0) }; 24];
/// CPU cycles consumed by the calling thread: unlike wall time it does not
/// count time spent descheduled behind other workers or other programs.
#[cfg(windows)]
pub fn thread_cycles() -> u64 {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThread() -> isize;
        fn QueryThreadCycleTime(thread: isize, cycles: *mut u64) -> i32;
    }
    let mut cycles = 0u64;
    // SAFETY: documented Win32 calls on the current thread's pseudo-handle.
    unsafe { QueryThreadCycleTime(GetCurrentThread(), &mut cycles) };
    cycles
}
#[cfg(not(windows))]
pub fn thread_cycles() -> u64 {
    0
}
/// (stage, calls, total giga-cycles of thread CPU time) for every stage that ran.
pub fn cycles() -> Vec<(&'static str, u64, f64)> {
    (0..STAGES.len())
        .filter(|&i| CALLS[i].load(Relaxed) > 0)
        .map(|i| {
            (
                STAGES[i],
                CALLS[i].load(Relaxed),
                CYCLES[i].load(Relaxed) as f64 / 1e9,
            )
        })
        .collect()
}
/// Record an already measured duration and cycle count for `stage`.
pub fn record(stage: usize, ms: f64, cycles: u64) {
    NANOS[stage].fetch_add((ms * 1e6) as u64, Relaxed);
    CYCLES[stage].fetch_add(cycles, Relaxed);
    CALLS[stage].fetch_add(1, Relaxed);
}
pub const COUNTERS: [&str; 29] = [
    "panel.poses_visited",
    "gui.hint_reused",
    "panel.poses_planned",
    "nf.reject_view00",
    "nf.reject_view01",
    "nf.reject_view02",
    "nf.reject_view03",
    "nf.reject_view04",
    "nf.reject_view05",
    "nf.reject_view06",
    "nf.reject_view07",
    "nf.reject_view08",
    "nf.reject_view09",
    "nf.reject_view10",
    "nf.reject_view11",
    "nf.reject_view12",
    "nf.reject_view13",
    "nf.reject_view14",
    "nf.reject_view15",
    "nf.reject_view16",
    "nf.reject_view17",
    "gui.hint_missed",
    "hint.reject_scale_or_origin",
    "hint.reject_slot_scores",
    "hint.reject_alt_centre_better",
    "hint.reject_alt_edges_better",
    "hint.reject_alt_misfit",
    "hint.refit_same_geometry",
    "hint.refit_different_geometry",
];
/// First counter of the per-view no-fire rejection histogram (views 0–8 raw, 9–17 unveiled).
pub const NF_REJECT_BASE: usize = 3;
static COUNTS: [AtomicU64; 29] = [const { AtomicU64::new(0) }; 29];
/// Add to a plain event counter (an index into [`COUNTERS`]).
pub fn count(counter: usize, by: u64) {
    COUNTS[counter].fetch_add(by, Relaxed);
}
pub fn counters() -> Vec<(&'static str, u64)> {
    (0..COUNTERS.len())
        .filter(|&i| COUNTS[i].load(Relaxed) > 0)
        .map(|i| (COUNTERS[i], COUNTS[i].load(Relaxed)))
        .collect()
}
pub fn reset() {
    for i in 0..STAGES.len() {
        NANOS[i].store(0, Relaxed);
        CALLS[i].store(0, Relaxed);
        CYCLES[i].store(0, Relaxed);
    }
    for c in &COUNTS {
        c.store(0, Relaxed);
    }
}
/// (stage, calls, total milliseconds) for every stage that ran.
pub fn snapshot() -> Vec<(&'static str, u64, f64)> {
    (0..STAGES.len())
        .filter(|&i| CALLS[i].load(Relaxed) > 0)
        .map(|i| {
            (
                STAGES[i],
                CALLS[i].load(Relaxed),
                NANOS[i].load(Relaxed) as f64 / 1e6,
            )
        })
        .collect()
}
