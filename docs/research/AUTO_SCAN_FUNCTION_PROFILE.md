# Function and waiting profile — 21 October 2026

This follows the stage timing and worker-count changes in
`AUTO_SCAN_PERFORMANCE.md`. No production algorithm changes were made in this
pass. The aim was to locate the next bottleneck, rather than assume that more
threads had exhausted the hardware.

## What was measured

The optimized native first-person and no-fire functions ran through the real
`fire_core::video::parallel_frames_indexed` queue with 12 workers. The same 32
cached real 1920×1080 RGB frames from catalogue V02/V03 were repeated 64 times:
2,048 processed frames per tool, **32 unique frames**, not a new accuracy test.
They include three accepted first-person phases and seven no-fire decisions.
Each repetition and all control/allocation runs preserved those exact outputs.
Models, thresholds, GUI rules, veil rules and preprocessing outputs were unchanged.

WPR's native CPU recording failed with OS error `0xc5585011`, "Failed to enable
the policy to profile system performance." A process-local external sampler
instead suspended individual threads briefly, captured native `StackWalk64`
stacks, resumed them, and resolved application addresses through the matching
optimized build's PDB using LLVM. Debug information was enabled; optimization
remained level 3, LTO and one codegen unit. GPU/provider startup and input loading
were outside the recording window.

These are **busy stack snapshots**, not exact CPU-cycle percentages. Threads
stopped at OS wait functions are listed separately. Runnable but descheduled
threads can still appear in a busy snapshot. Unwind failures from exited threads
were discarded; symbol resolution happened after threads resumed. External
suspension perturbs execution. Separate unsampled controls and direct lock timers
were therefore used to check the contention finding. A peer's native build and
the owner's other applications were active; rates are not controlled machine
capacity measurements. The unsampled first-person control was actually slower
than its sampled run, so no precise profiler-overhead estimate is claimed.

## First-person: GUI matching dominates the busy work

7,251 busy snapshots, plus 2,394 snapshots at waits:

| Call tree | Inclusive busy snapshots | Share |
|---|---:|---:|
| `GuiDetector::detect` | 5,641 | 77.8% |
| `gui_mask::score` — template correlation | 2,537 | 35.0% |
| Interaction/menu detector | 1,950 | 26.9% |
| `gui_interaction::fast::evidence` | 1,822 | 25.1% |
| `LumaRows::at` | 591 | 8.2% |
| Veil judgment | 516 | 7.1% |
| Sprite silhouette matching | 389 | 5.4% |

Rows overlap: callees are included in their parents. They must not be summed.
The important contrast is GUI matching versus the actual sprite matcher. The
first targets are hotbar correlation/probe sampling and repeated interaction
evidence work. Faster or reusable geometry/temporary storage must retain every
visibility, occlusion and acceptance rule; skipping evidence is not equivalent.

## No-fire: CPU preparation is serialized with GPU inference

3,899 busy snapshots, plus 26,383 wait snapshots across scanner and runtime
threads. Idle ONNX/driver threads account for many waits and are not a CPU hotspot.
7,895 snapshots specifically show the scanner blocked on
`Mutex<no_fire_cnn::engine::Engine>::lock`.

The direct timers confirm that this is a throughput bottleneck:

| Measurement | Sampled run | Unsampled control |
|---|---:|---:|
| Scan wall time | 31.616 s | 29.450 s |
| Time holding the shared model lock, summed | 31.428 s | 29.285 s |
| Workers' accumulated model-lock waiting | 243.141 s | 231.540 s |
| Frame-level model calls | 1,472 | 1,472 |

Waiting sums span multiple workers and can exceed wall time. The unsampled
control held the model section for 99.4% of scan wall time; average lock wait
was about 157 ms per frame-level model call.

Inside `Engine::clear_frame`, 990 owner-thread snapshots split as follows:

- 594 (60.0%) in CPU `resize`, including its inlined filter loops.
- 396 (40.0%) in `infer_view`; 332 of those are OS waits inside the ONNX/DirectML
  path. This is not a measurement of GPU device kernel time.

The application takes the model mutex before calling `clear_frame`, which loops
over raw/restored frames and image views. **The CPU resize is inside the same
critical section as inference.** Consequently resizing and session execution
cannot overlap across frames through this engine. The next candidate is to prepare views
outside the model lock and serialize only the necessary session call. Preserve
lazy view generation, early rejection, cancellation and GPU-to-CPU fallback;
eagerly resizing all views can waste work. The speedup is not yet measured.

GUI detection is still 43.4% of no-fire busy snapshots, and resizing 15.2%.
Those CPU shares alone hide the more important serialized wall-time constraint.

## Allocation pressure

A separate Rust `GlobalAlloc` counting pass, with no stack sampling, measured:

| Tool | Allocation/reallocation requests per processed frame | Requested bytes per frame |
|---|---:|---:|
| First-person | about 33,957 | about 19.1 MiB |
| No-fire | about 8,694 | about 19.0 MiB |

These are cumulative requests, **not live memory, a leak or retained RAM**.
Reallocation requests count again. They exclude allocations made internally by
ONNX, DirectML, the graphics driver and FFmpeg. The profile supports investigating
scratch/template reuse, but allocation counts alone do not prove that the
allocator is the main wall-time limit.

## Artifacts and limits

`AUTO_SCAN_FUNCTION_PROFILE.json` records measured counts, lock budgets, source
and artifact hashes, controls and exact parity checks. Local raw stacks,
symbolized collapsed stacks, source-function flamegraphs and the small profiling
adapters are kept in ignored `.board/scan-profile/`. The paired executable and PDB
for these traces are retained there in `queue-symbols/`.

The function profile intentionally excludes decoding and the frontend. The earlier
600-frame real AV1 stream timing includes decoding, but is not a function profile
of FFmpeg. No conclusions about its internal codec hotspots or device GPU
saturation follow from these traces. A broader video corpus may change proportions.

Method references: Microsoft's [StackWalk64 documentation](https://learn.microsoft.com/windows/win32/api/dbghelp/nf-dbghelp-stackwalk64)
and [GetThreadTimes documentation](https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getthreadtimes).
