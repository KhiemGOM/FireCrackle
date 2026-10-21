# Scan performance lab — report

Branch `claude/scan-perf-lab` (worktree `.board/scan-perf-lab/checkout`), 2026-10-21.
Running log with every experiment and raw numbers: [`LOG.md`](LOG.md); raw JSON in `results/`.

## Goal and outcome

**Goal (owner):** ≥ 60 fps end-to-end, decode included, for both the first-person scan and
the no-fire scan on the owner's 1440p60 AV1 recording, on this laptop (i9-13900HX, RTX 4060
Laptop), with recall / false positives within ~10 % of current main — to be judged from
this report. Separate experiment; nothing integrated into the app.

**Outcome:** both scans exceed the target at every resolution tested, 2–3× over at 1440p,
with **no change in any decision on the real recordings** (decision vectors at 1080p and
1440p, two labelled recordings scored against ground truth, all core and model-crate unit
tests). The 1440p file was the wall-clock target; the owner asked for the speed-up to
generalise, so 720p and 4K were tested on clips resized from the 1440p segment (speed only —
they are not real captures, see below).

Final before/after, same machine, same hour, 1,800 frames each, 12 workers, light
background load (the FireCrackle app open, ≈ 3–5 cores): `app` = the app's exact FFmpeg
command on current main code; `lab` = this branch's configuration.

| Recording | first-person app → lab | no-fire (→1080p) app → lab | decisions (lab vs app) |
|---|---:|---:|---|
| **2560×1440 AV1**, fire-rich segment (real) | 41.9 → **125.2** | 30.9 → **140.7** | 8 / 4 of 1,800 differ, all from NVDEC decoding ~2 % of this recovered file's frames differently; libdav1d gives 0 at the same speed |
| **1920×1080 H.264** `later` (real, fire-rich, GUI path on 70 % of frames) | 90.7 → **124.6** | 157.4 → **201.5** | 0 / 0 |
| **1920×1080 H.264** V03 (real, mixed) | 105.0 → **258.6** | 125.2 → **239.4** | 0 / 0 |
| 1280×720 H.264 (synthetic, downscaled) | 99.5 → 196.8 | 49.9 → 128.1 | speed only |
| 3840×2160 H.264 (synthetic, upscaled) | 38.6 → **64.6** | 28.2 → 130.6 | speed only |

Earlier rounds, taken while the app and another agent's scan were running (≈ 10–15 cores
busy), are in `LOG.md`; they are lower in absolute terms but show the same ratios.

Ground truth (lab build, every change on): `later` 338/344 accepted-and-correct, 0/309 false
positives, 0 wrong rows; `early` 5/5, 0/1,875 FP — identical to the production regression
(`docs/GUI_PRODUCTION_CHECK.md`).

The synthetic clips: 31 s of the fire-rich 1440p segment, resized and re-encoded with libx264.
Pixel counts, decode resolution and GUI geometry are those of real 720p/4K footage, so the
throughput is representative; the encodes are "easier" than real captures (upscaled detail),
so software-decode numbers at 4K are optimistic, and no accuracy claim is made for them.

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
6. **Hotbar geometry hint at small GUI scales (measured).** Rejection-reason counters showed
   that at 720p the per-worker hint was rejected on 96 of 97 GUI frames although the full
   search then found the same geometry 80 % of the time: the hint's "neighbouring exact scale
   better?" test compares centre scores with a 3e-3 margin, while the full fit decides its
   candidates by edge score, TIE and misfit. `HINT_MIRROR` makes the hint apply the full
   fit's own rule and order: hint reuse 24 → 1,252 of 1,472 GUI frames on the 720p clip,
   first-person 113 → 167 fps there; 0 decision changes at 1080p and 1440p, ground truth
   unchanged. (1080p `later` still refits 269 frames, mostly fits with a non-zero origin that
   the hint never covers — a further lever.)
7. Smaller exact items: `target-cpu=native` build (+10–15 %), probe-address prefetch,
   uint8-input model variant (+7 %, Cast inside the graph).

