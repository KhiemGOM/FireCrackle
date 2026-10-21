# Scan performance lab — report

Branch `claude/scan-perf-lab` (worktree `.board/scan-perf-lab/checkout`), 2026-10-21.
Running log with every experiment and raw numbers: [`LOG.md`](LOG.md); raw JSON in `results/`.

## Goal and outcome

**Goal (owner):** ≥ 60 fps end-to-end, decode included, for both the first-person scan and
the no-fire scan on the owner's 1440p60 AV1 recording, on this laptop (i9-13900HX, RTX 4060
Laptop), with recall / false positives within ~10 % of current main — to be judged from
this report. Separate experiment; nothing integrated into the app.

**Outcome:** both scans exceed the target by about 2×, with **no change in any decision on
every check run** (eight 1,800-frame decision vectors across 1080p and 1440p, two labelled
recordings scored against ground truth, all core and model-crate unit tests). Measurements
were taken while the FireCrackle app itself was running a scan in the background
(≈ 6–10 cores busy), so they are conservative.

| 1440p60 recording, 1,800 frames, 12 workers | app today | lab | decisions |
|---|---:|---:|---|
| first-person, fire-rich segment (5490 s, GUI path on 81 % of frames) | 33.8 fps | **130–135 fps** | 347 accepted, unchanged |
| first-person, 20 s segment (no fire) | 40.5 fps | 127 fps | unchanged |
| first-person, 7230 s segment (1,234 accepted) | — | 164 fps | — |
| no-fire (→ 1080p), fire-rich segment | 37.0 fps | **140–154 fps** | 237 clears, unchanged |
| no-fire, 20 s segment | 40.5–45 fps | 255 fps | — |
| no-fire, 7230 s segment | — | 286 fps | — |
| first-person / no-fire, 1080p V03 (app decoder, decode-bound) | 131 / 128 fps | 131 / 128 fps | 110 accepted / 308 clears, unchanged |

Ground truth (lab build, exact changes): `later` 338/344 accepted-and-correct, 0/309 false
positives; `early` 5/5, 0/1,875 FP — identical to the production regression
(`docs/GUI_PRODUCTION_CHECK.md`). With pose pruning on: see "Measured, not exact" below.

## What made the difference (in order of effect)

1. **The decoder, not the scan, was the 1440p bottleneck.** The bundled FFmpeg is the gyan
   "essentials" build, which has no libdav1d; it decodes this AV1 file with libaom at 92 fps
   on its own, and the app additionally runs it with `-threads 2`, `-filter_threads 1`
   (single-threaded RGB conversion) and a per-frame `showinfo` checksum. Removing the caps
   gives 63 fps; NVDEC (`-c:v av1_cuvid`) or libdav1d (the "full" build) roughly doubles
   both scans. The checksum itself costs nothing measurable.
