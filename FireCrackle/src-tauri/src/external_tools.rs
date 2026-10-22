//! Third-party executables are fetched once, verified, and kept outside the app package.
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use studio_core::import::Tools;

static ROOT: OnceLock<PathBuf> = OnceLock::new();
static INSTALL: Mutex<()> = Mutex::new(());
static STATUS: Mutex<Option<Progress>> = Mutex::new(None);
static VIDEO: OnceLock<Tools> = OnceLock::new();
fn check_cancel(cancel: Option<&AtomicBool>) -> Result<(), String> {
    if cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
        Err("Cancelled".into())
    } else {
        Ok(())
    }
}

#[derive(Clone, Serialize)]
pub struct Progress {
    pub name: String,
    pub downloaded: u64,
    pub total: Option<u64>,
}
#[derive(Deserialize)]
struct Asset {
    url: String,
    sha256: String,
    kind: String,
    version: String,
}

pub fn configure(root: PathBuf) {
    let _ = ROOT.set(root.join("tools"));
}
pub(crate) fn root() -> Result<&'static Path, String> {
    ROOT.get()
        .map(PathBuf::as_path)
        .ok_or("Tool cache unavailable".into())
}
pub fn status() -> Option<Progress> {
    STATUS.lock().ok().and_then(|s| s.clone())
}
pub(crate) fn progress(name: &str, downloaded: u64, total: Option<u64>) {
    if let Ok(mut s) = STATUS.lock() {
        *s = Some(Progress {
            name: name.into(),
            downloaded,
            total,
        });
    }
}
pub(crate) struct ClearStatus;
impl Drop for ClearStatus {
    fn drop(&mut self) {
        if let Ok(mut s) = STATUS.lock() {
            *s = None;
        }
    }
}

