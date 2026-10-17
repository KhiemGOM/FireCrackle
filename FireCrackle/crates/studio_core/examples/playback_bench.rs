//! Plays a project's video through the real frame cache the way the Label tab does (one step per tick, the tick
//! waits for its frame) and reports how often and how long playback stalls.
//!
//! `cargo run --release --example playback_bench -- PROJECT_DIR [--start N] [--seconds S] [--speed X]
//!  [--ahead N] [--back N] [--fraction F] [--head N] [--seeks N] [--back-steps N]`
//!
//! `PROJECT_DIR` is a `<video>.firecrackle` folder. Nothing is written: the project file is only read.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use studio_core::config::Settings;
use studio_core::import::Tools;
use studio_core::project::Project;
use studio_core::workspace::{FfmpegSource, FrameService};

fn arg<T: std::str::FromStr>(args: &[String], name: &str) -> Option<T> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = PathBuf::from(
        args.first()
            .expect("usage: playback_bench PROJECT_DIR [options]"),
    );
    let project = Project::load(&dir.join("project.json")).expect("project.json");
    let video = PathBuf::from(&project.video_path);
    let index = Arc::new(project.frame_index());
    let fps = project.index.fps;
    let mut cfg = Settings::default().decode;
    if let Some(v) = arg(&args, "--ahead") {
        cfg.window_ahead = v;
    }
    if let Some(v) = arg(&args, "--back") {
        cfg.window_back = v;
    }
    if let Some(v) = arg(&args, "--fraction") {
        cfg.prefetch_fraction = v;
    }
    let start: u32 = arg(&args, "--start").unwrap_or(1000);
    let seconds: f64 = arg(&args, "--seconds").unwrap_or(20.0);
    let speed: f64 = arg(&args, "--speed").unwrap_or(1.0);
    let seeks: u32 = arg(&args, "--seeks").unwrap_or(0);
    let back_steps: u32 = arg(&args, "--back-steps").unwrap_or(0);

    let source = FfmpegSource {
        tools: Tools::default(),
        video,
        index: index.clone(),
        cfg: Arc::new(Mutex::new(cfg)),
    };
    let frames = FrameService::new(index.clone(), Arc::new(source), cfg);
    if let Some(head) = arg::<u32>(&args, "--head") {
        frames.set_first_frames(head); // 0: the whole window in the first decode
    }
    println!(
        "{} frames at {fps:.2} fps; window back {} ahead {} fraction {}; cache {} MB",
        index.frames.len(),
        cfg.window_back,
        cfg.window_ahead,
        cfg.prefetch_fraction,
        cfg.cache_mb
    );

    // the Label tab's playback: one step per tick, ticks are skipped while a step is in flight
    let base_ms = 1000.0 / (fps * speed);
    let interval = base_ms.max(16.0);
    let per_tick = ((interval / base_ms).round() as u32).max(1);
    let mut frame = start;
    let mut latencies: Vec<f64> = Vec::new();
    let mut stall_log: Vec<(f64, u32, f64)> = Vec::new();
    let begun = Instant::now();
    let mut deadline = begun;
    while begun.elapsed().as_secs_f64() < seconds && (frame as usize) < index.frames.len() {
        let t = Instant::now();
        frames.get(frame).expect("frame");
        let waited = t.elapsed().as_secs_f64() * 1000.0;
        latencies.push(waited);
        if waited > 50.0 {
            stall_log.push((begun.elapsed().as_secs_f64(), frame - start, waited));
        }
        frame += per_tick;
        deadline += Duration::from_secs_f64(interval / 1000.0);
        let now = Instant::now();
        if deadline > now {
            std::thread::sleep(deadline - now);
        } else {
            deadline = now; // late: no catch-up, exactly like the skipped ticks
        }
    }
    let wall = begun.elapsed().as_secs_f64();
    let advanced = (frame - start) as f64;
    let mut sorted = latencies.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let stalls: Vec<f64> = latencies.iter().copied().filter(|&l| l > 50.0).collect();
    println!(
        "playback {speed}x from frame {start}: advanced {advanced} frames in {wall:.1} s = {:.2}x real time",
        advanced / fps / wall
    );
    println!(
        "  frame fetch ms: median {:.1}  p95 {:.1}  p99 {:.1}  worst {:.0}",
        percentile(&sorted, 0.5),
        percentile(&sorted, 0.95),
        percentile(&sorted, 0.99),
        sorted.last().copied().unwrap_or(0.0)
    );
    println!(
        "  stalls over 50 ms: {} ({:.1} s waiting in total, longest {:.0} ms)",
        stalls.len(),
        stalls.iter().sum::<f64>() / 1000.0,
        stalls.iter().cloned().fold(0.0, f64::max)
    );
    for (at, played, ms) in stall_log.iter().take(8) {
        println!("    stall at {at:.1} s (after {played} frames played): {ms:.0} ms");
    }
    frames.wait_idle();

    if seeks > 0 {
        let mut waits = Vec::new();
        for k in 0..seeks {
            let target = ((k as usize * 7919 + 3001) % (index.frames.len() - 400)) as u32;
            let t = Instant::now();
            frames.get(target).expect("seek");
            waits.push(t.elapsed().as_secs_f64() * 1000.0);
            // the first frame's wait on its own: the fill of the previous seek must not compete for the processor
            frames.wait_idle();
        }
        waits.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!(
            "random seeks ({seeks}, first frame, one at a time): median {:.0} ms  worst {:.0} ms",
            percentile(&waits, 0.5),
            waits.last().copied().unwrap_or(0.0)
        );
        frames.wait_idle();
    }

    if back_steps > 0 {
        let from = start + 2000;
        frames.get(from).expect("start");
        frames.wait_idle();
        let mut waits = Vec::new();
        for k in 1..=back_steps {
            let t = Instant::now();
            frames.get(from - k).expect("step back");
            waits.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        let slow: Vec<f64> = waits.iter().copied().filter(|&w| w > 50.0).collect();
        println!(
            "stepping back {back_steps} frames one at a time: {} waits over 50 ms, longest {:.0} ms, total {:.1} s",
            slow.len(),
            slow.iter().cloned().fold(0.0, f64::max),
            slow.iter().sum::<f64>() / 1000.0
        );
    }
}
