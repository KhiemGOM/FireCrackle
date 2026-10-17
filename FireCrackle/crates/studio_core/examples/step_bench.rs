//! What one playback tick costs the backend: `Workspace::apply(Step)` plus building the `View` the app receives as
//! JSON, on a copy of a real project (its labels included), and the frame fetch beside it. The Label tab's play loop
//! skips a tick while the previous step is still running, so a step slower than a frame time plays slower than real
//! time.
//!
//! `cargo run --release --example step_bench -- PROJECT_COPY_DIR [--start N] [--steps N] [--stride N]`
//!
//! `PROJECT_COPY_DIR` holds copies of `project.json` and `labels.jsonl`; labels are appended to, so never point this at
//! a live project folder.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use studio_core::config::Settings;
use studio_core::import::Tools;
use studio_core::project::Project;
use studio_core::workspace::{FfmpegSource, UiAction, Workspace};

fn arg<T: std::str::FromStr>(args: &[String], name: &str) -> Option<T> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
}

fn stats(label: &str, mut ms: Vec<f64>) {
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |p: f64| ms[((ms.len() - 1) as f64 * p).round() as usize];
    println!(
        "  {label:<22} median {:6.2} ms   p95 {:6.2}   worst {:7.2}",
        at(0.5),
        at(0.95),
        ms[ms.len() - 1]
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = PathBuf::from(args.first().expect("usage: step_bench PROJECT_COPY_DIR"));
    let project = Project::load(&dir.join("project.json")).expect("project.json");
    let video = PathBuf::from(&project.video_path);
    let index = Arc::new(project.frame_index());
    let settings = Settings::default();
    let source = FfmpegSource {
        tools: Tools::default(),
        video,
        index,
        cfg: Arc::new(Mutex::new(settings.decode)),
    };
    let mut w =
        Workspace::from_parts(&dir, project, &settings, Arc::new(source)).expect("workspace");
    let start: u32 = arg(&args, "--start").unwrap_or(1000);
    let steps: usize = arg(&args, "--steps").unwrap_or(600);
    let stride: i64 = arg(&args, "--stride").unwrap_or(1);
    w.apply(UiAction::GoTo { frame: start }).expect("go to");
    let frames = w.frame_service();
    frames.get(start).expect("first frame");
    frames.wait_idle();
    let view = w.view();
    println!(
        "{} frames, {} labelled; {steps} steps of {stride} from frame {start}",
        view.frame_count, view.labelled_count
    );

    let pace: f64 = arg(&args, "--pace-hz").unwrap_or(0.0); // 0: as fast as possible
    let (mut apply, mut json, mut fetch, mut bytes) = (vec![], vec![], vec![], 0usize);
    let mut late: Vec<f64> = vec![];
    let begun = Instant::now();
    for i in 0..steps {
        if pace > 0.0 {
            let due = std::time::Duration::from_secs_f64(i as f64 / pace);
            let now = begun.elapsed();
            if due > now {
                std::thread::sleep(due - now);
            }
            late.push(begun.elapsed().saturating_sub(due).as_secs_f64() * 1000.0);
        }
        let t = Instant::now();
        let view = w.apply(UiAction::Step { frames: stride }).expect("step");
        apply.push(t.elapsed().as_secs_f64() * 1000.0);
        let t = Instant::now();
        let body = serde_json::to_vec(&view).expect("json");
        json.push(t.elapsed().as_secs_f64() * 1000.0);
        bytes = body.len();
        let t = Instant::now();
        frames.get(view.current).expect("frame");
        fetch.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    stats("apply(Step)", apply.clone());
    stats("View as JSON", json.clone());
    stats("frame fetch", fetch);
    let both: Vec<f64> = apply.iter().zip(&json).map(|(a, j)| a + j).collect();
    stats("apply + JSON (a tick)", both.clone());
    let over: usize = both.iter().filter(|&&t| t > 16.7).count();
    println!(
        "  View JSON is {bytes} bytes; {over} of {steps} ticks take longer than one 60 fps frame time"
    );
    if !late.is_empty() {
        stats("tick start lateness", late);
        println!(
            "  played {steps} steps in {:.2} s = {:.2}x of {pace} Hz",
            begun.elapsed().as_secs_f64(),
            steps as f64 / pace / begun.elapsed().as_secs_f64()
        );
    }
    frames.wait_idle();
}
