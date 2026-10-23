//! Keep optional accelerator libraries out of AppImage's mandatory ELF dependency scan.
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
};
const LIBRARIES: [&str; 3] = [
    "libonnxruntime.so",
    "libonnxruntime_providers_cuda.so",
    "libonnxruntime_providers_shared.so",
];

fn digest(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut bytes = [0; 65536];
    loop {
        let n = file.read(&mut bytes).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&bytes[..n]);
    }
    Ok(crate::hex(&hash.finalize()))
}
pub(crate) fn unpack(bundle: &Path, cache: &Path) -> Result<PathBuf, String> {
    let file = fs::File::open(bundle).map_err(|e| format!("AI runtime archive missing: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let hashes: BTreeMap<String, String> = serde_json::from_reader(
        archive
            .by_name("SHA256SUMS.json")
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if hashes.len() != LIBRARIES.len()
        || !LIBRARIES.iter().all(|name| {
            hashes
                .get(*name)
                .is_some_and(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        })
    {
        return Err("Invalid AI runtime manifest".into());
    }
    // The archive's checksum manifest also keys the cache across runtime upgrades.
    let id = crate::hex(&Sha256::digest(
        serde_json::to_vec(&hashes).map_err(|e| e.to_string())?,
    ));
    let folder = cache.join(id);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    for name in LIBRARIES {
        let target = folder.join(name);
        if digest(&target).ok().as_ref() == Some(&hashes[name]) {
            continue;
        }
        let temporary = folder.join(format!("{name}.{}.part", std::process::id()));
        let result = (|| -> Result<(), String> {
            let mut input = archive.by_name(name).map_err(|e| e.to_string())?;
            let mut output = fs::File::create(&temporary).map_err(|e| e.to_string())?;
            std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
            drop(output);
            if digest(&temporary)? != hashes[name] {
                return Err("AI runtime checksum mismatch".into());
            }
            fs::rename(&temporary, &target).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
    }
    Ok(folder.join("libonnxruntime.so"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn bundle(folder: &Path, corrupt: bool) -> PathBuf {
        let path = folder.join("native.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        let mut hashes = BTreeMap::new();
        for name in LIBRARIES {
            hashes.insert(name, crate::hex(&Sha256::digest(name.as_bytes())));
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(if corrupt { b"bad" } else { name.as_bytes() })
                .unwrap();
        }
        zip.start_file("SHA256SUMS.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&serde_json::to_vec(&hashes).unwrap())
            .unwrap();
        zip.finish().unwrap();
        path
    }
    #[test]
    fn verifies_repairs_and_reuses_cached_runtime() {
        let root = std::env::temp_dir().join(format!("firecrackle-ai-pack-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let package = bundle(&root, false);
        let cache = root.join("cache");
        let runtime = unpack(&package, &cache).unwrap();
        assert_eq!(fs::read(&runtime).unwrap(), b"libonnxruntime.so");
        let modified = fs::metadata(&runtime).unwrap().modified().unwrap();
        assert_eq!(unpack(&package, &cache).unwrap(), runtime);
        assert_eq!(
            fs::metadata(&runtime).unwrap().modified().unwrap(),
            modified
        );
        fs::write(&runtime, b"damaged").unwrap();
        unpack(&package, &cache).unwrap();
        assert_eq!(fs::read(&runtime).unwrap(), b"libonnxruntime.so");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupt_archive_never_publishes_a_library() {
        let root =
            std::env::temp_dir().join(format!("firecrackle-ai-pack-bad-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let package = bundle(&root, true);
        let cache = root.join("cache");
        assert!(unpack(&package, &cache).is_err());
        for directory in fs::read_dir(&cache).unwrap() {
            assert_eq!(fs::read_dir(directory.unwrap().path()).unwrap().count(), 0);
        }
        fs::remove_dir_all(root).unwrap();
    }
}
