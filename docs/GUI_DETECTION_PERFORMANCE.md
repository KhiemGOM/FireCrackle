# GUI detection performance audit — 2026-10-21

Scope: standalone GUI interaction detection. Baseline `c77440b`. This does not change the first-person/no-fire detectors, Minecraft layout assumptions, thresholds, tooltip treatment, or labels. No model training/calibration took place.

## Method and literature

Followed the workspace performance workflow described by job 268 and `AUTO_SCAN_DEEP_REFACTOR.md`: freeze old code, measure complete results, reject slower candidates, distinguish cached-RGB detector timing from decoding and application overhead. Fable's separate current chat/rules were not available through this board; no claim is made to have inspected them.

- [Lewis, Fast Normalized Cross-Correlation](https://www.scribblethink.org/Work/nvisionInterface/nip.html): integral normalization and transform-domain correlation apply to dense NCC. Our interaction detector uses ordered sparse RGB interval probes with neutral occlusions, not NCC. Substituting NCC is a new decision rule, not a proven acceleration. The paper also explains that probabilistic early termination can miss narrow maxima. Keep the existing exact mismatch bound instead.
- [OpenCV 4.12 template matcher](https://github.com/opencv/opencv/blob/4.12.0/modules/imgproc/src/templmatch.cpp): inspected as a reference for dense/masked template computation; its normalization and matching objective are not interchangeable with our gates.
- [LLVM vectorization documentation](https://llvm.org/docs/Vectorizers.html): independent operations can widen, but complex traversal/control flow limits vectorization. Tested a branchless row prepass rather than assuming it helps.
- [Agner Fog optimization resources](https://www.agner.org/optimize/): profile bottlenecks, data access, branches and vectorization. Applied common-computation reuse and measured the memory/startup tradeoff.

## Candidates evaluated

| Candidate | Decision and evidence |
|---|---|
| Independent branchless tooltip row predicates, then original run traversal | Rejected:37-frame ABBA detector 1.014s→1.172s; tooltip 0.258s→0.423s. Exact outputs, slower. |
| Separate unmasked border loop with branchless colour tests | Not retained:0.807s→0.801s, too small/noisy to establish improvement. |
| Branchless predicates inside original tooltip traversal | Not retained:tooltip 0.332s→0.357s; total timing inconclusive under contention. |
| Share identical failed border checks within the current frame | Retained candidate:398-frame paired ABBA detector 11.525s→8.036s (30.3% less time,1.43×throughput). Complete public detection output and tooltip rectangles identical. |
| Remove tooltip masking/occlusion rules | Rejected on correctness:recent eight real tooltip-covered GUI frames depend on these rules. No guarantee that a particular GUI probe remains visible. |
| Previous-frame answer reuse, narrow tracked ROI or fewer sampled frames | Rejected as an exact optimization:cuts and GUI open/close boundaries can invalidate temporal assumptions. Would require separate accuracy validation, and cannot establish unchanged output. |
| Resize frames / approximate coarse search | Not integrated:changes thin-border, fractional-scale and occlusion evidence. Existing false-negative investigation argues against silently reducing coverage. |
| Dense FFT/integral correlation / GPU port | Not a drop-in equivalent for sparse interval tests; transfer/setup costs and arithmetic/selection parity need their own measured implementation. No speed claim. |
| More decoder/frame workers | Already present through shared `scan_workers` and FFmpeg. Shared decoder changes overlap the other detector work; measured current configuration instead of changing it here. |

## Why border sharing is exact

The resolution plan assigns a shared ID only when the **complete ordered list of RGB offsets and every inclusive colour interval** are equal. Hash collisions cannot merge unequal keys. Every border stage has the same floor; equal ordered lists also have the same length and allowed mismatch count. Thus, with no tooltip, a definite border rejection is identical for every pose sharing that ID. Only rejection is reused; successful borders still run their original structure/identity stages. Template and pose order are unchanged, so the first winning source remains the same.

The rejection array starts empty for every frame and is local to each worker. Masked frames keep the original path because visible support and regional accounting matter. No result crosses frame boundaries. At 2560×1440 the installed bank has 123,291 poses but 57,518 distinct border checks; scratch is 57,518 boolean bytes per serial detector call. The HashMap and copied keys are temporary during plan construction, not retained in the resolution plan. One-time construction and peak memory must be reported alongside warm timing.

## Validation

Private artifacts are under `.board/gui-performance`; videos, extracted frames and game assets are not committed. Source: `misc/dream/recovered-video.mkv`, native 2560×1440 AV1, first 36,000 frames. Source SHA256 `cfd239c247a6dc94ae10b27da4b86c6d38de98b2386f8f7f4acebfdace99c6f3`.

- 398 native saved frames: complete `Detection` debug representation (including source/type, box, scores, visible support, reason) and tooltip rectangle lists matched frozen modules. Includes 14 snow negatives and 8 tooltip positives. These are regression examples, not a new independent accuracy estimate.
- 32 cached native 1080p frames from the prior recording pool: complete output matched frozen modules.
- 29 targeted tests passed: 6 GUI module tests (including new repeated-frame/different-structure/equal-border case), 5 fast-detector integration tests, 18 source-layout tests. Existing worker-order and fractional/footer geometry tests remain active.
- Full first ten minutes: all 36,000 frame IDs, presence decisions and boxes exactly match the frozen scan. Same 3,483 positive frames and 40 intervals; zero added/lost frames. Four frame workers/four decoder threads, decode plus buffered result writing: 417.56s (86.2fps). This overlaps some verification/build work and is not a controlled speedup comparison.

## Controlled decode + detection runs

Sequential old/new/new/old runs, first 6,000 native frames each, same executable/build options and frozen old module. FFmpeg default decoder threading and production `scan_workers` policy; native RGB, original frame indices, buffered JSON result output. This includes decode and detector computation but not the application polling/UI, timestamp-validation wrapper or its unbuffered resumable-cache writer. The existing app and its FFmpeg workload remained running, as requested; host contention is a limitation.

| Run | Prepare (s) | Decode + scan (s) | Including prepare/setup (s) |
|---|---:|---:|---:|
| Old1 | 0.134 | 64.15 | 64.295 |
| New1 | 0.564 | 66.49 | 67.067 |
| New2 | 0.536 | 64.59 | 65.137 |
| Old2 | 0.145 | 65.58 | 65.738 |

All four runs matched frozen frame IDs, presence and boxes exactly. Average scan time: old 64.865s, new 65.540s (new 1.0% slower); including setup: old 65.0165s, new 66.102s (new 1.7% slower). **No end-to-end speedup established.** These small differences under an active external workload do not isolate a regression either. Do not turn the 30.3% cached-detector improvement into a whole-video ETA claim. New plan preparation costs roughly 0.4s extra; observed process peak working set was about 228MB old and 233MB new (snapshots, not allocator measurements).

The retained change reduces measured detector time without changing decisions; the measured full pipeline remains about 91fps. Further whole-video acceleration needs a controlled decode/transport/cache profile, coordinated with the existing shared-decoder optimization work. No live app was stopped/replaced and no private assets were committed.

Reproduction artifacts: `.board/gui-performance/{bench.rs,all.py,multi.rs,multi.py,pipeline.rs,manifest.json,pipeline-results.json,full/verified.json}`. `bench.rs` alternates old/new/new/old on identical decoded RGB, excluding PNG loading, IPC and initial plan construction from timing. Public results are compared before timing. Targeted tests: `cargo test --manifest-path fire-detection/core/Cargo.toml --lib gui_interaction`, `--test gui_interaction_fast`, `--test gui_interaction`.


## Follow-up: remove the wall-clock decoder bottleneck

The first detector-only result was insufficient. The follow-up profiles decoding,
RGB transfer and complete scans separately. Measurements below are from the same
native 2560×1440 AV1 recording; the user's other app remained running. Absolute
rates vary with live workload and thermal state. Compare paired runs, not numbers
from different batches.

### Root cause and runtime change

The pinned Gyan FFmpeg 8.1.2 **essentials** build lacks libdav1d and selected
libaom-av1 for this source. The same-version **full** build selects libdav1d
(dav1d 1.5.3-62-g77ef6635 in its vendor README). This is verified in both binaries'
`-decoders` output and actual decode logs. Gyan's [library inventory](https://www.gyan.dev/ffmpeg/builds/)
places libdav1d in the additional full-build libraries. FFmpeg source commit remains
`38b88335f9`; the pinned full archive SHA-256 is
`0fff188997a499b5382e0f66e845d4556c48c54f0113ebed4853d556dbdd7059`.

An initial 1,200-frame run with detection completely bypassed still ran at about
92 fps, approximately the same as detection enabled. Decoder/pipe reads occupied
almost the whole scan wall time. Therefore further detector arithmetic changes
could not solve this bottleneck.

### Full decode + transfer + detector benchmark

Same harness, current exact detector, full RGB24, every original frame,
`showinfo` retained, default frame-worker policy and automatic decoder threads.
Include detector initialization in the following wall times. Runs were sequential
A-B-B-A, each with 6,000 frames (100 seconds of footage):

| Runtime | First run | Second run | Aggregate FPS |
|---|---:|---:|---:|
| Essentials / libaom (A) | 87.197 s | 81.444 s | 71.16 |
| Full / dav1d (B) | 46.759 s | 52.003 s | 121.50 |

This is **1.71× throughput / 41.4% less wall time** for this batch. All four runs
matched the frozen baseline's GUI presence and panel bounds for all 6,000 frames.
The harness includes buffered result output, not the app's full cache lifecycle;
the separate production-pipeline test below covers that distinction.

### Further candidates actually tried

- Windows anonymous-pipe buffer hint of 1 MiB: no established additional gain.
  Reads still arrived in small chunks; do not infer the actual pipe capacity from
  the requested hint. [CreatePipe documentation](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-createpipe)
  explicitly describes the buffer size as a suggestion.
- `showinfo=checksum=0`: retained timestamps but no clear repeatable improvement
  in the 1,200-frame screen. Keep current diagnostics; no production change.
- Single filter thread, alone and combined with checksum/pipe changes: mixed or
  slower. No production change.
- CUVID, QSV, native CUDA and D3D11 decoding: some decode-only improvements did
  not survive full RGB transfer plus detection. Short full-pipeline trials were
  approximately 39–96 fps; none displaced dav1d. No hardware path forced.
- Restrict dav1d to four threads: 6,000-frame runs took 105.283 s, or 97.742 s
  with one filter thread. Slower than automatic threading; rejected.
- Fewer frames, resized frames, removed tooltip masks and temporal answer reuse
  remain changes to detection coverage, not exact speedups. Not introduced.

### Delivery and isolation

Windows now requires dav1d support before accepting a pre-existing local runtime;
an older portable essentials binary cannot silently bypass the new pinned cache.
The installer streams only the selected executables and vendor notices from the
checksum-verified 7z archive using Windows' bundled tar. It checks safe unique
member names and required executables. No archive-controlled output paths are
extracted. Cache directories include the archive checksum, so an old running
window's binaries are not overwritten. Linux keeps its existing system-tool
behavior. The build preparation script uses the same pin and hash-specific cache.

The archive is 166,721,853 bytes; installed ffmpeg and ffprobe total about 485 MB.
This is a larger one-time runtime download/install, not a per-scan cost. No private
video, game asset, executable or cache is committed. The original app and its
running work are left alone. Gains here apply to this AV1 bottleneck; do not claim
the same improvement for H.264 or for the other detectors without measuring them.

### Additional correctness checks

RGB24 frame hashes and output timestamps match between the two runtime builds for
all 6,000 initial frames and another 900 frames starting at 480 seconds (including
the recovered tooltip-covered GUI cases): 6,900 exact matches. The new archive's
SHA-256 verification, selected-member extraction, preserved vendor notices, both
executable startup checks and the libdav1d capability check pass locally. Six
runtime unit tests and two existing GUI cache/range tests pass; release-script
checks also pass.

An opt-in `gui_scan::tests::benchmark_real_video_through_production_pipeline`
creates an isolated stream-copy prefix (no re-encoding), preserves the original
indexed timestamps, runs the production Jobs/CheckedFrames/cache path and checks
every original frame ID and bound against frozen JSONL results. This avoids
mutating the user's live video cache. It also verifies that the completed cache
can be reopened without invoking a decoder.

The full 36,000-frame production scan completed with every frame's presence and
bounds identical to the frozen baseline, and compatible cache reuse passed.
Its 509.432-second validation run overlapped installation/compilation work and is
not used as a before/after speed estimate. Original timestamp validation remained
active throughout. Further paired production timing is recorded below.

The cache writer now serializes one complete JSONL record in memory and writes it
once. It does not buffer across frames. A byte-equivalence test covers header,
negative frame, positive bounds and completion records; existing truncated-tail,
resume-index and range tests still pass. This removes per-token filesystem calls
without changing cache format or detection semantics.

### Paired production wall-clock result

The real app scan path (frame timestamp checks, detection, progress polling,
per-frame cache writes, final sync) was run sequentially A-B-B-A on isolated
6,000-frame stream-copy prefixes of the same source. The user's other app was
left running and had an active FFmpeg process during these tests.

| Production configuration | Run 1 | Run 2 | Aggregate FPS |
|---|---:|---:|---:|
| Essentials runtime + previous per-token cache writer | 189.215 s | 186.805 s | 31.91 |
| Full/dav1d runtime + complete-record cache writes | 97.225 s | 99.346 s | 61.05 |

**1.91× throughput, 47.7% less wall time.** All 24,000 output records across the
four runs match the frozen presence/bounds baseline. Cache completion/reopen
checks pass in every run. This is the relevant end-to-end result; it supersedes
any temptation to present the faster standalone harness rate as actual app FPS.
These are live-workload measurements, not a universal throughput guarantee or a
whole-recording ETA.

### Last transfer/worker screen and cache attribution

With the full runtime, paired default 1,200-frame runs took 11.852/11.107 s;
`-avioflags direct` took 10.998/11.011 s, direct plus a larger pipe 11.163 s,
and 2/4/6 detector workers took 11.584/10.974/10.950 s. These small differences
under live workload do not establish another robust gain; read-call counts
remained about 260k–280k per 1,200 frames. Keep the existing transfer and worker
policy. All eight runs matched all 1,200 frozen GUI results.

The isolated cache serialization/file-write ABBA for 6,000 records measured
0.234823/0.226343 s for token writes versus 0.010849/0.011312 s for complete-record
writes, including final sync; file bytes were identical. Retain the smaller
number of filesystem calls, but it saves only about 0.22 s per 6,000 records in
this test. It does **not** explain the large end-to-end change: the decoder is
the main improvement. A subsequent full-runtime run with the old writer took
77.902 s (77.02 fps), further demonstrating workload variation; do not attribute
the difference from earlier 60–62 fps runs to the cache writer.

## Follow-up: transferring Fable's prepared-geometry methods

Compared the methods recorded in `AUTO_SCAN_DEEP_REFACTOR.md` against current
GUI presence detection (`cdc4e74`, including the dav1d runtime improvement).
Support thresholds and border coordinates are already prepared once; the new
experiments target remaining duplicate storage and coordinate arithmetic.
No model, threshold, mask rule, search order or frame cadence changed.

1. **Shared border geometry:** intern identical ordered offset arrays using
   `Arc<[u32]>`, retaining each pose and its original order. Equality checks the
   complete array. Sharing is immutable and does not reuse frame decisions.
2. **All-stage geometry:** additionally precompute structure, fallback-structure
   and identity offsets for each pose using the original `offset` function.
   This trades extra arrays and preparation work for less per-frame arithmetic.

| Candidate | Cached detector time, before / after | Decoded stream FPS, before / after |
|---|---:|---:|
| Shared border arrays | 11.349 / 10.618 s (6.4% less) | 109.81 / 112.15 |
| All-stage precomputation plus shared borders | 13.856 / 12.477 s (10.0% less) | 118.69 / 109.79 |

Cached tests use the same 398 real native 1440p samples with before/after/after/
before calls per sample. Every complete Detection debug representation matches,
including scores, support counts, bounds and reasons. Tooltip outputs also match.
These are implementation-parity checks, not new ground-truth accuracy estimates.

Each stream comparison is A-B-B-A, 2,400 frames per pass, decoding the exact same
owner recording with full/dav1d. Shared-array times: 22.41, 21.70, 21.10, 21.30 s.
All-stage times: 19.40, 22.45, 21.27, 21.04 s. All 19,200 output records across
both comparisons match the frozen first-ten-minute reference by frame ID.
The harness includes decoding, RGB transfer, parallel detection and buffered
result output; it does **not** include the app's checked-timestamp/cache lifecycle.
These rates must not be presented as production app FPS. Other applications
remain running, and baseline throughput varies between the two comparisons.

**Decision:** neither candidate is promoted. Shared arrays show only a 2.1%
stream throughput change, too small here to establish a dependable improvement;
all-stage precomputation loses 7.5% throughput in its paired stream comparison.
Fable's invariant-work principle transfers to detector CPU cost, but this pass
provides no additional established wall-clock gain. Keep the already validated
production implementation and dav1d runtime. No app restart or scan interruption.

Private reproducibility files: `.board/gui-performance/fable-methods.json`
(source SHA-256s and cached timing totals), `fable-stream.json`,
`geometry-stream.json`, `fable*.rs`, `geometry*.rs` and their Python drivers.
Do not commit these recording-derived caches or local source bundles.
