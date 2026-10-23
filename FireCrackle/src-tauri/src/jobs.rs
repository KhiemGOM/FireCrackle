//! What every background job shares (scans, link downloads, JoltCracker): a cancel flag, the external process it is
//! running, and a worker thread whose panic becomes an error instead of a job stuck "running".
use std::{
    process::{Child, ExitStatus},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

/// Cancel flag plus the external tool (FFmpeg, yt-dlp, JoltCracker) a job is running. Clones share both.
#[derive(Clone, Default)]
pub struct JobControl {
    cancel: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

impl JobControl {
    /// Ask the job to stop and stop its tool, including anything the tool started.
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
        if let Ok(mut slot) = self.child.lock()
            && let Some(child) = slot.as_mut()
        {
            crate::external_tools::kill_tree(child);
        }
    }
    /// Clear a previous cancel before the same job runs again (a paused scan being resumed).
    pub fn resume(&self) {
        self.cancel.store(false, Ordering::Relaxed);
    }
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
    /// For loops that poll the flag directly (decoder pipelines).
    pub fn flag(&self) -> &AtomicBool {
        &self.cancel
    }
    /// Where a decoder places its process, for code that manages the slot itself.
    pub fn slot(&self) -> &Mutex<Option<Child>> {
        &self.child
    }
    /// Hand over a started tool. When the job was cancelled meanwhile, the tool is stopped at once and this fails.
    pub fn attach(&self, mut child: Child) -> Result<(), String> {
        let mut slot = self.child.lock().map_err(|_| "Job state unavailable")?;
        if self.cancelled() {
            crate::external_tools::kill_tree(&mut child);
            return Err("Cancelled".into());
        }
        *slot = Some(child);
        Ok(())
    }
    /// Wait for the tool (stopping it first if the job was cancelled) and release it; `None` when there was none
    /// or it had to be stopped.
    pub fn finish_child(&self) -> Option<ExitStatus> {
        let mut child = self.child.lock().ok()?.take()?;
        if self.cancelled() {
            crate::external_tools::kill_tree(&mut child);
            return None;
        }
        child.wait().ok()
    }
    /// Stop and release the tool whatever its state (after an error, or when the job ends early).
    pub fn kill_child(&self) {
        if let Ok(mut slot) = self.child.lock()
            && let Some(mut child) = slot.take()
        {
            crate::external_tools::kill_tree(&mut child);
        }
    }
}

/// Run a job body; a panic becomes `"<name> worker failed"` so the job ends as failed instead of hanging.
pub fn guarded<T>(name: &str, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))
        .unwrap_or_else(|_| Err(format!("{name} worker failed")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    fn sleeper() -> std::process::Child {
        let mut c = if cfg!(windows) {
            let mut c = Command::new("ping");
            c.args(["-n", "30", "127.0.0.1"]);
            c
        } else {
            let mut c = Command::new("sleep");
            c.arg("30");
            c
        };
        c.stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap()
    }

    #[test]
    fn cancel_sets_the_flag_and_stops_the_running_tool() {
        let control = JobControl::default();
        assert!(!control.cancelled());
        control.attach(sleeper()).unwrap();
        let started = Instant::now();
        control.cancel();
        assert!(control.cancelled());
        assert!(
            control.finish_child().is_none(),
            "a killed tool is reaped, not left running"
        );
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn a_tool_started_after_cancel_is_stopped_at_once() {
        // The race between "Pause" and FFmpeg starting: the process must not outlive the cancelled job.
        let control = JobControl::default();
        control.cancel();
        let started = Instant::now();
        assert!(control.attach(sleeper()).is_err());
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn a_finished_tool_reports_its_exit_status() {
        let control = JobControl::default();
        let child = if cfg!(windows) {
            Command::new("cmd").args(["/C", "exit 3"]).spawn().unwrap()
        } else {
            Command::new("sh").args(["-c", "exit 3"]).spawn().unwrap()
        };
        control.attach(child).unwrap();
        assert_eq!(control.finish_child().and_then(|s| s.code()), Some(3));
        assert!(
            control.finish_child().is_none(),
            "nothing left after it was reaped"
        );
    }

    #[test]
    fn a_worker_panic_is_an_error_not_a_hang() {
        assert_eq!(
            guarded("Test", || -> Result<u8, String> { panic!("boom") }),
            Err("Test worker failed".into())
        );
        assert_eq!(guarded("Test", || Ok::<_, String>(5)), Ok(5));
        assert_eq!(
            guarded("Scan", || Err::<(), _>("decode".to_string())),
            Err("decode".into())
        );
    }
}
