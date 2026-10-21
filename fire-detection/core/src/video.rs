//! Reading video frames from a pipe, and understanding `ffprobe` output.

use std::io::{self, ErrorKind, Read};

/// Frame-preserving output, including the FFmpeg 4.4 shipped by Ubuntu 22.04.
pub const PASSTHROUGH_ARGS: [&str; 2] = if cfg!(target_os = "linux") {
    ["-vsync", "0"]
} else {
    ["-fps_mode", "passthrough"]
};

/// Decode on one producer while a bounded pool processes independent frames. Buffers are reused.
/// Results arrive in completion order; their original frame numbers are always retained.
pub fn parallel_frames<R, T, F, U>(
    reader: R,
    frame_bytes: usize,
    total: u32,
    workers: usize,
    cancel: &std::sync::atomic::AtomicBool,
    process: F,
    update: U,
) -> Result<(), String>
where
    R: Read + Send,
    T: Send,
    F: Fn(&[u8]) -> Result<T, String> + Sync,
    U: FnMut(u32, T),
{
    parallel_frames_indexed(
        reader,
        frame_bytes,
        total,
        workers,
        cancel,
        |_, frame| process(frame),
        update,
    )
}

/// As `parallel_frames`, exposing the original output index so resumed scans can reuse individual decisions.
pub fn parallel_frames_indexed<R, T, F, U>(
    reader: R,
    frame_bytes: usize,
    total: u32,
    workers: usize,
    cancel: &std::sync::atomic::AtomicBool,
    process: F,
    update: U,
) -> Result<(), String>
where
    R: Read + Send,
    T: Send,
    F: Fn(u32, &[u8]) -> Result<T, String> + Sync,
    U: FnMut(u32, T),
{
    parallel_frames_indexed_with_state(
        reader,
        frame_bytes,
        total,
        workers,
        cancel,
        || (),
        |_, n, frame| process(n, frame),
        update,
    )
}

/// Each worker owns its state and receives frames in increasing source order.
/// State never crosses workers, scans or resume sessions. Output order remains
/// independent of source order, as in `parallel_frames_indexed`.
#[allow(clippy::too_many_arguments)] // Explicit pipeline inputs plus worker-local state factory.
pub fn parallel_frames_indexed_with_state<R, S, T, I, F, U>(
    reader: R,
    frame_bytes: usize,
    total: u32,
    workers: usize,
    cancel: &std::sync::atomic::AtomicBool,
    initialize: I,
    process: F,
    mut update: U,
) -> Result<(), String>
where
    R: Read + Send,
    T: Send,
    I: Fn() -> S + Sync,
    F: Fn(&mut S, u32, &[u8]) -> Result<T, String> + Sync,
    U: FnMut(u32, T),
{
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    if frame_bytes == 0 {
        return Err("Frame size must be positive".into());
    }
    let workers = workers.clamp(1, 32);
    let buffers = workers + 2;
    let stop = AtomicBool::new(false);
    std::thread::scope(|scope| {
        let (work_tx, work_rx) = mpsc::sync_channel::<(u32, Vec<u8>)>(workers);
        let work_rx = Arc::new(Mutex::new(work_rx));
        let (free_tx, free_rx) = mpsc::sync_channel::<Vec<u8>>(buffers);
        for _ in 0..buffers {
            free_tx
                .send(vec![0; frame_bytes])
                .map_err(|e| e.to_string())?;
        }
        let (result_tx, result_rx) = mpsc::channel::<Result<(u32, T), String>>();
        let stopped = &stop;
        let decoder_result = result_tx.clone();
        scope.spawn(move || {
            let mut reader = reader;
            for n in 0..total {
                if stopped.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
                    return;
                }
                let Ok(mut frame) = free_rx.recv() else {
                    return;
                };
                match read_frame(&mut reader, &mut frame) {
                    Ok(true) => {}
                    Ok(false) => {
                        let _ = decoder_result
                            .send(Err(format!("Video ended before indexed frame {n}")));
                        return;
                    }
                    Err(e) => {
                        let _ = decoder_result.send(Err(format!("Decode frame {n}: {e}")));
                        return;
                    }
                }
                if work_tx.send((n, frame)).is_err() {
                    return;
                }
            }
            if stopped.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
                return;
            }
            let mut extra = [0u8; 1];
            match reader.read(&mut extra) {
                Ok(0) => {}
                Ok(_) => {
                    let _ = decoder_result.send(Err(
                        "Decoded video has more frames than the imported index".into(),
                    ));
                }
                Err(e) => {
                    let _ = decoder_result.send(Err(e.to_string()));
                }
            }
        });
        for _ in 0..workers {
            let input = work_rx.clone();
            let output = result_tx.clone();
            let recycle = free_tx.clone();
            let process = &process;
            let initialize = &initialize;
            scope.spawn(move || {
                background_priority();
                let mut state = initialize();
                loop {
                    let received = match input.lock() {
                        Ok(rx) => rx.recv(),
                        Err(_) => {
                            let _ = output.send(Err("Frame queue unavailable".into()));
                            break;
                        }
                    };
                    let Ok((n, frame)) = received else {
                        break;
                    };
                    if stopped.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
                        let _ = recycle.send(frame);
                        break;
                    }
                    let result = process(&mut state, n, &frame).map(|value| (n, value));
                    if result.is_err() {
                        stopped.store(true, Ordering::Relaxed);
                    }
                    let failed = result.is_err();
                    let _ = output.send(result);
                    let _ = recycle.send(frame);
                    if failed {
                        break;
                    }
                }
            });
        }
        drop(work_rx);
        drop(result_tx);
        drop(free_tx);
        let mut error = None;
        for result in result_rx {
            match result {
                Ok((n, value))
                    if !stop.load(Ordering::Relaxed) && !cancel.load(Ordering::Relaxed) =>
                {
                    update(n, value)
                }
                Err(e) => {
                    if error.is_none() {
                        error = Some(e);
                    }
                    stop.store(true, Ordering::Relaxed);
                }
                _ => {}
            }
        }
        if let Some(error) = error {
            Err(error)
        } else {
            Ok(())
        }
    })
}

