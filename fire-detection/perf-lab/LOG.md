# Scan performance lab — running log

Target (owner, 2026-10-21): **≥ 60 fps end-to-end, decode included**, on the owner's
1440p60 AV1 recording (`misc/dream/recovered-video.mkv`, 2560×1440, 2.6 h) for both the
first-person scan and the no-fire scan, measured on the owner's laptop
(i9-13900HX 32 threads, RTX 4060 Laptop 8 GB, CUDA 11.8 toolkit, DirectML).

Regression budget: recall and false positives within ~10 % of current main; judged at the
end from this log. Model retraining allowed with an approved run plan. Everything here is a
separate experiment on branch `claude/scan-perf-lab`; nothing is integrated into the app.

## Ground rules for every number in this log

- Rates are wall-clock over the whole run (spawn of FFmpeg to last decision), on a laptop
  with other software running. They compare set-ups on the same day, they are not promises.
- Accuracy is scored only on the labelled 1080p recordings (the 1440p file has no labels).
  1440p runs report decision parity between set-ups, nothing more.
- No-fire on 1440p: the shipped policy and model are 1920×1080-only. The lab feeds it a
  1920×1080 **downscale** of the 1440p frame (first definition; revisit if the owner wants
  native tiling).

## Findings so far

### F1. Raw decode of the 1440p AV1 recording (1800 frames from 20 s, to null)

| Decoder | Output | fps |
|---|---|---:|
| bundled ffmpeg 8.1.2 *essentials* — `libaom` (no libdav1d in that build) | rgb24 → NUL | **92** |
| bundled ffmpeg, `-c:v av1_cuvid` (NVDEC) | rgb24 → NUL | 264 |
| bundled ffmpeg, `-hwaccel cuda` (NV12 download, CPU rgb) | rgb24 → NUL | 223 |
| bundled ffmpeg, `av1_cuvid` | yuv420p → NUL | 458 |
| bundled ffmpeg, `av1_cuvid` | nv12 → NUL | 534 |
| system ffmpeg 9 full build — `libdav1d` | rgb24 → NUL | 215 |
| system ffmpeg 9 — `libdav1d` | null (no conversion) | 420 |
| system ffmpeg 9 — `av1_cuvid` | null | 633 |
| `av1_cuvid` rgb24 **through a pipe** (`| dd`) | | 152 |
| `av1_cuvid` yuv420p **through a pipe** (`| dd`) | | 323 |

The app's own decoder command additionally caps `-threads 2`, `-filter_threads 1` (so the
yuv→rgb swscale is single-threaded) and runs `showinfo` with its default per-frame checksum.

### F2. Decoder output parity

libaom and libdav1d produce bit-identical yuv420p frames (300/300). NVDEC (`av1_cuvid`)
matched 294/300; frames 42, 70, 165, 204, 234, 264 differ, five of them grossly
(PSNR 11–19 dB), i.e. NVDEC decoded those frames differently, not a rounding difference.
To be investigated (likely error-resilience / `show_existing_frame` handling); any NVDEC
path must quantify decision impact, not just assume parity.

## Experiment queue (living list; struck through when done, new ideas appended)

Frame feed
- D1 Remove the app's decoder caps (`-threads 2`, `-filter_threads 1`, `showinfo` checksum).
- D2 NVDEC `av1_cuvid` → rgb24 pipe.
- D3 NVDEC → yuv420p/nv12 pipe (half the bytes) + colour conversion inside the workers.
- D4 dav1d-capable FFmpeg build instead of libaom (system ffmpeg 9 as a proxy).
- D5 In-process decoding (libavcodec or NVDEC directly), no pipe at all.
- D6 `av1_cuvid -resize 1920x1080`: let NVDEC produce the 1080p frame the no-fire scan needs.
- D7 GPU colour conversion (`scale_cuda`/`colorspace_cuda`) before download.

First-person processing
- P1 `target-cpu=native` / AVX2 code generation (the app builds for baseline x86-64).
- P2 Per-stage profile at 1440p (how often GUI detection actually runs; which stage dominates).
- P3 Share the hotbar geometry hint across workers (per-worker hints are ~12 frames stale).
- P4 Interaction/menu detector: temporal skipping when the panel region is unchanged, coarse-to-fine.
- P5 `LumaRows` f64 per-frame allocation → reused f32/u8 buffers.
- P6 Lock contention: `CoarsePlan` and interaction `Plan` mutexes per detect.
- P7 Frame-level temporal coherence (identical/near-identical consecutive frames reuse decisions).
- P8 Template correlation on the GPU (CUDA).

