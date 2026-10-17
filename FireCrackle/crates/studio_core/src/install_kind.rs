//! Which package a running copy of FireCrackle came from, so the update banner offers the matching download.
//!
//! A Windows copy with an `uninstall.exe` beside it was put there by the setup program; without one it is the portable
//! ZIP. On Linux the AppImage runtime sets `APPIMAGE` (and runs the program from a temporary mount); the Debian package
//! puts the program under `/usr`. Anything else is not guessed at.

use serde::Serialize;
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallKind {
    WindowsSetup,
    WindowsPortable,
    LinuxAppimage,
    LinuxDeb,
    Unknown,
}

/// `os` is `std::env::consts::OS`; `exe` the running program; `siblings` the file names in its folder.
pub fn classify(os: &str, exe: &Path, siblings: &[&str], appimage_env: bool) -> InstallKind {
    match os {
        "windows" => {
            if siblings
                .iter()
                .any(|name| name.eq_ignore_ascii_case("uninstall.exe"))
            {
                InstallKind::WindowsSetup
            } else {
                InstallKind::WindowsPortable
            }
        }
        "linux" => {
            if appimage_env {
                InstallKind::LinuxAppimage
            } else if exe.starts_with("/usr") {
                InstallKind::LinuxDeb
            } else {
                InstallKind::Unknown
            }
        }
        _ => InstallKind::Unknown,
    }
}

/// The kind of the running program (unknown when its location cannot be read).
pub fn detect() -> InstallKind {
    let exe = std::env::current_exe().unwrap_or_default();
    let names: Vec<String> = exe
        .parent()
        .and_then(|dir| std::fs::read_dir(dir).ok())
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .filter_map(|entry| entry.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    let siblings: Vec<&str> = names.iter().map(String::as_str).collect();
    let appimage = std::env::var_os("APPIMAGE").is_some_and(|value| !value.is_empty());
    classify(std::env::consts::OS, &exe, &siblings, appimage)
}