2. **Half-bandwidth pipe with a bit-exact conversion.** FFmpeg delivers yuv420p (1.5 B/px)
   and each worker converts to RGB with the exact 16-bit fixed-point arithmetic of the
   bundled FFmpeg's SIMD swscale path, fitted from an exhaustive synthetic frame
   (`fit_swscale.py`, `src/yuv.rs`): 0 of 11,059,200 channel values differ on real frames,
   `perf-lab yuvcheck` reports 0 differing bytes. Side finding: FFmpeg's *own*
   `av1_cuvid → rgb24` output is colour-shifted versus software decoding (NV12 without the
   stream's colour tags), so the YUV pipe is also what makes NVDEC correct.
3. **Exact CPU savings in the first-person chain** (same expressions, same order, every
   value identical; unit tests pass): one-pass veil judgment (1.7× on real frames), HUD piece
   variants sample the frame once and resolve their templates once (≈ 20,000 correlations
   per frame), silhouette exclusions as predicates instead of two frame-sized masks, text
   grid sampled once, tooltip rim scan as a byte-arithmetic row pass, per-row LUT unveil,
   integer orange-mask bounds proven equal to the float rule for every byte triple.
4. **No-fire view order (exact).** A frame clears only if all nine raw and nine unveiled
   views clear, so scoring order cannot change a decision. From the full rejection matrix of
   1,200 sampled frames, a greedy order scores the views most likely to reject first: model
   calls per frame on the fire segment 6.3 → 3.0, no-fire 106 → 140–154 fps. The GPU session
   had been held ~100 % of wall time; it no longer is.
5. **HUD-scale pose pruning (measured, opt-in).** The known-panel detector visited ~104,000
   poses per GUI frame at ~18 probe reads each (already its early-exit floor). Vanilla draws
   HUD and screens with one window scale factor (`Window.calculateScaleFactor` via
   `MinecraftClient.onResolutionChanged`, PLAN-GUI-MASK.md §1.1), so poses are restricted to
   the frame's reliable hotbar scale (±0.26): 91 % fewer poses, interactions 41 → 13 ms per
   GUI frame. Not provably output-identical (a wrong hotbar fit could hide a panel) — see
   below for what was measured.
6. Smaller exact items: `target-cpu=native` build (+10–15 %), probe-address prefetch,
   uint8-input model variant (+7 %, Cast inside the graph).

## Measured, not exact

- **Pose pruning:** 0 decision changes on the 1440p fire segment, the 1440p 20 s segment and
  1080p V03 (1,800 frames each); ground truth on `later`/`early` with pruning on is
  identical to pruning off (338/344 and 5/5 correct, 0 false positives, 0 wrong rows). It
  stays behind the `SCALE_PRUNE` switch; integration should keep a way to turn it off and
  should run the full six-recording production regression once.
- **NVDEC frame differences:** on this *recovered* AV1 file NVDEC decodes ~2 % of frames
  (6 of 300 inspected) as visibly different pictures (max channel difference 255), which
  changed 8 of 1,800 decisions (0.4 %) on the fire segment. libdav1d is bit-identical to
  libaom and, through the YUV pipe, gave **135.9 fps with 0 decision differences** — the
  same speed as NVDEC. It needs the "full" FFmpeg package instead of "essentials"
  (`FireCrackle/release/runtime-lock.json`), same licence and source.
- **No-fire at 1440p** has no app precedent (the policy is 1920×1080-only); the lab feeds
  it a 1920×1080 downscale. Three resamplers (swscale on RGB, swscale on YUV, NVDEC's own)
  give three different decision sets and cannot be scored (no 1440p labels). Pick one when
  integrating; the YUV-domain swscale is the fastest.

## Rejected (all measured, see LOG for numbers)

Batching the nine views into one model call (DirectML 5× slower: the per-view early exit is
worth more); CUDA execution provider (slower than DirectML here); fp16 (no gain, moved 2
decisions); DirectML session pools; hybrid CPU+GPU sessions; a split-coefficient "SIMD"
resize (2.5× slower); a byte-vectorised veil variant (slower); removing the showinfo
checksum; the orange-pixel-sum shortcut (exact but never fires on fire-rich frames).

## Not tried (next levers if more is wanted)

In-process decoding (libavcodec/NVDEC directly, no pipe: the yuv420p pipe tops out near
320 fps); hand-written AVX2 for the tooltip rim scan, veil margins and the Pillow-exact
resize (each ~10–20 Mcyc per frame, all memory/ALU bound scalar code today); TensorRT (needs
the TensorRT runtime); a smaller/lower-resolution model (would need an approved training run).

## Reproduce

```bash
# build (lab target dir keeps the main checkout's builds untouched)
CARGO_TARGET_DIR=D:/Coding/Minecraft/FireCracking/.board/scan-perf-lab/target cargo build --release --manifest-path fire-detection/perf-lab/Cargo.toml
# app-faithful baseline
perf-lab bench tool=pov video=misc/dream/recovered-video.mkv w=2560 h=1440 start=5490 frames=1800 decoder=app
# lab configuration
perf-lab bench tool=pov video=... w=2560 h=1440 start=5490 frames=1800 decoder=cuvid pixfmt=yuv420p scale_prune=1 out=rows.jsonl
perf-lab bench tool=nofire video=... w=2560 h=1440 scale=1920x1080 start=5490 frames=1800 decoder=cuvid pixfmt=yuv420p scale_prune=1 view_order=0:0,0:5,1:4,0:2,0:4,0:6,0:8,0:3,0:1,0:7,1:0,1:1,1:2,1:3,1:5,1:6,1:7,1:8
# exact-parity decoder alternative
perf-lab bench ... decoder=fast ffmpeg=<full ffmpeg build> pixfmt=yuv420p
# accuracy on labelled recordings
python fire-detection/perf-lab/eval.py pov --tag check --names later,early --decoder app [--extra scale_prune=1]
```
