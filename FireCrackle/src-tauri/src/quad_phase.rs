//! Eager, reusable phase inference using the same ORT engine as no-fire. The two models (normal and soul fire) are
//! not packaged: like FFmpeg and yt-dlp they are downloaded on first use (`external_tools::install_model`), checked
//! against their pinned SHA-256 and cached; until then Match uses the colour matcher.
use no_fire_cnn::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::{
        Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
};

struct Loaded {
    engine: Engine,
    runtime: PathBuf,
    model: PathBuf,
}
static NORMAL: Mutex<Option<Loaded>> = Mutex::new(None);
static SOUL: Mutex<Option<Loaded>> = Mutex::new(None);
static NORMAL_GPU: AtomicBool = AtomicBool::new(false);
static SOUL_GPU: AtomicBool = AtomicBool::new(false);
/// A download in progress, and the last one's failure (shown until the next attempt).
static NORMAL_FETCH: AtomicBool = AtomicBool::new(false);
static SOUL_FETCH: AtomicBool = AtomicBool::new(false);
static NORMAL_FAILED: Mutex<Option<String>> = Mutex::new(None);
static SOUL_FAILED: Mutex<Option<String>> = Mutex::new(None);
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
    fn slot(self) -> &'static Mutex<Option<Loaded>> {
        match self {
            Self::Normal => &NORMAL,
            Self::Soul => &SOUL,
        }
    }
    fn fetching(self) -> &'static AtomicBool {
        match self {
            Self::Normal => &NORMAL_FETCH,
            Self::Soul => &SOUL_FETCH,
        }
    }
    fn failed(self) -> &'static Mutex<Option<String>> {
        match self {
            Self::Normal => &NORMAL_FAILED,
            Self::Soul => &SOUL_FAILED,
        }
    }
    fn sha256(self) -> String {
        serde_json::from_str::<serde_json::Value>(self.metadata())
            .ok()
            .and_then(|m| m["sha256"].as_str().map(str::to_string))
            .unwrap_or_default()
    }
}

