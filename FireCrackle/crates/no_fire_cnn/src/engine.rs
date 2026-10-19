use ort::{
    session::{Session, builder::SessionBuilder},
    value::Tensor,
};
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

pub struct Engine {
    session: Session,
    pub provider: String,
}
impl Engine {
    pub fn load(runtime: &Path, model: &[u8], gpu: bool, threads: usize) -> Result<Self, String> {
        Self::load_on(runtime, model, gpu.then_some(0), threads)
    }
    fn load_on(
        runtime: &Path,
        model: &[u8],
        device: Option<i32>,
        threads: usize,
    ) -> Result<Self, String> {
        if !runtime.is_file() {
            return Err("AI inference runtime is missing".into());
        }
        let absolute = runtime.canonicalize().map_err(|e| e.to_string())?;
        let runtime = absolute.as_path();
        // Preflight dynamic loading as a Result: ort otherwise panics on a bad/missing DLL.
        // Windows must resolve DirectML beside ORT, rather than from the working directory.
        static LIBRARY: std::sync::OnceLock<Result<libloading::Library, String>> =
            std::sync::OnceLock::new();
        LIBRARY
            .get_or_init(|| {
                #[cfg(windows)]
                let loaded = unsafe {
                    libloading::os::windows::Library::load_with_flags(
                        runtime,
                        0x00000100 | 0x00001000,
                    )
                }
                .map(Into::into);
                #[cfg(not(windows))]
                let loaded = unsafe { libloading::Library::new(runtime) };
                loaded.map_err(|e| format!("Could not load AI runtime: {e:?}"))
            })
            .as_ref()
            .map_err(Clone::clone)?;
        ort::init_from(runtime.to_string_lossy())
            .with_name("FireCrackle AI")
            .commit()
            .map_err(|e| e.to_string())?;
        let builder = || -> ort::Result<SessionBuilder> {
            Session::builder()?
                .with_intra_threads(threads.clamp(1, 4))?
                .with_inter_threads(1)?
                .with_parallel_execution(false)?
                .with_memory_pattern(false)?
                .with_intra_op_spinning(false)
        };
        #[cfg(windows)]
        if let Some(device) = device {
            use ort::execution_providers::DirectMLExecutionProvider;
            if let Ok(session) = builder()
                .and_then(|b| {
                    b.with_execution_providers([DirectMLExecutionProvider::default()
                        .with_device_id(device)
                        .build()
                        .error_on_failure()])
                })
                .and_then(|b| b.commit_from_memory(model))
            {
                return Ok(Self {
                    session,
                    provider: format!("GPU (DirectML {device})"),
                });
            }
        }
        #[cfg(target_os = "linux")]
        if let Some(device) = device {
            use ort::execution_providers::{
                CUDAExecutionProvider, MIGraphXExecutionProvider, OpenVINOExecutionProvider,
                cuda::CuDNNConvAlgorithmSearch,
            };
            let (provider, name) = match device {
                0 | 1 => (
                    CUDAExecutionProvider::default()
                        .with_device_id(device)
                        .with_tf32(false)
                        .with_conv_algorithm_search(CuDNNConvAlgorithmSearch::Heuristic)
                        .build(),
                    format!("GPU (CUDA {device})"),
                ),
                2 => (
                    OpenVINOExecutionProvider::default()
                        .with_device_type("GPU")
                        .with_precision("FP32")
                        .build(),
                    "GPU (OpenVINO)".into(),
                ),
                _ => (
                    MIGraphXExecutionProvider::default()
                        .with_device_id(0)
                        .with_fp16(false)
                        .build(),
                    "GPU (MIGraphX)".into(),
                ),
            };
            if let Ok(session) = builder()
                .and_then(|b| b.with_execution_providers([provider.error_on_failure()]))
                .and_then(|b| b.commit_from_memory(model))
            {
                return Ok(Self {
                    session,
                    provider: name,
                });
            }
        }
        let _ = device;
        let session = builder()
            .and_then(|b| b.commit_from_memory(model))
            .map_err(|e| format!("Could not load no-fire model: {e}"))?;
        Ok(Self {
            session,
            provider: "CPU".into(),
        })
    }
    /// Bounded startup probe. Never select a numerically inconsistent or slower GPU.
    pub fn auto(runtime: &Path, model: &[u8], cancel: &AtomicBool) -> Result<Self, String> {
        Self::auto_shape(runtime, model, cancel, 224, 1, 3)
    }
    /// Same backend selection, numerical check and CPU fallback as no-fire.
    /// One bounded probe avoids repeatedly running a large quad model on CPU.
    pub fn auto_phase(runtime: &Path, model: &[u8], cancel: &AtomicBool) -> Result<Self, String> {
        Self::auto_shape(runtime, model, cancel, 128, 32, 1)
    }
    fn auto_shape(runtime: &Path, model: &[u8], cancel: &AtomicBool, side: usize, outputs: usize, probes_count: usize) -> Result<Self, String> {
        let mut best = Self::load(runtime, model, false, 2)?;
        let probes: Vec<Vec<u8>> = (0..probes_count)
            .map(|k| {
                (0..side * side * 3)
                    .map(|i| ((i * 17 + k * 53) % 256) as u8)
                    .collect()
            })
            .collect();
        let mut refs = Vec::new();
        for p in &probes {
            refs.push(best.infer_view(p, side, outputs)?);
        }
        let measure = |engine: &mut Self| -> Result<f64, String> {
            let start = std::time::Instant::now();
            for _ in 0..3 {
                for p in &probes {
                    engine.infer_view(p, side, outputs)?;
                }
            }
            Ok(start.elapsed().as_secs_f64())
        };
        let mut best_time = measure(&mut best)?;
        #[cfg(any(windows, target_os = "linux"))]
        for device in 0..if cfg!(windows) { 2 } else { 4 } {
            if cancel.load(Ordering::Relaxed) {
                return Err("AI preparation cancelled".into());
            }
            let Ok(mut candidate) = Self::load_on(runtime, model, Some(device), 2) else {
                continue;
            };
            if !candidate.provider.starts_with("GPU") {
                continue;
            }
            let consistent = probes.iter().zip(&refs).all(|(p, r)| {
                candidate
                    .infer_view(p, side, outputs)
                    .is_ok_and(|scores| scores.iter().zip(r).all(|(s,r)| (s-r).abs() <= 0.0001))
            });
            if !consistent {
                continue;
            }
            if let Ok(time) = measure(&mut candidate)
                && time < best_time * 0.9
            {
                best = candidate;
                best_time = time;
                // Large click-to-match models need not compile a second GPU
                // after finding an already validated, faster first adapter.
                // Preserve the no-fire scanner's existing exhaustive selection.
                if outputs == 32 { break; }
            }
        }
        let _ = (cancel, best_time, refs);
        Ok(best)
    }
    pub fn score_view(&mut self, rgb: &[u8]) -> Result<f32, String> {
        Ok(self.infer_view(rgb, 224, 1)?[0])
    }
    pub fn phase_view(&mut self, rgb: &[u8]) -> Result<Vec<f32>, String> {
        self.infer_view(rgb, 128, 32)
    }
    fn infer_view(&mut self, rgb: &[u8], side: usize, count: usize) -> Result<Vec<f32>, String> {
        if rgb.len() != side * side * 3 {
            return Err("Invalid AI image view".into());
        }
        let tensor = Tensor::from_array((
            [1usize, side, side, 3],
            rgb.iter().map(|v| *v as f32).collect::<Vec<_>>(),
        ))
        .map_err(|e| e.to_string())?;
        let outputs = self
            .session
            .run(ort::inputs![tensor])
            .map_err(|e| e.to_string())?;
        let (_, values) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| e.to_string())?;
        if values.len() != count || values.iter().any(|s| !s.is_finite()) {
            return Err("AI returned invalid evidence".into());
        }
        Ok(values.to_vec())
    }
    pub fn clear_frame(
        &mut self,
        raw: &[u8],
        auto: Option<&[u8]>,
        cancel: &AtomicBool,
    ) -> Result<bool, String> {
        for rgb in std::iter::once(raw).chain(auto) {
            if rgb.len() != 1920 * 1080 * 3 {
                return Err("Invalid AI video frame".into());
            }
            let cropped = &rgb[1920 * 12 * 3..];
            for rect in crate::tile_boxes() {
                if cancel.load(Ordering::Relaxed) {
                    return Ok(false);
                }
                if !crate::clear_score(self.score_view(&crate::resize(cropped, 1920, rect))?) {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
}
