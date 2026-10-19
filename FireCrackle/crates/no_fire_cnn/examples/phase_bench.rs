//! Actual shared CPU/GPU provider path; ignored assets supplied explicitly.
use no_fire_cnn::Engine;
use std::{path::Path, sync::atomic::AtomicBool, time::Instant};
fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        return Err("phase_bench RUNTIME MODEL CROP_RGB".into());
    }
    let weights = std::fs::read(&args[2]).map_err(|e| e.to_string())?;
    let rgb = std::fs::read(&args[3]).map_err(|e| e.to_string())?;
    let start = Instant::now();
    let mut cpu = Engine::load(Path::new(&args[1]), &weights, false, 2)?;
    let cpu_load = start.elapsed().as_secs_f64();
    let expected = cpu.phase_view(&rgb)?;
    drop(cpu);
    let start = Instant::now();
    let mut model = Engine::auto_phase(Path::new(&args[1]), &weights, &AtomicBool::new(false))?;
    let auto_load = start.elapsed().as_secs_f64();
    let actual = model.phase_view(&rgb)?;
    let error = actual
        .iter()
        .zip(&expected)
        .map(|(a, b)| (a - b).abs())
        .fold(0f32, f32::max);
    let mut times = Vec::new();
    for _ in 0..20 {
        let start = Instant::now();
        model.phase_view(&rgb)?;
        times.push(start.elapsed().as_secs_f64() * 1000.);
    }
    times.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::json!({"provider":model.provider,"cpu_load_seconds":cpu_load,"auto_load_seconds":auto_load,"cpu_gpu_max_logit_error":error,"mean_ms":times.iter().sum::<f64>()/times.len() as f64,"p95_ms":times[18],"logits":actual})
    );
    Ok(())
}
