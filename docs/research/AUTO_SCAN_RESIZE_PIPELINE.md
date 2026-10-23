# No-fire resize/session pipeline — 21 October 2026

The function profile identified CPU resizing inside the shared model mutex.
`Engine::clear_frame_shared` now prepares each view outside that mutex and locks
the session for scoring. The application's no-fire scan calls this path.

## Measured result

Same model session and DirectML 0 provider, 12 workers, unchanged native 1080p
preprocessing and decisions:

| Workload | Frame-wide lock | Resize outside lock |
|---|---:|---:|
| Cached RGB processing, final old/new/new/old comparison | 79.1 fps | 153.6 fps |
| Decode + detector, 1,800 contiguous video frames | 84.2 fps | 139.6 fps |

The cached rate is total processed frames divided by total time across each
path's two passes: 512 frames per pass, repeating the same 32 real V02/V03 inputs.
It is not 2,048 unique frames or an accuracy evaluation. The earlier longer trial
also showed roughly a twofold improvement (about 70 versus 151 fps). Rates vary
with content and machine load; no universal speed promise is implied.

The contiguous test decoded V03 `2026-10-15 18-18-16.mkv`, 20–50 seconds, through
the bundled FFmpeg and the production native frame queue. Both paths produced
the same **308 no-fire decisions**, all at the same original output indices, and
made the same 1,220 frame-level model calls. Time fell from 21.390 to 12.891 s.
This includes decoding/RGB transfer and detector execution, but excludes the
frontend, project timestamp validation and persistence. The two stream passes
were old then new, not a repeated full-video benchmark. Provider setup was
outside the timed sections.

Every cached output also matched the previously frozen reference for each of
the 32 inputs and every repetition, including seven clears per repetition.
No claim about new TP/FP accuracy follows from these throughput checks.

## Retained behavior

- Same frozen Pillow-compatible view bytes, raw/restored order, threshold and model.
- Prepare only the next needed view; reject immediately when it fails. No eager
  nine-view batch and no cache of prior frame predictions.
- Cancellation remains conservative, including after a queued view gets the lock.
- If GPU inference fails, load CPU and recheck the **entire** frame. A worker whose
  backend changed between views also rechecks its earlier GPU evidence on CPU.
- CPU load/inference failures remain errors. The one session is never executed
  concurrently. Existing in-process model reuse remains in place.

GPU failures were simulated in targeted tests; no driver failure occurred in
the timed real-frame runs. The change adds at most one prepared view per active
worker waiting for the session, rather than preparing all views for each frame.

## Which GUI masker the scans already use

The fast versioned interaction detector is already in production, introduced by
`363df75`:

1. `gui_interaction.rs` re-exports `fast::InteractionDetector` from
   `gui_interaction_fast.rs`.
2. `studio_core::gui::with_interactions` attaches the shared source bank. Both
   `pov_textures` and the no-fire texture loader call it.
3. `GuiDetector::detect` performs HUD fitting/masking and merges those independent
   interaction-panel results. Both first-person and no-fire use this detector.

The HUD and panel passes have different purposes: hotbar/hearts/hunger and other
overlays versus inventory/menu panels. Calling both is not a duplicate HUD fit.
The fast panel detector does not replace every HUD pixel mask needed downstream.

There **is** an older `add_screen_masks` extension after `GuiDetector::detect` in
the first-person path. It overlaps inventory/menu detection, but identical
coverage and exclusion behavior have not been established. The earlier profile
has 170/7,251 busy stacks (2.3%) inside this extension including its callees.
The initial under-1% observation counted direct samples only. This is potential
cleanup, not permission to remove a mask and change acceptance. No GUI detection
or mask rules were changed for this optimization.

## Verification

Twenty targeted no-fire crate tests pass: frozen resize hashes, view order,
early rejection, cancellation, GPU failure, concurrent backend-change restart
and error propagation. Native application no-fire tests pass (two external
fixture tests remain ignored), and native Clippy is clean. The performance
adapter invokes the same `Engine::clear_frame_shared` method as the application.
Source/input/model/artifact hashes and raw measurements are recorded in
`AUTO_SCAN_RESIZE_PIPELINE.json`; private inputs and adapters remain ignored.
The optimized native application build passed. The already running instance was
left open; it needs a restart to load this executable.
