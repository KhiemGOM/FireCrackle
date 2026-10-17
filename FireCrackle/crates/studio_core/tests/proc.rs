use studio_core::proc::{ffmpeg_command, JPEG_OUTPUT};
#[test]
fn decoding_filtering_and_jpeg_encoding_do_not_use_automatic_cpu_pools() {
    let cmd = ffmpeg_command("ffmpeg");
    let args: Vec<_> = cmd.get_args().map(|a| a.to_str().unwrap()).collect();
    assert_eq!(
        args,
        vec![
            "-threads",
            "2",
            "-filter_threads",
            "1",
            "-filter_complex_threads",
            "1"
        ]
    );
    assert!(JPEG_OUTPUT.windows(2).any(|w| w == ["-threads", "1"]));
}

fn child(mode: &str) -> std::process::Command {
    let mut cmd = studio_core::proc::hidden_command(std::env::current_exe().unwrap());
    cmd.args(["--exact", "capture_child", "--nocapture"])
        .env("FIRECRACKLE_CAPTURE_TEST", mode);
    cmd
}
#[test]
fn capture_child() {
    match std::env::var("FIRECRACKLE_CAPTURE_TEST").as_deref() {
        Ok("quiet") => std::thread::sleep(std::time::Duration::from_secs(30)),
        Ok("large") => {
            use std::io::Write;
            let _ = std::io::stdout().write_all(&vec![b'x'; 2 * 1024 * 1024]);
        }
        Ok("normal") => {
            println!("picture");
            eprintln!("frame time");
        }
        _ => return,
    }
    std::process::exit(0);
}
#[test]
fn cancellation_interrupts_a_child_with_no_output() {
    let cancelled = std::sync::atomic::AtomicBool::new(false);
    std::thread::scope(|scope| {
        scope.spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(100));
            cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        let start = std::time::Instant::now();
        let error = studio_core::proc::capture(&mut child("quiet"), &cancelled, 1024).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::Interrupted);
        assert!(start.elapsed() < std::time::Duration::from_secs(3));
    });
}
#[test]
fn excessive_output_is_rejected_instead_of_accumulated() {
    let error =
        studio_core::proc::capture(&mut child("large"), &Default::default(), 1024).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
}
#[test]
fn normal_capture_preserves_status_and_both_pipes() {
    let output =
        studio_core::proc::capture(&mut child("normal"), &Default::default(), 1024).unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("picture"));
    assert!(String::from_utf8_lossy(&output.stderr).contains("frame time"));
}
