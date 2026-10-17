# Four deterministic no-fire experiments

2026-10-17. Owner requested all four avenues in parallel. The shared automatic
unveil remains the only colour inverse. Positive means a correct no-fire or
negligible-fire clear; false positive means meaningful fire wrongly cleared.
All spatial experiments use the same 218 clip2 calibration frames and 1,361
evaluation frames (755 clear-eligible, 606 meaningful fire), stride90, native
1920x1080, horizontal visible-box width24 proxy, no height cutoff.

Ideal GUI masking is an experimental premise, not an implemented mask here.
Full-frame results remain separately available. Existing `nohud`/`hud_proxy`
variants remove fixed rectangles and retain all actual fire as truth; they
must not be described as measured oracle-mask results. This does not block
testing the hypotheses while GUI masking is being developed.

## Findings

- **Fragment merging:** dilation radii0/1/2/4, 8-connected components, counting
  only original orange area rather than the artificial dilation pixels.
  Clip2-only selection chooses radius4, threshold2198: **91 TP / 13 FP**.
  This is worse than the unmerged largest-blob reference100/13. Merging does
  not make blob size transferable enough for safe no-fire decisions.
- **Multiple window sizes:** normalized24/48/96px local-orange and orange-only
  texture evidence, predeclared min/mean/max ablations. The conservative
  full-frame primary gives **7 TP / 0 FP**; a permissive alternative gives
  **51 TP / 6 FP**. HUD-proxy local+texture max gives30/0 and adds just one
  clear to the previous exploratory46/0 union, producing **47 TP / 0 FP**.
  That union is exploratory, not an independently validated operating point.
- **Broader colours:** the clip2-only expanded-range primary, dark-orange
  texture24<123, gives **7 TP / 0 FP**, versus the original full-frame local24
  rule24/0. Dark-orange local24<562 gives **65 TP / 19 FP**; the redder version
  gives39/13. Broader support alone does not improve safe clearing. See
  `BROAD-COLOUR-RESULTS.md` for all24 variants and the projected-sample caveat.
- **Temporal bursts:** actual video frames at offsets0/3/6 from each anchor,
  translation registration, raw and shared-auto branches. Clip2 has three
  meaningful-fire examples with zero qualifying change/reversal. Every
  zero-calibration-FP motion threshold consequently becomes0, so the strict
  acceptance rule **always reviews**: mathematically0TP/0FP and no utility.
  The spatially guarded variant also abstains because no finite calibration
  fire remains. Pixel evaluation was stopped during partialclip1 rather than
  reporting a fabricated complete evaluation. 218 real calibration bursts
  (654 input pictures) were processed.

The temporal counterexamples are clip2 frames2880,13860,13950. Exact-frame
visual review confirms actual fire; the latter two have recorded veil0.8/0.801
and are automatically unveiled. Motion absence cannot establish fire absence.
The registered spatial-burst rule with frozen440 threshold can only retain
more frames than the existing anchor local24 rule, so it cannot increase its
correct-clear count. Labels remain attached only to the anchor frame.

## Targeted temporal review and reproducibility

Read-only peer review identified that newly unveiled orange might leave the
registered overlap even when raw dark orange did not trigger the original
crop guard. Before reading evaluation metrics, a conservative policy was
recorded: any auto-unveiled burst with nonzero translation has unknown motion
scores and stays review. `burst_review.py` applies that policy from saved
metadata, suppresses four calibration bursts, and recalibrates clip2 only;
all six motion thresholds remain0. The current runner implements the policy
directly. Original decode source hash and reviewed source hashes stay separate.

Four targeted tests cover white exclusion, static orange, anchor association,
window boundary coverage and shifted-auto uncertainty (two checks share one test).

```powershell
python fire-detection/bench/no_fire/burst_pilot.py .board/no-fire-parallel/temporal-new --workers 4
python fire-detection/bench/no_fire/burst_review.py .board/no-fire-parallel/temporal
```

The runner stops after calibration if all motion thresholds are0. `--full-eval`
allows an explicit full pixel run if needed. Existing ignored evidence is in
`.board/no-fire-parallel/{fragments,colours,multiscale,temporal}/`; per-method
reports include frozen thresholds and source/cache hashes. The temporal
`reviewed-report.json` explicitly labels the early stop, and
`zero-motion-fire.png` shows the actual counterexamples. No app labels were
changed and no learned model was used.

See `FRAGMENT-RESULTS.md`, `BROAD-COLOUR-RESULTS.md`, `MULTISCALE-RESULTS.md` and
`ORANGE-RESULTS.md` for the individual protocols. These are familiar,
temporally correlated recordings with multiple exploratory variants, not a
pristine independent validation set. Zero observed FP is not a guarantee.
