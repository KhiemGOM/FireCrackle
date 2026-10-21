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

