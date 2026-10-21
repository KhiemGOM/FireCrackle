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
        "micro" => micro(&args),
        "resize" => resize_bench(&args),
        "veilbench" => veil_bench(&args),
        "views" => views(&args),
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
    /// `sessions=K`: number of model sessions shared by the workers (default 1, as in the app).
    sessions: usize,
    /// `cpu_sessions=N`: extra CPU sessions used when the GPU session(s) are busy.
    cpu_sessions: usize,
    /// `extra_provider=dml1|cuda|...`: backend of the extra sessions (default: same as the first).
    extra_provider: Option<String>,
    /// `input=u8`: feed uint8 views (needs the u8-input model variant).
    input_u8: bool,
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
            sessions: args.num("sessions", 1)?,
            cpu_sessions: args.num("cpu_sessions", 0)?,
            extra_provider: args.get("extra_provider").map(str::to_string),
            input_u8: args.get("input") == Some("u8"),
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
            // `sessions=K`: K-1 additional DirectML sessions so views from different
            // workers can be in flight at once instead of queueing on one lock.
            let extra_provider = setup.extra_provider.as_deref().or(setup.provider.as_deref()).unwrap_or("dml");
            let extra: Vec<Mutex<Engine>> = (1..setup.sessions)
                .map(|_| Engine::load_provider(&setup.runtime, &setup.model, extra_provider, 2).map(Mutex::new))
                .collect::<Result<_, _>>()?;
            for e in &extra {
                eprintln!("extra session: {}", e.lock().map_err(|_| "AI state unavailable")?.provider);
            }
            // `cpu_sessions=N`: CPU sessions that take a view whenever every GPU
            // session is busy (hybrid; CPU and GPU scores agree within the app's
            // own 1e-4 acceptance tolerance, decisions are compared, not assumed).
            let cpu: Vec<Mutex<Engine>> = (0..setup.cpu_sessions)
                .map(|_| Engine::load(&setup.runtime, &setup.model, false, 2).map(Mutex::new))
                .collect::<Result<_, _>>()?;
            let pool: Vec<&Mutex<Engine>> = std::iter::once(&engine).chain(extra.iter()).chain(cpu.iter()).collect();
            let u8_input = setup.input_u8;
            let score = move |session: &mut Engine, view: &[u8]| {
                if u8_input {
                    session.score_view_u8(view)
                } else {
                    session.score_view(view)
                }
            };
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
                        } else if pool.len() > 1 || u8_input {
                            no_fire_cnn::clear_frame_with(raw, auto, cancel, |view| {
                                for session in &pool {
                                    if let Ok(mut session) = session.try_lock() {
                                        return score(&mut session, view);
                                    }
                                }
                                let mut guard = pool[0].lock().map_err(|_| "AI state unavailable")?;
                                score(&mut guard, view)
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
    // Experiment switches that live inside fire_core / no_fire_cnn.
    let scale_prune = args.get("scale_prune") == Some("1");
    if let Some(order) = args.get("view_order") {
        // "0:5,0:3,1:4,..." as (pass, tile) pairs
        let pairs: Vec<(u8, u8)> = order
            .split(',')
            .map(|p| {
                let (a, b) = p.split_once(':').ok_or("view_order=pass:tile,...")?;
                Ok((a.parse().map_err(|_| "bad pass")?, b.parse().map_err(|_| "bad tile")?))
            })
            .collect::<Result<_, String>>()?;
        no_fire_cnn::set_view_order(pairs)?;
    }
    fire_core::gui_interaction::SCALE_PRUNE.store(scale_prune, std::sync::atomic::Ordering::Relaxed);
    let start: f64 = args.num("start", 0.0)?;
    let frames: u32 = args.num("frames", 600)?;
    let repeat: u32 = args.num("repeat", 1)?;
    let cancel = AtomicBool::new(false);
    let mut reference: Option<Vec<(u32, Option<u8>)>> = None;
    for repeat in 0..repeat {
        GUI_FRAMES.store(0, std::sync::atomic::Ordering::Relaxed);
        fire_core::profile::reset();
        let (seconds, rows) = pass(&setup, start, 1, frames, &cancel)?;
        let cycles: std::collections::HashMap<_, _> =
            fire_core::profile::cycles().into_iter().map(|(s, _, g)| (s, g)).collect();
        let profile: Vec<_> = fire_core::profile::snapshot()
            .into_iter()
            .map(|(stage, calls, ms)| {
                let gcycles = cycles.get(stage).copied().unwrap_or(0.0);
                serde_json::json!({"stage": stage, "calls": calls, "ms": ms, "ms_per_call": ms / calls as f64,
                    "gcycles": gcycles, "mcycles_per_call": gcycles * 1e3 / calls as f64})
            })
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
                "pixfmt": setup.pixfmt, "scale_prune": scale_prune, "sessions": setup.sessions,
                "cpu_sessions": setup.cpu_sessions, "input_u8": setup.input_u8, "view_order": args.get("view_order"),
                "model": args.get("model"),
                "native": [setup.w, setup.h], "scan": [w, h], "workers": setup.workers,
                "start": start, "frames": frames, "repeat": repeat,
                "seconds": seconds, "fps": frames as f64 / seconds,
                "accepted": rows.iter().filter(|r| r.1.is_some()).count(),
                "gui_frames": GUI_FRAMES.load(std::sync::atomic::Ordering::Relaxed),
                "parity_with_first": parity,
                "profile": profile,
                "counters": fire_core::profile::counters().into_iter().collect::<std::collections::BTreeMap<_, _>>(),
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

/// Single-threaded stage micro-benchmark: decode `frames` frames into memory,
/// then run the production per-frame code `repeat` times on one thread and
/// report thread-CPU cycles per stage. Cycle counts on one uncontended thread
/// are far steadier than the contended wall times of a full scan.
fn micro(args: &Args) -> Result<(), String> {
    use std::io::Read;
    let setup = Setup::new(args)?;
    fire_core::gui_interaction::SCALE_PRUNE.store(args.get("scale_prune") == Some("1"), std::sync::atomic::Ordering::Relaxed);
    let start: f64 = args.num("start", 0.0)?;
    let frames: u32 = args.num("frames", 24)?;
    let repeat: u32 = args.num("repeat", 3)?;
    let stride: u32 = args.num("stride", 1)?;
    let (w, h) = setup.scan_size();
    let (mut pipe, mut child, drain) = setup.spawn(start, stride, frames)?;
    let mut data = vec![0u8; w * h * 3 * frames as usize];
    pipe.read_exact(&mut data).map_err(|e| e.to_string())?;
    if !child.wait().map_err(|e| e.to_string())?.success() {
        return Err(drain.join().unwrap_or_default());
    }
    let cancel = AtomicBool::new(false);
    fire_core::profile::reset();
    let started = Instant::now();
    let cycles0 = fire_core::profile::thread_cycles();
    match setup.tool.as_str() {
        "pov" => {
            let matcher = PovMatcher::new(&setup.sheet, studio_core::gui::pov_textures()?, w, h)?;
            let mut hint = GuiFitHint::default();
            for _ in 0..repeat {
                for frame in data.chunks_exact(w * h * 3) {
                    matcher.match_frame_with_hint(frame, &mut hint)?;
                }
            }
        }
        "nofire" => {
            let detector = GuiDetector::new(setup.no_fire_textures()?, GuiOptions::default())?;
            detector.prepare(w, h);
            let mut engine = match &setup.provider {
                Some(provider) => Engine::load_provider(&setup.runtime, &setup.model, provider, 2)?,
                None => Engine::auto(&setup.runtime, &setup.model, &cancel)?,
            };
            let mut hint = GuiFitHint::default();
            for _ in 0..repeat {
                for frame in data.chunks_exact(w * h * 3) {
                    policy::candidate_prepared_with_hint(frame, w, h, &detector, &mut hint, |raw, auto| {
                        engine.clear_frame(raw, auto, &cancel)
                    })?;
                }
            }
        }
        other => return Err(format!("unknown tool {other}")),
    }
    let total_cycles = fire_core::profile::thread_cycles() - cycles0;
    let seconds = started.elapsed().as_secs_f64();
    let per_frame = (frames * repeat) as f64;
    let cycles: std::collections::HashMap<_, _> = fire_core::profile::cycles().into_iter().map(|(s, _, g)| (s, g)).collect();
    let mut stages: Vec<_> = fire_core::profile::snapshot()
        .into_iter()
        .map(|(stage, calls, ms)| (stage, calls, ms, cycles.get(stage).copied().unwrap_or(0.0)))
        .collect();
    stages.sort_by(|a, b| b.3.partial_cmp(&a.3).unwrap());
    println!(
        "{}",
        serde_json::json!({
            "tool": setup.tool, "scan": [w, h], "frames": frames, "repeat": repeat, "seconds": seconds,
            "ms_per_frame": seconds * 1000.0 / per_frame, "mcycles_per_frame": total_cycles as f64 / 1e6 / per_frame,
            "stages": stages.iter().map(|(s, calls, ms, g)| serde_json::json!({
                "stage": s, "calls": calls, "ms_per_call": ms / *calls as f64, "mcycles_per_call": g * 1e3 / *calls as f64,
                "mcycles_per_frame": g * 1e3 / per_frame })).collect::<Vec<_>>(),
            "counters": fire_core::profile::counters().into_iter().collect::<std::collections::BTreeMap<_, _>>(),
        })
    );
    Ok(())
}

/// Time `no_fire_cnn::resize` against the committed reference on real 1080p
/// frames (full view and one tile), checking the outputs are identical.
fn resize_bench(args: &Args) -> Result<(), String> {
    use std::io::Read;
    let setup = Setup::new(args)?;
    let start: f64 = args.num("start", 0.0)?;
    let frames: u32 = args.num("frames", 8)?;
    let repeat: u32 = args.num("repeat", 10)?;
    let (w, h) = setup.scan_size();
    if (w, h) != (1920, 1080) {
        return Err("resize bench needs 1920x1080 frames (use scale=1920x1080)".into());
    }
    let (mut pipe, mut child, drain) = setup.spawn(start, 1, frames)?;
    let mut data = vec![0u8; w * h * 3 * frames as usize];
    pipe.read_exact(&mut data).map_err(|e| e.to_string())?;
    if !child.wait().map_err(|e| e.to_string())?.success() {
        return Err(drain.join().unwrap_or_default());
    }
    let rects = no_fire_cnn::tile_boxes();
    let mut report = serde_json::Map::new();
    for (name, rect) in [("full", rects[0]), ("tile", rects[1])] {
        let mut mismatches = 0usize;
        let mut cycles = [0u64; 2];
        for frame in data.chunks_exact(w * h * 3) {
            let cropped = &frame[1920 * 12 * 3..];
            let reference = no_fire_cnn::resize_reference(cropped, 1920, rect);
            let fast = no_fire_cnn::resize(cropped, 1920, rect);
            mismatches += usize::from(reference != fast);
            for _ in 0..repeat {
                let c0 = fire_core::profile::thread_cycles();
                std::hint::black_box(no_fire_cnn::resize_reference(cropped, 1920, rect));
                let c1 = fire_core::profile::thread_cycles();
                std::hint::black_box(no_fire_cnn::resize(cropped, 1920, rect));
                let c2 = fire_core::profile::thread_cycles();
                cycles[0] += c1 - c0;
                cycles[1] += c2 - c1;
            }
        }
        let n = (frames * repeat) as f64;
        report.insert(name.into(), serde_json::json!({"mismatching_frames": mismatches,
            "reference_mcycles": cycles[0] as f64 / 1e6 / n, "fast_mcycles": cycles[1] as f64 / 1e6 / n}));
    }
    println!("{}", serde_json::Value::Object(report));
    Ok(())
}

/// Time `veil::detect_pixels` against the four-pass reference on real frames.
fn veil_bench(args: &Args) -> Result<(), String> {
    use std::io::Read;
    let setup = Setup::new(args)?;
    let start: f64 = args.num("start", 0.0)?;
    let frames: u32 = args.num("frames", 24)?;
    let repeat: u32 = args.num("repeat", 5)?;
    let stride: u32 = args.num("stride", 15)?;
    let (w, h) = setup.scan_size();
    let (mut pipe, mut child, drain) = setup.spawn(start, stride, frames)?;
    let mut data = vec![0u8; w * h * 3 * frames as usize];
    pipe.read_exact(&mut data).map_err(|e| e.to_string())?;
    if !child.wait().map_err(|e| e.to_string())?.success() {
        return Err(drain.join().unwrap_or_default());
    }
    let o = fire_core::veil::Options::default();
    let (mut mismatches, mut cycles) = (0usize, [0u64; 2]);
    for frame in data.chunks_exact(w * h * 3) {
        let reference = fire_core::veil::detect_pixels_reference(frame, w, h, 3, 16, o)?;
        let fast = fire_core::veil::detect_pixels(frame, w, h, 3, 16, o)?;
        mismatches += usize::from(reference != fast);
        for _ in 0..repeat {
            let c0 = fire_core::profile::thread_cycles();
            std::hint::black_box(fire_core::veil::detect_pixels_reference(frame, w, h, 3, 16, o)?);
            let c1 = fire_core::profile::thread_cycles();
            std::hint::black_box(fire_core::veil::detect_pixels(frame, w, h, 3, 16, o)?);
            let c2 = fire_core::profile::thread_cycles();
            cycles[0] += c1 - c0;
            cycles[1] += c2 - c1;
        }
    }
    let n = (frames * repeat) as f64;
    println!("{}", serde_json::json!({"scan": [w, h], "mismatching_frames": mismatches,
        "reference_mcycles": cycles[0] as f64 / 1e6 / n, "fast_mcycles": cycles[1] as f64 / 1e6 / n}));
    Ok(())
}

/// For a strided sample of frames, score every view of the raw frame and (when
/// veiled) of the unveiled frame without early exit, and write one line per
/// frame: which views would reject it. Any view order gives the same frame
/// decision, so this is the data for choosing a cheaper order.
fn views(args: &Args) -> Result<(), String> {
    use std::io::Read;
    let setup = Setup::new(args)?;
    let start: f64 = args.num("start", 0.0)?;
    let frames: u32 = args.num("frames", 120)?;
    let stride: u32 = args.num("stride", 15)?;
    let (w, h) = setup.scan_size();
    let (mut pipe, mut child, drain) = setup.spawn(start, stride, frames)?;
    let mut data = vec![0u8; w * h * 3 * frames as usize];
    pipe.read_exact(&mut data).map_err(|e| e.to_string())?;
    if !child.wait().map_err(|e| e.to_string())?.success() {
        return Err(drain.join().unwrap_or_default());
    }
    let cancel = AtomicBool::new(false);
    let mut engine = match &setup.provider {
        Some(provider) => Engine::load_provider(&setup.runtime, &setup.model, provider, 2)?,
        None => Engine::auto(&setup.runtime, &setup.model, &cancel)?,
    };
    let mut out = std::io::BufWriter::new(std::fs::File::create(args.need("out")?).map_err(|e| e.to_string())?);
    for (i, frame) in data.chunks_exact(w * h * 3).enumerate() {
        let (veiled, _) = fire_core::veil::detect_pixels(frame, w, h, 3, 12, fire_core::veil::Options::default())?;
        let cnn_needed = policy::cnn_needed(frame, w, h)?;
        let unveiled = if veiled { Some(fire_core::veil::unveil_rgb(frame, w, h)?) } else { None };
        let mut scores = Vec::new();
        for rgb in std::iter::once(frame).chain(unveiled.as_deref()) {
            let cropped = &rgb[1920 * 12 * 3..];
            for rect in no_fire_cnn::tile_boxes() {
                let view = no_fire_cnn::resize(cropped, 1920, rect);
                scores.push(engine.score_view(&view)?);
            }
        }
        let rejects: Vec<bool> = scores.iter().map(|&s| !no_fire_cnn::clear_score(s)).collect();
        writeln!(out, "{}", serde_json::json!({"n": i as u32 * stride, "veiled": veiled, "cnn_needed": cnn_needed, "rejects": rejects, "scores": scores}))
            .map_err(|e| e.to_string())?;
    }
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
