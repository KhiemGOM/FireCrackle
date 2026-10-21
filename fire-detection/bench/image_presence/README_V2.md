# Reviewed-crop image model, research v2

This experiment is isolated on `codex/fire-presence-research` and explicitly
excluded from0.2.1. All outputs remain manual-review candidates; there is no app
integration or automatic saved-label change. The first experiment is preserved.

V2 makes three related changes together; it is not an ablation that isolates each
change's contribution:

- Sample the same fitting recordings every30frames instead of90:1,048 candidate
  fitting frames, versus350 in v1. Adjacent frames remain correlated.
- Propose192 native320px crops, stratified by recording, block/entity kind and
  width24–48/48–96/96+px, with source visibility>=0.5. Visually review every
  candidate; approve188 and exclude4 ambiguous/occluded crops. Rejected positive
  candidates are excluded, never relabelled as negative.
- Train on those approved crops plus two hard negatives from each of422 fitting
  frames with no recorded fire at all. Propose four random320px tiles per negative
  frame and select the two highest-scoring under frozen v1 weights. Negligible-fire
  frames are not used as negative crop supervision.

Model: ImageNet-pretrained MobileNetV3-Small with the same576–128–1 head. Freeze
the backbone for2epochs, then fine-tune its final3blocks; keep batch statistics
fixed. Eight epochs,32crops/batch, seed321, AdamW weight decay0.001, learning
rates0.00005(backbone)/0.0005(head), weighted class-balanced loss,50% horizontal
flips and brightness multiplier0.85–1.15. Pick the checkpoint using whole-frame
development BCE over the same83 development frames, before calibration/test.

Inference is a dense, label-free image scan:40 overlapping320px native tiles at
1920×1080, resized to224px. No whole-screen view is used in v2. The top12pixels
containing the capture sync strip never enter a view. A24px flame becomes about
17px wide in a view, versus8px in v1. Take the maximum logit across all tiles of
the raw image and canonical conditional-unveil branch. Scan in32-image chunks.
The network never receives geometry, ticks, phases, timestamps or source IDs.

Canonical Rust unveil and purple/supplied-translucency guard are reused through
the existing Python bindings, with exactly the same Rust source hashes as v1.
Absence of a guard hit does not prove opacity; water/glass/ice are not inferred automatically.
Menu/held-object confounders and incomplete recorded visibility remain limits.

Calibration/evaluation use exactly v1's218clip2 and919survival1 frame IDs and its
width24 target. Freeze a strict threshold below the lowest meaningful-fire
calibration score, then apply the shared abstention veto. Survival1 has already
been inspected in v1 and informed the broad next-experiment discussion: it is a
familiar diagnostic comparison, not a fresh independent validation recording.
Zero observed errors cannot establish a zero future error rate.

Run in a checkout containing the local labelled videos, or supply `--data-root`
pointing to the primary checkout. For isolated source plus primary local data:

```powershell
python crop_v2.py prepare OUT --data-root DATA_ROOT --baseline-source pipeline.py --baseline-run BASELINE_RUN
# Inspect all positive-review-*.png and write review.json: {candidate_id: true/false}.
python crop_v2.py train OUT --data-root DATA_ROOT --baseline-source pipeline.py --baseline-run BASELINE_RUN
python predict_v2.py OUT IMAGE.png --data-root DATA_ROOT --baseline-source pipeline.py
```

`train` mines negatives, trains, selects/saves a checkpoint, freezes calibration,
and evaluates the familiar survival recording. It requires a boolean review entry
for every candidate, with no extra IDs. Protocol, source/preprocessing/data/review
hashes, exact candidate IDs, visual-review reasons, mined negatives, weights,
prediction rows and contact sheets are saved locally. Use a fresh output folder
for a changed protocol. Keep all data/images/weights under ignored `.board`.

The first run's threshold-limiting frame, clip2#15840, was inspected at full
resolution and after canonical auto-unveil. The options menu is open, but a
qualifying flame remains visible at lower right after unveil. It is retained as
positive calibration truth; no threshold-limiting example is discarded to raise
coverage. Screenshots are local `run2/old-threshold-case.png` and
`old-threshold-unveiled.png`.