/// Scan workers yield to the UI and to whatever else the user is running: they
/// only take CPU time that normal-priority threads leave idle. Only the worker
/// threads are lowered; the caller's thread is unchanged.
fn background_priority() {
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetCurrentThread() -> isize;
            fn SetThreadPriority(thread: isize, priority: i32) -> i32;
        }
        const THREAD_PRIORITY_BELOW_NORMAL: i32 = -1;
        // SAFETY: documented Win32 call on the current thread's pseudo-handle.
        unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL) };
    }
}

/// Leave room for decoding/UI and cap the recycled RGB frame pool to about 256 MiB.
pub fn scan_workers(frame_bytes: usize) -> usize {
    let cpu = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2)
        .saturating_sub(2)
        .max(1);
    cpu.min(12).min(
        (256usize * 1024 * 1024 / frame_bytes.max(1))
            .saturating_sub(2)
            .max(1),
    )
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct VideoInfo {
    pub width: usize,
    pub height: usize,
    pub fps_num: u32,
    pub fps_den: u32,
}

fn parse_dim(key: &str, v: &str) -> Result<usize, String> {
    match v.trim().parse::<usize>() {
        Ok(n) if n > 0 => Ok(n),
        _ => Err(format!("bad {key} in ffprobe output: {v:?}")),
    }
}

/// Parses `key=value` lines as printed by `ffprobe -of default=noprint_wrappers=1`. Order does not matter and
/// unknown keys are ignored; if several streams are printed the first value of each key wins.
pub fn parse_probe(text: &str) -> Result<VideoInfo, String> {
    let mut width = None;
    let mut height = None;
    let mut fps = None;
    for line in text.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        match key {
            "width" if width.is_none() => width = Some(parse_dim("width", value)?),
            "height" if height.is_none() => height = Some(parse_dim("height", value)?),
            "r_frame_rate" if fps.is_none() => {
                let (n, d) = value
                    .trim()
                    .split_once('/')
                    .ok_or_else(|| format!("bad frame rate in ffprobe output: {value:?}"))?;
                let n: u32 = n
                    .parse()
                    .map_err(|_| format!("bad frame rate: {value:?}"))?;
                let d: u32 = d
                    .parse()
                    .map_err(|_| format!("bad frame rate: {value:?}"))?;
                if n == 0 || d == 0 {
                    return Err(format!("unusable frame rate: {value:?}"));
                }
                fps = Some((n, d));
            }
            _ => {}
        }
    }
    let width = width.ok_or("ffprobe output has no width")?;
    let height = height.ok_or("ffprobe output has no height")?;
    let (fps_num, fps_den) = fps.ok_or("ffprobe output has no frame rate")?;
    Ok(VideoInfo {
        width,
        height,
        fps_num,
        fps_den,
    })
}

/// Fills `buf` completely from `r`. `Ok(false)` is a clean end of stream (nothing read at all); a stream that ends
/// in the middle of a frame is an `UnexpectedEof` error. Short reads from a pipe are stitched together.
pub fn read_frame<R: Read>(r: &mut R, buf: &mut [u8]) -> io::Result<bool> {
    if buf.is_empty() {
        return Err(io::Error::new(
            ErrorKind::InvalidInput,
            "frame buffer is empty",
        ));
    }
    let mut filled = 0;
    while filled < buf.len() {
        match r.read(&mut buf[filled..]) {
            Ok(0) => {
                return if filled == 0 {
                    Ok(false)
                } else {
                    Err(io::Error::new(
                        ErrorKind::UnexpectedEof,
                        format!(
                            "stream ended {filled} bytes into a {} byte frame",
                            buf.len()
                        ),
                    ))
                };
            }
            Ok(n) => filled += n,
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(true)
}