/// The first of `places` holding the exact pinned file (by SHA-256); a damaged or different file is passed over.
pub(crate) fn locate(file: &str, sha256: &str, places: &[PathBuf]) -> Option<PathBuf> {
    places.iter().map(|dir| dir.join(file)).find(|path| {
        std::fs::read(path).is_ok_and(|bytes| crate::hex(&Sha256::digest(&bytes)) == sha256)
    })
}
/// Where a model may already be: the download cache, the `ai` folder of an install from 0.4.2 to 0.6.0 (they bundled
/// it, so updating downloads nothing), and in development the build scripts' staging folder.
fn places(material: Material) -> Vec<PathBuf> {
    let file = material.file();
    let mut out: Vec<PathBuf> = crate::external_tools::installed_model(material.metadata(), file)
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .into_iter()
        .collect();
    if let Some(bundled) = crate::no_fire::model_path(file).parent() {
        out.push(bundled.to_path_buf());
    }
    if cfg!(debug_assertions) {
        out.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime/models"));
    }
    out
}
/// Download the model in the background, one download at a time; a failure is kept for the next message.
fn fetch(material: Material) {
    if material.fetching().swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(mut failed) = material.failed().lock() {
        *failed = None;
    }
    std::thread::spawn(move || {
        let result =
            crate::external_tools::install_model(material.metadata(), material.file(), None);
        if let Err(error) = result
            && let Ok(mut failed) = material.failed().lock()
        {
            *failed = Some(error);
        }
        material.fetching().store(false, Ordering::SeqCst);
    });
}
/// What Match says while the model is not there yet; it also starts (or retries) the download.
fn missing_message(material: Material) -> String {
    let failed = material.failed().lock().ok().and_then(|f| f.clone());
    fetch(material);
    if let Some(error) = failed {
        return format!(
            "Could not download the quad AI model ({error}); trying again. The colour matcher is used meanwhile."
        );
    }
    let done = match crate::external_tools::model_progress(material.file()) {
        Some((bytes, Some(total))) if total > 0 => {
            format!(": {}% of {} MB", bytes * 100 / total, total / (1024 * 1024))
        }
        _ => String::new(),
    };
    format!(
        "Downloading the quad AI model (first use){done}. The colour matcher is used meanwhile."
    )
}
/// The engine for `material`, loaded once its model is on disk. `download`: when it is not, start fetching it
/// (preloading at startup never downloads). A failed load is tried again next time.
fn ready(
    material: Material,
    download: bool,
) -> Result<MutexGuard<'static, Option<Loaded>>, String> {
    let mut guard = material
        .slot()
        .lock()
        .map_err(|_| "Quad AI state unavailable")?;
    if guard.is_none() {
        let Some(model) = locate(material.file(), &material.sha256(), &places(material)) else {
            return Err(if download {
                missing_message(material)
            } else {
                "Quad AI model not downloaded yet".into()
            });
        };
        let runtime = crate::no_fire::runtime()?;
        let weights = std::fs::read(&model)
            .map_err(|e| format!("Quad AI model is missing or unreadable: {e}"))?;
        // Publish a ready CPU session first. GPU shader compilation must never
        // keep the first match waiting for all adapter startup probes.
        let engine = Engine::load(&runtime, &weights, false, 2)?;
        eprintln!("Quad phase AI ready: {}", engine.provider);
        *guard = Some(Loaded {
            engine,
            runtime,
            model,
        });
    }
    Ok(guard)
}
pub(crate) fn eager_load() {
    for material in [Material::Normal, Material::Soul] {
        eager_material(material);
    }
}
fn eager_material(material: Material) {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = {
            let mut guard = match ready(material, false) {
                Ok(guard) => guard,
                Err(error) => {
                    eprintln!("Quad phase AI not preloaded: {error}");
                    return;
                }
            };
            let Some(loaded) = guard.as_mut() else {
                return;
            };
            if let Err(error) = loaded.engine.phase_view(&vec![0; 128 * 128 * 3]) {
                eprintln!("Quad AI warmup failed: {error}");
            }
            (loaded.runtime.clone(), loaded.model.clone())
        };
        let started = match material {
            Material::Normal => &NORMAL_GPU,
            Material::Soul => &SOUL_GPU,
        };
        if started.swap(true, Ordering::Relaxed) {
            return;
        }
        // Do not hold the engine's mutex while compiling/probing GPU backends.
        let upgrade = (|| {
            let weights = std::fs::read(&paths.1).map_err(|e| e.to_string())?;
            Engine::auto_phase(&paths.0, &weights, &AtomicBool::new(false))
        })();
        match upgrade {
            Ok(candidate) if candidate.provider.starts_with("GPU") => {
                if let Ok(mut guard) = material.slot().lock()
                    && let Some(loaded) = guard.as_mut()
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
    let mut guard = ready(material, true)?;
    let Some(loaded) = guard.as_mut() else {
        return Err("Quad AI state unavailable".into());
    };
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
    fn the_model_is_taken_from_the_first_place_holding_the_exact_pinned_file() {
        use sha2::{Digest, Sha256};
        let root = std::env::temp_dir().join(format!("firecrackle-locate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (cache, bundled, staged) = (root.join("cache"), root.join("ai"), root.join("models"));
        for dir in [&cache, &bundled, &staged] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let sha = crate::hex(&Sha256::digest(b"model"));
        let places = [cache.clone(), bundled.clone(), staged.clone()];
        assert_eq!(super::locate("m.onnx", &sha, &places), None);
        std::fs::write(staged.join("m.onnx"), b"model").unwrap();
        assert_eq!(
            super::locate("m.onnx", &sha, &places),
            Some(staged.join("m.onnx"))
        );
        // an older install's bundled copy is used before the dev staging, so updating downloads nothing
        std::fs::write(bundled.join("m.onnx"), b"model").unwrap();
        assert_eq!(
            super::locate("m.onnx", &sha, &places),
            Some(bundled.join("m.onnx"))
        );
        // a damaged or different file is passed over
        std::fs::write(cache.join("m.onnx"), b"other").unwrap();
        assert_eq!(
            super::locate("m.onnx", &sha, &places),
            Some(bundled.join("m.onnx"))
        );
        std::fs::write(cache.join("m.onnx"), b"model").unwrap();
        assert_eq!(
            super::locate("m.onnx", &sha, &places),
            Some(cache.join("m.onnx"))
        );
        std::fs::remove_dir_all(root).unwrap();
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
                    let ready = material
                        .slot()
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
