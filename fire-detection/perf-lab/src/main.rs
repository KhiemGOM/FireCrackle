//! Scan performance laboratory.
//!
//! `bench` runs the production first-person or no-fire per-frame code through the
//! same frame queue the app uses, fed by a child FFmpeg exactly as the app spawns
//! it (or by one of the alternative decoder set-ups under test), and reports
//! end-to-end frames per second including decoding. `eval` runs the same code at a
//! frame stride over a labelled recording and writes one decision per frame for
//! the Python scorer. Nothing here is a detector: every decision comes from
//! `fire_core::pov::PovMatcher` or `no_fire_cnn::policy`.
//!
//! Arguments are `key=value` pairs after the mode, see `usage`.

mod yuv;

use fire_core::{
    gui_mask::{GuiDetector, GuiFitHint, GuiOptions, GuiTextures},
    pov::PovMatcher,
    video::parallel_frames_indexed_with_state,
};
use no_fire_cnn::{policy, Engine};
use std::{
    collections::HashMap,
    io::{BufRead, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{atomic::AtomicBool, Mutex},
    time::Instant,
};

const USAGE: &str = "perf-lab bench|eval key=value...
  tool=pov|nofire            which production scan to run
  video=PATH                 recording
  w=W h=H                    native video size
  start=SECONDS              seek before decoding (bench only, default 0)
  frames=N                   frames to process (bench), or total decoded frames (eval)
  stride=S                   eval: keep every S-th frame (default 1)
  workers=K                  worker threads (default: fire_core::video::scan_workers)
  decoder=app|fast|cuvid     app = the exact FireCrackle decoder command; fast = no thread caps,
                             no showinfo; cuvid = fast + NVDEC av1_cuvid
  scale=WxH                  optional swscale resize inside FFmpeg (frames reach the scan at this size)
  repeat=R                   bench: repeat the run R times (default 1)
  pixfmt=rgb24|yuv420p       what the pipe carries (yuv420p: workers convert, bit-identically)
  provider=dml|cuda|...      no-fire backend override; batch=1 scores nine views per call
  out=PATH                   decisions as JSONL {n,row} or {n,clear}
perf-lab yuvcheck video= w= h= [start=] [frames=]   verify the YUV pipe reproduces rgb24 exactly
  root=PATH                  checkout holding runtime assets (default: this checkout's grandparent, i.e. the main checkout)
  ffmpeg=PATH runtime=PATH model=PATH   override the bundled tools
";

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

struct Args(HashMap<String, String>);
impl Args {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(String::as_str)
    }
    fn need(&self, key: &str) -> Result<&str, String> {
        self.get(key).ok_or_else(|| format!("missing {key}=\n{USAGE}"))
    }
    fn num<T: std::str::FromStr>(&self, key: &str, default: T) -> Result<T, String> {
        match self.get(key) {
            Some(v) => v.parse().map_err(|_| format!("bad number for {key}")),
            None => Ok(default),
        }
    }
}

fn run() -> Result<(), String> {
    let argv: Vec<String> = std::env::args().collect();
    let mode = argv.get(1).map(String::as_str).unwrap_or("");
    let args = Args(argv[2.min(argv.len())..]
        .iter()
        .filter_map(|a| a.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect());
    match mode {
        "bench" => bench(&args),
        "eval" => eval(&args),
        "yuvcheck" => yuvcheck(&args),
        _ => Err(USAGE.into()),
    }
}

/// Where the ignored runtime tools live. The worktree has no `runtime/`, so by
/// default look two levels up (`.board/scan-perf-lab/checkout` -> repository root).
fn root(args: &Args) -> PathBuf {
    args.get("root").map(PathBuf::from).unwrap_or_else(|| {
        let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let candidate = here.join("../../../../..").canonicalize().unwrap_or(here.clone());
        if candidate.join("FireCrackle/src-tauri/runtime/ffmpeg.exe").is_file() {
            candidate
        } else {
            here.join("../..")
        }
    })
}

struct Setup {
    tool: String,
    video: String,
    w: usize,
    h: usize,
    workers: usize,
    decoder: String,
    scale: Option<(usize, usize)>,
    /// `resize=nvdec`: let av1_cuvid scale on the GPU instead of an swscale filter.
    resize_in_decoder: bool,
    /// `checksum=0`: app decoder without showinfo's per-frame checksum.
    checksum: bool,
    /// `cuvid=h264_cuvid` etc.; the NVDEC decoder must match the stream codec.
    cuvid: String,
    /// `pixfmt=rgb24|yuv420p`: what the decoder pipe carries.
    pixfmt: String,
    /// `provider=cpu|dml|cuda|tensorrt|tensorrt-fp16` instead of the app's automatic choice.
    provider: Option<String>,
    /// `batch=1`: score the nine views per frame in one model run (needs the batched model).
    batch: bool,
    ffmpeg: PathBuf,
    runtime: PathBuf,
    model: Vec<u8>,
    sheet: Vec<u8>,
    checkout: PathBuf,
}
impl Setup {
    fn new(args: &Args) -> Result<Self, String> {
        let root = root(args);
        let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let w: usize = args.num("w", 0)?;
        let h: usize = args.num("h", 0)?;
        if w == 0 || h == 0 {
            return Err("w= and h= are required".into());
        }
        let scale = match args.get("scale") {
            Some(s) => {
                let (a, b) = s.split_once('x').ok_or("scale=WxH")?;
                Some((a.parse().map_err(|_| "bad scale")?, b.parse().map_err(|_| "bad scale")?))
            }
            None => None,
        };
        let (sw, sh) = scale.unwrap_or((w, h));
        let ffmpeg = args
            .get("ffmpeg")
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join("FireCrackle/src-tauri/runtime/ffmpeg.exe"));
        let runtime = args
            .get("runtime")
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join("FireCrackle/src-tauri/runtime/ai/onnxruntime.dll"));
        let model = std::fs::read(
            args.get("model")
                .map(PathBuf::from)
                .unwrap_or_else(|| root.join("FireCrackle/src-tauri/runtime/ai/no-fire-v3.onnx")),
        )
        .map_err(|e| format!("model: {e}"))?;
        let sheet = std::fs::read(checkout.join("fire-detection/data/assets/fire_1.rgba"))
            .map_err(|e| format!("sheet: {e}"))?;
        Ok(Self {
            tool: args.need("tool")?.to_string(),
            video: args.need("video")?.to_string(),
            w,
            h,
            workers: args.num("workers", fire_core::video::scan_workers(sw * sh * 3))?,
            decoder: args.get("decoder").unwrap_or("app").to_string(),
            scale,
            resize_in_decoder: args.get("resize") == Some("nvdec"),
            checksum: args.get("checksum") != Some("0"),
            cuvid: args.get("cuvid").unwrap_or("av1_cuvid").to_string(),
            pixfmt: args.get("pixfmt").unwrap_or("rgb24").to_string(),
            provider: args.get("provider").map(str::to_string),
            batch: args.get("batch") == Some("1"),
            ffmpeg,
            runtime,
            model,
            sheet,
            checkout,
        })
    }
    /// Frame size as the scan sees it.
    fn scan_size(&self) -> (usize, usize) {
        self.scale.unwrap_or((self.w, self.h))
    }
    fn asset(&self, name: &str) -> Result<Vec<u8>, String> {
        std::fs::read(self.checkout.join("fire-detection/data/assets/gui").join(name))
            .map_err(|e| format!("{name}: {e}"))
    }
    /// The no-fire scan's textures (`src-tauri/src/no_fire.rs::textures`): no recipe book.
    fn no_fire_textures(&self) -> Result<GuiTextures, String> {
        studio_core::gui::with_interactions(
            GuiTextures::from_rgba(
                self.asset("widgets.rgba")?,
                self.asset("icons.rgba")?,
                self.asset("inventory.rgba")?,
            )?
            .with_extras(Some(self.asset("bars.rgba")?), Some(self.asset("ascii.rgba")?))?,
        )
    }

    /// Spawn the decoder. `start` seeks by time; `stride` keeps every S-th frame;
    /// `frames` bounds the output. Returns the RGB pipe and the child.
    fn spawn(&self, start: f64, stride: u32, frames: u32) -> Result<(std::process::ChildStdout, Child, std::thread::JoinHandle<String>), String> {
        let mut c = Command::new(&self.ffmpeg);
        let app = self.decoder == "app";
        if app {
            // studio_core::proc::ffmpeg_command + open_scan_decoder, verbatim.
            c.args(["-threads", "2", "-filter_threads", "1", "-filter_complex_threads", "1"]);
            c.args(["-nostdin", "-hide_banner", "-loglevel", "info", "-nostats"]);
        } else {
            c.args(["-nostdin", "-v", "error"]);
        }
        let nvdec_resize = self.decoder == "cuvid" && self.resize_in_decoder && self.scale.is_some();
        if self.decoder == "cuvid" {
            c.args(["-c:v", &self.cuvid]);
            if let Some((sw, sh)) = self.scale.filter(|_| nvdec_resize) {
                c.args(["-resize", &format!("{sw}x{sh}")]);
            }
        }
        if start > 0.0 {
            if app {
                c.args(["-seek_timestamp", "1"]);
            }
            c.args(["-ss", &format!("{start}")]);
        }
        c.arg("-i").arg(&self.video).args(["-map", "0:v:0"]);
        let mut filters = Vec::new();
        if app {
            filters.push(if self.checksum {
                "trim=start_frame=0,showinfo".to_string()
            } else {
                "trim=start_frame=0,showinfo=checksum=0".to_string()
            });
        }
        if stride > 1 {
            filters.push(format!("select=not(mod(n\\,{stride}))"));
        }
        if let Some((sw, sh)) = self.scale.filter(|_| !nvdec_resize) {
            filters.push(format!("scale={sw}:{sh}"));
        }
        if !filters.is_empty() {
            c.args(["-vf", &filters.join(",")]);
        }
        c.args(["-fps_mode", "passthrough"]);
        c.args(["-frames:v", &frames.to_string()]);
        c.args(["-pix_fmt", &self.pixfmt, "-f", "rawvideo", "-"]);
        c.stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x08000000);
        }
        let mut child = c.spawn().map_err(|e| format!("spawn ffmpeg: {e}"))?;
        let pipe = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        // The app parses showinfo lines on a thread; draining is what costs here.
        let drain = std::thread::spawn(move || {
            let mut saved = std::collections::VecDeque::new();
            for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) {
                if !line.contains("showinfo") {
                    saved.push_back(line);
                    if saved.len() > 12 {
                        saved.pop_front();
                    }
                }
            }
            saved.into_iter().collect::<Vec<_>>().join("\n")
        });
        Ok((pipe, child, drain))
    }
}