pub fn command(exe: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = studio_core::proc::hidden_command(exe);
    c.stdin(std::process::Stdio::null());
    c
}
/// Stop a tool and everything it started (yt-dlp's and Jolt's FFmpeg children too), then reap it.
pub(crate) fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let _ = command("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(unix)]
    {
        let _ = command("kill")
            .args(["-TERM", "--", &format!("-{}", child.id())])
            .output();
    }
    let _ = child.kill();
    let _ = child.wait();
}
fn runs(exe: &std::ffi::OsStr, arg: &str) -> bool {
    command(exe)
        .arg(arg)
        .output()
        .is_ok_and(|o| o.status.success())
}
fn video_tool_check(exe: &std::ffi::OsStr) -> Result<(), String> {
    match command(exe).arg("-version").output() {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(format!(
            "{} -version failed ({}): {}",
            exe.to_string_lossy(),
            output.status,
            String::from_utf8_lossy(&output.stderr)
                .trim()
                .chars()
                .take(600)
                .collect::<String>()
        )),
        Err(error) => Err(format!(
            "Could not start {}: {error}",
            exe.to_string_lossy()
        )),
    }
}
fn lists_dav1d(decoders: &str) -> bool {
    decoders
        .lines()
        .any(|line| line.split_whitespace().nth(1) == Some("libdav1d"))
}
pub(crate) fn has_dav1d(exe: &std::ffi::OsStr) -> bool {
    command(exe)
        .args(["-hide_banner", "-decoders"])
        .output()
        .is_ok_and(|o| o.status.success() && lists_dav1d(&String::from_utf8_lossy(&o.stdout)))
}
fn verify(path: &Path, expected: &str) -> Result<(), String> {
    let mut input = File::open(path).map_err(|e| e.to_string())?;
    let mut sha = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        sha.update(&buffer[..n]);
    }
    if format!("{:x}", sha.finalize()) != expected {
        return Err("Tool download checksum mismatch; please retry".into());
    }
    Ok(())
}
fn download(
    asset: &Asset,
    dir: &Path,
    name: &str,
    cancel: Option<&AtomicBool>,
) -> Result<PathBuf, String> {
    check_cancel(cancel)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let archive = dir.join("download");
    // Per process, so a second FireCrackle window cannot truncate or delete this download.
    let partial = dir.join(format!("download.{}.part", std::process::id()));
    if archive.is_file() && verify(&archive, &asset.sha256).is_ok() {
        return Ok(archive);
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(1800))
        .user_agent(concat!("FireCrackle/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(&asset.url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Could not download {name}: {e}"))?;
    let total = response.content_length();
    progress(name, 0, total);
    let result = (|| {
        let mut output = File::create(&partial).map_err(|e| e.to_string())?;
        let mut done = 0;
        let mut buffer = [0; 65536];
        loop {
            check_cancel(cancel)?;
            let n = response.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            done += n as u64;
            progress(name, done, total);
        }
        output.sync_all().map_err(|e| e.to_string())?;
        verify(&partial, &asset.sha256)?;
        if archive.exists() {
            fs::remove_file(&archive).map_err(|e| e.to_string())?;
        }
        fs::rename(&partial, &archive).map_err(|e| e.to_string())?;
        Ok(archive.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_file(partial);
    }
    result
}
fn extract_zip(archive: &Path, dir: &Path, executables: &[&str]) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(File::open(archive).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(path) = entry.enclosed_name() else {
            return Err("Unsafe tool archive path".into());
        };
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let upper = name.to_ascii_uppercase();
        if !executables.contains(&name)
            && !upper.starts_with("LICENSE")
            && !upper.starts_with("COPYING")
            && !upper.starts_with("README")
        {
            continue;
        }
        if entry.is_dir() {
            continue;
        }
        let target = dir.join(name);
        let mut output = File::create(&target).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        if executables.contains(&name) {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&target, fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
fn asset_cache_name(name: &str, asset: &Asset) -> String {
    // A new build must not overwrite tools still used by another running app.
    if name == "ffmpeg" {
        format!("{name}-{}-{}", asset.version, asset.sha256)
    } else {
        format!("{name}-{}", asset.version)
    }
}

fn selected_archive_members(
    list: &str,
    executables: &[&str],
) -> Result<Vec<(String, String)>, String> {
    let mut selected = BTreeMap::new();
    for member in list.lines() {
        if member.ends_with('/') {
            continue;
        }
        let path = Path::new(member);
        if !path
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
        {
            return Err("Unsafe tool archive path".into());
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let upper = name.to_ascii_uppercase();
        if (executables.contains(&name)
            || upper.starts_with("LICENSE")
            || upper.starts_with("COPYING")
            || upper.starts_with("README"))
            && selected
                .insert(name.to_owned(), member.to_owned())
                .is_some()
        {
            return Err(format!("Duplicate tool archive member: {name}"));
        }
    }
    if !executables.iter().all(|name| selected.contains_key(*name)) {
        return Err("Tool archive is missing its executable".into());
    }
    Ok(selected.into_iter().collect())
}

fn extract_7z(archive: &Path, dir: &Path, executables: &[&str]) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Windows' bundled libarchive tar reads 7z. Stream only selected members
        // into files we create: archive paths never control filesystem extraction.
        let tar =
            PathBuf::from(std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?)
                .join("System32/tar.exe");
        let listing = command(&tar)
            .arg("-tf")
            .arg(archive)
            .output()
            .map_err(|e| e.to_string())?;
        if !listing.status.success() {
            return Err(format!(
                "Could not read FFmpeg archive: {}",
                String::from_utf8_lossy(&listing.stderr)
            ));
        }
        let members = selected_archive_members(
            std::str::from_utf8(&listing.stdout).map_err(|e| e.to_string())?,
            executables,
        )?;
        for (name, member) in members {
            let output = File::create(dir.join(name)).map_err(|e| e.to_string())?;
            let result = command(&tar)
                .arg("-xOf")
                .arg(archive)
                .arg("--")
                .arg(member)
                .stdout(output)
                .output()
                .map_err(|e| e.to_string())?;
            if !result.status.success() {
                return Err(format!(
                    "Could not unpack FFmpeg: {}",
                    String::from_utf8_lossy(&result.stderr)
                ));
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (archive, dir, executables);
        Err("7z runtime installation is only used on Windows".into())
    }
}

fn install(
    name: &str,
    asset: &Asset,
    executables: &[&str],
    cancel: Option<&AtomicBool>,
) -> Result<PathBuf, String> {
    check_cancel(cancel)?;
    let dir = root()?.join(asset_cache_name(name, asset));
    // Reuse only a completed installation of the exact pinned archive.
    if fs::read_to_string(dir.join("ready")).is_ok_and(|sha| sha == asset.sha256)
        && executables.iter().all(|n| dir.join(n).is_file())
    {
        return Ok(dir);
    }
    let _clear = ClearStatus;
    progress(name, 0, None);
    let archive = download(asset, &dir, name, cancel)?;
    check_cancel(cancel)?;
    if asset.kind == "zip" {
        extract_zip(&archive, &dir, executables)?;
    } else if asset.kind == "7z" {
        extract_7z(&archive, &dir, executables)?;
    } else {
        fs::copy(&archive, dir.join(executables[0])).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir.join(executables[0]), fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }
    }
    if !executables.iter().all(|n| dir.join(n).is_file()) {
        return Err(format!("{name} archive is missing its executable"));
    }
    fs::write(
        dir.join("THIRD_PARTY_NOTICES.txt"),
        include_str!("../../../THIRD_PARTY_NOTICES.md"),
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        dir.join("SOURCE.txt"),
        format!("{}\nSHA256 {}\n", asset.url, asset.sha256),
    )
    .map_err(|e| e.to_string())?;
    fs::write(dir.join("ready"), &asset.sha256).map_err(|e| e.to_string())?;
    // Keep the installed tools and notices, not a second copy of the archive.
    let _ = fs::remove_file(archive);
    Ok(dir)
}
pub fn video_tools() -> Result<Tools, String> {
    video_tools_cancellable(None)
}
pub fn video_tools_cancellable(cancel: Option<&AtomicBool>) -> Result<Tools, String> {
    check_cancel(cancel)?;
    if let Some(tools) = VIDEO.get() {
        return Ok(tools.clone());
    }
    let _lock = INSTALL.lock().map_err(|_| "Tool setup unavailable")?;
    if let Some(tools) = VIDEO.get() {
        return Ok(tools.clone());
    }
    let tools = Tools::default();
    let checks = [
        video_tool_check(&tools.ffmpeg),
        video_tool_check(&tools.ffprobe),
    ];
    // Older portable Windows builds carry essentials beside the app. Do not
    // let that valid-but-slow AV1 decoder bypass the upgraded runtime cache.
    if checks.iter().all(Result::is_ok) && (!cfg!(windows) || has_dav1d(&tools.ffmpeg)) {
        // Linux uses the distribution's FFmpeg, which we cannot replace: only say so.
        if !cfg!(windows) && !has_dav1d(&tools.ffmpeg) {
            eprintln!(
                "FireCrackle: this FFmpeg has no libdav1d, so AV1 videos decode with a slower decoder. Install an FFmpeg build with libdav1d for faster AV1 scans."
            );
        }
        let _ = VIDEO.set(tools.clone());
        return Ok(tools);
    }
    #[cfg(windows)]
    {
        #[derive(Deserialize)]
        struct Lock {
            url: String,
            sha256: String,
            version: String,
            kind: String,
        }
        let lock: Lock = serde_json::from_str(include_str!("../../release/runtime-lock.json"))
            .map_err(|e| e.to_string())?;
        let asset = Asset {
            url: lock.url,
            sha256: lock.sha256,
            version: lock.version,
            kind: lock.kind,
        };
        let dir = install("ffmpeg", &asset, &["ffmpeg.exe", "ffprobe.exe"], cancel)?;
        let tools = Tools {
            ffmpeg: dir.join("ffmpeg.exe").into_os_string(),
            ffprobe: dir.join("ffprobe.exe").into_os_string(),
        };
        if !runs(&tools.ffmpeg, "-version")
            || !runs(&tools.ffprobe, "-version")
            || !has_dav1d(&tools.ffmpeg)
        {
            let _ = fs::remove_file(dir.join("ready"));
            return Err("Downloaded FFmpeg could not start".into());
        }
        let _ = VIDEO.set(tools.clone());
        Ok(tools)
    }
    #[cfg(not(windows))]
    {
        let details = checks
            .into_iter()
            .filter_map(Result::err)
            .collect::<Vec<_>>()
            .join("\n");
        Err(format!(
            "FFmpeg/ffprobe are unavailable.\n{details}\nInstall both with your system package manager, then restart FireCrackle. Fedora: sudo dnf install ffmpeg-free. Debian/Ubuntu: sudo apt install ffmpeg. If already installed, run ffmpeg -version and ffprobe -version in a terminal to check for missing libraries."
        ))
    }
}
pub fn link_tools(cancel: Option<&AtomicBool>) -> Result<(PathBuf, PathBuf), String> {
    if !cfg!(target_arch = "x86_64") {
        return Err("Online video downloads currently support x64 Windows and Linux.".into());
    }
    let _lock = INSTALL.lock().map_err(|_| "Tool setup unavailable")?;
    let manifest: BTreeMap<String, BTreeMap<String, Asset>> =
        serde_json::from_str(include_str!("../../release/download-tools.json"))
            .map_err(|e| e.to_string())?;
    let platform = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        return Err("Online video downloads support Windows and Linux.".into());
    };
    let suffix = std::env::consts::EXE_SUFFIX;
    let yname = format!("yt-dlp{suffix}");
    let dname = format!("deno{suffix}");
    let assets = &manifest[platform];
    let yt = install("yt-dlp", &assets["yt-dlp"], &[&yname], cancel)?;
    let deno = install("deno", &assets["deno"], &[&dname], cancel)?;
    Ok((yt.join(yname), deno.join(dname)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decoder_list_with_dav1d_is_recognised() {
        let list = "Decoders:\n V....D av1                  Alliance for Open Media AV1\n V....D libdav1d             dav1d AV1 decoder by VideoLAN (codec av1)\n V....D libaom-av1           libaom AV1 (codec av1)\n";
        assert!(lists_dav1d(list));
    }
    #[test]
    fn decoder_list_without_dav1d_is_rejected() {
        // essentials-style: libaom only, and a description that merely mentions dav1d.
        let list = "Decoders:\n V....D libaom-av1           libaom AV1 (codec av1)\n V....D av1                  slower than libdav1d without it\n";
        assert!(!lists_dav1d(list));
        assert!(!lists_dav1d(""));
        assert!(!lists_dav1d("libdav1d"));
        assert!(!lists_dav1d(" V....D libdav1d_extra   something else\n"));
    }
    #[test]
    fn manifest_has_verified_https_downloads() {
        let manifest: BTreeMap<String, BTreeMap<String, Asset>> =
            serde_json::from_str(include_str!("../../release/download-tools.json")).unwrap();
        for assets in manifest.values() {
            for a in assets.values() {
                assert!(a.url.starts_with("https://github.com/"));
                assert_eq!(a.sha256.len(), 64);
                assert!(a.sha256.bytes().all(|c| c.is_ascii_hexdigit()));
            }
        }
    }
    #[test]
    fn refuses_bad_checksum() {
        let path = std::env::temp_dir().join(format!("firecrackle-hash-{}", std::process::id()));
        fs::write(&path, b"abc").unwrap();
        assert!(
            verify(
                &path,
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            )
            .is_ok()
        );
        assert!(verify(&path, &"0".repeat(64)).is_err());
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn runtime_builds_have_separate_cache_directories() {
        let mut asset = Asset {
            url: String::new(),
            sha256: "a".repeat(64),
            kind: "7z".into(),
            version: "8.1.2".into(),
        };
        let previous = asset_cache_name("ffmpeg", &asset);
        asset.sha256 = "b".repeat(64);
        assert_ne!(previous, asset_cache_name("ffmpeg", &asset));
    }
    #[test]
    fn archive_selection_requires_unique_safe_tools_and_preserves_notices() {
        let required = ["ffmpeg.exe", "ffprobe.exe"];
        let valid = "vendor/\nvendor/bin/ffmpeg.exe\nvendor/bin/ffprobe.exe\nvendor/LICENSE\nvendor/README.txt\nvendor/doc/large.html\n";
        let members = selected_archive_members(valid, &required).unwrap();
        assert_eq!(members.len(), 4);
        assert!(members.iter().any(|(n, _)| n == "LICENSE"));
        for bad in [
            "../ffmpeg.exe\nffprobe.exe",
            "/ffmpeg.exe\nffprobe.exe",
            "ffmpeg.exe",
            "a/ffmpeg.exe\nb/ffmpeg.exe\nffprobe.exe",
        ] {
            assert!(selected_archive_members(bad, &required).is_err(), "{bad}");
        }
    }
    #[test]
    #[cfg(windows)]
    #[ignore = "Requires the checksum-verified pinned FFmpeg archive in the local release cache"]
    fn unpack_pinned_runtime_and_check_dav1d() {
        let asset: Asset =
            serde_json::from_str(include_str!("../../release/runtime-lock.json")).unwrap();
        let cache = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.release-cache");
        let archive = cache.join(format!(
            "{}.{}",
            asset_cache_name("ffmpeg", &asset),
            asset.kind
        ));
        verify(&archive, &asset.sha256).unwrap();
        let dir = cache.join(format!("extract-check-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        extract_7z(&archive, &dir, &["ffmpeg.exe", "ffprobe.exe"]).unwrap();
        assert!(dir.join("LICENSE").is_file());
        assert!(dir.join("README.txt").is_file());
        let output = command(dir.join("ffmpeg.exe"))
            .args(["-hide_banner", "-decoders"])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("libdav1d"));
        assert!(runs(dir.join("ffprobe.exe").as_os_str(), "-version"));
    }
    #[test]
    fn cancelled_setup_does_not_download() {
        let cancelled = AtomicBool::new(true);
        assert!(check_cancel(Some(&cancelled)).is_err());
    }
    #[test]
    fn missing_video_tool_reports_the_executable_and_launch_error() {
        let missing = std::env::temp_dir().join(format!(
            "firecrackle-missing-ffprobe-{}-never-created",
            std::process::id()
        ));
        let error = video_tool_check(missing.as_os_str()).unwrap_err();
        assert!(error.contains("Could not start"));
        assert!(error.contains("firecrackle-missing-ffprobe"));
    }
    #[test]
    #[ignore = "Downloads official executables; run explicitly with network access"]
    fn download_and_run_pinned_tools() {
        configure(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.release-cache/link-tools-smoke"),
        );
        let (yt, deno) = link_tools(None).unwrap();
        assert!(runs(yt.as_os_str(), "--version"));
        assert!(runs(deno.as_os_str(), "--version"));
        let again = link_tools(None).unwrap();
        assert_eq!(again, (yt, deno));
        #[cfg(windows)]
        {
            let asset: serde_json::Value =
                serde_json::from_str(include_str!("../../release/runtime-lock.json")).unwrap();
            let asset = Asset {
                url: asset["url"].as_str().unwrap().into(),
                sha256: asset["sha256"].as_str().unwrap().into(),
                version: asset["version"].as_str().unwrap().into(),
                kind: asset["kind"].as_str().unwrap().into(),
            };
            let dir = root().unwrap().join(asset_cache_name("ffmpeg", &asset));
            fs::create_dir_all(&dir).unwrap();
            let existing = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!(
                "../.release-cache/{}.{}",
                asset_cache_name("ffmpeg", &asset),
                asset.kind
            ));
            if existing.is_file() && !dir.join("ready").is_file() {
                fs::copy(existing, dir.join("download")).unwrap();
            }
            let dir = install("ffmpeg", &asset, &["ffmpeg.exe", "ffprobe.exe"], None).unwrap();
            assert!(runs(dir.join("ffmpeg.exe").as_os_str(), "-version"));
            assert!(runs(dir.join("ffprobe.exe").as_os_str(), "-version"));
            assert!(dir.join("LICENSE").is_file());
            assert!(dir.join("SOURCE.txt").is_file());
        }
        // Exercise the actual downloader against a small video we own, then open it as a workspace.
        let video = video_tools().unwrap();
        let fixture = root().unwrap().join("smoke.mp4");
        assert!(
            command(&video.ffmpeg)
                .args([
                    "-v",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=orange:s=64x64:r=10",
                    "-t",
                    "0.3",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p"
                ])
                .arg(&fixture)
                .status()
                .unwrap()
                .success()
        );
        let bytes = fs::read(&fixture).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let server = std::thread::spawn(move || {
            while !stopping.load(Ordering::Relaxed) {
                if let Ok((mut socket, _)) = listener.accept() {
                    let _ = socket.set_nonblocking(false);
                    let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));
                    let mut req = [0; 8192];
                    let mut n = 0;
                    while n < req.len() && !req[..n].windows(4).any(|p| p == b"\r\n\r\n") {
                        let read = socket.read(&mut req[n..]).unwrap_or(0);
                        if read == 0 {
                            break;
                        }
                        n += read;
                    }
                    let head = req[..n].starts_with(b"HEAD ");
                    let headers = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        bytes.len()
                    );
                    let _ = socket.write_all(headers.as_bytes());
                    if !head {
                        let _ = socket.write_all(&bytes);
                    }
                } else {
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
        });
        let jobs = crate::url_import::Jobs::default();
        let state = jobs
            .start(
                format!("http://{address}/smoke.mp4"),
                root().unwrap().to_path_buf(),
            )
            .unwrap();
        assert!(
            jobs.start(
                format!("http://{address}/smoke.mp4"),
                root().unwrap().to_path_buf()
            )
            .is_err()
        );
        let until = std::time::Instant::now() + Duration::from_secs(45);
        let result = loop {
            let s = jobs.status().unwrap().unwrap();
            if s.state != "running" || std::time::Instant::now() > until {
                break s;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        stop.store(true, Ordering::Relaxed);
        server.join().unwrap();
        if result.state == "running" {
            jobs.cancel(state.id).unwrap();
        }
        assert_eq!(result.state, "done", "{:?}", result.error);
        let mut workspace = studio_core::workspace::Workspace::open(
            &video,
            Path::new(result.path.as_ref().unwrap()),
            &studio_core::config::Settings::default(),
        )
        .unwrap();
        assert_eq!(workspace.view().frame_count, 3);
        workspace.wait_idle();
    }
}
