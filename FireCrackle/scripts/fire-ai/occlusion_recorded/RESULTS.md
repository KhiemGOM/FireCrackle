# Recorded occlusion-mask experiment — 2026-10-17

Training on the new recording improves the partial visibility mask substantially.
The resulting improvement in sprite selection is small, with regressions on some
individual cases. This is a research checkpoint; the app's matcher is unchanged.

## Data and supervision

Source: `fire-detection/data/video/2026-10-17 18-28-42.mkv`, plus its lossless RGB/ID
capture pairs in ownership session `ebe022b2-f48a-456d-8c2c-169aedede5f9`.
95 capture samples lie within the video's rendered-frame range. Most have global
missing-VBO-metadata warnings. This experiment **does not promote those frames to
oracle ground truth**. It tests using their locally consistent, mapped plane IDs
as partial supervision, retaining the original warnings and hashes.

The audit checks PNG hashes, positive clip W, invertible submitted UV-to-image
correspondences, >=16px quad edges, >=100 native visible pixels, and <=3% ownership
on transparent texels of the recorded sprite. It ignores unknown IDs, out-of-frame
points, one-pixel ownership boundaries, and texture-edge probes. A crop needs >=24
known positive probes and >=128 known probes total. No absence of a mask is used
as a no-fire label. Local errors can still survive these checks.

This yields **178 crops**, split by 600-render-frame blocks with 100-frame boundary
purges on each side:

| Split | Crops | Distinct rendered frames |
|---|---:|---:|
| Training | 101 | 13 |
| Validation | 29 | 5 |
| Test | 48 | 6 |

This is a small, correlated dataset from one recording. It is not 178 independent
scenes. Material-mixed regions marked unknown, including much glass/water footage,
provide no direct supervision; this is not a trained glass/water detector.
New-recording training and tests use the lossless capture sidecars, including
rendered frames that OBS did not retain. The older real datasets use their saved
decoded video pixels. No new-clip encoded-video equivalence is claimed.

Inputs are RGB plus the existing broad fire-colour mask in a rectified 64x64 quad.
The model receives no candidate sprite, row, sheet, timing, or expected alpha.
Expected alpha is used only to audit training/evaluation labels, never inference.
The canonical Rust unveil binding preprocesses real RGB; no inverse math is copied.

## Training and selection

Two small U-Nets use the same existing `MaskNet` architecture:

- **Fine-tuned:** initialized from the prior survival mask checkpoint.
- **Scratch:** random initialization, as a control.

Each runs six epochs, 96 steps per epoch, batch 48: 24 recorded partial-label crops
and 24 synthetic ownership scenes. Known-pixel BCE and Dice losses are normalized
per example; unknown probes have no loss. Flips transform images and masks together.
Checkpoint selection maximizes the mean of recorded-validation known-pixel IoU
and synthetic-validation IoU. Test results do not change weights or thresholds.
Training took about 27 seconds and 21 seconds respectively on the local RTX4060.

Held-out **known-pixel** mask metrics, using threshold0.5:

| Mask | IoU | Precision | Visible-target recall | Other-plane retention |
|---|---:|---:|---:|---:|
| Broad colour proxy | .383 | .383 | 1.000 | not measured |
| Previous survival model | .391 | .507 | .629 | .572 |
| Fine-tuned model | **.633** | **.707** | .857 | **.339** |
| Scratch model | .608 | .670 | **.868** | .410 |

These metrics cover37,048 known probes, not the unknown regions. The colour proxy
here is the network's existing fourth input; the downstream baseline below is the
actual app colour-mask/scoring implementation.

## Downstream comparison with our matcher

All methods use **the original native RGB pixels, the same quad and unchanged app
sampling/scoring**. Only sample weights are multiplied by the inferred mask.
No geometry optimizer is enabled in this isolated comparison. The baseline rerun
reproduces the historical87/310 and59/310 quad1 counts. An initial64px-resampled
matcher diagnostic is retained in scratch, but excluded from these results because
it changed the baseline pixels.

