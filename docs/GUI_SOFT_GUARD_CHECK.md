# Tiny GUI and sign-editor check

The automatic source-template detector now detects **257/261 interaction-GUI
samples (98.5%)**, versus 242/261 before this change. It recovers 15 misses,
loses no previous detections, and produces **0 false detections in 289
closed-GUI samples**. These are the same development recordings and sampled
screen-segment midpoints, not every frame or an independent test set.

## Changes

- At less than one output pixel per GUI texel in both axes, source probes can
  match a channel range between their original colour and their opaque 3x3
  source-neighbourhood mean, plus the existing 24-channel tolerance. This
  allows edge blending from downscaling. It is a bounded approximation, not
  a reconstruction of OBS's unknown resampling kernel.
- Acceptance fractions (90% border, 85% structure), regional evidence quorums,
  geometry search and minimum surviving evidence remain unchanged. Fixed
  control text retains its strict comparison. Larger GUI scales retain their
  original comparison. A mismatch never creates an occlusion mask.
- The neighbourhood alternative is unavailable beside transparent/unknown
  source pixels. Caller-supplied occlusion remains neutral in numerator and
  denominator, with the existing insufficient-evidence guards.
- Hanging-sign editors gain the fixed heading/Done-button alternative already
  used for ordinary sign editors. Minecraft 1.21.11's
  `AbstractSignEditScreen.init` places Done at `(W/2-100,H/4+144,200,20)`;
  its render method draws the heading at `(W/2,40)`.
  `HangingSignEditScreen` inherits these methods and supplies
  `hanging_sign.edit`. User-written sign text and renameable container titles
  are not identifying evidence. This alternative masks only the button patch,
  not the entire sign/editor area.

## Observed changes

- All three missed hanging-sign visits now pass: 10/10 hanging signs detected;
  ordinary sign editors remain 7/7.
- Twelve of fourteen smallest-scale GUI misses now pass without supplied masks.
  Some have ambiguous known types, which still count as GUI detected.
- Remaining automatic misses: two tiny creative-inventory visits, one filled
  dispenser/dropper and one merchant visit. The latter two already responded
  to independently supplied occlusion exclusions in the preceding diagnostic.

## Supplied-mask compatibility check

Rerunning all 636 samples through the new scorer with the same independently
supplied slot/mouse exclusions gives **260/261 (99.6%)**, recovering three more
samples without regressions; closed negatives remain **0/289**. One tiny
creative-inventory sample remains missed. All unmasked decisions reproduce the
new automatic benchmark.

This 99.6% result is conditional on renderer-assisted masks, **not automatic
video-only accuracy**. See [the mask protocol](GUI_OCCLUSION_MASK_CHECK.md):
logged layout/mouse positions supply conservative potential-content exclusions,
including empty slots. They are neither inferred automatically nor exact pixel
ownership. Closed frames lack container-layout masks, so their result does not
validate a future automatic mask proposal system.

## Evidence and limits

Private evidence is under `.board/gui-soft-guard-check/`:
`assets-v10` contains 90 source variants for 35 classes;
`check-v10/{report.json,predictions.jsonl,coverage.json}` records all 636
sampled segments across both aligned recordings, source/video hashes and
per-sample decisions. Source rules/class and local asset hashes are in the
asset manifest. The benchmark source hash precedes a formatting-only pass.
`check_visits.py` and `supplied-mask-visits.json` preserve the separate
full supplied-mask rerun, including source/binary hashes and all decisions.

The new unit fixture area-downsamples a source GUI to 0.75 scale independently
of the scoring approximation, verifies detection, then rejects a uniform-grey
frame and a frame with the same border but erased interior layout. All 16
GUI-interaction tests pass, including the existing occlusion-neutral tests.

This is deterministic source-template work, with no AI fitting or training.
Both recordings share a session and were already inspected during development.
Zero observed false detections is not a general zero-error guarantee. English
sign controls, vanilla artwork and the existing capture geometry assumptions
still apply. No video-only occlusion estimator or app scanning path is added.
