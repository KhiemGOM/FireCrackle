//! A paused frame at the video's own resolution as a lossless PNG (`studio_core::frames::decode_exact_png`).
//! The last few are kept in memory, so pausing again or stepping back is instant.

use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, LazyLock, Mutex};
use studio_core::{
    config::DecodeConfig, frames::decode_exact_png, import::Tools, project::Project,
};

const KEPT: usize = 4;

type Key = (String, u32);
static RECENT: Mutex<VecDeque<(Key, Arc<Vec<u8>>)>> = Mutex::new(VecDeque::new());
/// One lock per frame being decoded: its holder runs the decode, later callers wait and then find it kept.
static DECODING: LazyLock<Mutex<HashMap<Key, Arc<Mutex<()>>>>> = LazyLock::new(Default::default);

pub fn get(
    project: &Project,
    frame: u32,
    tools: impl FnOnce() -> Result<Tools, String>,
) -> Result<Arc<Vec<u8>>, String> {
    if frame as usize >= project.frames.len() {
        return Err("Frame is outside the video".into());
    }
    fetch((project.video_path.clone(), frame), || {
        decode_exact_png(
            &tools()?,
            Path::new(&project.video_path),
            &project.frame_index(),
            frame,
            &DecodeConfig::default(),
            &AtomicBool::new(false),
        )
        .map_err(|e| format!("Full-quality frame decode failed: {e:?}"))
    })
}

/// The kept picture, or `decode`'s. Callers asking for one frame at once (the paused picture and its GUI mask, as
/// the playhead stops) wait for a single decode instead of running ffmpeg twice; other frames are not held up.
fn fetch(
    key: Key,
    decode: impl FnOnce() -> Result<Vec<u8>, String>,
) -> Result<Arc<Vec<u8>>, String> {
    if let Some(png) = recent(&key) {
        return Ok(png);
    }
    let turn = {
        let mut decoding = DECODING.lock().unwrap_or_else(|e| e.into_inner());
        decoding.entry(key.clone()).or_default().clone()
    };
    // a decode that panicked leaves the lock poisoned, not held: the next caller decodes
    let _turn = turn.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(png) = recent(&key) {
        return Ok(png);
    }
    let made = decode().map(Arc::new);
    if let Ok(png) = &made {
        remember(key.clone(), png.clone());
    }
    let mut decoding = DECODING.lock().unwrap_or_else(|e| e.into_inner());
    if decoding.get(&key).is_some_and(|t| Arc::ptr_eq(t, &turn)) {
        decoding.remove(&key);
    }
    made
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
    fn key(name: &str, frame: u32) -> Key {
        (
            format!("single-flight-{name}-{}", std::process::id()),
            frame,
        )
    }
    #[test]
    fn callers_asking_for_the_same_frame_at_once_share_one_decode() {
        // the GUI mask and the paused picture both ask for the frame as the playhead stops
        use std::sync::atomic::{AtomicUsize, Ordering};
        let decodes = Arc::new(AtomicUsize::new(0));
        let k = key("same", 5);
        let threads: Vec<_> = (0..3)
            .map(|_| {
                let (decodes, k) = (decodes.clone(), k.clone());
                std::thread::spawn(move || {
                    fetch(k, || {
                        decodes.fetch_add(1, Ordering::SeqCst);
                        std::thread::sleep(std::time::Duration::from_millis(150));
                        Ok(vec![5])
                    })
                })
            })
            .collect();
        let got: Vec<_> = threads
            .into_iter()
            .map(|t| t.join().unwrap().unwrap())
            .collect();
        assert_eq!(decodes.load(Ordering::SeqCst), 1);
        assert!(got.iter().all(|png| **png == [5]));
    }
    #[test]
    fn different_frames_still_decode_at_the_same_time() {
        // frame b's decode only finishes once frame a's has started: one waiting on the other would never end
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let a = std::thread::spawn(move || {
            fetch(key("parallel", 1), move || {
                started_tx.send(()).unwrap();
                Ok(vec![1])
            })
        });
        let b = fetch(key("parallel", 2), move || {
            started_rx
                .recv_timeout(std::time::Duration::from_secs(5))
                .map_err(|_| "frame 1 never started".to_string())?;
            Ok(vec![2])
        });
        assert_eq!(*b.unwrap(), vec![2]);
        assert_eq!(*a.join().unwrap().unwrap(), vec![1]);
    }
    #[test]
    fn a_failed_decode_is_not_kept_and_the_next_caller_decodes_again() {
        let k = key("failed", 3);
        assert_eq!(
            fetch(k.clone(), || Err("ffmpeg failed".into())).unwrap_err(),
            "ffmpeg failed"
        );
        assert_eq!(*fetch(k, || Ok(vec![3])).unwrap(), vec![3]);
    }
    #[test]
    fn a_decode_that_panics_does_not_block_that_frame_for_good() {
        let k = key("panic", 4);
        let k2 = k.clone();
        let _ = std::thread::spawn(move || fetch(k2, || panic!("decoder crashed"))).join();
        assert_eq!(*fetch(k, || Ok(vec![4])).unwrap(), vec![4]);
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
