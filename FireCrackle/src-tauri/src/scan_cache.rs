//! Append-only per-video scan decisions. Unknown, abstained and accepted are distinct;
//! workers may finish out of order. A truncated final record is safely retried.
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::PathBuf,
    sync::OnceLock,
    time::{Duration, Instant},
};
use studio_core::project::Project;

pub(crate) fn pipeline_version() -> &'static str {
    static VERSION: OnceLock<String> = OnceLock::new();
    VERSION.get_or_init(|| {
        let mut hash = Sha256::new();
        hash.update(b"firecrackle-auto-cache-v1");
        hash.update(env!("CARGO_PKG_VERSION"));
        hash.update(std::env::consts::ARCH); hash.update(std::env::consts::OS);
        // Compile-time bytes: changing detector, preprocessing, model or texture assets invalidates results.
        macro_rules! sources { ($($path:literal),+ $(,)?) => { $(hash.update(include_bytes!($path));)+ }; }
        sources!("scan_cache.rs", "pov.rs", "no_fire.rs", "../runtime/ai/no-fire-v3.onnx",
            "../Cargo.lock", "../../release/no-fire-model.json",
            "../../crates/no_fire_cnn/src/engine.rs", "../../crates/no_fire_cnn/src/policy.rs", "../../crates/no_fire_cnn/src/lib.rs",
            "../../crates/studio_core/src/gui.rs", "../../crates/studio_core/src/import.rs", "../../crates/studio_core/src/proc.rs",
            "../../../fire-detection/core/src/veil.rs", "../../../fire-detection/core/src/portal.rs",
            "../../../fire-detection/core/src/gui_mask.rs", "../../../fire-detection/core/src/gui_screens.rs",
            "../../../fire-detection/core/src/gui_interaction.rs", "../../../fire-detection/core/src/gui_interaction_fast.rs",
            "../../../fire-detection/core/src/gui_tooltip.rs", "../../../fire-detection/data/assets/gui/interaction.bundle",
            "../../../fire-detection/core/src/pov.rs", "../../../fire-detection/core/src/overlay.rs",
            "../../../fire-detection/core/src/video.rs", "../../../fire-detection/core/src/lib.rs", "../../../fire-detection/bench/no_fire/fragment_rules.rs", "../../../fire-detection/bench/no_fire/retention_rules.rs",
            "../../../fire-detection/data/assets/fire_1.rgba", "../../../fire-detection/data/assets/gui/widgets.rgba",
            "../../../fire-detection/data/assets/gui/icons.rgba", "../../../fire-detection/data/assets/gui/inventory.rgba",
            "../../../fire-detection/data/assets/gui/bars.rgba", "../../../fire-detection/data/assets/gui/ascii.rgba",
            "../../../fire-detection/data/assets/gui/recipe_book.rgba");
        crate::hex(&hash.finalize())
    })
}

/// The video file's length and modification time, so a file replaced in place invalidates caches even before
/// its project is re-imported. A file that cannot be read adds nothing.
pub(crate) fn hash_video_file(hash: &mut Sha256, video_path: &str) {
    if let Ok(meta) = std::fs::metadata(video_path) {
        hash.update(meta.len().to_le_bytes());
        if let Ok(time) = meta.modified().and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .map_err(std::io::Error::other)
        }) {
            hash.update(time.as_nanos().to_le_bytes());
        }
    }
}

/// `<video>.firecrackle/auto-cache/<name>`: where every automatic scan keeps its resumable results.
pub(crate) fn auto_cache_file(project: &Project, name: &str) -> Result<PathBuf, String> {
    let dir = studio_core::project::project_dir(std::path::Path::new(&project.video_path))
        .ok_or("Video path has no file name")?;
    Ok(dir.join("auto-cache").join(name))
}