Resolution notes: at 1080p the app is bound by its capped H.264 software decode (the same
caps as at 1440p), so the decoder change alone is the main lever there; at 4K the first-person
scan is CPU-bound in the per-pixel passes (veil margins, tooltip scan, GUI templates scale
with pixel count) and scales with worker count (6/8/12 workers: 39.5/49/67 fps under load) —
note the app would use 8 workers at 4K under its 256 MiB RGB pool budget, which the yuv420p
pipe halves. No-fire runs on a 1080p downscale at every resolution and is unaffected.

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
- **No-fire at non-1080p resolutions** has no app precedent (the policy is 1920×1080-only);
  the lab feeds it a 1920×1080 downscale. The rgb24 pipe with FFmpeg's fused `scale` is the
  app's own would-be path and gave **0 decision differences** against it at 720p, 1440p and
  4K (differing only by decoder); the yuv420p pipe + separate conversion is a different
  resampler (20–36 of 1,800 decisions move) and is only used when no scaling is needed.
- **Hint mirror** (item 6) is measured, not exact, like pose pruning: 0 changes on every
  real-recording check so far; both stay behind switches.

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

## Integration (done on this branch, after the owner's go-ahead)

- `fire_core::yuv` is the single yuv420p→rgb24 converter (BT.709 and BT.601, chosen from the
  stream's `color_space` tag the way swscale chooses it; untagged streams are BT.601 at any
  size). `no_fire_cnn::DEFAULT_VIEW_ORDER` holds the measured view order. Pose pruning and
  the hint mirror default to on.
- The app's three scans share `ScanFeed` (`src-tauri/src/pov.rs`): yuv420p pipe at native
  even size with a reproducible matrix, otherwise rgb24 with FFmpeg's fused `scale`; the
  decoder is probed once per codec — NVDEC for H.264/HEVC/VP9, software for AV1 while the
  bundled FFmpeg has libdav1d (main now pins the full build) — with no decoder thread caps,
  still at below-normal priority; `showinfo` timestamp validation is unchanged; workers are
  budgeted on the pipe's bytes. The no-fire scan accepts any resolution (1080p view).
- Verified: unit tests for every new rule plus an end-to-end YUV-feed-vs-FFmpeg byte match;
  the real `Jobs` scan on a 1440p H.264 clip and on the whole 1080p `later` recording
  reproduces every decision of the previous path (first-person 347 and 1,692 accepted,
  no-fire 269 and 0 clears) — see the "Integration" entry in `LOG.md` for the numbers after
  merging main's own changes.

## Reproduce

```bash
# build (lab target dir keeps the main checkout's builds untouched)
CARGO_TARGET_DIR=D:/Coding/Minecraft/FireCracking/.board/scan-perf-lab/target cargo build --release --manifest-path fire-detection/perf-lab/Cargo.toml
# app-faithful baseline
perf-lab bench tool=pov video=misc/dream/recovered-video.mkv w=2560 h=1440 start=5490 frames=1800 decoder=app
# lab configuration (H.264 sources: add cuvid=h264_cuvid)
perf-lab bench tool=pov video=... w=2560 h=1440 start=5490 frames=1800 decoder=cuvid pixfmt=yuv420p scale_prune=1 hint_mirror=1 out=rows.jsonl
perf-lab bench tool=nofire video=... w=2560 h=1440 scale=1920x1080 start=5490 frames=1800 decoder=cuvid pixfmt=rgb24 scale_prune=1 hint_mirror=1 view_order=0:0,0:5,1:4,0:2,0:4,0:6,0:8,0:3,0:1,0:7,1:0,1:1,1:2,1:3,1:5,1:6,1:7,1:8
# (no-fire at native 1080p: pixfmt=yuv420p and no scale=)
# exact-parity decoder alternative
perf-lab bench ... decoder=fast ffmpeg=<full ffmpeg build> pixfmt=yuv420p
# accuracy on labelled recordings
python fire-detection/perf-lab/eval.py pov --tag check --names later,early --decoder app [--extra scale_prune=1]
```
