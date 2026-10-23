//! Exact-frame list previews, separate from the full-resolution playback/prefetch cache.
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak, atomic::AtomicBool},
};
use studio_core::{
    config::DecodeConfig, decode_plan::job_for, frames::decode_preview, import::Tools,
    project::Project,
};

fn profile() -> DecodeConfig {
    DecodeConfig {
        max_width: 128,
        jpeg_quality: 14,
        window_back: 0,
        window_ahead: 0,
        cache_mb: 8,
        ..DecodeConfig::default()
    }
}
/// The preview width (the frontend's PREVIEW_TIERS in lib/guiThumbnailCache.ts) and its JPEG `-q:v` (2 best, 31
/// smallest). Gallery sizes are decoded at the card's size and stay good JPEGs; the 128 px list strips stay small.
fn tier(width: u32) -> (u32, u32) {
    match width {
        0..=128 => (128, 10),
        129..=512 => (512, 4),
        513..=1024 => (1024, 4),
        _ => (2048, 4),
    }
}
fn cache_path(project: &Project, dir: &Path, frame: u32, width: u32) -> PathBuf {
    let mut hash = Sha256::new();
    hash.update(b"exact-preview-jpeg-selected-v3");
    hash.update(width.to_le_bytes());
    hash.update(project.fingerprint.as_bytes());
    hash.update((project.frames.len() as u64).to_le_bytes());
    crate::scan_cache::hash_video_file(&mut hash, &project.video_path);
    dir.join("preview-thumbs")
        .join(crate::hex(&hash.finalize()))
        .join(format!("{frame:010}.jpg"))
}
fn read(path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > 2 * 1024 * 1024 {
        return None;
    }
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(
        &mut std::io::Read::take(file, 2 * 1024 * 1024 + 1),
        &mut bytes,
    )
    .ok()?;
    let split = studio_core::frames::split_jpegs(&bytes);
    (split.frames.len() == 1 && split.frames[0] == (0..bytes.len()) && split.incomplete_tail == 0)
        .then_some(bytes)
}
#[cfg(test)]
pub fn get(
    project: &Project,
    dir: &Path,
    frame: u32,
    tools: impl FnOnce() -> Result<Tools, String>,
) -> Result<Vec<u8>, String> {
    get_sized(project, dir, frame, 128, tools)
}

pub fn get_sized(
    project: &Project,
    dir: &Path,
    frame: u32,
    width: u32,
    tools: impl FnOnce() -> Result<Tools, String>,
) -> Result<Vec<u8>, String> {
    get_with_targets(project, dir, frame, width, &[], tools)
}

// Bound batch latency/memory even when a source has unusually long keyframe intervals.
fn batch_targets(index: &studio_core::index::FrameIndex, frame: u32, targets: &[u32]) -> Vec<u32> {
    let key = index.keyframe_at_or_before(frame);
    let mut wanted: Vec<_> = targets
        .iter()
        .copied()
        .filter(|&n| {
            (n as usize) < index.frames.len()
                && n / 240 == frame / 240
                && index.keyframe_at_or_before(n) == key
        })
        .collect();
    wanted.push(frame);
    wanted.sort_unstable();
    wanted.dedup();
    wanted
}
fn batch_lock(path: &Path, window: u32) -> Arc<Mutex<()>> {
    type Locks = HashMap<(PathBuf, u32), Weak<Mutex<()>>>;
    static LOCKS: OnceLock<Mutex<Locks>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);
    let key = (path.parent().unwrap_or(path).to_path_buf(), window);
    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}

