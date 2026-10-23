//! Decode admission remains bounded under bursts, cancellation and failures.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use studio_core::decode_gate::{decode_gate, DecodeGate};

fn never() -> AtomicBool {
    AtomicBool::new(false)
}

/// Run `f` on a thread and report whether it has finished after `wait`.
fn finishes_within<T: Send + 'static>(
    wait: Duration,
    f: impl FnOnce() -> T + Send + 'static,
) -> (bool, thread::JoinHandle<T>) {
    let handle = thread::spawn(f);
    let start = Instant::now();
    while start.elapsed() < wait {
        if handle.is_finished() {
            return (true, handle);
        }
        thread::sleep(Duration::from_millis(5));
    }
    (handle.is_finished(), handle)
}

#[test]
fn permits_are_given_up_to_the_limit_at_once() {
    let gate = DecodeGate::new(2);
    let c = never();
    let a = gate.acquire(&c).expect("first permit");
    let b = gate.acquire(&c).expect("second permit");
    assert_eq!(gate.in_flight(), 2);
    drop((a, b));
    assert_eq!(gate.in_flight(), 0);
}

#[test]
fn a_third_caller_waits_until_a_permit_is_returned() {
    let gate = Arc::new(DecodeGate::new(2));
    let c = never();
    let a = gate.acquire(&c).unwrap();
    let _b = gate.acquire(&c).unwrap();
    let g = gate.clone();
    let (done, handle) = finishes_within(Duration::from_millis(150), move || {
        let c = never();
        g.acquire(&c).is_some()
    });
    assert!(
        !done,
        "the third caller must wait while both permits are out"
    );
    drop(a);
    assert!(
        handle.join().unwrap(),
        "and gets one as soon as a permit is back"
    );
}

#[test]
fn a_permit_comes_back_even_when_the_holder_panics() {
    let gate = DecodeGate::new(1);
    let c = never();
    let result = catch_unwind(AssertUnwindSafe(|| {
        let _permit = gate.acquire(&c).unwrap();
        panic!("a decode failed in an unexpected way");
    }));
    assert!(result.is_err());
    assert_eq!(gate.in_flight(), 0);
    assert!(gate.acquire(&c).is_some(), "the gate is not stuck shut");
}

#[test]
fn a_waiting_caller_gives_up_when_cancelled_and_takes_no_permit() {
    let gate = Arc::new(DecodeGate::new(1));
    let c = never();
    let held = gate.acquire(&c).unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    let (g, flag) = (gate.clone(), cancel.clone());
    let handle = thread::spawn(move || g.acquire(&flag).is_none());
    thread::sleep(Duration::from_millis(100));
    cancel.store(true, Ordering::SeqCst);
    let start = Instant::now();
    assert!(handle.join().unwrap(), "a cancelled wait returns None");
    assert!(
        start.elapsed() < Duration::from_secs(1),
        "and does so promptly"
    );
    assert_eq!(gate.in_flight(), 1, "only the original holder has a permit");
    drop(held);
    assert_eq!(gate.in_flight(), 0);
}

#[test]
fn a_caller_that_is_already_cancelled_gets_nothing_even_if_a_permit_is_free() {
    let gate = DecodeGate::new(2);
    let cancel = AtomicBool::new(true);
    assert!(gate.acquire(&cancel).is_none());
    assert_eq!(gate.in_flight(), 0);
}

