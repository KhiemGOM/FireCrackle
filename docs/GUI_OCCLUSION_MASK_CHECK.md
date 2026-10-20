# Real-footage check of occlusion-neutral scoring

Historical mask-only diagnostic, before the tiny-GUI/sign changes. See
[the subsequent soft-guard check](GUI_SOFT_GUARD_CHECK.md) for current results.

The new `detect_with_occlusion` path was checked on the same **636 sampled
screen segments** as the prior baseline, including every previously detected
example and every previously missed example. These are midpoint samples, not
an exhaustive every-video-frame measurement.

## Results

| Interaction-GUI metric | Original unmasked path | Supplied-mask path |
|---|---:|---:|
| Detected / GUI-present samples | 242/261 | 247/261 |
| Sampled recall | 92.7% | 94.6% |
| Misses | 19 | 14 |
| Previous detections lost | — | 0 |
| Closed-GUI false detections / negatives | 0/289 | 0/289 |

Menus and modded screens are excluded from this interaction metric. GUI type
ambiguity counts as detected. All 636 original unmasked presence decisions
were reproduced before comparison.

**This is a supplied-mask scoring diagnostic, not an automatic video-only
occlusion-detection benchmark.** Renderer labels supplied the slot geometry
and mouse positions. Consequently these results do not establish the accuracy
or false-positive rate of an automatically estimated mask. In particular,
positives can receive exclusions at their known GUI location, while closed
screens have no container layout in the metadata.

The automatic detector has not yet received a video-only occlusion estimator;
its measured unmasked result at this revision was 242/261.

## Mask protocol

- Input was the actual decoded 1920×1080 RGB frame, selected by the same
  renderer-aligned video index as the baseline.
- Independently logged container slot positions supplied potential 18×18
  item/count footprints. Empty slots were excluded too; the mask is a
  conservative potential-content exclusion, not exact pixel ownership.
- The logged mouse position supplied a 30×36 cursor/carried-stack exclusion.
- Exclusions were defined before scoring, without consulting mismatched probe
  colours. No failed-pixel-derived masks, model fitting or threshold changes.
- Every other input, source pack and detector setting stayed fixed.

These masks are deliberately broader than the actually occupied pixels. Their
result cannot be presented as performance with tiny, perfectly estimated
occlusions, or as a complete mask for arbitrary tooltips and other layers.

## Recovered cases

| Recording | Video frame | Truth |
|---|---:|---|
| Main | 22266 | Container |
| Main | 22467 | Shulker |
| Main | 22573 | Creative inventory |
| Main | 24639 | Dispenser/dropper |
| Supplemental | 1026 | Merchant |

The filled dropper is a direct real-footage check of the new normalization:
unmasked detection fails; supplied-mask detection succeeds with 96 border
probes and 23 remaining structure probes, both at 100% agreement. The mask
removes probes from both error counts and score denominators.

Three recovered small-GUI cases were not established to be physically occluded
at all excluded locations. Removing potential-content regions also discards
some capture-degraded probes. They demonstrate changed scoring support, not
proof that foreground occlusion caused every recovered miss.

## What still limits this diagnostic

The remaining 14 misses are **11 smallest-scale panels and 3 hanging-sign
editors**. The prior source-probe audit identifies subpixel colour blending,
coarse pixel registration and hanging-sign texture sampling as the rejected
evidence conditions. Neutralizing content does not repair those image-model
problems.

Before masks, GUI scales2/3/6 supplied 242 detections in247 samples; the14
scale1 samples supplied none. With these masks the larger-scale group supplies
244/247, while the smallest group supplies3/14. Thus occlusion alone was not
responsible for the low combined baseline.

## Reproduce and provenance

- Private runner: `.board/gui-occlusion-impact-audit/check_visits.py`.
- It uses the original selector in
  `fire-detection/bench/gui_interaction/check_recorded.py`, frozen renderer
  snapshots and the actual Rust `detect` / `detect_with_occlusion` APIs.
- It checks both recordings, all636 selected samples, then stores every
  input frame index, decision, mask-pixel count, visible-probe count and
  baseline comparison in `supplied-mask-visits.json`.
- That report records the production-source and diagnostic-binary SHA256.
  The original presence report provides the video and joined-label hashes.
- Source bank: `.board/gui-interaction-detector/assets-v9`, unchanged from
  the baseline and prior false-negative trace.
- Private raw frames, masks, geometry logs and game assets remain ignored.
- Same-session development evidence only; no independent validation claim.
