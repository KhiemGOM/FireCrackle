# Tiled image model for fire presence

Offline research experiment. Never changes saved application labels. Every output
remains a manual-review candidate. Zero observed calibration errors do not imply
zero errors on new footage. Scores are logits, not calibrated probabilities.

This uses ImageNet-pretrained MobileNetV3-Small visual features, a 576–128–1 head,
and maximum pooling over each frame's image views. Frame labels supervise the
whole bag: background tiles from a fire frame are not incorrectly labelled fire.
The first two epochs fit the head; the remaining eight also fine-tune the last
three backbone blocks. Pretrained batch statistics remain fixed. Development
binary cross entropy selects the checkpoint before calibration/test scoring.

Inputs are a 224px whole-screen view and eight overlapping 640px native windows,
resized to 224px, at a normalized 1920×1080 working resolution. Exclude the top
1.2% before any view so the capture sync strip is unavailable to the network.
Training randomly chooses raw or conditionally unveiled branches and horizontal
flips. Scoring takes the maximum across all raw and conditional-unveil views.
Unveil and purple/translucency guard call the canonical Rust bindings; no copied
pixel rules. No guard hit does not prove opacity. Water/glass/ice are not inferred
automatically; arbitrary open menus and other out-of-distribution scenes remain
unvalidated. No GUI pixels are automatically erased from this experiment.

The target is any recorded source box at least 24px wide at 1080p. Recorded boxes
are approximate visibility proxies, not exact visible flame masks. Smaller fire
is kept separately as `raw_fire=true, fire=false`; unknown/missing geometry and
unsynchronized labels are excluded. Source boxes, ticks and rows never enter
the model. Native resolution normalization precedes the width threshold.

Frozen split for run1:

| Recording | Use |
| --- | --- |
| clip1, 2026-10-15 14-48-36 | First 80% fit; final 20% development |
| quad1, 2026-10-16 00-40-22 | First 80% fit; final 20% development |
| clip2, 2026-10-15 18-18-16 | Clearing threshold calibration only |
| survival1, 2026-10-16 18-23-42 | Evaluation only |

Each fit/development boundary excludes ±180 frames. Sample every 90 frames
(1.5 seconds at 60fps). These familiar recordings have influenced earlier
project research; the evaluation recording is held out of this model's fitting
and calibration, but is not a pristine project-wide benchmark.

Clearing requires a score strictly below the lowest meaningful-fire calibration
score and no shared translucency veto. Ties retain review. Reports include both
guarded and unguarded results and diagnostic logit-zero performance. Do not tune
on the survival results and then call them independent test results.

From the repository root, using an environment with PyTorch, torchvision, NumPy
and Pillow:

```powershell
python -m unittest discover -s fire-detection/bench/image_presence -p 'test_*.py'
python -u fire-detection/bench/image_presence/pipeline.py .board/image-presence/run1
python fire-detection/bench/image_presence/predict.py .board/image-presence/run1 IMAGE.png
```

Defaults: seed321, 10 epochs, 4 frames/batch, backbone learning rate0.0001,
head learning rate0.001, AdamW weight decay0.001, head dropout0.2, class-balanced
frame loss. `--epochs`, `--stride`, `--min-width` are explicit CLI settings; use
a fresh output folder for a changed protocol. Pipeline/Rust source and data
hashes accompany the local cache, checkpoint, calibration and result report.
Data, weights, thumbnails and caches stay under ignored `.board/image-presence`.
Official pretrained weights download into that experiment folder.