/// One frame's result as a scan journal stores it. `Saved` is the `Frame` record's fields beside `frame`, so each
/// scan keeps its own on-disk shape (`"row"` for first-person/no-fire, `"hit"` for the GUI detector).
pub trait Decision: Clone + PartialEq {
    type Saved: Serialize + DeserializeOwned;
    fn save(&self) -> Self::Saved;
    /// `None` when the stored value cannot be right (the journal is then not trusted).
    fn load(saved: Self::Saved) -> Option<Self>;
}

#[derive(Serialize, Deserialize)]
pub struct RowSaved {
    row: Option<u8>,
}

/// First-person / no-fire: -1 abstained, 0..31 the accepted sprite row.
impl Decision for i16 {
    type Saved = RowSaved;
    fn save(&self) -> RowSaved {
        RowSaved {
            row: u8::try_from(*self).ok(),
        }
    }
    fn load(saved: RowSaved) -> Option<i16> {
        match saved.row {
            None => Some(-1),
            Some(r) if r < 32 => Some(i16::from(r)),
            Some(_) => None,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
enum Record<S> {
    Header {
        key: String,
        total: usize,
    },
    Frame {
        frame: u32,
        #[serde(flatten)]
        value: S,
    },
    Finished {
        #[serde(default)]
        applied: usize,
    },
}

/// Append-only, resumable per-video scan results: one header, one record per frame (in any order), then `Finished`.
/// It is locked against a second FireCrackle window, flushed to disk about once a second, and a torn final record
/// from a crash is cut off in place before anything new is appended.
pub struct Journal<T: Decision = i16> {
    pub decisions: Vec<Option<T>>,
    pub finished: bool,
    pub applied: usize,
    path: PathBuf,
    key: String,
    valid_bytes: u64,
    file: Option<File>,
    synced: Instant,
}

impl<T: Decision> Journal<T> {
    /// A journal with nothing recorded yet (nothing is written until [`Journal::begin`]).
    pub fn empty(path: PathBuf, key: String, total: usize) -> Self {
        Self {
            decisions: vec![None; total],
            finished: false,
            applied: 0,
            path,
            key,
            valid_bytes: 0,
            file: None,
            synced: Instant::now(),
        }
    }
    /// The saved journal at `path` when it belongs to this `key` and length; `None` when missing, stale or damaged.
    pub fn load_at(path: PathBuf, key: String, total: usize) -> Option<Self> {
        if std::fs::metadata(&path).ok()?.len()
            > (total as u64)
                .saturating_mul(128)
                .saturating_add(1024 * 1024)
        {
            return None;
        }
        // A stale journal (other pipeline/project) is rejected from its first
        // line without reading a possibly very large file.
        {
            use std::io::BufRead;
            let mut first = Vec::new();
            std::io::BufReader::new(File::open(&path).ok()?)
                .read_until(b'\n', &mut first)
                .ok()?;
            match serde_json::from_slice::<Record<T::Saved>>(&first).ok()? {
                Record::Header { key: k, total: n } if k == key && n == total => {}
                _ => return None,
            }
        }
        let bytes = std::fs::read(&path).ok()?;
        let mut journal = Self::empty(path, key, total);
        let mut header = false;
        for line in bytes.split_inclusive(|b| *b == b'\n') {
            if !line.ends_with(b"\n") {
                break;
            } // Crash during the final append: discard that record only.
            let record: Record<T::Saved> = serde_json::from_slice(line).ok()?;
            match record {
                Record::Header { key, total: n }
                    if !header && journal.valid_bytes == 0 && key == journal.key && n == total =>
                {
                    header = true
                }
                Record::Frame { frame, value }
                    if header && (frame as usize) < total && !journal.finished =>
                {
                    let value = T::load(value)?;
                    let slot = &mut journal.decisions[frame as usize];
                    if slot.as_ref().is_some_and(|old| *old != value) {
                        return None;
                    }
                    *slot = Some(value);
                }
                Record::Finished { applied }
                    if header && journal.decisions.iter().all(Option::is_some) =>
                {
                    journal.finished = true;
                    journal.applied = applied;
                }
                _ => return None,
            }
            journal.valid_bytes += line.len() as u64;
        }
        header.then_some(journal)
    }
    /// [`Journal::load_at`] (or an empty journal), opened for writing.
    pub fn open_at(path: PathBuf, key: String, total: usize) -> Result<Self, String> {
        let mut journal = Self::load_at(path.clone(), key.clone(), total)
            .unwrap_or_else(|| Self::empty(path, key, total));
        journal.begin()?;
        Ok(journal)
    }
    /// Take the file for writing: lock it, cut off anything after the last whole record, write the header if new.
    pub fn begin(&mut self) -> Result<(), String> {
        self.open_file()?;
        if self.finished {
            self.close()?;
        }
        Ok(())
    }
    fn open_file(&mut self) -> Result<(), String> {
        if self.file.is_some() {
            return Ok(());
        }
        std::fs::create_dir_all(self.path.parent().ok_or("Scan cache has no folder")?)
            .map_err(|e| format!("Cannot create scan cache: {e}"))?;
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&self.path)
            .map_err(|e| format!("Cannot open scan cache: {e}"))?;
        file.try_lock()
            .map_err(|_| "Another FireCrackle instance is using this scan cache")?;
        file.set_len(self.valid_bytes).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::End(0)).map_err(|e| e.to_string())?;
        self.file = Some(file);
        if self.valid_bytes == 0 {
            self.append(&Record::Header {
                key: self.key.clone(),
                total: self.decisions.len(),
            })?;
        }
        Ok(())
    }
    fn append(&mut self, record: &Record<T::Saved>) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(record).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        let file = self
            .file
            .as_mut()
            .ok_or("Scan cache is not open for writing")?;
        file.write_all(&bytes)
            .map_err(|e| format!("Cannot save scan progress: {e}"))?;
        self.valid_bytes += bytes.len() as u64;
        if self.synced.elapsed() >= Duration::from_secs(1) {
            file.sync_data().map_err(|e| e.to_string())?;
            self.synced = Instant::now();
        }
        Ok(())
    }
    /// Record one frame. `false` when it was already known (results never change once saved).
    pub fn put(&mut self, frame: u32, value: T) -> Result<bool, String> {
        let slot = self
            .decisions
            .get(frame as usize)
            .ok_or("Invalid scan frame")?;
        if slot.is_some() {
            return Ok(false);
        }
        self.append(&Record::Frame {
            frame,
            value: value.save(),
        })?;
        self.decisions[frame as usize] = Some(value);
        Ok(true)
    }
    pub fn finish(&mut self, applied: usize) -> Result<(), String> {
        if self.decisions.iter().any(Option::is_none) {
            return Err("Cannot finish an incomplete scan".into());
        }
        self.open_file()?;
        self.append(&Record::Finished { applied })?;
        self.close()?;
        self.applied = applied;
        self.finished = true;
        Ok(())
    }
    pub fn processed(&self) -> u32 {
        self.decisions.iter().filter(|r| r.is_some()).count() as u32
    }
    /// Flush and release the file (and its lock); the journal can be resumed with [`Journal::begin`].
    pub fn close(&mut self) -> Result<(), String> {
        if let Some(file) = self.file.take() {
            file.sync_data()
                .map_err(|e| format!("Cannot sync scan progress: {e}"))?;
        }
        Ok(())
    }
}

