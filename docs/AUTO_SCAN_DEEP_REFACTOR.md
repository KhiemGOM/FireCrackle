# Scan hot-path refactor — 21 October 2026

This follows the function profile and resize/session pipeline changes. It is an
implementation comparison against `318a524`, with frozen models, thresholds,
candidate order, GUI occlusion policy and automatic unveil math.

## Retained changes

- GUI panel support requirements are prepared once per template stage. Previously
  every pose of every frame repeated the same linear search and floating-point
  divisions to determine its permitted mismatch count. The comparison and its
  rounding are unchanged.
- Template sampling geometry stores unique source columns/rows and compact point
  indices. Each score transforms a coordinate and obtains its luma row once,
  instead of repeating those operations for every sample. The dot products and
  sums still visit points in their original order. Small templates use smaller
  stack scratch space; oversized or clipped cases retain the general path.
- Shape-cache keys store the common zero/one/two-layer cases inline. A rejected
  pose no longer clones a layer vector. Selection records the winning index and
  moves that piece out only after the search. Larger layer lists remain supported.
- Hotbar slot selection scores each slot once instead of rescoring both operands
  of every comparison. Last-equal selection behavior is unchanged.
- No-fire processing borrows the original RGB frame when unveil is unused,
  avoiding a 6,220,800-byte copy for each native 1080p frame. An actual unveil still
  owns its restored buffer and uses the sole shared implementation.

These changes replace repeated work with immutable geometry, bounded scratch
space and ownership of the selected result. They do not cache previous-frame
decisions or add another detector implementation.

## Measurement and correctness

Final measurements and source/input/artifact hashes are in
[`AUTO_SCAN_DEEP_REFACTOR.json`](AUTO_SCAN_DEEP_REFACTOR.json).

| Workload, same 12 workers | Before | After | Throughput gain |
|---|---:|---:|---:|
| First-person, cached RGB | 61.0 fps | 74.0 fps | 21% |
| No-fire, cached RGB | 132.8 fps | 147.5 fps | 11% |
| First-person, 1,800 decoded 1080p frames | 163.3 fps | 168.4 fps | 3% |
| No-fire, 1,800 decoded 1080p frames | 106.5 fps | 122.2 fps | 15% |
| First-person, 600 decoded 1440p AV1 frames | 40.4 fps | 43.5 fps | 8% |

Cached rates combine the total time of each path's two old/new/new/old passes,
512 frames per pass. Stream comparisons are one before/after pair each. The
1080p test uses V03, 20–50 seconds; the 1440p test uses the owner's externally
recovered recording, 20–30 seconds. Their complete output vectors match: 110
first-person matches and 308 no-fire clears in the 1080p clip; no accepted
first-person matches in the 1440p clip. This is parity, not ground-truth accuracy.

The instrumented warm GUI pass requests 9,704 allocations/reallocations per
frame versus 38,319 before, about **75% fewer**. Requested bytes fall from
12,752,866 to 11,207,942 per frame. These are cumulative Rust allocation
requests, not retained RAM, and exclude native decoder/ORT/driver allocations.
Allocation counting runs separately from the scan-throughput measurements.

The comparison executable includes both the previous core extracted from the
named Git revision and the changed core. Both use the same native frame queue,
12 workers and source packs. No-fire paths share one warmed model session and
the resize-outside-session-lock implementation; this prevents the previous
optimization from being counted again as a new gain. Initialization is outside
the timed sections.

Cached tests repeat 32 unique recorded RGB frames from catalogue V02/V03. Repeated
frames measure throughput; they are not additional accuracy examples. Independent
reference files compare every GUI mask byte, fit, hit, note and hit-score bit.
Contiguous tests decode original video with the bundled FFmpeg and compare the
complete per-frame output vectors before and after, not just their counts.

