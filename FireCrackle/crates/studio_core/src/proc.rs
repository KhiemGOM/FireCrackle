//! Child processes for the GUI app. On Windows a console program started from a GUI process opens its own console
//! window unless it is created with CREATE_NO_WINDOW, so every tool (ffmpeg, ffprobe) is launched through here.

use std::ffi::OsStr;
use std::process::Command;

/// A tool started for background work (decoding frames): hidden like `hidden_command`, and at below-normal priority, so
/// a busy decode yields to the window, the browser and the rest of the machine instead of starving them.
pub fn background_command(exe: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = hidden_command(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000 | 0x0000_4000); // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
    }
    cmd
}

pub fn hidden_command(exe: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}
