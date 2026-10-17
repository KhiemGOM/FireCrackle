//! Child processes for the GUI app. On Windows a console program started from a GUI process opens its own console
//! window unless it is created with CREATE_NO_WINDOW, so every tool (ffmpeg, ffprobe) is launched through here.

use std::ffi::OsStr;
use std::process::Command;

/// Capture a decoder with bounded pipes. Cancellation kills even a silent child;
/// the process is always reaped before its output readers are joined.
pub fn capture(
    cmd: &mut Command,
    cancel: &std::sync::atomic::AtomicBool,
    limit: usize,
) -> std::io::Result<std::process::Output> {
    use std::io::{Error, ErrorKind, Read};
    use std::process::Stdio;
    use std::sync::atomic::{AtomicBool, Ordering};
    if cancel.load(Ordering::SeqCst) {
        return Err(ErrorKind::Interrupted.into());
    }
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let overflow = AtomicBool::new(false);
    std::thread::scope(|scope| {
        let read = |pipe: Box<dyn Read + Send>, cap: usize| {
            let mut bytes = Vec::new();
            let result = pipe.take(cap as u64 + 1).read_to_end(&mut bytes);
            if bytes.len() > cap {
                overflow.store(true, Ordering::SeqCst);
            }
            result.map(|_| bytes)
        };
        let out = scope.spawn(move || read(Box::new(stdout), limit));
        let err = scope.spawn(move || read(Box::new(stderr), 8 * 1024 * 1024));
        let result = loop {
            if cancel.load(Ordering::SeqCst) {
                break Err(ErrorKind::Interrupted.into());
            }
            if overflow.load(Ordering::SeqCst) {
                break Err(Error::new(
                    ErrorKind::InvalidData,
                    "decoder output exceeded its byte budget",
                ));
            }
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(10)),
                Err(error) => break Err(error),
            }
        };
        if result.is_err() {
            let _ = child.kill();
        }
        let _ = child.wait();
        let stdout = out.join().unwrap();
        let stderr = err.join().unwrap();
        let status = result?;
        if overflow.load(Ordering::SeqCst) {
            return Err(Error::new(
                ErrorKind::InvalidData,
                "decoder output exceeded its byte budget",
            ));
        }
        Ok(std::process::Output {
            status,
            stdout: stdout?,
            stderr: stderr?,
        })
    })
}

/// Bound CPU fanout separately from the process count. Options precede the input.
pub fn ffmpeg_command(exe: impl AsRef<OsStr>) -> Command {
    let mut cmd = background_command(exe);
    cmd.args([
        "-threads",
        "2",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
    ]);
    cmd
}

/// Output encoder threads must be specified after the input as well.
pub const JPEG_OUTPUT: [&str; 7] = ["-f", "image2pipe", "-c:v", "mjpeg", "-threads", "1", "-q:v"];

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