Post-change external stack profiles sampled another 2,048 processed frames per
tool. Among busy snapshots, first-person GUI work remains 73.4% inclusive
(correlation 34.6%, panel evidence 16.7%). No-fire GUI work is 37.4%, resizing
17.3% and veil detection 14.2%. The no-fire profile calls the production
resize-outside-lock path. These overlapping wall-stack samples exclude OS wait
stubs; they are neither precise CPU-cycle percentages nor GPU timings. The
remaining costs do not establish a hardware limit.

The targeted checks pass: 109 GUI/POV integration tests, three correlation/key
unit tests and 20 no-fire flow/fallback/frozen-preprocessing tests. Core and
no-fire library/test Clippy checks pass with warnings denied.
The native release executable also rebuilt successfully in 5m41s; its hash is
recorded in the manifest. The existing running app was not restarted.

## Research and implementation review

| Evidence | Application to this implementation |
|---|---|
| [Lewis, Fast Normalized Cross-Correlation](https://www.scribblethink.org/Work/nvisionInterface/nip.html) | Separate invariant template statistics and sampling geometry from observed pixels. Integral-image normalization/FFT applies to dense rectangular searches; it is not a drop-in replacement for these masked, scaled sparse samples. |
| [OpenCV 4.12.0 `templmatch.cpp`](https://github.com/opencv/opencv/blob/4.12.0/modules/imgproc/src/templmatch.cpp), `common_matchTemplate` | Inspected actual integral-image and reference-statistics implementation. Retained exact reference sums and ordered observed sums; did not replace occlusion handling with rectangular normalization. |
| [Intel loop optimization guidance](https://www.intel.com/content/www/us/en/developer/articles/technical/loop-optimizations-where-blocks-are-required.html) | Reuse invariant data and improve locality. Here that means prepared support counts and row/column reuse, rather than changing score arithmetic. |
| [Agner Fog optimization manuals](https://www.agner.org/optimize/) | Reviewed memory allocation/locality guidance against the measured allocation profile. Reduced ownership and lookup allocations before considering a custom allocator. |
| [ONNX Runtime DirectML configuration](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html#configuration-options) | One session must not receive concurrent `Run` calls. Retained the session mutex and parallel CPU preprocessing. Removing that lock would be incorrect. |
| [ONNX Runtime I/O binding](https://onnxruntime.ai/docs/performance/tune-performance/iobinding.html) | Device-resident input/output can avoid transfers. This remains a separate backend-specific candidate requiring measured transfer costs; the present CPU GUI refactor does not claim to implement GPU image processing. |

These are implementation lessons, not claims that a paper validates this
detector's accuracy. No source was used to invent new Minecraft rules.

## Candidates rejected or deferred

- **Per-frame fine-score hash cache:** implemented and checked for exact parity.
  Alternating runs did not show a dependable gain; the extra hash table was removed.
- **Dense integral images/FFT:** deferred. Sparse masks, variable fractional scales
  and covered probes prevent directly substituting a dense rectangular algorithm.
- **Reassociated SIMD/approximate correlation:** deferred. Changing floating-point
  sum order can change close fit/tie decisions. The retained geometry path keeps
  the original accumulation order and general fallback.
- **Previous-frame GUI answer reuse / reduced search:** not used. Cuts and GUI
  changes must not inherit a stale answer, and search order is part of the frozen
  presence policy.
- **Delete POV's older screen-mask extension:** not done. Its overlap with the new
  panel matcher does not prove mask equivalence; its measured cost is recorded in
  the earlier profile.
- **Parallel runs on one DirectML session:** rejected by the backend's documented
  contract. Multiple sessions or I/O binding would need their own memory, latency,
  cancellation and fallback measurements.

## Limits

Results depend on content, decoder, CPU load and inference provider. A faster GUI
pass need not improve decode-bound footage by the same factor. Timings exclude
frontend drawing, scan checkpoint persistence and timestamp validation. No new
TP/FP estimate, retraining, model selection or Linux speed claim follows from
this refactor. Private recordings, textures and benchmark caches remain local.