pub fn get_with_targets(
    project: &Project,
    dir: &Path,
    frame: u32,
    width: u32,
    targets: &[u32],
    tools: impl FnOnce() -> Result<Tools, String>,
) -> Result<Vec<u8>, String> {
    let (width, quality) = tier(width);
    if frame as usize >= project.frames.len() {
        return Err("Thumbnail frame is outside the video".into());
    }
    let path = cache_path(project, dir, frame, width);
    if let Some(bytes) = read(&path) {
        return Ok(bytes);
    }
    let index = project.frame_index();
    let lock = (!targets.is_empty()).then(|| batch_lock(&path, frame / 240));
    let _guard = lock
        .as_ref()
        .map(|lock| lock.lock().unwrap_or_else(|e| e.into_inner()));
    // A concurrent request may already have decoded this same window.
    if let Some(bytes) = read(&path) {
        return Ok(bytes);
    }
    let mut wanted = batch_targets(&index, frame, targets);
    wanted.retain(|&n| n == frame || read(&cache_path(project, dir, n, width)).is_none());
    let mut config = profile();
    config.max_width = width;
    config.jpeg_quality = quality;
    let job = job_for(&index, wanted[0], *wanted.last().unwrap(), &config);
    // Reuse the shipped timestamp-verified decoder. No playback lookahead or background fill.
    let decoded = decode_preview(
        &tools()?,
        Path::new(&project.video_path),
        &index,
        &job,
        &config,
        &AtomicBool::new(false),
    )
    .map_err(|e| format!("Thumbnail decode failed: {e:?}"))?;
    let mut requested = None;
    for decoded in decoded {
        if wanted.binary_search(&decoded.frame).is_ok() {
            persist(
                &cache_path(project, dir, decoded.frame, width),
                &decoded.jpeg,
            );
        }
        if decoded.frame == frame {
            requested = Some(decoded.jpeg);
        }
    }
    requested.ok_or("Thumbnail decoder returned no image".into())
}