impl Journal<i16> {
    fn location(project: &Project, no_fire: bool) -> Result<(PathBuf, String), String> {
        let mut hash = Sha256::new();
        hash.update(pipeline_version());
        hash.update([u8::from(no_fire)]);
        hash.update(serde_json::to_vec(project).map_err(|e| e.to_string())?);
        hash_video_file(&mut hash, &project.video_path);
        let key = crate::hex(&hash.finalize());
        let name = if no_fire {
            "no-fire.jsonl"
        } else {
            "first-person.jsonl"
        };
        Ok((auto_cache_file(project, name)?, key))
    }
    pub fn load(project: &Project, no_fire: bool) -> Option<Self> {
        let (path, key) = Self::location(project, no_fire).ok()?;
        Self::load_at(path, key, project.frames.len())
    }
    pub fn open(project: &Project, no_fire: bool) -> Result<Self, String> {
        let (path, key) = Self::location(project, no_fire)?;
        Self::open_at(path, key, project.frames.len())
    }
    pub fn record(&mut self, frame: u32, row: Option<u8>) -> Result<bool, String> {
        if row.is_some_and(|r| r >= 32) {
            return Err("Invalid scan sprite row".into());
        }
        self.put(frame, row.map_or(-1, i16::from))
    }
    pub fn rows(&self) -> Vec<(u32, u8)> {
        self.decisions
            .iter()
            .enumerate()
            .filter_map(|(n, value)| value.filter(|r| *r >= 0).map(|r| (n as u32, r as u8)))
            .collect()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    #[test]
    fn the_video_file_fingerprint_changes_when_the_file_is_replaced_in_place() {
        let f = fixture(2);
        let digest = |path: &str| {
            let mut h = Sha256::new();
            hash_video_file(&mut h, path);
            crate::hex(&h.finalize())
        };
        let before = digest(&f.project.video_path);
        assert_eq!(before, digest(&f.project.video_path));
        std::fs::write(&f.project.video_path, b"a longer replacement video").unwrap();
        assert_ne!(before, digest(&f.project.video_path));
        // A missing file still hashes (to the no-metadata value) rather than failing.
        let _ = digest("Z:/definitely/missing.mkv");
    }
    #[test]
    fn auto_cache_files_live_in_the_videos_project_folder() {
        let f = fixture(2);
        let path = auto_cache_file(&f.project, "gui-interactions.jsonl").unwrap();
        assert_eq!(
            path,
            f.root
                .join("clip.mkv.firecrackle")
                .join("auto-cache")
                .join("gui-interactions.jsonl")
        );
        let mut nameless = f.project.clone();
        nameless.video_path = "/".into();
        assert!(auto_cache_file(&nameless, "x.jsonl").is_err());
    }
    pub struct Fixture {
        pub root: PathBuf,
        pub project: Project,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            assert!(self.root.starts_with(std::env::temp_dir()));
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    pub fn fixture(total: usize) -> Fixture {
        use studio_core::{
            config::IndexConfig,
            index::{Packet, build_index},
            project::VideoMeta,
        };
        // Tests run in parallel: the counter keeps two fixtures from ever sharing a folder (and its cache lock).
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "firecrackle-scan-cache-{}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let video = root.join("clip.mkv");
        std::fs::write(&video, b"test-video").unwrap();
        let packets: Vec<_> = (0..total)
            .map(|n| Packet {
                pts: Some(n as f64 / 20.),
                dts: None,
                key: n == 0,
            })
            .collect();
        let index = build_index(&packets, &IndexConfig::default()).unwrap();
        let project = Project::assemble(
            &video.to_string_lossy(),
            10,
            "fingerprint".into(),
            VideoMeta {
                width: 16,
                height: 16,
                fps_num: 20,
                fps_den: 1,
                codec: "ffv1".into(),
            },
            &index,
        );
        Fixture { root, project }
    }
    #[test]
    fn retains_out_of_order_accepts_and_abstentions_without_duplicates() {
        let f = fixture(6);
        let mut cache = Journal::open(&f.project, false).unwrap();
        assert!(cache.record(4, Some(12)).unwrap());
        assert!(cache.record(0, None).unwrap());
        assert!(!cache.record(4, Some(12)).unwrap());
        drop(cache);
        let recovered = Journal::load(&f.project, false).unwrap();
        assert_eq!(
            recovered.decisions,
            vec![Some(-1), None, None, None, Some(12), None]
        );
        assert_eq!(recovered.processed(), 2);
        assert_eq!(recovered.rows(), vec![(4, 12)]);
        assert!(!recovered.finished);
        assert!(Journal::load(&f.project, true).is_none());
    }
    #[test]
    fn rejects_changed_pipeline_video_metadata_and_frame_index() {
        let f = fixture(3);
        let mut cache = Journal::open(&f.project, false).unwrap();
        cache.record(0, Some(2)).unwrap();
        let path = cache.path.clone();
        drop(cache);
        assert!(
            Journal::<i16>::load_at(path, "old-detector-model-preprocessing-version".into(), 3)
                .is_none()
        );
        let mut changed = f.project.clone();
        changed.fingerprint = "other".into();
        assert!(Journal::load(&changed, false).is_none());
        changed = f.project.clone();
        changed.frames[1].pts += 0.001;
        assert!(Journal::load(&changed, false).is_none());
        changed = f.project.clone();
        changed.meta.width += 1;
        assert!(Journal::load(&changed, false).is_none());
        std::fs::write(&f.project.video_path, b"replacement-video").unwrap();
        assert!(Journal::load(&f.project, false).is_none());
        assert_eq!(Journal::open(&f.project, false).unwrap().processed(), 0);
    }
    #[test]
    fn truncates_only_an_incomplete_final_record_then_continues() {
        let f = fixture(3);
        let mut cache = Journal::open(&f.project, true).unwrap();
        cache.record(0, None).unwrap();
        let path = cache.path.clone();
        drop(cache);
        OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{\"type\":\"Frame\",\"frame\":1,")
            .unwrap();
        assert_eq!(Journal::load(&f.project, true).unwrap().processed(), 1);
        let mut resumed = Journal::open(&f.project, true).unwrap();
        resumed.record(1, Some(0)).unwrap();
        resumed.record(2, None).unwrap();
        resumed.finish(1).unwrap();
        drop(resumed);
        let recovered = Journal::load(&f.project, true).unwrap();
        assert_eq!(recovered.processed(), 3);
        assert!(recovered.finished);
        assert_eq!(recovered.applied, 1);
    }
    #[test]
    fn rejects_corrupt_complete_records_and_invalid_rows() {
        let f = fixture(2);
        let mut cache = Journal::open(&f.project, false).unwrap();
        assert!(cache.record(2, None).is_err());
        assert!(cache.record(0, Some(32)).is_err());
        assert!(cache.finish(0).is_err());
        let path = cache.path.clone();
        drop(cache);
        OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"broken-record\n")
            .unwrap();
        assert!(Journal::load(&f.project, false).is_none());
        assert_eq!(Journal::open(&f.project, false).unwrap().processed(), 0);
    }
    #[test]
    fn completed_results_survive_restart_and_manual_apply_updates_cached_count() {
        let f = fixture(2);
        let mut cache = Journal::open(&f.project, false).unwrap();
        cache.record(1, Some(4)).unwrap();
        cache.record(0, None).unwrap();
        cache.finish(0).unwrap();
        drop(cache);
        let mut recovered = Journal::load(&f.project, false).unwrap();
        assert!(recovered.finished);
        assert_eq!(recovered.rows(), vec![(1, 4)]);
        recovered.finish(1).unwrap();
        drop(recovered);
        assert_eq!(Journal::load(&f.project, false).unwrap().applied, 1);
    }
    #[test]
    fn a_second_writer_cannot_truncate_or_append_to_an_active_checkpoint() {
        let f = fixture(2);
        let mut active = Journal::open(&f.project, false).unwrap();
        active.record(0, Some(3)).unwrap();
        assert!(Journal::open(&f.project, false).is_err());
        active.close().unwrap();
        let recovered = Journal::open(&f.project, false).unwrap();
        assert_eq!(recovered.rows(), vec![(0, 3)]);
    }
}
