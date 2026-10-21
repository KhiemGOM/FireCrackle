# Verified GUI geometry hints — 21 October 2026

Auto's first-person and no-fire scanners now try the last successful GUI fit
before searching all scales again. Each worker owns its own `GuiFitHint`.
The ordinary `GuiDetector::detect`, `PovMatcher::match_frame` and no-fire
`candidate_prepared` APIs remain stateless for previews, random access and controls.

## Verification and fallback

The hint contains dimensions, geometry and the centre/edge scores from its last
**full search**. It contains no frame pixels, previous masks, selected slots,
screen decisions or fire predictions.

On each GUI request:

1. Require unchanged dimensions and supported finite geometry. Nonzero origin
   offsets take the full path in this first implementation.
2. Test current hotbar-selection variants against the canonical opaque template
   samples. Centre agreement must meet the normal threshold and remain within
   the existing `1e-3` tie tolerance of the remembered full-search score. Edge
   agreement must likewise retain the full-search reference quality.
3. Challenge the proposed scale with the existing exact `videoW/n` and
   `videoH/n` candidates within the same ±1% neighborhood used by full fitting.
   A meaningfully better centre score, or a competitive centre score with a
   better edge/misfit result, triggers the original full search. The existing
   `3e-3` centre tolerance and `1e-3` edge tie tolerance are reused.
4. If these checks pass, retain the geometry and build a new mask from current
   pixels. HUD pieces, contents, text and interaction panels are still checked
   on the current frame. A failed/unavailable check runs the original full search.

Successful reuse does **not** lower its remembered reference scores frame by
frame. Only a completed full search establishes a new reference. Missing HUD,
bad input and changed dimensions cannot inherit an old mask. No GUI region is
assumed visible and no newly invented occlusion exception is used to pass a check.

This is a verified temporal proposal, not a mathematical guarantee of equality
to every heuristic global-search result. The quality checks below distinguish
exact mask parity from actual label parity.

## Ordered state in parallel scans

`parallel_frames_indexed_with_state` initializes state inside each worker.
Each worker consumes source indices in increasing order, although different
workers finish out of order. There is no shared “latest fit” that a future frame
can publish to an earlier one. A new scan/resume invocation creates fresh hints;
they are not persisted in scan checkpoints or shared across projects.

The hint is from the last frame that worker actually checked for GUI. First-person
raw acceptances and early no-fire rejections can skip GUI work, so this is not
necessarily the immediately preceding encoded frame. Every reuse is still
checked against current pixels. Existing timestamp validation, cached-decision
skipping, model-session locking and cancellation remain in place.

## Measured checks

Actual decoded scan comparison, full/hint/hint/full order with 12 workers:

| Scanner / clip | Full search | Verified hints | Change |
| --- | ---: | ---: | ---: |
| First-person, 1080p / 1,800 frames | 171.5 fps | 174.4 fps | +1.7% |
| No-fire, 1080p / 1,800 frames | 134.5 fps | 160.9 fps | +19.6% |
| First-person, 1440p / 600 frames | 52.5 fps | 61.2 fps | +16.6% |

Rates use total frames divided by total time across the two runs per path.
Complete decision vectors matched for every pass: 110 first-person accepts,
308 no-fire clears and zero accepts on the 1440p negative clip. Both 1080p
tools also matched their stateless decisions on the same 32 time-spread controls.
These are implementation parity checks, not TP/FP ground truth. The no-fire
provider reported `GPU (DirectML 0)`; model initialization/warm-up was outside
timing. Decode and scan processing were inside timing. Other owner apps were
left running. The 1080p first-person case needs few GUI passes, so its 1.7%
change is small enough to treat as effectively flat on this workload.

The GUI-only 600-frame V03 clip, 20–30 seconds, improved from **76.3 to 97.9 fps**
in the preliminary paired run. Hints were reused on **506/600 frames**, and the
complete class/piece mask hashes matched the stateless result on all 600.
This workload runs GUI analysis on every frame and includes decoding plus mask
hashing; it is **not** the overall Auto scan speed. Actual scanner comparisons
and source/input/artifact hashes are in [`GUI_SCALE_HINTS.json`](GUI_SCALE_HINTS.json).

The time-spread 32-frame control intentionally jumps between GUI scales and
recordings. It shows little speed benefit, as hints frequently fall back. The
stateless path still reproduces the previously frozen class/piece mask bytes.

One of those 32 hinted masks differs: `clip2-clear-9032` uses scale **1.5**, while
the stateless heuristic chooses **1.5023474178403755**, changing 1,446 of 2,073,600
class/piece pixel pairs. The joined recording metadata says 2560×1440 framebuffer,
and the video is 1920×1080: 1.5 is compatible with integer GUI scale 2 × resize
0.75. The alternative is not an integer GUI scale at that known resize. This
supports geometry stabilization, but it is not per-pixel mask ground truth and
must not be reported as 32/32 exact hinted-mask parity. Historical cleared-frame
predictions are not used as ground-truth no-fire labels.

Targeted tests cover stable frames, current selected-slot changes, scale and
dimension changes, hidden HUD, invalid input, a plausible nearby wrong hint,
private monotonic worker state and fresh state on a new scan. Scanner-level
tests cover cancellation, timestamp alignment and resumed/cached frame indices.

## Source evidence and limits

Minecraft **1.16.5, Yarn 1.16.5+build.10-v2**,
`net/minecraft/client/util/Window.java`, `calculateScaleFactor` returns an integer
scale; `setScaleFactor` computes scaled dimensions with ceil. These methods were
re-read from the local mapped sources JAR. Class SHA-256:
`c41fd3c7c2e76ceb7feeb05623d87174fd0c00acf8de13f4bd5b7b5cab6047e2`.
The fit hint supports fractional **video** scales; it does not round all footage
to integer GUI scales or read recording metadata during inference.

No AI training, calibration, model weights, inference thresholds, shared unveil
math or GUI-neutral probe rules changed. The geometry proposal can stabilize a
different fit than a fresh search, so label comparisons are reported explicitly,
not assumed. Stable footage benefits most; frequent GUI changes, weak/occluded
HUD evidence and unsupported offsets still pay for full fitting. No new TP/FP
accuracy estimate or cross-machine/Linux speed guarantee is claimed.

## Validation and build

82 targeted tests passed; four external-fixture tests were ignored. Core and
native Clippy passed with warnings denied. Tests include GUI fallback and
selection changes, worker ordering, timestamp alignment, cancellation, resume,
and frozen no-fire preprocessing behavior. The native release build passed in 4m 03s; its executable hash is recorded
in the JSON manifest. The running app was not restarted.
