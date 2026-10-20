//! AI + orange-fragment ensemble. One full scan saves one undoable no-fire batch.
#[cfg(any(test, target_os = "linux"))]
#[path = "no_fire_runtime.rs"]
mod runtime_pack;
use fire_core::gui_mask::{GuiDetector, GuiOptions, GuiTextures};
use no_fire_cnn::{Engine, policy};
use std::{
    path::PathBuf,
    process::Child,
    sync::{Mutex, OnceLock, atomic::AtomicBool},
};
use studio_core::{import::Tools, project::Project};
const MODEL: &[u8] = include_bytes!("../runtime/ai/no-fire-v3.onnx");
static RESOURCES: OnceLock<PathBuf> = OnceLock::new();
static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);
pub(crate) fn configure(folder: PathBuf) {
    let _ = RESOURCES.set(folder);
}
pub(crate) fn model_path(name: &str) -> PathBuf {
    let folder = RESOURCES
        .get()
        .cloned()
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime/ai"));
    let file = folder.join(name);
    #[cfg(debug_assertions)]
    if !file.is_file() {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("runtime/ai")
            .join(name);
    }
    file
}
#[cfg(target_os = "linux")]
static CACHE: OnceLock<PathBuf> = OnceLock::new();
#[cfg(target_os = "linux")]
pub(crate) fn configure_cache(folder: PathBuf) {
    let _ = CACHE.set(folder);
}
pub(crate) fn runtime() -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    if let Some(path) = std::env::var_os("FIRECRACKLE_AI_RUNTIME") {
        return Ok(PathBuf::from(path));
    }
    let folder = RESOURCES
        .get()
        .cloned()
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime/ai"));
    #[cfg(windows)]
    let name = "onnxruntime.dll";
    #[cfg(not(windows))]
    let name = "libonnxruntime.so";
    #[cfg(target_os = "linux")]
    if folder.join("native.zip").is_file() {
        return runtime_pack::unpack(
            &folder.join("native.zip"),
            CACHE.get().ok_or("AI cache unavailable")?,
        );
    }
    let file = folder.join(name);
    #[cfg(debug_assertions)]
    if !file.is_file() {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("runtime/ai")
            .join(name));
    }
    Ok(file)
}
fn textures() -> Result<GuiTextures, String> {
    macro_rules! asset {
        ($name:literal) => {
            include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../fire-detection/data/assets/gui/",
                $name
            ))
            .to_vec()
        };
    }
    studio_core::gui::with_interactions(
        GuiTextures::from_rgba(
            asset!("widgets.rgba"),
            asset!("icons.rgba"),
            asset!("inventory.rgba"),
        )?
        .with_extras(Some(asset!("bars.rgba")), Some(asset!("ascii.rgba")))?,
    )
}

