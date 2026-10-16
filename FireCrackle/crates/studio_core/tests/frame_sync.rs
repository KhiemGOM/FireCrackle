use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use studio_core::import::{passthrough_args, variable_frame_rate_args};

struct FakeTool(PathBuf);
impl FakeTool {
    fn new(name: &str, help: &str, stderr: bool) -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "firecrackle-sync-{name}-{}-{stamp}{}",
            std::process::id(),
            if cfg!(windows) { ".cmd" } else { "" }
        ));
        let redirect = if stderr { " >&2" } else { "" };
        let script = if cfg!(windows) {
            format!("@echo off\r\necho {help}{redirect}\r\nexit /b 0\r\n")
        } else {
            format!("#!/bin/sh\nprintf '%s\\n' '{help}'{redirect}\n")
        };
        fs::write(&path, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        }
        Self(path)
    }
}
impl Drop for FakeTool {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[test]
fn installed_modern_tool_uses_fps_mode_even_on_linux() {
    let tool = FakeTool::new("modern", "-fps_mode[:stream_specifier] mode", true);
    assert_eq!(
        passthrough_args(tool.0.as_os_str()),
        ["-fps_mode", "passthrough"]
    );
    assert_eq!(
        variable_frame_rate_args(tool.0.as_os_str()),
        ["-fps_mode", "vfr"]
    );
}

#[test]
fn installed_legacy_tool_uses_vsync_and_is_probed_only_once() {
    let tool = FakeTool::new("legacy", "-vsync sync_method", false);
    assert_eq!(passthrough_args(tool.0.as_os_str()), ["-vsync", "0"]);
    fs::remove_file(&tool.0).unwrap();
    // Both modes share the cached capability; decoding must not launch a help probe per frame.
    assert_eq!(
        variable_frame_rate_args(tool.0.as_os_str()),
        ["-vsync", "2"]
    );
}