fn persist(path: &Path, jpeg: &[u8]) {
    // Disk caching is best effort, including on read-only project folders.
    if let Some(parent) = path.parent()
        && std::fs::create_dir_all(parent).is_ok()
    {
        let _ = studio_core::fsutil::write_atomic(path, jpeg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;
    use studio_core::{decode_plan::job_for, frames::decode_job};
    #[test]
    fn batches_only_valid_targets_in_the_same_bounded_keyframe_window() {
        let mut fixture = crate::scan_cache::tests::fixture(800);
        for entry in &mut fixture.project.frames {
            entry.key = false;
        }
        fixture.project.frames[0].key = true;
        fixture.project.frames[500].key = true;
        let index = fixture.project.frame_index();
        assert_eq!(
            batch_targets(&index, 490, &[1, 480, 490, 499, 500, 510, 720, 900]),
            vec![480, 490, 499]
        );
        assert_eq!(
            batch_targets(&index, 510, &[490, 500, 510, 600, 720, 900]),
            vec![500, 510, 600]
        );
    }
    #[test]
    #[ignore = "Requires GUI_THUMB_PROJECT, GUI_THUMB_CACHE, GUI_THUMB_FFMPEG and GUI_THUMB_FFPROBE"]
    fn real_batch_reuses_one_decode_and_matches_single_frame_bytes() {
        use std::sync::atomic::AtomicUsize;
        let project =
            Project::load(Path::new(&std::env::var("GUI_THUMB_PROJECT").unwrap())).unwrap();
        let dir = PathBuf::from(std::env::var("GUI_THUMB_CACHE").unwrap());
        let tools = Tools {
            ffmpeg: std::env::var_os("GUI_THUMB_FFMPEG").unwrap(),
            ffprobe: std::env::var_os("GUI_THUMB_FFPROBE").unwrap(),
        };
        let targets = [584, 616, 644, 679];
        let calls = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            let a = scope.spawn(|| {
                get_with_targets(&project, &dir.join("batch"), 584, 512, &targets, || {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Ok(tools.clone())
                })
                .unwrap()
            });
            let b = scope.spawn(|| {
                get_with_targets(&project, &dir.join("batch"), 616, 512, &targets, || {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Ok(tools.clone())
                })
                .unwrap()
            });
            assert!(!a.join().unwrap().is_empty());
            assert!(!b.join().unwrap().is_empty());
        });
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        for frame in targets {
            let cached = get_sized(&project, &dir.join("batch"), frame, 512, || {
                panic!("batch target must be cached")
            })
            .unwrap();
            let single = get_sized(&project, &dir.join("single"), frame, 512, || {
                Ok(tools.clone())
            })
            .unwrap();
            assert_eq!(cached, single, "exact frame {frame}");
        }
    }
    #[test]
    fn previews_come_in_the_frontends_widths_and_gallery_sizes_are_good_jpegs() {
        // lib/guiThumbnailCache.ts PREVIEW_TIERS: 128, 512, 1024, 2048
        let tiers: Vec<u32> = [0, 128, 129, 512, 513, 1024, 1025, 2048, 9999]
            .iter()
            .map(|&w| tier(w).0)
            .collect();
        assert_eq!(tiers, [128, 128, 512, 512, 1024, 1024, 2048, 2048, 2048]);
        // ffmpeg -q:v, 2 best .. 31 smallest: gallery sizes are not mush
        for w in [512, 1024, 2048] {
            assert!(tier(w).1 <= 4, "{w}");
        }
        assert!(tier(128).1 <= 10);
    }

    #[test]
    fn rejects_invalid_frame_before_reading_or_decoding() {
        let fixture = crate::scan_cache::tests::fixture(3);
        assert!(
            get(&fixture.project, Path::new("unused"), 3, || panic!(
                "must not decode"
            ))
            .is_err()
        );
        assert_eq!(profile().max_width, 128);
        assert_eq!(profile().jpeg_quality, 14);
        assert_eq!(profile().window_ahead, 0);
    }
    #[test]
    fn cache_keys_follow_video_identity() {
        let fixture = crate::scan_cache::tests::fixture(3);
        let a = cache_path(&fixture.project, Path::new("cache"), 1, 128);
        let mut changed = fixture.project.clone();
        changed.fingerprint.push('x');
        assert_ne!(a, cache_path(&changed, Path::new("cache"), 1, 128));
        assert_ne!(a, cache_path(&fixture.project, Path::new("cache"), 2, 128));
    }
    #[test]
    #[ignore = "Requires GUI_THUMB_PROJECT, GUI_THUMB_CACHE, GUI_THUMB_FFMPEG and GUI_THUMB_FFPROBE"]
    fn real_thumbnail_speed_and_disk_reuse() {
        use std::time::Instant;
        let project =
            Project::load(Path::new(&std::env::var("GUI_THUMB_PROJECT").unwrap())).unwrap();
        let dir = PathBuf::from(std::env::var("GUI_THUMB_CACHE").unwrap());
        let tools = Tools {
            ffmpeg: std::env::var_os("GUI_THUMB_FFMPEG").unwrap(),
            ffprobe: std::env::var_os("GUI_THUMB_FFPROBE").unwrap(),
        };
        let index = project.frame_index();
        let mut results = Vec::new();
        // Spread across the actual GUI recording, including a long keyframe prefix.
        for frame in [193, 584, 1640, 2971, 4554, 6500] {
            let config = DecodeConfig::default();
            let job = job_for(
                &index,
                frame,
                (frame + 8).min(index.frames.len() as u32 - 1),
                &config,
            );
            let started = Instant::now();
            let full = decode_job(
                &tools,
                Path::new(&project.video_path),
                &index,
                &job,
                &config,
                &AtomicBool::new(false),
            )
            .unwrap();
            let full_ms = started.elapsed().as_secs_f64() * 1000.;
            let started = Instant::now();
            let small = get(&project, &dir, frame, || Ok(tools.clone())).unwrap();
            let small_ms = started.elapsed().as_secs_f64() * 1000.;
            let started = Instant::now();
            assert_eq!(
                get(&project, &dir, frame, || panic!(
                    "disk hit must not need tools"
                ))
                .unwrap(),
                small
            );
            let disk_ms = started.elapsed().as_secs_f64() * 1000.;
            results.push(serde_json::json!({"frame":frame,"full_ms":full_ms,"small_ms":small_ms,"disk_ms":disk_ms,"full_bytes":full[0].jpeg.len(),"small_bytes":small.len()}));
        }
        println!("{}", serde_json::to_string_pretty(&results).unwrap());
        std::fs::write(
            dir.join("measurement.json"),
            serde_json::to_vec_pretty(&results).unwrap(),
        )
        .unwrap();
    }
}
