use no_fire_cnn::Engine;
use std::{path::Path, sync::atomic::AtomicBool, time::Instant};
fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() < 4 {
        return Err("runtime model views.rgb [auto|cpu]".into());
    }
    let bytes = std::fs::read(&args[2]).map_err(|e| e.to_string())?;
    let start = Instant::now();
    let mut engine = if args.get(4).is_some_and(|s| s == "auto") {
        Engine::auto(Path::new(&args[1]), &bytes, &AtomicBool::new(false))?
    } else {
        Engine::load(Path::new(&args[1]), &bytes, false, 2)?
    };
    let setup = start.elapsed().as_secs_f64();
    let views = std::fs::read(&args[3]).map_err(|e| e.to_string())?;
    if views.len() % (224 * 224 * 3) != 0 {
        return Err("Invalid view data".into());
    }
    let mut values = Vec::new();
    let start = Instant::now();
    for image in views.chunks_exact(224 * 224 * 3) {
        values.push(engine.score_view(image)?);
    }
    println!(
        "provider={} setup_s={setup:.3} inference_ms={:.3} scores={values:?}",
        engine.provider,
        start.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}
