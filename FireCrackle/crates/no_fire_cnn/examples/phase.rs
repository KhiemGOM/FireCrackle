use no_fire_cnn::Engine;
use std::path::Path;

fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 4 {
        return Err("runtime model crop.rgb".into());
    }
    let weights = std::fs::read(&args[2]).map_err(|e| e.to_string())?;
    let crop = std::fs::read(&args[3]).map_err(|e| e.to_string())?;
    let mut engine = Engine::load(Path::new(&args[1]), &weights, false, 2)?;
    let logits = engine.phase_view(&crop)?;
    if logits.len() != 32 || logits.iter().any(|v| !v.is_finite()) {
        return Err("Invalid phase model output".into());
    }
    println!("provider={} phases={}", engine.provider, logits.len());
    Ok(())
}