No-fire processing
- N1 Batch the 9 (18) views into one `session.run` per frame instead of up to 9 serialized calls.
- N2 One session per worker / parallel sessions instead of one global lock.
- N3 CUDA / TensorRT execution provider instead of DirectML.
- N4 fp16 (then int8) model; measure score drift against the 1e-4 consistency check.
- N5 Faster resize (the i64 fixed-point triangle filter is scalar; 9 views per frame).
- N6 Profile the rule stages (fragments BFS, portal guard, material, GUI) at 1080p.
- N7 Downscale 1440p→1080p on the GPU (D6) rather than single-threaded swscale.
- N8 Smaller / lower-resolution model via an approved training run (last resort).

## Experiment index

Machine state for every run below unless noted: the FireCrackle app was running its own
scan in the background (≈ 9 cores busy: app + two FFmpeg children). Numbers are therefore
pessimistic; relative comparisons within one block are still fair.

### E0. App-faithful baseline (`results/baseline/runs.jsonl`)

1,800 frames from 20 s, 12 workers, FFmpeg spawned exactly as the app does.

| Scan | Input | fps | decisions |
|---|---|---:|---|
| first-person | 1440p AV1 | **40.5** | 0 accepted (segment has no overlay fire) |
| first-person | same, decoder caps removed | 63.0 | same |
| no-fire | 1440p → swscale 1920×1080 | 40.5–45.0 | 10 clears |
| first-person | 1080p V03 | 131.4 | 110 accepted (= reference vector) |
| no-fire | 1080p V03 | 128.2 | 308 clears (= reference vector) |

### Segment choice for the 1440p recording

The recording has no labels. Sampling 12 frames every 60 s (`results/map/samples.jsonl`,
156 samples) found accepted first-person rows only around **5490–5550 s and 7230–7290 s**;
the first-person matcher ran its expensive GUI path on ≥ 6 of 12 frames at almost every
sample, so the 20 s segment used above already exercises GUI detection. From here on the
"fire" segment is 1,800 frames from **5490 s**; the 20 s segment stays as the "no fire" one.

### E1. Decoder variants, first-person 1440p (`results/decode/runs.jsonl`)

| Decoder | fps | decisions |
|---|---:|---|
| app command, `showinfo=checksum=0` | 40.2 | 0 |
| **NVDEC `av1_cuvid` → rgb24 pipe** | **89.3** | 0 |
| libdav1d (system ffmpeg 9), uncapped | 85.8 | 0 |

The showinfo checksum is not the cost. libaom is: decoding alone caps the app at ~40 fps.

### E2. Decoder variants, no-fire 1440p→1080p

| Decoder | fps | clears (of 1,800) |
|---|---:|---|
| app (libaom capped + swscale) | 40.5–45.0 | 10 |
| libaom uncapped + swscale | 85.3 | 10 (identical vector) |
| libdav1d + swscale | 167.3 | 10 (identical vector) |
| **NVDEC + swscale** | **179.5** | 9 |
| **NVDEC with its own `-resize 1920x1080`** | **188.5** | 8 |

### E3. Fire-rich 1440p segment (5490 s), app load ≈ 10 cores (`results/fire/runs.jsonl`)

| Scan | Decoder | fps | decisions |
|---|---|---:|---|
| first-person | app | 33.8 | 347 accepted; GUI path on 1,457/1,800 frames |
| first-person | NVDEC | **77.0** | 347 accepted; GUI on 1,453 |
| no-fire →1080p | app | 37.0 | 265 clears |
| no-fire →1080p | NVDEC | **78.7** | 263 clears |

### E4. No-fire: batching the nine views — **rejected**

| Set-up | fps | clears |
|---|---:|---|
| 1440p fire segment, NVDEC, DirectML, one call per view (early exit) | 78.7 | 263 |
| same, all nine views in one DirectML call | **18.0** | 263 |
| 1080p V03, app decoder, DirectML batched | 42.1 (vs 128 unbatched) | 308 |
| 1080p V03, app decoder, **CUDA** batched | 101.1 | 308 |

The per-view early exit is worth far more than call overhead: on frames with fire the
first (full-frame) view usually ends the frame after one inference, so a nine-view batch is
up to 9× the GPU work. DirectML also handles the larger batch poorly. Batched decisions
are identical (same views, same scores), as expected. CUDA with the batched model still
beat DirectML batched 2.4×, which motivates CUDA *un*batched (E5).

### E5. CUDA execution provider — **not better than DirectML here**

| Set-up (per-view calls, early exit) | DirectML | CUDA EP |
|---|---:|---:|
| 1080p V03, app decoder | 128.2 fps | 117.4 fps (308 clears, identical) |
| 1440p fire segment, NVDEC | 78.7 fps | 43.6 fps (263 clears, identical) |

ORT 1.22 GPU build, CUDA 12.5, cuDNN 9.2, `CUDAExecutionProvider` with heuristic conv
search. The 1440p case also shares the GPU with NVDEC. Scores are identical to DirectML
(same decisions). TensorRT not yet tried (needs the TensorRT runtime; queued as low priority
because the CNN is not the no-fire bottleneck — see the stage profile).

### E6. First-person stage profile, 1440p fire segment, NVDEC, 12 workers (`results/round2`)

