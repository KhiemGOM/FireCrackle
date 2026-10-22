//! A paused frame at the video's own resolution as a lossless PNG (`studio_core::frames::decode_exact_png`).
//! The last few are kept in memory, so pausing again or stepping back is instant.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use studio_core::{
    config::DecodeConfig, frames::decode_exact_png, import::Tools, project::Project,
};

const KEPT: usize = 4;

type Key = (String, u32);
static RECENT: Mutex<VecDeque<(Key, Arc<Vec<u8>>)>> = Mutex::new(VecDeque::new());

pub fn get(
    project: &Project,
    frame: u32,
    tools: impl FnOnce() -> Result<Tools, String>,
) -> Result<Arc<Vec<u8>>, String> {
    if frame as usize >= project.frames.len() {
        return Err("Frame is outside the video".into());
    }
    let key = (project.video_path.clone(), frame);
    if let Some(png) = recent(&key) {
        return Ok(png);
    }
    let png = decode_exact_png(
        &tools()?,
        Path::new(&project.video_path),
        &project.frame_index(),
        frame,
        &DecodeConfig::default(),
        &AtomicBool::new(false),
    )
    .map_err(|e| format!("Full-quality frame decode failed: {e:?}"))?;
    let png = Arc::new(png);
    remember(key, png.clone());
    Ok(png)
}

fn remember(key: Key, png: Arc<Vec<u8>>) {
    let mut kept = RECENT.lock().unwrap_or_else(|e| e.into_inner());
    kept.retain(|(k, _)| *k != key);
    kept.push_back((key, png));
    while kept.len() > KEPT {
        kept.pop_front();
    }
}

fn recent(key: &Key) -> Option<Arc<Vec<u8>>> {
    let kept = RECENT.lock().unwrap_or_else(|e| e.into_inner());
    kept.iter()
        .find(|(k, _)| k == key)
        .map(|(_, png)| png.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn no_tools() -> Result<Tools, String> {
        Err("decoded".into())
    }
    #[test]
    fn a_frame_outside_the_video_is_an_error_without_decoding() {
        let f = crate::scan_cache::tests::fixture(3);
        let error = get(&f.project, 3, || -> Result<Tools, String> {
            panic!("must not decode")
        })
        .unwrap_err();
        assert!(error.contains("outside"), "{error}");
    }
    #[test]
    fn a_recent_frame_is_returned_without_decoding_again() {
        let f = crate::scan_cache::tests::fixture(3);
        let png = Arc::new(vec![1, 2, 3]);
        remember((f.project.video_path.clone(), 2), png.clone());
        let got = get(&f.project, 2, || -> Result<Tools, String> {
            panic!("must not decode")
        })
        .unwrap();
        assert!(Arc::ptr_eq(&got, &png));
        assert_eq!(
            get(&f.project, 1, no_tools).unwrap_err(),
            "decoded",
            "other frames still decode"
        );
    }
    #[test]
    fn only_the_last_few_frames_are_kept() {
        let f = crate::scan_cache::tests::fixture(10);
        let path = f.project.video_path.clone();
        for frame in 0..=KEPT as u32 {
            remember((path.clone(), frame), Arc::new(vec![frame as u8]));
        }
        assert_eq!(
            get(&f.project, 0, no_tools).unwrap_err(),
            "decoded",
            "the oldest is dropped"
        );
        assert_eq!(
            *get(&f.project, KEPT as u32, no_tools).unwrap(),
            vec![KEPT as u8]
        );
    }
}