pub(crate) fn scan_resuming(
    project: &Project,
    tools: &Tools,
    cancel: &AtomicBool,
    slot: &Mutex<Option<Child>>,
    completed: &[Option<i16>],
    update: impl FnMut(u32, Option<u8>),
) -> Result<(), String> {
    let detector = GuiDetector::new(textures()?, GuiOptions::default())?;
    detector.prepare(project.meta.width, project.meta.height);
    let runtime = runtime()?;
    let previous = ENGINE.lock().map_err(|_| "AI state unavailable")?.take();
    let engine = Mutex::new(match previous {
        Some(engine) => engine,
        None => Engine::auto(&runtime, MODEL, cancel)?,
    });
    eprintln!(
        "AI no-fire: {}",
        engine.lock().map_err(|_| "AI state unavailable")?.provider
    );
    let result = crate::pov::scan_with_workers_resuming(
        project,
        tools,
        cancel,
        slot,
        fire_core::video::scan_workers(project.meta.width * project.meta.height * 3),
        completed,
        |rgb| {
            let clear = policy::candidate_prepared(
                rgb,
                project.meta.width,
                project.meta.height,
                &detector,
                |raw, auto| Engine::clear_frame_shared(&engine, &runtime, MODEL, raw, auto, cancel),
            )?;
            Ok(clear.then_some(0))
        },
        update,
    );
    *ENGINE.lock().map_err(|_| "AI state unavailable")? =
        Some(engine.into_inner().map_err(|_| "AI state unavailable")?);
    result
}
#[cfg(test)]
fn candidate(rgb: &[u8], w: usize, h: usize, tex: &GuiTextures) -> Result<bool, String> {
    policy::candidate(rgb, w, h, tex, |_, _| Ok(false))
}
#[cfg(test)]
use policy::material;
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blue_texture_and_portal_veto_but_flat_sky_does_not() {
        let w = 96;
        let h = 96;
        let world = vec![1; w * h];
        let mut rgb = vec![0; w * h * 3];
        for c in rgb.as_chunks_mut::<3>().0 {
            c.copy_from_slice(&[30, 100, 180]);
        }
        assert!(!material(&rgb, &world, w, h));
        for (i, c) in rgb.as_chunks_mut::<3>().0.iter_mut().enumerate() {
            let d = if (i % w / 3 + i / w / 3) % 2 == 0 {
                0
            } else {
                25
            };
            c.copy_from_slice(&[30 + d, 100 + d, 180 + d]);
        }
        assert!(material(&rgb, &world, w, h));
        assert!(!material(&rgb, &vec![0; w * h], w, h));
        for (i, c) in rgb.as_chunks_mut::<3>().0.iter_mut().enumerate() {
            let d = if (i % w / 3 + i / w / 3) % 2 == 0 {
                0
            } else {
                25
            };
            c.copy_from_slice(&[110 + d, 30 + d, 170 + d]);
        }
        assert!(material(&rgb, &world, w, h));
    }
    #[test]
    fn missing_hud_never_clears_and_visible_orange_stays_reviewed() {
        let tex = textures().unwrap();
        let (w, h) = (1920, 1080);
        let mut rgb = vec![0; w * h * 3];
        assert!(!candidate(&rgb, w, h, &tex).unwrap());
        for y in 200..250 {
            for x in 200..250 {
                rgb[(y * w + x) * 3..(y * w + x) * 3 + 3].copy_from_slice(&[230, 130, 20]);
            }
        }
        assert!(!candidate(&rgb, w, h, &tex).unwrap());
    }
    #[test]
    #[ignore = "Requires native RGB frames extracted from the separate validation video"]
    fn real_video_candidates_and_pause_uncertainty() {
        let data = std::fs::read(std::env::var("NO_FIRE_SMOKE_RGB").unwrap()).unwrap();
        let bytes = 1920 * 1080 * 3;
        assert_eq!(data.len(), bytes * 3);
        let tex = textures().unwrap();
        let actual: Vec<_> = data
            .chunks_exact(bytes)
            .map(|rgb| candidate(rgb, 1920, 1080, &tex).unwrap())
            .collect();
        assert_eq!(
            actual,
            vec![true, true, false],
            "32s / 40s gameplay clears; unsafe156s menu abstains"
        );
    }
    #[test]
    #[ignore = "Requires lossless real-frame fixture and bundled FFmpeg"]
    fn desktop_scan_decodes_and_returns_reviewable_original_frames() {
        let video = std::env::var("NO_FIRE_SMOKE_VIDEO").unwrap();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime");
        let tools = Tools {
            ffmpeg: root.join("ffmpeg.exe").into_os_string(),
            ffprobe: root.join("ffprobe.exe").into_os_string(),
        };
        let project = studio_core::import::import_video(
            &tools,
            std::path::Path::new(&video),
            &studio_core::config::Settings::default(),
        )
        .unwrap();
        assert_eq!(project.frames.len(), 3);
        let jobs = crate::pov::Jobs::default();
        let initial = jobs.start_no_fire(project, tools).unwrap();
        let started = std::time::Instant::now();
        loop {
            let status = jobs.status().unwrap().unwrap();
            if status.state != "running" {
                assert_eq!(status.state, "done", "{:?}", status.error);
                assert_eq!(status.processed, 3);
                assert_eq!(status.accepted, 2);
                assert_eq!(jobs.candidates(initial.id, 0).unwrap(), vec![0, 1]);
                break;
            }
            assert!(started.elapsed().as_secs() < 30, "scan timed out");
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}
