use std::path::PathBuf;
use studio_core::fsutil::write_atomic;

fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("fc-fsutil-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}
fn leftovers(d: &PathBuf) -> Vec<String> {
    std::fs::read_dir(d)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".tmp"))
        .collect()
}

#[test]
fn writes_and_replaces_the_file_and_leaves_no_temporary_behind() {
    let d = dir("replace");
    let path = d.join("project.json");
    write_atomic(&path, b"first").unwrap();
    write_atomic(&path, b"second").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"second");
    assert!(leftovers(&d).is_empty());
}

#[test]
fn a_failed_write_keeps_the_previous_file_and_cleans_up() {
    let d = dir("fail");
    // The target is a non-empty folder, so the final rename cannot replace it.
    let target = d.join("busy");
    std::fs::create_dir_all(target.join("inside")).unwrap();
    assert!(write_atomic(&target, b"new").is_err());
    assert!(target.join("inside").is_dir());
    assert!(leftovers(&d).is_empty());
}

#[test]
fn a_path_without_a_file_name_or_folder_is_an_error() {
    assert!(write_atomic(std::path::Path::new("/"), b"x").is_err());
    let d = dir("missing");
    assert!(write_atomic(&d.join("no/such/folder/file.json"), b"x").is_err());
    assert!(leftovers(&d).is_empty());
}

#[test]
fn concurrent_writers_never_share_a_temporary_file() {
    let d = dir("concurrent");
    let path = d.join("thumb.jpg");
    let handles: Vec<_> = (0..8u8)
        .map(|n| {
            let path = path.clone();
            std::thread::spawn(move || write_atomic(&path, &[n; 4096]))
        })
        .collect();
    for h in handles {
        // On Windows a rename onto a file another writer is renaming at that instant may be refused; never corrupt.
        let _ = h.join().unwrap();
    }
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(bytes.len(), 4096);
    assert!(
        bytes.iter().all(|&b| b == bytes[0]),
        "one writer's whole file, never a mix"
    );
    assert!(leftovers(&d).is_empty());
}

#[test]
fn scratch_folders_are_unique_and_removed_with_their_contents() {
    let a = studio_core::fsutil::ScratchDir::new("test").unwrap();
    let b = studio_core::fsutil::ScratchDir::new("test").unwrap();
    assert_ne!(a.0, b.0);
    assert!(a.0.starts_with(std::env::temp_dir()));
    assert!(a.0.file_name().unwrap().to_string_lossy().starts_with("firecrackle-test-"));
    std::fs::write(a.0.join("frame.png"), b"x").unwrap();
    let path = a.0.clone();
    drop(a);
    assert!(!path.exists());
    assert!(b.0.is_dir());
}