/// One scan pass over `frames` frames; returns (seconds, rows sorted by n).
fn pass(
    setup: &Setup,
    start: f64,
    stride: u32,
    frames: u32,
    cancel: &AtomicBool,
) -> Result<(f64, Vec<(u32, Option<u8>)>), String> {
    let (w, h) = setup.scan_size();
    let rows = Mutex::new(Vec::with_capacity(frames as usize));
    let (pipe, mut child, drain) = setup.spawn(start, stride, frames)?;
    let mut started = Instant::now();
    let push = |n: u32, row: Option<u8>| rows.lock().unwrap().push((n, row));
    // `pixfmt=yuv420p`: the pipe carries planar YUV and each worker converts into
    // its own RGB buffer; otherwise FFmpeg delivers rgb24 as in the app.
    let yuv = setup.pixfmt == "yuv420p";
    let frame_bytes = if yuv { w * h * 3 / 2 } else { w * h * 3 };
    let state = || (GuiFitHint::default(), if yuv { vec![0u8; w * h * 3] } else { Vec::new() });
    fn as_rgb<'a>(yuv: bool, frame: &'a [u8], buffer: &'a mut Vec<u8>, w: usize, h: usize) -> &'a [u8] {
        if yuv {
            yuv::yuv420p_to_rgb24(frame, w, h, buffer);
            buffer
        } else {
            frame
        }
    }
    match setup.tool.as_str() {
        "pov" => {
            let matcher = PovMatcher::new(&setup.sheet, studio_core::gui::pov_textures()?, w, h)?;
            parallel_frames_indexed_with_state(
                pipe,
                frame_bytes,
                frames,
                setup.workers,
                cancel,
                state,
                |(hint, buffer), _, frame| {
                    let rgb = as_rgb(yuv, frame, buffer, w, h);
                    let result = matcher.match_frame_with_hint(rgb, hint)?;
                    if result.used_gui {
                        GUI_FRAMES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }
                    Ok(result.row)
                },
                push,
            )?;
        }
        "nofire" => {
            let detector = GuiDetector::new(setup.no_fire_textures()?, GuiOptions::default())?;
            detector.prepare(w, h);
            let engine = Mutex::new(ENGINE.with(|e| e.take()).map(Ok).unwrap_or_else(|| {
                let load = Instant::now();
                let engine = match &setup.provider {
                    Some(provider) => Engine::load_provider(&setup.runtime, &setup.model, provider, 2),
                    None => Engine::auto(&setup.runtime, &setup.model, cancel),
                };
                if let Ok(engine) = &engine {
                    eprintln!("engine {} ready in {:.1}s", engine.provider, load.elapsed().as_secs_f64());
                }
                engine
            })?);
            // Provider selection is a one-time cost the app also pays once per process.
            started = Instant::now();
            let batched = setup.batch;
            let result = parallel_frames_indexed_with_state(
                pipe,
                frame_bytes,
                frames,
                setup.workers,
                cancel,
                state,
                |(hint, buffer), _, frame| {
                    let rgb = as_rgb(yuv, frame, buffer, w, h);
                    let clear = policy::candidate_prepared_with_hint(rgb, w, h, &detector, hint, |raw, auto| {
                        if batched {
                            no_fire_cnn::clear_frame_batched(raw, auto, cancel, |views, count| {
                                engine.lock().map_err(|_| "AI state unavailable")?.score_batch(views, count)
                            })
                        } else {
                            Engine::clear_frame_shared(&engine, &setup.runtime, &setup.model, raw, auto, cancel)
                        }
                    })?;
                    Ok(clear.then_some(0))
                },
                push,
            );
            ENGINE.with(|e| e.set(engine.into_inner().ok()));
            result?;
        }
        other => return Err(format!("unknown tool {other}")),
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let seconds = started.elapsed().as_secs_f64();
    if !status.success() {
        return Err(format!("ffmpeg failed: {}", drain.join().unwrap_or_default()));
    }
    let mut rows = rows.into_inner().unwrap();
    rows.sort_by_key(|r| r.0);
    Ok((seconds, rows))
}

/// Frames on which the first-person matcher ran GUI detection (its expensive path).
static GUI_FRAMES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

thread_local! {
    /// Keep the warmed ONNX session between repeats, as the app keeps it between scans.
    static ENGINE: std::cell::Cell<Option<Engine>> = const { std::cell::Cell::new(None) };
}

fn write_rows(path: &str, tool: &str, rows: &[(u32, Option<u8>)], stride: u32) -> Result<(), String> {
    let mut out = std::io::BufWriter::new(std::fs::File::create(path).map_err(|e| e.to_string())?);
    for (n, row) in rows {
        let n = n * stride;
        let line = if tool == "pov" {
            serde_json::json!({"n": n, "row": row})
        } else {
            serde_json::json!({"n": n, "clear": row.is_some()})
        };
        writeln!(out, "{line}").map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn bench(args: &Args) -> Result<(), String> {
    let setup = Setup::new(args)?;
    let start: f64 = args.num("start", 0.0)?;
    let frames: u32 = args.num("frames", 600)?;
    let repeat: u32 = args.num("repeat", 1)?;
    let cancel = AtomicBool::new(false);
    let mut reference: Option<Vec<(u32, Option<u8>)>> = None;
    for repeat in 0..repeat {
        GUI_FRAMES.store(0, std::sync::atomic::Ordering::Relaxed);
        fire_core::profile::reset();
        let (seconds, rows) = pass(&setup, start, 1, frames, &cancel)?;
        let profile: Vec<_> = fire_core::profile::snapshot()
            .into_iter()
            .map(|(stage, calls, ms)| serde_json::json!({"stage": stage, "calls": calls, "ms": ms, "ms_per_call": ms / calls as f64}))
            .collect();
        let parity = reference.as_ref().map(|r| r == &rows);
        if reference.is_none() {
            reference = Some(rows.clone());
        }
        let (w, h) = setup.scan_size();
        println!(
            "{}",
            serde_json::json!({
                "tool": setup.tool, "decoder": setup.decoder, "video": setup.video,
                "ffmpeg": setup.ffmpeg.display().to_string(), "resize_in_decoder": setup.resize_in_decoder,
                "checksum": setup.checksum, "provider": setup.provider, "batch": setup.batch,
                "pixfmt": setup.pixfmt,
                "model": args.get("model"),
                "native": [setup.w, setup.h], "scan": [w, h], "workers": setup.workers,
                "start": start, "frames": frames, "repeat": repeat,
                "seconds": seconds, "fps": frames as f64 / seconds,
                "accepted": rows.iter().filter(|r| r.1.is_some()).count(),
                "gui_frames": GUI_FRAMES.load(std::sync::atomic::Ordering::Relaxed),
                "parity_with_first": parity,
                "profile": profile,
            })
        );
        if let Some(out) = args.get("out") {
            write_rows(out, &setup.tool, &rows, 1)?;
        }
    }
    Ok(())
}

fn eval(args: &Args) -> Result<(), String> {
    let setup = Setup::new(args)?;
    let total: u32 = args.num("frames", 0)?;
    let stride: u32 = args.num("stride", 1)?;
    if total == 0 {
        return Err("frames= (total decoded frames) is required for eval".into());
    }
    let kept = total.div_ceil(stride);
    let cancel = AtomicBool::new(false);
    let (seconds, rows) = pass(&setup, 0.0, stride, kept, &cancel)?;
    write_rows(args.need("out")?, &setup.tool, &rows, stride)?;
    println!(
        "{}",
        serde_json::json!({
            "tool": setup.tool, "decoder": setup.decoder, "video": setup.video,
            "stride": stride, "frames": kept, "seconds": seconds, "fps": kept as f64 / seconds,
            "accepted": rows.iter().filter(|r| r.1.is_some()).count(),
        })
    );
    Ok(())
}

/// Decode `frames` frames twice — FFmpeg's own rgb24 and yuv420p converted by
/// `yuv::yuv420p_to_rgb24` — and count differing bytes. Zero means the YUV pipe
/// is a transparent replacement for the app's rgb24 pipe.
fn yuvcheck(args: &Args) -> Result<(), String> {
    use std::io::Read;
    let mut setup = Setup::new(args)?;
    let start: f64 = args.num("start", 0.0)?;
    let frames: u32 = args.num("frames", 10)?;
    let (w, h) = setup.scan_size();
    let read_all = |setup: &Setup, bytes: usize| -> Result<Vec<u8>, String> {
        let (mut pipe, mut child, drain) = setup.spawn(start, 1, frames)?;
        let mut data = vec![0u8; bytes * frames as usize];
        pipe.read_exact(&mut data).map_err(|e| e.to_string())?;
        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(drain.join().unwrap_or_default());
        }
        Ok(data)
    };
    // `refdecoder=` compares against another decoder's rgb24 (e.g. NVDEC YUV vs software RGB).
    let decoder = setup.decoder.clone();
    setup.decoder = args.get("refdecoder").unwrap_or(&decoder).to_string();
    setup.pixfmt = "rgb24".into();
    let reference = read_all(&setup, w * h * 3)?;
    setup.decoder = decoder;
    setup.pixfmt = "yuv420p".into();
    let yuv = read_all(&setup, w * h * 3 / 2)?;
    let mut rgb = vec![0u8; w * h * 3];
    let mut differing = 0usize;
    let mut worst = 0u8;
    let mut bad_frames = 0;
    for f in 0..frames as usize {
        yuv::yuv420p_to_rgb24(&yuv[f * w * h * 3 / 2..(f + 1) * w * h * 3 / 2], w, h, &mut rgb);
        let before = differing;
        for (a, b) in rgb.iter().zip(&reference[f * w * h * 3..(f + 1) * w * h * 3]) {
            if a != b {
                differing += 1;
                worst = worst.max(a.abs_diff(*b));
            }
        }
        bad_frames += usize::from(differing != before);
    }
    println!(
        "{}",
        serde_json::json!({"video": setup.video, "frames": frames, "scan": [w, h], "decoder": setup.decoder,
            "differing_bytes": differing, "of": reference.len(), "max_abs_diff": worst, "frames_with_differences": bad_frames})
    );
    Ok(())
}

#[allow(dead_code)]
fn _unused(_: &Path) {}