Per-call wall time with 12 contending workers; total ms over 1,800 frames.

| Stage | calls | total ms | per call |
|---|---:|---:|---:|
| `pov.gui_detect` (everything below it) | 1,453 | 127,725 | 87.9 |
| └ `gui.interactions` (known-panel detector + tooltips) | 1,453 | 64,233 | **44.2** |
| └ `gui.pieces` (hearts/armor/food/XP/boss bars) | 1,453 | 37,530 | 25.8 |
| └ `gui.text` | 1,453 | 17,566 | 12.1 |
| └ `gui.hotbar_fit` (hint reused most frames) | 1,453 | 7,788 | 5.4 |
| `pov.screen_masks` (inventory/menu confirmation + opaque/broad masks) | 1,453 | 35,006 | 24.1 |
| `pov.veil` (`detect_pixels`, four margin/mode passes) | 1,800 | 32,752 | 18.2 |
| `pov.raw_silhouette` (two FOVs) | 1,800 | 13,079 | 7.3 |
| `pov.masked_hard` / `pov.masked_soft` | 1,453 / 1,438 | 7,912 / 7,566 | 5.4 / 5.3 |

GUI detection ran on 81 % of frames. The sprite matcher itself is < 15 % of the work.
Targets, in order: interactions, pieces, screen masks, veil, text.

### E7. Half-bandwidth pipe: yuv420p + exact in-worker conversion

First attempt with textbook BT.709 coefficients: 86.1 → 97.8 fps on the 1440p fire segment,
but 3 of 1,800 decisions changed (veil/colour rules are sensitive to ±1 values). So the
conversion was fitted to the bundled FFmpeg's actual SIMD swscale path with an exhaustive
synthetic frame (`fit_swscale.py`): `R = clip(((8Y−128)·9539 + (8V−1024)·14686) >> 16)` etc.
with floor products — **0 of 11,059,200 channel values differ** on real frames, and
`perf-lab yuvcheck` reports 0 differing bytes for both the software and the NVDEC decoder.

Side finding: FFmpeg's *own* `av1_cuvid → rgb24` output is colour-shifted versus the
software decoders (max channel difference 37; 79 % of bytes differ) — NVDEC hands swscale
NV12 without the stream's colour tags, so a naive "just switch to NVDEC" integration would
change colours. NVDEC → yuv420p → the exact converter reproduces the software decoder's RGB
byte-for-byte (on the frames checked), which makes the YUV pipe the right integration path
for both speed and correctness.

### E8. Round 3 (`results/round3`): exact YUV pipe, NVDEC frame parity, `target-cpu=native`

| Run (1440p fire segment, NVDEC, yuv420p pipe, 12 workers) | fps | decisions |
|---|---:|---|
| default build, run A | 85.4 | 347 accepted, **identical rows** to NVDEC rgb24 |
| default build, run B (same binary, same input) | 79.7 | identical |
| `-C target-cpu=native` build | **93.9** | identical |
| no-fire →1080p (yuv scaled by swscale, then exact conversion) | 83.6 | 237 clears (vs 263 rgb24-NVDEC, 265 libaom) |
| first-person, 20 s no-fire segment | 69.3 | 0 accepted, GUI on 1,418 frames |

Run-to-run noise under the app's background load is about ±5 %; from now on key
comparisons are repeated and the median reported.

NVDEC vs libaom on 300 frames at 20 s: 6 frames differ (max channel difference 255: those
frames are decoded differently, not rounding); at 5490 s all checked frames match. On the
fire segment the NVDEC decisions differ from libaom's on **8 of 1,800 frames (0.4 %)**, all
attributable to those frame-level decode differences. Software libdav1d would give exact
parity at a similar speed (E1) but needs the "full" FFmpeg build instead of "essentials".

The no-fire 1440p→1080p downscale has no app precedent; the three set-ups above are three
different resamplers. Which one to standardise on is an open question for the owner (none
can be scored: the 1440p recording has no labels).

Sub-stage profile (default build, run B), per GUI frame: `gui.panel_find` 31.3 ms,
`gui.tooltips` 9.2 ms, `pov.opaque_broad` **21.2 ms** (building two per-pixel mask vectors —
pure overhead), `pov.screen_confirm` 6.9 ms, `gui.pieces` 27.4 ms, `gui.text` 15.2 ms,
`pov.veil` 21.1 ms.

Software decoders agree bit-for-bit, so their decision vectors are identical. NVDEC changes
decisions: it decoded 6 of 300 inspected frames as visibly different pictures (F2), and its
built-in resize is a different filter from swscale bicubic. Impact must be quantified on
labelled data before NVDEC can be recommended; the labelled 1080p recordings are H.264 (see
E3), where NVDEC conformance is expected to be exact — the AV1 discrepancy is specific to
this recovered AV1 file (possibly damaged packets concealed differently).
