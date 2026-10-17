use fire_core::{
    gui_mask::{GuiDetector, GuiOptions, GuiTextures},
    video::parallel_frames,
};
use no_fire_cnn::{Engine, policy};
use std::{
    fs::{File, read},
    io::Write,
    path::Path,
    process::{Command, Stdio},
    sync::{Mutex, atomic::AtomicBool},
    time::Instant,
};
fn main() -> Result<(), String> {
    let a: Vec<_> = std::env::args().collect();
    if a.len() != 10 {
        return Err(
            "runtime model ffmpeg video gui-folder output total-frames stride workers".into(),
        );
    }
    let load = |name: &str| read(Path::new(&a[5]).join(name)).map_err(|e| e.to_string());
    let tex = GuiTextures::from_rgba(
        load("widgets.rgba")?,
        load("icons.rgba")?,
        load("inventory.rgba")?,
    )?
    .with_extras(Some(load("bars.rgba")?), Some(load("ascii.rgba")?))?;
    let detector = GuiDetector::new(tex, GuiOptions::default())?;
    detector.prepare(1920, 1080);
    let mut engine = Engine::load(
        Path::new(&a[1]),
        &read(&a[2]).map_err(|e| e.to_string())?,
        false,
        2,
    )?;
    let mode = std::env::var("NO_FIRE_BENCH_ENGINE").unwrap_or_default();
    if mode == "auto" {
        engine = Engine::auto(
            Path::new(&a[1]),
            &read(&a[2]).map_err(|e| e.to_string())?,
            &AtomicBool::new(false),
        )?;
    }
    let engine = Mutex::new(engine);
    let total: u32 = a[7].parse().map_err(|_| "Bad total")?;
    let stride: u32 = a[8].parse().map_err(|_| "Bad stride")?;
    let workers: usize = a[9].parse().map_err(|_| "Bad workers")?;
    let mut command = Command::new(&a[3]);
    command
        .args([
            "-nostdin",
            "-v",
            "error",
            "-threads",
            "2",
            "-filter_threads",
            "1",
            "-i",
        ])
        .arg(&a[4])
        .args([
            "-vf",
            &format!("select=not(mod(n\\,{stride}))"),
            "-fps_mode",
            "passthrough",
            "-frames:v",
            &total.div_ceil(stride).to_string(),
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "-threads",
            "1",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08004000);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let mut out = File::create(&a[6]).map_err(|e| e.to_string())?;
    let cancel = AtomicBool::new(false);
    let start = Instant::now();
    let mut count = 0;
    let mut clears = 0;
    let result = parallel_frames(
        child.stdout.take().unwrap(),
        1920 * 1080 * 3,
        total.div_ceil(stride),
        workers,
        &cancel,
        |rgb| {
            policy::candidate_prepared(rgb, 1920, 1080, &detector, |raw, auto| {
                engine
                    .lock()
                    .map_err(|_| "engine lock")?
                    .clear_frame(raw, auto, &cancel)
            })
        },
        |n, clear| {
            let _ = writeln!(
                out,
                "{}",
                serde_json::json!({"frame":n*stride,"clear":clear})
            );
            count += 1;
            clears += clear as usize;
            if count % 100 == 0 {
                eprintln!(
                    "processed={count} clears={clears} seconds={:.1}",
                    start.elapsed().as_secs_f64()
                );
            }
        },
    );
    if result.is_err() {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    result?;
    if !status.success() {
        return Err("FFmpeg failed".into());
    }
    eprintln!(
        "frames={count} clears={clears} workers={workers} seconds={:.3}",
        start.elapsed().as_secs_f64()
    );
    Ok(())
}
