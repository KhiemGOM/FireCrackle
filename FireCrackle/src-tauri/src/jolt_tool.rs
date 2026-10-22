//! Splosh's JoltCracker (https://splosh.icu/jolt, MIT), integrated with his permission: find a copy on this PC or
//! download the newest release, then run it on the open video and import its result as the Jolt clock.
use crate::external_tools;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use studio_core::import::Tools;

pub(crate) const EXE: &str = if cfg!(windows) { "jolt.exe" } else { "jolt" };
const PAGE: &str = "https://splosh.icu/jolt";
const MAX_DOWNLOAD: u64 = 64 * 1024 * 1024;
const MAX_RESULT: u64 = 32 * 1024 * 1024;

fn download_url() -> &'static str {
    if cfg!(windows) {
        "https://splosh.icu/jolt/download"
    } else if cfg!(target_os = "macos") {
        "https://splosh.icu/jolt/download?file=mac"
    } else {
        "https://splosh.icu/jolt/download?file=linux"
    }
}

fn version_after(text: &str, marker: &str) -> Option<(u32, u32)> {
    let rest = &text[text.find(marker)? + marker.len()..];
    let digits = |s: &str| -> Option<(u32, usize)> {
        let n = s.chars().take_while(char::is_ascii_digit).count();
        Some((s[..n].parse().ok()?, n))
    };
    let (major, used) = digits(rest)?;
    let minor = rest[used..]
        .strip_prefix('.')
        .and_then(digits)
        .map_or(0, |(m, _)| m);
    Some((major, minor))
}

/// The version from `jolt --version` ("Jolt v2.5"); anything else is not Jolt.
pub fn parse_version(text: &str) -> Option<(u32, u32)> {
    version_after(text, "Jolt v")
}

/// The newest release's version from the download's file name (`attachment; filename="jolt-v2.5.zip"`).
pub fn disposition_version(header: &str) -> Option<(u32, u32)> {
    version_after(header, "jolt-v")
}

/// The SHA-256 the download page publishes for `jolt.exe` (the first one after that name, else the only one).
pub fn page_sha256(html: &str) -> Option<String> {
    let text = html.to_ascii_lowercase();
    let hashes = |from: usize| {
        let bytes = text.as_bytes();
        let mut found = Vec::new();
        let mut i = from;
        while i + 64 <= bytes.len() {
            let run = bytes[i..]
                .iter()
                .take_while(|b| b.is_ascii_hexdigit())
                .count();
            if run == 64 && (i == 0 || !bytes[i - 1].is_ascii_hexdigit()) {
                found.push(text[i..i + 64].to_string());
            }
            i += run.max(1);
        }
        found
    };
    text.find("jolt.exe")
        .and_then(|at| hashes(at).into_iter().next())
        .or_else(|| hashes(0).into_iter().next())
}

pub struct Found {
    pub path: PathBuf,
    pub version: (u32, u32),
}

/// The newest of `candidates` that answers as Jolt.
pub fn newest(
    candidates: impl IntoIterator<Item = PathBuf>,
    probe: impl Fn(&Path) -> Option<(u32, u32)>,
) -> Option<Found> {
    candidates
        .into_iter()
        .filter_map(|path| probe(&path).map(|version| Found { path, version }))
        .max_by_key(|f| f.version)
}

/// The Jolt executable inside a release zip, checked against the published SHA-256 when there is one.
pub fn executable_from_zip(archive: &[u8], expected: Option<&str>) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive))
        .map_err(|e| format!("The JoltCracker download is not a valid zip: {e}"))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(path) = entry.enclosed_name() else {
            continue; // never follow a path that leaves the archive
        };
        if entry.is_dir() || path.file_name().and_then(|n| n.to_str()) != Some(EXE) {
            continue;
        }
        let mut bytes = Vec::new();
        entry
            .by_ref()
            .take(MAX_DOWNLOAD)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if let Some(expected) = expected
            && format!("{:x}", Sha256::digest(&bytes)) != expected.to_ascii_lowercase()
        {
            return Err(
                "The downloaded JoltCracker does not match the checksum published on splosh.icu; nothing was installed."
                    .into(),
            );
        }
        return Ok(bytes);
    }
    Err(format!("The JoltCracker download has no {EXE}."))
}

