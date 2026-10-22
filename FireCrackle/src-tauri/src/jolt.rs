//! Imported clock evidence belongs to the current video's project, separate from sprite labels.
use std::path::{Path, PathBuf};

fn path(video: &Path) -> PathBuf {
    let mut name = video.as_os_str().to_os_string();
    name.push(".firecrackle");
    PathBuf::from(name).join("jolt.json")
}
pub fn read(video: &Path) -> Result<Option<String>, String> {
    let path = path(video);
    match std::fs::metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
        Ok(m) if m.len() > 32 * 1024 * 1024 => Err("Saved Jolt data is too large".into()),
        Ok(_) => std::fs::read_to_string(path)
            .map(Some)
            .map_err(|e| e.to_string()),
    }
}
pub fn write(video: &Path, data: &str) -> Result<(), String> {
    if data.len() > 32 * 1024 * 1024 {
        return Err("Jolt data is too large".into());
    }
    let _: serde_json::Value = serde_json::from_str(data).map_err(|e| e.to_string())?;
    let target = path(video);
    studio_core::fsutil::write_atomic(&target, data.as_bytes()).map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sidecar_is_scoped_to_exact_video() {
        assert_ne!(path(Path::new("one.mp4")), path(Path::new("two.mp4")));
        assert!(path(Path::new("one.mp4")).ends_with("one.mp4.firecrackle/jolt.json"));
    }
    #[test]
    fn persisted_clock_can_be_replaced_and_invalid_json_leaves_it_intact() {
        let root = std::env::temp_dir().join(format!(
            "firecrackle-jolt-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let video = root.join("clip.mp4");
        let target = path(&video);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        assert_eq!(read(&video).unwrap(), None);
        write(&video, "{\"version\":1}").unwrap();
        write(&video, "{\"version\":2}").unwrap();
        assert!(write(&video, "bad JSON").is_err());
        assert_eq!(read(&video).unwrap().as_deref(), Some("{\"version\":2}"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
