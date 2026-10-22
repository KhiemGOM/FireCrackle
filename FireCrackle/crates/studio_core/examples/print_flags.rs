//! `cargo run --release --example print_flags -- VIDEO [OUT.json]`
//! Opens an existing FireCrackle project (the `.firecrackle` folder next to the video, with its saved labels) exactly
//! as the app does and prints the fire-phase flags the app would show: kind, severity, frame range, time and phase
//! delta. Nothing is relabelled or scanned; this only reads what is there.

use std::path::Path;
use studio_core::config::Settings;
use studio_core::import::Tools;
use studio_core::workspace::Workspace;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let Some(video) = args.get(1) else {
        eprintln!("usage: print_flags VIDEO [OUT.json]");
        std::process::exit(2);
    };
    let mut w = Workspace::open(&Tools::default(), Path::new(video), &Settings::default()).expect("open");
    let v = w.view();
    let fps = v.fps;
    let flags = w.flags();
    eprintln!("{} frames at {fps:.3} fps; {} flags", v.frame_count, flags.len());
    let rows: Vec<serde_json::Value> = flags
        .iter()
        .map(|f| {
            serde_json::json!({
                "kind": format!("{:?}", f.kind), "severity": format!("{:?}", f.severity),
                "frame": f.frame, "end_frame": f.end_frame,
                "time": f.frame as f64 / fps, "end_time": f.end_frame as f64 / fps,
                "phase_delta": f.phase_delta,
            })
        })
        .collect();
    for r in &rows {
        println!("{r}");
    }
    if let Some(out) = args.get(2) {
        std::fs::write(out, serde_json::to_string_pretty(&rows).unwrap()).unwrap();
    }
}