/// Arguments for a scan of `video` whose report and raw result land in the video's project folder.
pub fn run_args(video: &Path, project_dir: &Path) -> Vec<String> {
    vec![
        video.to_string_lossy().into_owned(),
        "--json".into(),
        project_dir
            .join("jolt.result.json")
            .to_string_lossy()
            .into_owned(),
        "--html".into(),
        project_dir
            .join("jolt.report.html")
            .to_string_lossy()
            .into_owned(),
    ]
}

/// What Jolt last said while scanning, and how far through the frames it is.
#[derive(Default)]
struct Progress {
    lines: VecDeque<String>,
    percent: Option<u8>,
}

impl Progress {
    fn line(&mut self, raw: &str) {
        let line = raw.trim();
        if line.is_empty() {
            return;
        }
        if let Some(n) = line.strip_suffix('%').and_then(|n| n.parse::<u8>().ok()) {
            self.percent = Some(self.percent.map_or(n, |p| p.max(n)).min(100));
            return;
        }
        if line.contains(" is decoding too") || line.starts_with("decoded by") {
            return; // which graphics cards help: detail, not progress
        }
        self.lines.push_back(line.chars().take(300).collect());
        if self.lines.len() > 8 {
            self.lines.pop_front();
        }
    }
    fn message(&self) -> String {
        self.lines.back().cloned().unwrap_or_default()
    }
    fn tail(&self) -> String {
        self.lines.iter().cloned().collect::<Vec<_>>().join("\n")
    }
}

/// Jolt's own explanation of a failed run, with its error code (`J07`) kept for looking up in its guide.
fn failure_message(code: Option<i32>, stderr: &str) -> String {
    let Some(code) = code else {
        return "JoltCracker was stopped.".into();
    };
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let error_code = lines
        .iter()
        .rev()
        .find(|l| l.len() <= 6 && l.starts_with('J') && l[1..].chars().all(|c| c.is_ascii_digit()));
    let words: Vec<&str> = lines
        .iter()
        .copied()
        .filter(|l| Some(l) != error_code)
        .collect();
    if words.is_empty() {
        return format!("JoltCracker stopped (exit code {code}) without saying why.");
    }
    let mut message = words.join(" ");
    if let Some(e) = error_code {
        message.push_str(&format!(" (Jolt error {e})"));
    }
    message
}

