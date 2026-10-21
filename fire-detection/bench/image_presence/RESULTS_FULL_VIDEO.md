# Entire-video evaluation of the frozen no-fire ensemble

**The dense test exposes errors missed by sparse sampling. The current ensemble
is not reliable enough for unattended clearing under the existing benchmark.**

Scanned every frame of `2026-10-15 18-18-16.mkv` (clip2): **19,553 frames**, native
1920×1080, 60 fps, 325.88 seconds. All frames have valid joined recorded truth;
no skipped, missing or unknown-label frames. This recording did not supply fitting
data, but its 218 sparse samples supplied the existing calibration threshold.
This is therefore a familiar full-video diagnostic, **not independent validation**.

## TP and FP

Positive means eligible to clear as no fire. TP = correct clear; FP = meaningful
fire wrongly cleared. Same frozen 24-native-pixel source-box width target as all
prior experiments: 8,908 eligible frames and 10,645 above-cutoff fire frames.

| Method, identical common safety gates | TP / 8,908 | TP rate | FP / 10,645 | FP rate |
| --- | ---: | ---: | ---: | ---: |
| MobileNetV3 | 647 | 7.26% | 86 | .81% |
| Orange/fragment rules | 575 | 6.45% | 59 | .55% |
| Existing OR ensemble | **1,160** | **13.02%** | **95** | **.89%** |

The ensemble clears 1,255/19,553 frames (6.42% of the entire recording), spanning
220 contiguous clear intervals. Of its clear decisions, **7.57% are wrong under
the frozen target** (precision 92.43%). Fifty false-clear frames are shared by both
methods. Requiring agreement is therefore not automatically error-free either.
No combination or threshold was retuned on these results.

Of 1,160 TP frames, **1,040 are literally recorded no fire**, and 120 contain only
below-cutoff recorded fire. The existing eligibility definition is preserved;
below-cutoff fire has not been silently relabelled as physically absent.

## Failure review

All 95 false-clear thumbnails were reviewed; native PNGs are preserved. There
are 16 strictly contiguous false-clear runs, or 11 review windows when neighbouring
errors within one second are grouped for inspection. These correlated frames are
not 95 independent scenes.

Representative windows include:
- Frames 2539–2540 (42.32–42.33 s): recorded fire boxes clipped at the top edge;
  source-box width alone is a poor visible-fire/readability proxy here.
- 6349–6356 (105.82–105.93 s), 7736–7737 (128.93–128.95 s): dark Nether views.
- 8162–8181 (136.03–136.35 s, intermittent): smoke/particle-heavy views.
- 15786–16334 (263.10–272.23 s, several separate runs): options/pause menus,
  including both frames that were automatically unveiled and frames that were not.
- Additional short runs at 16676–16678, 16938–16944, 17867–17868 and 18271–18274.

The canonical automatic unveil was applied throughout. Eighteen false-clear
frames had automatic correction applied and 77 did not; that does **not** mean
all 77 are missed veils, since ordinary un-veiled scenes also correctly use raw
pixels. Menu recovery, uncertainty gates, occlusion and spatial/context evidence
remain issues to investigate. No individual causal fix is established by these
counts alone. Several projected/clipped boxes are also questionable readability
targets; none were removed after seeing the test.

The old 919-frame survival result (43 TP / 0 FP) remains a historical sparse
diagnostic. It does not support a zero-error claim across complete recordings.
This entire-video run used the same model/thresholds rather than retraining on
its new failures.

## Frozen policy and verification

- MobileNet positive-aux V3 checkpoint SHA256
  `4542be2d4ac9f9f9df5dbb9b0a7d1a05a94241b6292cb7e7259ea8bed0d1548a`;
  fixed logit threshold `-1.7583287954330444` (strictly less than clears).
- Native orange merged radius4, max(raw, automatic-unveil), threshold2198;
  existing restored-only 128-area / 24-width / 8-height retention rule.
- Identical reliable-GUI, weak-menu, material-v3 and original purple safety gates.
  GUI remains a guard/material/retention input; model pixels are not erased.
- Independently counted video frames with FFprobe; audited consecutive decoded
  frame IDs 0–19552 and recomputed recorded truth for every frame. Video SHA256
  matches the original cached dataset's recording.
- All **218** original calibration frame inputs match byte-for-byte and model
  scores match within 1e-5. All **218** historical native orange scores match exactly.
- All **3,034** raw union candidates receive fresh full-resolution safety checks;
  their model-input view hashes and native orange areas match the scoring pass.
  Other frames cannot clear either frozen method and need no expensive GUI fit.
- Independent audit recomputes every decision, TP/FP denominator and clear interval;
  checkpoint/threshold and 17 guard source/asset hashes are unchanged. Targeted
  tests cover unknown-label accounting and contiguous clear-run boundaries.

The initial candidate verifier used individual seeks and was slow. Its 550
completed candidate checks were preserved; the remaining 2,484 were verified in
a second full sequential video decode, with identical rules and per-frame parity
checks. Original executed-source snapshot and separate resume-source hashes are
preserved. This changes traversal cost, not the clearing policy. No app, release
or saved-label changes were made.

## Local artifacts and tools

Primary checkout `.board/image-presence/continuation/full-clip2/` contains frozen
protocol and source snapshots, every-frame `scores.jsonl` / `predictions.json`,
candidate `gates.jsonl`, `report.json`, `audit.json`, all 95 native failure PNGs,
four `false-clears-*.jpg` contact sheets, and representative correct-clear sheets.

`full_video.py` performs the all-frame scan, `finish_full_video.py` resumes complete
scores with streaming verification, and `audit_full_video.py` audits this specific
clip2 evaluation. Recordings, local assets, generated data and weights stay ignored.
