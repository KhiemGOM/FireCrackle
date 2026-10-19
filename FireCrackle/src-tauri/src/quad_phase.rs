//! Eager, reusable phase inference using the same ORT engine as no-fire.
use no_fire_cnn::Engine;
use serde::Serialize;
use sha2::{Digest,Sha256};
use std::{path::PathBuf,sync::{Mutex,OnceLock,atomic::{AtomicBool,Ordering}}};

struct Loaded { engine: Engine, runtime: PathBuf, model: PathBuf }
static ENGINE: OnceLock<Mutex<Result<Loaded,String>>> = OnceLock::new();
static GPU_STARTED: AtomicBool = AtomicBool::new(false);
fn engine() -> &'static Mutex<Result<Loaded,String>> {
    ENGINE.get_or_init(|| Mutex::new((|| {
        let runtime=crate::no_fire::runtime()?;
        let model=crate::no_fire::model_path("quad-phase-v1.onnx");
        let weights=std::fs::read(&model).map_err(|e|format!("Quad AI model is missing or unreadable: {e}"))?;
        let metadata:serde_json::Value=serde_json::from_str(include_str!("../../release/quad-phase-model.json")).map_err(|e|e.to_string())?;
        let hash=format!("{:x}",Sha256::digest(&weights));
        if metadata["sha256"].as_str()!=Some(hash.as_str()) {return Err("Quad AI model checksum mismatch; reinstall the matching model".into());}
        // Publish a ready CPU session first. GPU shader compilation must never
        // keep the first match waiting for all adapter startup probes.
        let engine=Engine::load(&runtime,&weights,false,2)?;
        eprintln!("Quad phase AI ready: {}",engine.provider);
        Ok(Loaded {engine,runtime,model})
    })()))
}
pub(crate) fn eager_load() {
    tauri::async_runtime::spawn_blocking(|| {
        let paths={
            let Ok(mut guard)=engine().lock() else {return;};
            match guard.as_mut() {
                Err(error)=>{eprintln!("Quad phase AI preparation failed: {error}");return;},
                Ok(loaded)=>{
                    if let Err(error)=loaded.engine.phase_view(&vec![0;128*128*3]) {eprintln!("Quad AI warmup failed: {error}");}
                    (loaded.runtime.clone(),loaded.model.clone())
                }
            }
        };
        if GPU_STARTED.swap(true,Ordering::Relaxed) {return;}
        // Do not hold ENGINE's mutex while compiling/probing GPU backends.
        let upgrade=(|| {
            let weights=std::fs::read(&paths.1).map_err(|e|e.to_string())?;
            Engine::auto_phase(&paths.0,&weights,&AtomicBool::new(false))
        })();
        match upgrade {
            Ok(candidate) if candidate.provider.starts_with("GPU")=>{
                if let Ok(mut guard)=engine().lock() {if let Ok(loaded)=guard.as_mut() {loaded.engine=candidate;eprintln!("Quad AI switched to {}",loaded.engine.provider);}}
            },
            Err(error)=>eprintln!("Quad AI retained CPU: {error}"),
            _=>{},
        }
    });
}
#[derive(Debug,Serialize)]
pub(crate) struct Answer { logits: Vec<f32>, provider: String }
pub(crate) fn infer(rgb: &[u8]) -> Result<Answer,String> {
    if rgb.len()!=128*128*3 {return Err("Quad AI requires a128×128 RGB crop".into());}
    let mut guard=engine().lock().map_err(|_|"Quad AI state unavailable")?;
    let loaded=guard.as_mut().map_err(|e|e.clone())?;
    let logits=match loaded.engine.phase_view(rgb) {
        Ok(logits)=>logits,
        Err(error) if loaded.engine.provider.starts_with("GPU")=>{
            eprintln!("Quad AI GPU failed; retrying on CPU: {error}");
            let weights=std::fs::read(&loaded.model).map_err(|e|e.to_string())?;
            loaded.engine=Engine::load(&loaded.runtime,&weights,false,2)?;
            loaded.engine.phase_view(rgb)?
        },
        Err(error)=>return Err(error),
    };
    Ok(Answer {logits,provider:loaded.engine.provider.clone()})
}
#[tauri::command]
pub(crate) async fn quad_phase(rgb: Vec<u8>) -> Result<Answer,String> {
    tauri::async_runtime::spawn_blocking(move || infer(&rgb)).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    fn invalid_input_fails_before_loading() {assert!(super::infer(&[0;4]).unwrap_err().contains("128"));}
    #[test]
    fn native_phase_model_smoke() {
        let Some(file)=std::env::var_os("FIRECRACKLE_TEST_PHASE_CROP") else {return;};
        let rgb=std::fs::read(file).unwrap();
        let start=std::time::Instant::now();
        let answer=super::infer(&rgb).unwrap();
        assert_eq!(answer.logits.len(),32);
        assert!(answer.logits.iter().all(|x|x.is_finite()));
        assert_eq!(answer.provider,"CPU");
        eprintln!("Phase CPU ready + first actual crop: {:?}",start.elapsed());
        // Once CPU is available, eager GPU compilation runs off-lock. A match
        // can continue immediately using the published CPU session.
        super::eager_load();
        let start=std::time::Instant::now();
        let next=super::infer(&rgb).unwrap();
        for (a,b) in next.logits.iter().zip(&answer.logits) {assert!((a-b).abs()<0.0001);}
        eprintln!("Match during GPU preparation: {:?} ({})",start.elapsed(),next.provider);
    }
}