Numbers are exact sprite top1 correct counts. Learned columns use the fixed soft
mask, rather than selecting a blend after looking at test accuracy.

| Dataset | Targets | Colour matcher | Previous mask | Fine-tuned mask | Scratch mask |
|---|---:|---:|---:|---:|---:|
| New recording, exact quad | 48 | 28 | 26 | **28** | 27 |
| New recording, rough quad | 48 | 16 | 17 | 18 | **19** |
| Older quad1, exact | 310 | 87 | 83 | **90** | 88 |
| Older quad1, rough | 310 | 59 | 61 | **62** | **62** |
| Older survival, exact | 36 | 14 | 15 | 15 | **16** |
| Older survival, rough | 36 | 9 | 8 | **10** | 8 |
| Reviewed cases | 15 | 15 | 15 | 15 | 15 |
| Synthetic controls | 224 | 148 | 144 | **151** | 150 |

Rough quads use the previous experiment's fixed width1.12/height0.92 perturbation,
translation, and two corner offsets. Cases and perturbations are shared across
methods. The old survival training/selection neighbours remain excluded from its
evaluation. All real datasets here are separate from the new recording's training
frames; the new-recording test is time-separated within the same clip.

Fine-tuning gains7 and loses4 exact quad1 cases; on rough quad1 it gains9 and loses6.
Frame-cluster bootstrap95% intervals for its net gain include zero: [-1.23,+3.28]
percentage points exact, [-2.33,+3.40] rough. The new exact test gains2 and loses2,
both changes cancelling within their frame groups. Its degenerate bootstrap
interval is not evidence of population-level certainty from six frames.

Synthetic controls include32 cases each of clean, background patch, rod, white UI,
smoke, another fire plane, exactly aligned fire, and absent target. Fine-tuning
improves other-fire17→19/32 and smoke24→26/32, but clean falls28→27 and rod26→25.
Both baseline and learned mask get0/32 on the deliberately ambiguous aligned-fire
condition. All methods make0 false-clear decisions on the32 absent-target controls;
that small synthetic test is not a real-world false-positive guarantee.

Wrong high-confidence results also remain: fine-tuning reduces rough quad1 wrong
clear results10→8 but leaves new recording1→1 and older survival exact13→13.
The model should not be used to auto-confirm labels.

## Cost and conclusion

Fine-tuned single-crop inference, including broad-colour input and CPU probability
output but excluding decode/rectification: CPU median2.79ms, p953.84ms; CUDA
median3.65ms, p954.39ms. Small GPU work plus host transfer was slower on this machine.
These are local timings, not app end-to-end measurements.

**The recording helps the occlusion mask; it does not yet establish a large or
reliable improvement in exact sprite matching.** Keep the checkpoint for further
research, with the current colour matcher as baseline. Next experiments should
test whether retaining distinctive visible texels and geometry robustness improves
ranking, rather than optimizing aggregate mask IoU alone. No new recording is
required to pursue that analysis.

## Reproduction and artifacts

Use the existing research environment, then run `prepare.py`, `experiment.py train
--run finetune`, `experiment.py train --run scratch`, `experiment.py evaluate`,
`experiment.py evaluate --rough`, and `experiment.py synthetic` from the repository.
Run `scripts/occlusion-mask-eval.mjs DATA OUT` for each emitted run/dataset, using
`<dataset>-native-score` as OUT, then `summarize.py`.

Artifacts live in ignored `.board/occlusion-recorded`: source-hashed manifest,
recorded.npz, per-run protocols/checkpoints/history, mask-results.json,
downstream-summary.json, per-case matcher results, latency.json, and training-audit.png.
Checkpoints and raw game assets are not committed. Four tests in `test_prepare.py`
check UV orientation, pixel centres, ignored unknown boundaries and split separation.

Fine-tuned checkpoint SHA256:
`151145d46d92b0725c2557144d2b897d1bfa5aa57ae5f0c628232dd9d1f22a76`.
Scratch checkpoint SHA256:
`2768dbbd769cf8a170f74870a46b6c4227666403be4daf3b77947f813c569693`.