#[test]
fn never_more_than_the_limit_run_at_once_under_load() {
    let gate = Arc::new(DecodeGate::new(3));
    let running = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let handles: Vec<_> = (0..24)
        .map(|_| {
            let (g, r, p) = (gate.clone(), running.clone(), peak.clone());
            thread::spawn(move || {
                let c = never();
                let _permit = g.acquire(&c).unwrap();
                let now = r.fetch_add(1, Ordering::SeqCst) + 1;
                p.fetch_max(now, Ordering::SeqCst);
                thread::sleep(Duration::from_millis(15));
                r.fetch_sub(1, Ordering::SeqCst);
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    assert!(
        peak.load(Ordering::SeqCst) <= 3,
        "peak was {}",
        peak.load(Ordering::SeqCst)
    );
    assert_eq!(
        peak.load(Ordering::SeqCst),
        3,
        "and the limit is actually used"
    );
    assert_eq!(gate.in_flight(), 0);
}

#[test]
fn raising_the_limit_lets_waiting_callers_in() {
    let gate = Arc::new(DecodeGate::new(1));
    let c = never();
    let _held = gate.acquire(&c).unwrap();
    let g = gate.clone();
    let (done, handle) = finishes_within(Duration::from_millis(120), move || {
        let c = never();
        g.acquire(&c).is_some()
    });
    assert!(!done);
    gate.set_limit(2);
    assert!(handle.join().unwrap());
}

#[test]
fn lowering_the_limit_does_not_stop_decodes_that_are_running() {
    let gate = DecodeGate::new(3);
    let c = never();
    let permits: Vec<_> = (0..3).map(|_| gate.acquire(&c).unwrap()).collect();
    gate.set_limit(1);
    assert_eq!(gate.in_flight(), 3, "the three keep running");
    drop(permits);
    assert_eq!(gate.in_flight(), 0);
    let a = gate.acquire(&c).unwrap();
    let g = &gate;
    let second = thread::scope(|s| {
        let h = s.spawn(move || {
            let c = AtomicBool::new(false);
            let flag = &c;
            thread::scope(|inner| {
                let t = inner.spawn(|| g.acquire(flag).is_some());
                thread::sleep(Duration::from_millis(100));
                flag.store(true, Ordering::SeqCst);
                t.join().unwrap()
            })
        });
        h.join().unwrap()
    });
    assert!(
        !second,
        "with the limit at 1 a second caller has to wait (and here gave up)"
    );
    drop(a);
}

#[test]
fn a_limit_of_zero_still_lets_one_decode_run() {
    let gate = DecodeGate::new(0);
    let c = never();
    assert!(gate.acquire(&c).is_some());
    gate.set_limit(0);
    assert_eq!(gate.limit(), 1);
}

#[test]
fn the_process_wide_gate_is_one_gate() {
    let a = decode_gate() as *const DecodeGate;
    let b = decode_gate() as *const DecodeGate;
    assert_eq!(a, b);
    assert!(decode_gate().limit() >= 1);
}

/// A decode is heavy work for the machine as a whole. Run at below-normal priority, it yields to the window, the
/// browser and the rest of the system instead of starving them, so a busy decode makes the app slower, not the PC.
#[cfg(windows)]
#[test]
fn a_background_child_runs_at_below_normal_priority_with_no_console_window() {
    let script = r#"Add-Type -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();' -Name ConsoleProbe2 -Namespace FireCrackle; "$((Get-Process -Id $PID).PriorityClass) $([FireCrackle.ConsoleProbe2]::GetConsoleWindow().ToInt64())""#;
    let output = studio_core::proc::background_command("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ])
        .output()
        .expect("start the probe");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        "BelowNormal 0"
    );
}

// ---- the newest request is served first

/// Wait (up to a second) until the gate has `n` callers waiting for a slot.
fn wait_for_waiters(gate: &DecodeGate, n: usize) {
    let start = Instant::now();
    while gate.waiting() < n && start.elapsed() < Duration::from_secs(1) {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(gate.waiting(), n);
}

#[test]
fn after_a_burst_the_newest_request_goes_first() {
    // a click on the timeline asks for a frame and the user moves on: the last place asked for is the one to show
    let gate = Arc::new(DecodeGate::new(1));
    let held = gate.acquire(&never()).unwrap();
    let order = Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut handles = Vec::new();
    for id in 1..=3 {
        let (g, o) = (gate.clone(), order.clone());
        handles.push(thread::spawn(move || {
            let _slot = g.acquire(&never()).unwrap();
            o.lock().unwrap().push(id);
            thread::sleep(Duration::from_millis(20));
        }));
        wait_for_waiters(&gate, id); // arrive one after another, in order
    }
    drop(held);
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(*order.lock().unwrap(), vec![3, 2, 1]);
}

#[test]
fn a_request_that_has_waited_too_long_is_not_starved_by_newer_ones() {
    let gate = Arc::new(DecodeGate::with_starvation(1, Duration::from_millis(150)));
    let held = gate.acquire(&never()).unwrap();
    let order = Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut handles = Vec::new();
    for id in 1..=2 {
        let (g, o) = (gate.clone(), order.clone());
        handles.push(thread::spawn(move || {
            let _slot = g.acquire(&never()).unwrap();
            o.lock().unwrap().push(id);
        }));
        wait_for_waiters(&gate, id);
        if id == 1 {
            thread::sleep(Duration::from_millis(250)); // the first one is now overdue
        }
    }
    drop(held);
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(
        *order.lock().unwrap(),
        vec![1, 2],
        "the overdue request goes first"
    );
}

#[test]
fn a_cancelled_waiter_leaves_the_queue_and_does_not_hold_up_the_others() {
    let gate = Arc::new(DecodeGate::new(1));
    let held = gate.acquire(&never()).unwrap();
    let ran = Arc::new(AtomicBool::new(false));
    let (g, r) = (gate.clone(), ran.clone());
    let older = thread::spawn(move || {
        let _slot = g.acquire(&never()).unwrap();
        r.store(true, Ordering::SeqCst);
    });
    wait_for_waiters(&gate, 1);
    let cancel = Arc::new(AtomicBool::new(false));
    let (g, c) = (gate.clone(), cancel.clone());
    let newer = thread::spawn(move || g.acquire(&c).is_none());
    wait_for_waiters(&gate, 2);
    cancel.store(true, Ordering::SeqCst);
    assert!(newer.join().unwrap());
    assert_eq!(gate.waiting(), 1, "only the older request still waits");
    drop(held);
    older.join().unwrap();
    assert!(ran.load(Ordering::SeqCst), "and it is served");
    assert_eq!(gate.waiting(), 0);
}

// ---- the thumbnail pass is background work too

#[test]
fn frame_decodes_and_the_thumbnail_pass_start_at_background_priority() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for file in ["frames.rs", "thumbs.rs"] {
        let text = std::fs::read_to_string(dir.join(file)).unwrap();
        assert!(
            text.contains("proc::ffmpeg_command(&tools.ffmpeg)"),
            "{file} must use the bounded background FFmpeg command"
        );
        assert!(
            !text.contains("proc::hidden_command(&tools.ffmpeg)"),
            "{file} starts ffmpeg at normal priority"
        );
    }
}

#[test]
fn an_overload_has_a_hard_waiter_bound_and_cancels_cleanly() {
    let gate = Arc::new(DecodeGate::new(1));
    let held_cancel = never();
    let held = gate.acquire(&held_cancel).unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    let handles: Vec<_> = (0..40)
        .map(|_| {
            let g = gate.clone();
            let c = cancel.clone();
            thread::spawn(move || g.acquire(&c).is_none())
        })
        .collect();
    thread::sleep(Duration::from_millis(200));
    let queued = gate.waiting();
    cancel.store(true, Ordering::SeqCst);
    for h in handles {
        assert!(h.join().unwrap());
    }
    drop(held);
    assert!(queued <= 32, "unbounded queued decodes: {queued}");
    assert_eq!(gate.waiting(), 0);
    assert_eq!(gate.in_flight(), 0);
}

#[test]
fn invalid_large_limits_cannot_disable_the_process_cap() {
    let gate = DecodeGate::new(usize::MAX);
    assert!(gate.limit() <= 8);
    gate.set_limit(usize::MAX);
    assert!(gate.limit() <= 8);
}

// ---- a paused frame's full-quality decode is urgent

use studio_core::decode_gate::Priority;

#[test]
fn a_full_queue_drops_normal_waiters_never_the_urgent_one() {
    // pausing asks for the exact frame while playback and thumbnails have filled the queue: the paused picture must
    // not be the request that is thrown away ("Full-quality frame decode failed: Cancelled")
    let gate = Arc::new(DecodeGate::new(1));
    let held = gate.acquire(&never()).unwrap();
    let g = gate.clone();
    let urgent = thread::spawn(move || g.acquire_as(&never(), Priority::Urgent).is_some());
    wait_for_waiters(&gate, 1);
    let cancel = Arc::new(AtomicBool::new(false));
    let normal: Vec<_> = (0..40)
        .map(|_| {
            let (g, c) = (gate.clone(), cancel.clone());
            thread::spawn(move || g.acquire(&c).is_none())
        })
        .collect();
    thread::sleep(Duration::from_millis(200));
    assert!(gate.waiting() <= 32, "the queue stays bounded: {}", gate.waiting());
    cancel.store(true, Ordering::SeqCst);
    drop(held);
    assert!(urgent.join().unwrap(), "the urgent request was dropped");
    for h in normal {
        assert!(h.join().unwrap());
    }
}

#[test]
fn an_urgent_request_goes_before_newer_and_overdue_normal_ones() {
    let gate = Arc::new(DecodeGate::with_starvation(1, Duration::from_millis(100)));
    let held = gate.acquire(&never()).unwrap();
    let order = Arc::new(std::sync::Mutex::new(Vec::new()));
    let spawn = |id: u32, priority: Priority| {
        let (g, o) = (gate.clone(), order.clone());
        thread::spawn(move || {
            let _slot = g.acquire_as(&never(), priority).unwrap();
            o.lock().unwrap().push(id);
            thread::sleep(Duration::from_millis(10));
        })
    };
    let mut handles = vec![spawn(1, Priority::Normal)];
    wait_for_waiters(&gate, 1);
    thread::sleep(Duration::from_millis(200)); // the normal one is overdue
    handles.push(spawn(2, Priority::Urgent));
    wait_for_waiters(&gate, 2);
    handles.push(spawn(3, Priority::Normal));
    wait_for_waiters(&gate, 3);
    drop(held);
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(*order.lock().unwrap(), vec![2, 1, 3], "urgent, then the overdue one, then the rest");
}

#[test]
fn the_newest_urgent_request_goes_first_and_urgent_ones_alone_stay_bounded() {
    let gate = Arc::new(DecodeGate::new(1));
    let held = gate.acquire(&never()).unwrap();
    let order = Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut handles = Vec::new();
    for id in 1..=2 {
        let (g, o) = (gate.clone(), order.clone());
        handles.push(thread::spawn(move || {
            let _slot = g.acquire_as(&never(), Priority::Urgent).unwrap();
            o.lock().unwrap().push(id);
            thread::sleep(Duration::from_millis(10));
        }));
        wait_for_waiters(&gate, id);
    }
    drop(held);
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(*order.lock().unwrap(), vec![2, 1]);

    let held = gate.acquire(&never()).unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    let many: Vec<_> = (0..40)
        .map(|_| {
            let (g, c) = (gate.clone(), cancel.clone());
            thread::spawn(move || g.acquire_as(&c, Priority::Urgent).is_none())
        })
        .collect();
    thread::sleep(Duration::from_millis(200));
    assert!(gate.waiting() <= 32, "unbounded urgent waiters: {}", gate.waiting());
    cancel.store(true, Ordering::SeqCst);
    for h in many {
        assert!(h.join().unwrap());
    }
    drop(held);
    assert_eq!(gate.waiting(), 0);
}

#[test]
fn the_exact_png_decode_asks_the_gate_as_urgent() {
    let text = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/frames.rs")).unwrap();
    assert!(text.contains("Priority::Urgent"), "the exact picture must not wait behind playback and thumbnails");
}
