//! File helpers shared by every save in the app and its background jobs.
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Replace `path` with `bytes` so a crash or power loss leaves either the old file or the new one, never half:
/// write a temporary file beside it, flush it to disk, then rename it over the target. The temporary file is
/// removed on failure. Temporary names are unique per process and call, so concurrent writers never share one.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let mut name = path
        .file_name()
        .ok_or_else(|| std::io::Error::other("the path has no file name"))?
        .to_os_string();
    name.push(format!(
        ".{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let tmp = path.with_file_name(name);
    let written = (|| {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp, path)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}