fn probe(path: &Path) -> Option<(u32, u32)> {
    let mut child = external_tools::command(path)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut out = child.stdout.take()?;
    // A file that is not Jolt might never exit; give it five seconds.
    for _ in 0..50 {
        if child.try_wait().ok()?.is_some() {
            let mut text = String::new();
            out.read_to_string(&mut text).ok()?;
            return parse_version(&text);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    external_tools::kill_tree(&mut child);
    None
}

/// Copies FireCrackle downloaded, Jolt on PATH, and the usual places a downloaded Jolt is kept.
fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut dir_and_children = |dir: PathBuf| {
        out.push(dir.join(EXE));
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|t| t.is_dir()) {
                    out.push(entry.path().join(EXE));
                }
            }
        }
    };
    if let Ok(root) = external_tools::root() {
        dir_and_children(root.join("jolt"));
    }
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        for place in ["Downloads", "Desktop"] {
            dir_and_children(home.join(place));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        out.extend(std::env::split_paths(&path).map(|d| d.join(EXE)));
    }
    out.retain(|p| p.is_file());
    out.dedup();
    out
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .user_agent(concat!("FireCrackle/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// The newest JoltCracker: a copy already on this PC when it is the latest release (or splosh.icu is unreachable),
/// otherwise the latest release downloaded once into FireCrackle's tool folder.
fn ensure_latest(cancel: &AtomicBool) -> Result<Found, String> {
    let local = newest(candidates(), probe);
    let client = client()?;
    let latest = client.head(download_url()).send().ok().and_then(|r| {
        r.headers()
            .get(reqwest::header::CONTENT_DISPOSITION)?
            .to_str()
            .ok()
            .and_then(disposition_version)
    });
    match (local, latest) {
        (Some(found), Some(latest)) if found.version >= latest => return Ok(found),
        (Some(found), None) => return Ok(found), // offline: use what is here
        (None, None) => {
            return Err(
                "JoltCracker is not on this PC and splosh.icu could not be reached to download it."
                    .into(),
            );
        }
        _ => {}
    }
    let latest = latest.expect("handled above");
    let _clear = external_tools::ClearStatus;
    external_tools::progress("JoltCracker", 0, None);
    let expected = if cfg!(windows) {
        client
            .get(PAGE)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.text())
            .ok()
            .as_deref()
            .and_then(page_sha256)
    } else {
        None // splosh.icu publishes a checksum for the Windows build only
    };
    if cfg!(windows) && expected.is_none() {
        return Err("splosh.icu did not show JoltCracker's checksum, so the download could not be verified.".into());
    }
    let mut response = client
        .get(download_url())
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Could not download JoltCracker: {e}"))?;
    let total = response.content_length();
    if total.is_some_and(|n| n > MAX_DOWNLOAD) {
        return Err(
            "The JoltCracker download is unexpectedly large; nothing was installed.".into(),
        );
    }
    let mut archive = Vec::new();
    let mut buffer = [0; 65536];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        let n = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        archive.extend_from_slice(&buffer[..n]);
        if archive.len() as u64 > MAX_DOWNLOAD {
            return Err(
                "The JoltCracker download is unexpectedly large; nothing was installed.".into(),
            );
        }
        external_tools::progress("JoltCracker", archive.len() as u64, total);
    }
    let exe = executable_from_zip(&archive, expected.as_deref())?;
    let dir = external_tools::root()?
        .join("jolt")
        .join(format!("v{}.{}", latest.0, latest.1));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(EXE);
    studio_core::fsutil::write_atomic(&path, &exe).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    let version = probe(&path).ok_or("The downloaded JoltCracker did not start on this PC.")?;
    Ok(Found { path, version })
}

#[derive(Clone, Serialize)]
pub struct Status {
    pub id: u64,
    pub video_path: String,
    /// preparing (finding or downloading Jolt) · running · done · failed · cancelled
    pub state: String,
    pub message: String,
    pub percent: Option<u8>,
    pub version: Option<String>,
    /// Jolt's JSON result when done; the app imports it as this video's Jolt clock.
    pub result: Option<String>,
    pub error: Option<String>,
}

struct Job {
    status: Status,
    cancel: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

#[derive(Clone, Default)]
pub struct Jobs {
    current: Arc<Mutex<Option<Job>>>,
    next: Arc<AtomicU64>,
}

impl Jobs {
    pub fn status(&self) -> Result<Option<Status>, String> {
        Ok(self
            .current
            .lock()
            .map_err(|_| "JoltCracker state unavailable")?
            .as_ref()
            .map(|j| j.status.clone()))
    }
    pub fn cancel(&self, id: u64) -> Result<(), String> {
        let state = self
            .current
            .lock()
            .map_err(|_| "JoltCracker state unavailable")?;
        if let Some(job) = state.as_ref().filter(|j| j.status.id == id) {
            job.cancel.store(true, Ordering::Relaxed);
            if let Ok(mut child) = job.child.lock()
                && let Some(child) = child.as_mut()
            {
                external_tools::kill_tree(child);
            }
        }
        Ok(())
    }
    /// Stop a running scan (another video opened, or exit).
    pub fn shutdown(&self) {
        let id = self
            .status()
            .ok()
            .flatten()
            .filter(|s| matches!(s.state.as_str(), "preparing" | "running"))
            .map(|s| s.id);
        if let Some(id) = id {
            let _ = self.cancel(id);
        }
    }
    fn update(&self, id: u64, f: impl FnOnce(&mut Status)) {
        if let Ok(mut state) = self.current.lock()
            && let Some(job) = state.as_mut().filter(|j| j.status.id == id)
        {
            f(&mut job.status);
        }
    }
    pub fn start(
        &self,
        video: PathBuf,
        project_dir: PathBuf,
        tools: Tools,
    ) -> Result<Status, String> {
        let mut state = self
            .current
            .lock()
            .map_err(|_| "JoltCracker state unavailable")?;
        if state
            .as_ref()
            .is_some_and(|j| matches!(j.status.state.as_str(), "preparing" | "running"))
        {
            return Err("JoltCracker is already running".into());
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let status = Status {
            id,
            video_path: video.to_string_lossy().into_owned(),
            state: "preparing".into(),
            message: "Finding JoltCracker…".into(),
            percent: None,
            version: None,
            result: None,
            error: None,
        };
        let cancel = Arc::new(AtomicBool::new(false));
        let child = Arc::new(Mutex::new(None));
        *state = Some(Job {
            status: status.clone(),
            cancel: cancel.clone(),
            child: child.clone(),
        });
        drop(state);
        let jobs = self.clone();
        std::thread::spawn(move || {
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                run(&jobs, id, &video, &project_dir, &tools, &cancel, &child)
            }))
            .unwrap_or_else(|_| Err("JoltCracker integration failed".into()));
            let cancelled = cancel.load(Ordering::Relaxed);
            jobs.update(id, |s| match outcome {
                _ if cancelled => {
                    s.state = "cancelled".into();
                    s.message = "Stopped".into();
                }
                Ok(result) => {
                    s.state = "done".into();
                    s.message = "Finished".into();
                    s.percent = Some(100);
                    s.result = Some(result);
                }
                Err(error) => {
                    s.state = "failed".into();
                    s.error = Some(error);
                }
            });
        });
        Ok(status)
    }
}

