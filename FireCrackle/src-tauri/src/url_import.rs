use crate::external_tools;
use serde::Serialize;
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize)]
pub struct Status {
    pub id: u64,
    pub state: String,
    pub message: String,
    pub path: Option<String>,
    pub error: Option<String>,
}
#[derive(Clone, Default)]
pub struct Jobs {
    inner: Arc<Mutex<Option<Job>>>,
}
type Job = (Status, Arc<AtomicBool>);
static NEXT: AtomicU64 = AtomicU64::new(1);

fn validate_url(url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url.trim())
        .map_err(|_| "Paste a full http:// or https:// video link")?;
    if !matches!(parsed.scheme(), "https" | "http")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Use an http:// or https:// video link without embedded login details".into());
    }
    Ok(parsed.to_string())
}
/// canonicalize() gives verbatim \\?\ paths on Windows; Python/FFmpeg handle the ordinary form more reliably.
fn plain_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path
}
impl Jobs {
    pub fn status(&self) -> Result<Option<Status>, String> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| "Download unavailable")?
            .as_ref()
            .map(|(s, _)| s.clone()))
    }
    fn message(&self, id: u64, message: String) {
        if let Ok(mut guard) = self.inner.lock()
            && let Some((s, _)) = guard.as_mut()
            && s.id == id
        {
            s.message = message;
        }
    }
    pub fn cancel(&self, id: u64) -> Result<(), String> {
        let guard = self.inner.lock().map_err(|_| "Download unavailable")?;
        if let Some((s, c)) = guard.as_ref()
            && s.id == id
        {
            c.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
    /// The hidden yt-dlp child would outlive the app, so cancel it on exit and give the worker time to kill it.
    pub fn shutdown(&self) {
        let running = |s: &Status| s.state == "running";
        let Some(id) = self.status().ok().flatten().filter(running).map(|s| s.id) else {
            return;
        };
        let _ = self.cancel(id);
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline
            && self
                .status()
                .ok()
                .flatten()
                .is_some_and(|s| s.id == id && running(&s))
        {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    pub fn start(&self, url: String, folder: PathBuf) -> Result<Status, String> {
        let url = validate_url(&url)?;
        let folder = folder
            .canonicalize()
            .map_err(|_| "Choose an existing download folder")?;
        let folder = plain_path(folder);
        if !folder.is_dir() {
            return Err("Choose an existing download folder".into());
        }
        let mut guard = self.inner.lock().map_err(|_| "Download unavailable")?;
        if guard.as_ref().is_some_and(|(s, _)| s.state == "running") {
            return Err("A video download is already running".into());
        }
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        let cancel = Arc::new(AtomicBool::new(false));
        let status = Status {
            id,
            state: "running".into(),
            message: "Preparing video tools…".into(),
            path: None,
            error: None,
        };
        *guard = Some((status.clone(), cancel.clone()));
        drop(guard);
        let jobs = self.clone();
        std::thread::spawn(move || {
            let result = jobs.download(id, &url, &folder, &cancel);
            if let Ok(mut guard) = jobs.inner.lock()
                && let Some((s, _)) = guard.as_mut()
                && s.id == id
            {
                match result {
                    Ok(path) => {
                        s.state = "done".into();
                        s.message = "Video downloaded".into();
                        s.path = Some(path.to_string_lossy().into_owned());
                    }
                    Err(e) => {
                        s.state = if cancel.load(Ordering::Relaxed) {
                            "cancelled"
                        } else {
                            "failed"
                        }
                        .into();
                        s.message = if s.state == "cancelled" {
                            "Download cancelled"
                        } else {
                            "Download failed"
                        }
                        .into();
                        s.error = Some(e);
                    }
                }
            }
        });
        Ok(status)
    }
    fn download(
        &self,
        id: u64,
        url: &str,
        folder: &Path,
        cancel: &AtomicBool,
    ) -> Result<PathBuf, String> {
        let tools = external_tools::video_tools_cancellable(Some(cancel))?;
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        let (yt, deno) = external_tools::link_tools(Some(cancel))?;
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        // A fresh owned directory prevents overwriting or deleting the user's existing downloads.
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis();
        let dir = folder.join(format!("FireCrackle-{stamp}-{id}"));
        fs::create_dir(&dir).map_err(|e| e.to_string())?;
        let result = (|| {
            let mut command = external_tools::command(yt);
            // Keep downloader paths short and consistent during .part -> final rename,
            // including Windows folders with spaces/non-ASCII characters.
            command.current_dir(&dir);
            command
                .env("PYTHONIOENCODING", "utf-8")
                .args(["--encoding", "utf-8"]);
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                command.process_group(0);
            }
            command
                .args([
                    "--ignore-config",
                    "--no-playlist",
                    "--playlist-items",
                    "1",
                    "--match-filters",
                    "!is_live",
                    "--no-simulate",
                    "--newline",
                    "--no-colors",
                    "--file-access-retries",
                    "20",
                    "--retry-sleep",
                    "file_access:1",
                    "--no-js-runtimes",
                    "--js-runtimes",
                ])
                .arg(format!("deno:{}", deno.display()));
            if Path::new(&tools.ffmpeg).is_file() {
                command.arg("--ffmpeg-location").arg(&tools.ffmpeg);
            }
            command.args(["--format","bv*+ba/b","--merge-output-format","mkv","--restrict-filenames","--no-mtime","--print","after_move:@DONE@%(filepath)j","--progress","--progress-template","download:Downloading %(progress._percent_str)s - %(progress._speed_str)s - ETA %(progress._eta_str)s","--paths"]).arg(".")
                .args(["--output","%(title).120B [%(id)s].%(ext)s","--"]).arg(url).stdout(Stdio::piped()).stderr(Stdio::piped());
            let mut child = command
                .spawn()
                .map_err(|e| format!("Could not start yt-dlp: {e}"))?;
            let output = child.stdout.take().ok_or("Missing downloader output")?;
            let errors = child.stderr.take().ok_or("Missing downloader errors")?;
            let (tx, rx) = std::sync::mpsc::channel();
            for stream in [
                Box::new(output) as Box<dyn std::io::Read + Send>,
                Box::new(errors),
            ] {
                let tx = tx.clone();
                std::thread::spawn(move || {
                    // Standalone Python may write the Windows code page despite --encoding.
                    // Invalid UTF-8 in progress text must never close the pipe mid-download.
                    for line in BufReader::new(stream).split(b'\n').map_while(Result::ok) {
                        let _ = tx.send(
                            String::from_utf8_lossy(&line)
                                .trim_end_matches('\r')
                                .to_string(),
                        );
                    }
                });
            }
            drop(tx);
            self.message(id, "Connecting to video site…".into());
            let mut path = None;
            let mut last = String::new();
            let mut log = std::collections::VecDeque::new();
            let mut diagnostics = std::collections::VecDeque::new();
            let code = loop {
                while let Ok(line) = rx.try_recv() {
                    if let Some(p) = line.strip_prefix("@DONE@") {
                        path = serde_json::from_str::<String>(p).ok().map(PathBuf::from);
                    } else {
                        remember_diagnostic(&mut diagnostics, &line);
                        last = line.chars().take(1000).collect();
                        log.push_back(last.clone());
                        if log.len() > 8 {
                            log.pop_front();
                        }
                        self.message(id, last.clone());
                    }
                }
                if cancel.load(Ordering::Relaxed) {
                    #[cfg(windows)]
                    {
                        let _ = external_tools::command("taskkill.exe")
                            .args(["/PID", &child.id().to_string(), "/T", "/F"])
                            .output();
                    }
                    #[cfg(unix)]
                    {
                        let _ = external_tools::command("kill")
                            .args(["-TERM", "--", &format!("-{}", child.id())])
                            .output();
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Cancelled".into());
                }
                if let Some(code) = child.try_wait().map_err(|e| e.to_string())? {
                    break code;
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            // Readers can deliver the final path just after the child exits.
            for line in rx {
                if let Some(p) = line.strip_prefix("@DONE@") {
                    path = serde_json::from_str::<String>(p).ok().map(PathBuf::from);
                } else {
                    remember_diagnostic(&mut diagnostics, &line);
                    last = line.chars().take(1000).collect();
                    log.push_back(last.clone());
                    if log.len() > 8 {
                        log.pop_front();
                    }
                }
            }
            if !code.success() {
                return Err(if last.is_empty() {
                    format!("yt-dlp exited with {code}")
                } else {
                    log.into_iter()
                        .chain(diagnostics)
                        .collect::<Vec<_>>()
                        .join("\n")
                });
            }
            let path = path.ok_or("Downloader did not return a video file")?;
            let path = if path.is_absolute() {
                path
            } else {
                dir.join(path)
            };
            let actual = path.canonicalize().map_err(|e| e.to_string())?;
            let owned = dir.canonicalize().map_err(|e| e.to_string())?;
            if !actual.starts_with(&owned) || !actual.is_file() {
                return Err("Downloader returned an unexpected file path".into());
            }
            // Projects are keyed by path, so return the spelling the file picker would give.
            Ok(plain_path(actual))
        })();
        preserve_failed_download(result, &dir)
    }
}

fn remember_diagnostic(log: &mut std::collections::VecDeque<String>, line: &str) {
    // Progress can otherwise evict the actual rename/merge error from the tail.
    // Never retain debug URLs/headers, which can contain signed credentials.
    if line.starts_with("ERROR:")
        || line.starts_with("WARNING:")
        || line.contains("Unable to rename file")
    {
        log.push_back(line.chars().take(1000).collect());
        if log.len() > 12 {
            log.pop_front();
        }
    }
}

fn preserve_failed_download(
    result: Result<PathBuf, String>,
    dir: &Path,
) -> Result<PathBuf, String> {
    result.map_err(|error| format!("{error}\nDownload files kept in: {}", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_download_keeps_partial_bytes_and_reports_recovery_folder() {
        let dir = std::env::temp_dir().join(format!(
            "firecrackle-failed-download-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let partial = dir.join("video.f400.mp4.part");
        fs::write(&partial, b"already downloaded bytes").unwrap();
        let error = preserve_failed_download(Err("rename failed".into()), &dir).unwrap_err();
        assert!(error.contains("rename failed"));
        assert!(error.contains(&dir.display().to_string()));
        assert_eq!(fs::read(&partial).unwrap(), b"already downloaded bytes");
        fs::remove_file(partial).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn rename_diagnostics_survive_progress_without_retaining_debug_urls() {
        let mut log = std::collections::VecDeque::new();
        remember_diagnostic(&mut log, "[download] Unable to rename file: access denied");
        for _ in 0..100 {
            remember_diagnostic(&mut log, "Downloading 100%");
        }
        remember_diagnostic(&mut log, "[debug] signed request URL");
        assert_eq!(log.len(), 1);
        assert!(log[0].contains("Unable to rename file"));
    }
    #[test]
    fn only_web_urls_are_accepted() {
        for u in [
            "file:///etc/passwd",
            "-o test",
            "ftp://example.com/x",
            "https://user:pass@example.com/x",
            "garbage",
        ] {
            assert!(validate_url(u).is_err(), "{u}");
        }
        assert!(validate_url(" https://youtu.be/example ").is_ok());
    }
    #[test]
    fn invalid_folder_does_not_start_job() {
        let jobs = Jobs::default();
        assert!(
            jobs.start(
                "https://example.com/video".into(),
                PathBuf::from("missing-download-folder")
            )
            .is_err()
        );
        assert!(jobs.status().unwrap().is_none());
    }
    #[test]
    fn shutdown_cancels_a_running_download_and_waits_for_it() {
        let jobs = Jobs::default();
        let cancel = Arc::new(AtomicBool::new(false));
        let running = Status {
            id: 9,
            state: "running".into(),
            message: String::new(),
            path: None,
            error: None,
        };
        *jobs.inner.lock().unwrap() = Some((running, cancel.clone()));
        let worker = jobs.clone();
        std::thread::spawn(move || {
            while !cancel.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(5));
            }
            std::thread::sleep(Duration::from_millis(50));
            worker.inner.lock().unwrap().as_mut().unwrap().0.state = "cancelled".into();
        });
        jobs.shutdown();
        assert_eq!(jobs.status().unwrap().unwrap().state, "cancelled");
        Jobs::default().shutdown();
    }
    #[cfg(windows)]
    #[test]
    fn verbatim_prefixes_are_removed_without_breaking_network_paths() {
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\C:\videos\a.mkv")),
            PathBuf::from(r"C:\videos\a.mkv")
        );
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\UNC\server\share\a.mkv")),
            PathBuf::from(r"\\server\share\a.mkv")
        );
        assert_eq!(
            plain_path(PathBuf::from(r"D:\videos")),
            PathBuf::from(r"D:\videos")
        );
    }
}
