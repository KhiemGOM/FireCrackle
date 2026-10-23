//! Eager, reusable phase inference using the same ORT engine as no-fire.
use no_fire_cnn::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

struct Loaded {
    engine: Engine,
    runtime: PathBuf,
    model: PathBuf,
}
static NORMAL: OnceLock<Mutex<Result<Loaded, String>>> = OnceLock::new();
static SOUL: OnceLock<Mutex<Result<Loaded, String>>> = OnceLock::new();
static NORMAL_GPU: AtomicBool = AtomicBool::new(false);
static SOUL_GPU: AtomicBool = AtomicBool::new(false);
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Material {
    #[default]
    Normal,
    Soul,
}
impl Material {
    fn file(self) -> &'static str {
        match self {
            Self::Normal => "quad-phase-v1.onnx",
            Self::Soul => "quad-soul-phase-v1.onnx",
        }
    }
    fn metadata(self) -> &'static str {
        match self {
            Self::Normal => include_str!("../../release/quad-phase-model.json"),
            Self::Soul => include_str!("../../release/quad-soul-phase-model.json"),
        }
    }
}
fn engine(material: Material) -> &'static Mutex<Result<Loaded, String>> {
    let slot = match material {
        Material::Normal => &NORMAL,
        Material::Soul => &SOUL,
    };
    slot.get_or_init(|| {
        Mutex::new((|| {
            let runtime = crate::no_fire::runtime()?;
            let model = crate::no_fire::model_path(material.file());
            let weights = std::fs::read(&model)
                .map_err(|e| format!("Quad AI model is missing or unreadable: {e}"))?;
            let metadata: serde_json::Value =
                serde_json::from_str(material.metadata()).map_err(|e| e.to_string())?;
            let hash = crate::hex(&Sha256::digest(&weights));
            if metadata["sha256"].as_str() != Some(hash.as_str()) {
                return Err("Quad AI model checksum mismatch; reinstall the matching model".into());
            }
            // Publish a ready CPU session first. GPU shader compilation must never
            // keep the first match waiting for all adapter startup probes.
            let engine = Engine::load(&runtime, &weights, false, 2)?;
            eprintln!("Quad phase AI ready: {}", engine.provider);
            Ok(Loaded {
                engine,
                runtime,
                model,
            })
        })())
    })
}
pub(crate) fn eager_load() {
    for material in [Material::Normal, Material::Soul] {
        eager_material(material);
    }
}
fn eager_material(material: Material) {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = {
            let Ok(mut guard) = engine(material).lock() else {
                return;
            };
            match guard.as_mut() {
                Err(error) => {
                    eprintln!("Quad phase AI preparation failed: {error}");
                    return;
                }
                Ok(loaded) => {
                    if let Err(error) = loaded.engine.phase_view(&vec![0; 128 * 128 * 3]) {
                        eprintln!("Quad AI warmup failed: {error}");
                    }
                    (loaded.runtime.clone(), loaded.model.clone())
                }
            }
        };
        let started = match material {
            Material::Normal => &NORMAL_GPU,
            Material::Soul => &SOUL_GPU,
        };
        if started.swap(true, Ordering::Relaxed) {
            return;
        }
        // Do not hold ENGINE's mutex while compiling/probing GPU backends.
        let upgrade = (|| {
            let weights = std::fs::read(&paths.1).map_err(|e| e.to_string())?;
            Engine::auto_phase(&paths.0, &weights, &AtomicBool::new(false))
        })();
        match upgrade {
            Ok(candidate) if candidate.provider.starts_with("GPU") => {
                if let Ok(mut guard) = engine(material).lock()
                    && let Ok(loaded) = guard.as_mut()
                {
                    loaded.engine = candidate;
                    eprintln!(
                        "Quad AI {material:?} switched to {}",
                        loaded.engine.provider
                    );
                }
            }
            Err(error) => eprintln!("Quad AI retained CPU: {error}"),
            _ => {}
        }
    });
}
#[derive(Debug, Serialize)]
pub(crate) struct Answer {
    logits: Vec<f32>,
    provider: String,
}
pub(crate) fn infer_for(rgb: &[u8], material: Material) -> Result<Answer, String> {
    if rgb.len() != 128 * 128 * 3 {
        return Err("Quad AI requires a128×128 RGB crop".into());
    }
    let mut guard = engine(material)
        .lock()
        .map_err(|_| "Quad AI state unavailable")?;
    let loaded = guard.as_mut().map_err(|e| e.clone())?;
    let logits = match loaded.engine.phase_view(rgb) {
        Ok(logits) => logits,
        Err(error) if loaded.engine.provider.starts_with("GPU") => {
            eprintln!("Quad AI GPU failed; retrying on CPU: {error}");
            let weights = std::fs::read(&loaded.model).map_err(|e| e.to_string())?;
            loaded.engine = Engine::load(&loaded.runtime, &weights, false, 2)?;
            loaded.engine.phase_view(rgb)?
        }
        Err(error) => return Err(error),
    };
    Ok(Answer {
        logits,
        provider: loaded.engine.provider.clone(),
    })
}
#[tauri::command]
pub(crate) async fn quad_phase(rgb: Vec<u8>, material: Option<Material>) -> Result<Answer, String> {
    tauri::async_runtime::spawn_blocking(move || infer_for(&rgb, material.unwrap_or_default()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    fn infer(rgb: &[u8]) -> Result<super::Answer, String> {
        super::infer_for(rgb, super::Material::Normal)
    }
    #[test]
    fn invalid_input_fails_before_loading() {
        assert!(infer(&[0; 4]).unwrap_err().contains("128"));
        assert!(
            super::infer_for(&[0; 4], super::Material::Soul)
                .unwrap_err()
                .contains("128")
        );
    }
    #[test]
    fn native_phase_model_smoke() {
        let Some(file) = std::env::var_os("FIRECRACKLE_TEST_PHASE_CROP") else {
            return;
        };
        let rgb = std::fs::read(file).unwrap();
        let start = std::time::Instant::now();
        let answer = infer(&rgb).unwrap();
        assert_eq!(answer.logits.len(), 32);
        assert!(answer.logits.iter().all(|x| x.is_finite()));
        assert_eq!(answer.provider, "CPU");
        eprintln!("Phase CPU ready + first actual crop: {:?}", start.elapsed());
        if let Some(soul_file) = std::env::var_os("FIRECRACKLE_TEST_SOUL_CROP") {
            let rgb = std::fs::read(soul_file).unwrap();
            let start = std::time::Instant::now();
            let soul = super::infer_for(&rgb, super::Material::Soul).unwrap();
            assert_eq!(soul.provider, "CPU");
            assert_eq!(soul.logits.len(), 32);
            if let Some(expected) = std::env::var_os("FIRECRACKLE_TEST_SOUL_EXPECTED") {
                let values: Vec<f32> =
                    serde_json::from_slice(&std::fs::read(expected).unwrap()).unwrap();
                for (a, b) in soul.logits.iter().zip(values) {
                    assert!((a - b).abs() < 0.0001, "Soul model routing/parity mismatch");
                }
            }
            eprintln!("Soul CPU ready + first actual crop: {:?}", start.elapsed());
        }
        // Once CPU is available, eager GPU compilation runs off-lock. A match
        // can continue immediately using the published CPU session.
        super::eager_load();
        let start = std::time::Instant::now();
        let next = infer(&rgb).unwrap();
        for (a, b) in next.logits.iter().zip(&answer.logits) {
            assert!((a - b).abs() < 0.0001);
        }
        eprintln!(
            "Match during GPU preparation: {:?} ({})",
            start.elapsed(),
            next.provider
        );
        if std::env::var_os("FIRECRACKLE_TEST_PHASE_GPU").is_some() {
            for material in [super::Material::Normal, super::Material::Soul] {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
                loop {
                    let ready = super::engine(material)
                        .lock()
                        .unwrap()
                        .as_ref()
                        .unwrap()
                        .engine
                        .provider
                        .starts_with("GPU");
                    if ready {
                        break;
                    }
                    assert!(
                        std::time::Instant::now() < deadline,
                        "Expected test GPU did not become ready: {material:?}"
                    );
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
                let (crop, expected) = match material {
                    super::Material::Normal => (rgb.clone(), answer.logits.clone()),
                    super::Material::Soul => (
                        std::fs::read(std::env::var_os("FIRECRACKLE_TEST_SOUL_CROP").unwrap())
                            .unwrap(),
                        serde_json::from_slice(
                            &std::fs::read(
                                std::env::var_os("FIRECRACKLE_TEST_SOUL_EXPECTED").unwrap(),
                            )
                            .unwrap(),
                        )
                        .unwrap(),
                    ),
                };
                let started = std::time::Instant::now();
                let actual = super::infer_for(&crop, material).unwrap();
                assert!(actual.provider.starts_with("GPU"));
                for (a, b) in actual.logits.iter().zip(expected) {
                    assert!((a - b).abs() < 0.02);
                }
                eprintln!(
                    "{material:?} {} inference: {:?}",
                    actual.provider,
                    started.elapsed()
                );
            }
        }
    }
}