fn run(
    jobs: &Jobs,
    id: u64,
    video: &Path,
    project_dir: &Path,
    tools: &Tools,
    cancel: &AtomicBool,
    slot: &Mutex<Option<Child>>,
) -> Result<String, String> {
    let found = ensure_latest(cancel)?;
    let version = format!("{}.{}", found.version.0, found.version.1);
    jobs.update(id, |s| {
        s.state = "running".into();
        s.version = Some(version.clone());
        s.message = format!("JoltCracker v{version} is starting");
    });
    std::fs::create_dir_all(project_dir).map_err(|e| e.to_string())?;
    let result = project_dir.join("jolt.result.json");
    let _ = std::fs::remove_file(&result);
    let mut command = external_tools::command(&found.path);
    command.args(run_args(video, project_dir));
    // Jolt finds FFmpeg on PATH: give it the same verified build FireCrackle decodes with.
    if let Some(dir) = Path::new(&tools.ffmpeg).parent() {
        let mut paths = vec![dir.to_path_buf()];
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        if let Ok(joined) = std::env::join_paths(paths) {
            command.env("PATH", joined);
        }
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut process = command
        .spawn()
        .map_err(|e| format!("Could not start JoltCracker: {e}"))?;
    let stdout = process.stdout.take().ok_or("JoltCracker output missing")?;
    let stderr = process.stderr.take().ok_or("JoltCracker errors missing")?;
    *slot.lock().map_err(|_| "JoltCracker state unavailable")? = Some(process);
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = BufReader::new(stderr)
            .take(1 << 20)
            .read_to_string(&mut text);
        text
    });
    let mut progress = Progress::default();
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        progress.line(&line);
        let (message, percent) = (progress.message(), progress.percent);
        jobs.update(id, |s| {
            s.message = message;
            s.percent = percent;
        });
    }
    let code = {
        let mut slot = slot.lock().map_err(|_| "JoltCracker state unavailable")?;
        let status = slot
            .as_mut()
            .map(Child::wait)
            .transpose()
            .map_err(|e| e.to_string())?;
        *slot = None;
        status
    };
    let stderr = errors.join().unwrap_or_default();
    if cancel.load(Ordering::Relaxed) {
        return Err("Cancelled".into());
    }
    if !code.is_some_and(|c| c.success()) {
        let mut message = failure_message(code.and_then(|c| c.code()), &stderr);
        if !progress.tail().is_empty() && message.starts_with("JoltCracker stopped") {
            message.push_str(&format!("\n{}", progress.tail()));
        }
        return Err(message);
    }
    match std::fs::metadata(&result) {
        Ok(m) if m.len() > MAX_RESULT => Err("JoltCracker's result is too large to import.".into()),
        Ok(_) => std::fs::read_to_string(&result).map_err(|e| e.to_string()),
        Err(_) => Err("JoltCracker finished without writing its result.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// End to end against splosh.icu and a real survival recording: downloads the newest JoltCracker into a fresh
    /// tool folder (checksum-verified), scans the first minutes and returns its JSON.
    #[test]
    #[ignore = "Network and video: set JOLT_E2E_VIDEO (and FFmpeg on PATH)"]
    fn downloads_the_latest_jolt_and_scans_a_real_video() {
        let video = PathBuf::from(std::env::var("JOLT_E2E_VIDEO").unwrap());
        let root = std::env::temp_dir().join(format!("fc-jolt-e2e-{}", std::process::id()));
        external_tools::configure(root.clone());
        let found = ensure_latest(&AtomicBool::new(false)).unwrap();
        println!("using {} v{}.{}", found.path.display(), found.version.0, found.version.1);
        let jobs = Jobs::default();
        let dir = root.join("project");
        let ffmpeg = std::env::var_os("JOLT_E2E_FFMPEG").unwrap_or_else(|| "ffmpeg".into());
        let tools = Tools { ffmpeg, ffprobe: "ffprobe".into() };
        let status = jobs.start(video, dir, tools).unwrap();
        let done = loop {
            std::thread::sleep(Duration::from_millis(500));
            let s = jobs.status().unwrap().unwrap();
            if !matches!(s.state.as_str(), "preparing" | "running") {
                break s;
            }
        };
        assert_eq!(done.id, status.id);
        assert_eq!(done.state, "done", "{:?}", done.error);
        assert!(done.result.unwrap().contains("\"runs\""));
    }

    #[test]
    fn reads_the_version_jolt_reports() {
        assert_eq!(parse_version("Jolt v2.5\n"), Some((2, 5)));
        assert_eq!(parse_version("Jolt v10.12"), Some((10, 12)));
        assert_eq!(parse_version("Jolt v3"), Some((3, 0)));
        assert_eq!(parse_version("jolt.exe: command not found"), None);
        assert_eq!(
            parse_version("FFmpeg version 8.1"),
            None,
            "only Jolt's own banner counts"
        );
    }

    #[test]
    fn the_latest_version_is_read_from_the_download_file_name() {
        assert_eq!(
            disposition_version(r#"attachment; filename="jolt-v2.5.zip""#),
            Some((2, 5))
        );
        assert_eq!(
            disposition_version("attachment; filename=jolt-v2.10.zip"),
            Some((2, 10))
        );
        assert_eq!(disposition_version("inline"), None);
    }

    #[test]
    fn finds_the_published_jolt_exe_checksum_on_the_download_page() {
        let hash = "520d47e8111580a9214da9972d6e51185d0fb176ff6d25b3b86e35060a6e6e15";
        let page =
            format!("<p>Windows v2.5</p><p>SHA-256 of jolt.exe</p><code>{hash}</code><p>PDB</p>");
        assert_eq!(page_sha256(&page).as_deref(), Some(hash));
        assert_eq!(
            page_sha256(&page.to_uppercase()).as_deref(),
            Some(hash),
            "hex case does not matter"
        );
        assert_eq!(page_sha256("<p>no checksum here</p>"), None);
        assert_eq!(
            page_sha256("deadbeef jolt.exe"),
            None,
            "a short hex string is not a SHA-256"
        );
    }

    #[test]
    fn prefers_the_newest_working_copy_and_ignores_files_that_are_not_jolt() {
        let probe = |p: &Path| match p.to_str().unwrap() {
            "old" => Some((2, 3)),
            "new" => Some((2, 5)),
            _ => None,
        };
        let found = newest([PathBuf::from("broken"), "old".into(), "new".into()], probe).unwrap();
        assert_eq!((found.path, found.version), (PathBuf::from("new"), (2, 5)));
        assert!(newest([PathBuf::from("broken")], probe).is_none());
        assert!(newest(Vec::<PathBuf>::new(), probe).is_none());
    }

    fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut out);
        for (name, bytes) in files {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        out.into_inner()
    }
    fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    #[test]
    fn takes_the_executable_out_of_the_release_zip_and_checks_it() {
        let exe = b"MZ jolt binary";
        let archive = zip(&[("README.md", b"hi"), (EXE, exe)]);
        assert_eq!(executable_from_zip(&archive, Some(&sha(exe))).unwrap(), exe);
        assert_eq!(
            executable_from_zip(&archive, None).unwrap(),
            exe,
            "no published checksum: HTTPS only"
        );
        let err = executable_from_zip(&archive, Some(&sha(b"something else"))).unwrap_err();
        assert!(err.contains("checksum"), "{err}");
        assert!(executable_from_zip(&zip(&[("README.md", b"hi")]), None).is_err());
        assert!(executable_from_zip(b"not a zip", None).is_err());
        // A nested path is fine; a path escaping the archive is never used.
        let nested = zip(&[(&format!("jolt-v2.5/{EXE}"), exe)]);
        assert_eq!(executable_from_zip(&nested, None).unwrap(), exe);
        assert!(executable_from_zip(&zip(&[(&format!("../{EXE}"), exe)]), None).is_err());
    }

    #[test]
    fn runs_on_the_video_and_writes_its_result_into_the_project_folder() {
        let args = run_args(
            Path::new("D:/clips/fire run.mkv"),
            Path::new("D:/clips/fire run.mkv.firecrackle"),
        );
        assert_eq!(
            args,
            [
                "D:/clips/fire run.mkv",
                "--json",
                &Path::new("D:/clips/fire run.mkv.firecrackle")
                    .join("jolt.result.json")
                    .to_string_lossy(),
                "--html",
                &Path::new("D:/clips/fire run.mkv.firecrackle")
                    .join("jolt.report.html")
                    .to_string_lossy(),
            ]
        );
        assert!(
            !args.iter().any(|a| a == "--open"),
            "never opens a browser behind the user's back"
        );
    }

    #[test]
    fn progress_reads_jolts_percent_lines_and_keeps_them_moving_forward() {
        let mut p = Progress::default();
        assert_eq!(p.percent, None);
        p.line("reading frames\r");
        p.line("  NVIDIA GeForce RTX 4060 Laptop GPU is decoding too (cuda)");
        p.line("  40%\r");
        assert_eq!(p.percent, Some(40));
        assert_eq!(
            p.message(),
            "reading frames",
            "a bare percent is shown as the bar, not the message"
        );
        p.line("  decoded by the CPU 100%, NVIDIA GeForce RTX 4060 Laptop GPU 0%");
        assert_eq!(p.percent, Some(40), "a decoder share is not progress");
        p.line("  30%");
        assert_eq!(p.percent, Some(40), "never goes backwards");
    }

    #[test]
    fn a_failed_run_explains_itself_with_jolts_own_words_and_code() {
        let stderr = "\r\nJolt found no hunger bar in the video\r\nIt looks at 12 pictures spread over the part that is read.\r\nJ07\r\n";
        let message = failure_message(Some(1), stderr);
        assert!(
            message.starts_with("Jolt found no hunger bar in the video"),
            "{message}"
        );
        assert!(message.contains("(Jolt error J07)"), "{message}");
        assert_eq!(
            failure_message(Some(3), ""),
            "JoltCracker stopped (exit code 3) without saying why."
        );
        assert_eq!(failure_message(None, ""), "JoltCracker was stopped.");
    }

    #[test]
    fn progress_shows_the_latest_line_jolt_printed() {
        let mut p = Progress::default();
        p.line("reading 1:08 / 25:00\r");
        p.line("   ");
        assert_eq!(p.message(), "reading 1:08 / 25:00");
        p.line(&"x".repeat(5000));
        assert_eq!(p.message().len(), 300);
        p.line("error: no hunger bar found");
        assert_eq!(
            p.tail(),
            "reading 1:08 / 25:00\n".to_string()
                + &"x".repeat(300)
                + "\nerror: no hunger bar found"
        );
    }
}
