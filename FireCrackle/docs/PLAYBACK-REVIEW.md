# Playback investigation — job175

Reviewed2026-10-18. This is a local-file, frame-indexed annotation player with reverse playback and paused image processing. It is not an audio-master streaming player. No application window or release build was launched during this investigation. Tests use one Vitest worker, two Cargo compilation jobs, and an external temporary Cargo target directory.

## Observed failure and scope

The owner reported the playhead advancing while the picture remained loading, especially after a timeline seek. The recorded Kernel-Power41 event has no bugcheck or dump. It establishes an abnormal shutdown, not which component caused it. Prior comments claiming that four FFmpeg decodes took the machine down overstate the available evidence.

The deterministic App harness reproduced29 step requests in1second without a single delivered picture. Its clock was advanced at setInterval ticks, independently of image fetch, JPEG decode and display readiness. FrameBuffer.load also bypassed its parallel cap: three direct requests ran concurrently with parallel=2. Cancellation was ignored, and a stale out-of-window result was retained because it was still marked forced. These are separate defects; catching up the clock cannot fix an overwhelmed consumer.

## Source inspection: concrete mechanisms worth adopting

| Reference inspected | Mechanism | Application here |
| --- | --- | --- |
| [FFmpeg ffplay.c](https://github.com/FFmpeg/FFmpeg/blob/master/fftools/ffplay.c), video_refresh / frame_queue_peek_writable / packet_queue_flush | Picture availability is checked before presentation. Frame queues have finite capacity. Serial changes invalidate pre-seek packets; the video clock is updated from the frame being presented. | A wall-clock target is not evidence of a displayed frame. Hold media time until the current image has loaded; never treat an obsolete seek completion as readiness. Bound foreground requests as well as prefetch. |
| [mpv player/video.c](https://github.com/mpv-player/mpv/blob/master/player/video.c), write_video | Startup has explicit syncing/ready states. VD_WAIT returns without manufacturing a new picture; decoder/output wakeups drive progress. Underrun signalling is separate from successful presentation. | Distinguish wanting a frame, having its bytes, and having a loadable displayed image. A stall must not accumulate30frames of catch-up debt. |
| [mpv f_decoder_wrapper.c](https://github.com/mpv-player/mpv/blob/master/filters/f_decoder_wrapper.c), update_queue_config / public_f_reset | Decoder queues have byte, sample and duration bounds, reset independently, and propagate backpressure. | Limit processes, queued work, encoded bytes and decoded-image work separately. A process semaphore alone is not a memory/thread bound. |
| [CVAT frames.ts](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/frames.ts), FrameData.data / PrefetchAnalyzer | One active chunk request; request identifiers reject outdated work; prefetch starts partway through cached chunks. Decoded cache sizing uses frame dimensions and a memory budget. | Coalesce cache misses and cancel obsolete consumers rather than queueing a decode for every transient cursor position. Prefetch should replenish a bounded window, not chase a clock that outruns delivery. |
| [WebCodecs specification](https://www.w3.org/TR/webcodecs/), processing model / VideoDecoder / raw-media memory model | Explicit decode queue size/dequeue, reset/close, and release of retained media resources. Decoding and presentation are separate responsibilities. | A future compressed-video pipeline should have an explicit queue and frame lifetime. Merely moving JPEG decode to another API does not solve clock/cancellation bugs. |
| [FFmpeg codec options](https://ffmpeg.org/ffmpeg-codecs.html#Codec-Options) and [filter options](https://ffmpeg.org/ffmpeg.html#Advanced-options) | Codec threads default to automatic selection; filter pipelines default to available CPUs. Input/output option placement matters. | Bound decoder threads before input, filter pools globally, and MJPEG encoder threads after input. Below-normal process priority is not a CPU-thread limit. |

These projects are architectural references; their source has not been copied wholesale. Their current branch URLs can change. Relevant function names above identify what was inspected.

## Literature: useful findings and limits of transfer

1. [Huang et al., Using the Buffer to Avoid Rebuffers (2014)](https://arxiv.org/html/1401.2209v1). The paper argues for controlling observable playback-buffer occupancy instead of relying on unstable throughput estimates; the evaluation includes a deployed streaming client. For this app the transferable principle is feedback from actual readiness. Its bitrate adaptation is not directly applicable: our input is a fixed local recording, and silently reducing the image quality would harm labelling.
2. [Spiteri et al., BOLA (2020revision)](https://arxiv.org/html/1601.06748v3). BOLA treats finite buffer occupancy and rebuffering/quality as an explicit control objective. Its bounded-buffer model supports the decision to make buffering a normal state rather than let work accumulate. BOLA is an ABR selector, not a frame scheduler; adopting its bitrate equation would not repair our seek race or JPEG resource lifetime.
3. [Yang et al., Redline (OSDI2008)](https://www.usenix.org/legacy/events/osdi08/tech/full_papers/yang/yang_html/index.html). Their experiments show how concurrent CPU/memory/I/O-intensive work can make video and the desktop unresponsive. It motivates testing responsiveness and separate resource budgets, not merely average FPS. It does not diagnose this Windows shutdown or establish that a particular process caused it.
4. [Dutta and Zisserman, VIA (2019)](https://arxiv.org/abs/1904.10699). Relevant as a browser-based annotation system and baseline for using mature media facilities. It does not provide a drop-in native exact-frame reverse-playback implementation; cite it for annotation context, not as evidence that an arbitrary HTML video seek is frame-exact.

## Choice of playback engine

A native video element or embedded libmpv would avoid the JPEG-encode/IPC/image-decode cycle for ordinary forward playback. WebCodecs with a proper demuxer can offer explicit timestamped frames and decoder backpressure. Either is a larger engine migration: demuxing/container support, keyframe seek/discard, reverse GOP caching, video-frame identity, colour conversion, GPU resource lifetime, and the paused scientific image-processing path must remain correct. A plain currentTime assignment is not a substitute for the indexed labelling contract. First repair the existing clock and resource ownership, then benchmark the engine alternatives with the same presentation and seek tests.

The current JPEG path has a real structural cost: at60fps,100–200KB JPEGs imply roughly6–12MB/s of payload plus encoding, IPC allocation and browser decode. At1920×1080 an RGBA surface is about7.9MiB. More buffering can hide latency but cannot fix sustained producer throughput below consumption. Current fixes deliberately hold playback rather than pretend to sustain60fps by racing the playhead ahead of the picture.

## Test-first plan and evidence

- Slow producer / no displayed picture: hold the playhead; no accumulated catch-up debt after readiness returns. Test forward, reverse/speed arithmetic, a long stall and stale completion after seek.
- Foreground loads plus speculative loads: one shared concurrency bound; duplicate requests coalesce.
- Seek cancellation: queued obsolete requests never reach the backend; in-flight stale completions do not pin old bytes; disposal releases URLs.
- Native overload: finite wait queue, explicit cancellation, RAII process permits, invalid-limit clamp, bounded FFmpeg decoder/filter/encoder thread counts.
- Keep the per-frame path small. Do not raise line budgets to hide duplicated scheduling logic. Test the actual App wiring as well as the clock helper.

Initial red evidence:3 clock/App tests failed; App advanced29times while no frame was presented. Three independent buffer-limit tests failed (parallel bypass, ignored queued cancellation, stale byte retention). Native overload admitted40waiting requests with no finite cap. Command inspection initially lacked explicit thread budgets.

## Implemented result and verification

- Playback advances only after the current image has loaded. A missing picture resets the media clock, so ten seconds of buffering cannot become a thirty-frame catch-up jump. A stale URL/frame cannot report readiness for the new target.
- Foreground and speculative fetches share the configured 1–8 in-flight limit. At most32 additional requests wait; cancelled queued requests never reach IO. One fetch serves duplicate consumers; cancelling one consumer does not cancel another. Already-issued IPC requests finish inside the bound and their stale results are discarded; seeking does not yet interrupt the native process for each individual IPC request.
- The browser owns at most64MiB of cached JPEG payload; a single JPEG over16MiB is refused. Speculation stops below the limit instead of endlessly refetching evicted pictures. The displayed URL survives eviction. At most two predecodes run concurrently, with an eight-frame warm horizon. Browser/GPU image caches are managed by the browser; this is not a claimed hard bound on total GPU or process memory.
- The native cache retains its configured byte budget. Per-workspace foreground misses serialize and recheck the cache, coalescing identical cold requests; existing cached pictures bypass that lock. Workspace close propagates cancellation to frame work as well as thumbnails.
- The process gate holds at most32waiters and1–8active frame decodes (default2). FFmpeg decoding uses2codec threads, filter pools1, MJPEG encoding1; these options do not bound every internal FFmpeg OS thread. A thumbnail pass remains separate from the frame gate, but uses the same CPU and pipe budgets.
- Frame/thumbnail subprocess capture is shared:128MiB stdout and8MiB stderr per command. A10ms cancellation poll kills and reaps a silent child without waiting for its next pipe write. Tests cover cancellation, excessive output and both normal pipes.
- The buffer implementation is smaller than its original233lines and still fits its260line budget. No line budgets were raised. The temporary lost-frame debug readout and per-frame statistics collection were removed at the owner's request.

Verification: full frontend suite passed (110files,1180tests before the additional image-load regression), TypeScript `tsc --noEmit` passed, and the full `studio_core` suite passed with two compilation jobs and serial test execution. The65focused frame/thumbnail tests were then rerun with bundled FFmpeg8.1.2 on PATH and passed, including real fixture decoding, B-frame/timestamp alignment, nonzero starts, image sizes and thumbnail extraction. This distinction matters: those tests skip codec-dependent cases when FFmpeg is absent. Focused regressions also exercise100cancelled seeks, a ten-second stalled consumer, bounded predecode work,64MiB retention and stopped speculative filling.

The owner independently reports the build they tested is now smooth. These later robustness edits have not been launched in the desktop app. Actual desktop throughput, compositor presentation timing and the cause of the PC shutdown remain unverified. No application was launched, no release build was made, and nothing was pushed.
