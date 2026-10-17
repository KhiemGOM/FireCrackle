# AI no-fire integration — 0.3.0

Auto combines the frozen orange-fragment rules with a MobileNetV3 Small image model. It processes native 1920 × 1080 video, saves no-fire labels only on untouched frames, and applies the finished batch as one undoable action. Patterned tool colours distinguish automatic labels. Unknown GUI evidence, uncertain menus and suspected world translucency cause abstention.

Resumable scans retain completed frame decisions locally. Cache compatibility includes the video, frame index, detector/model sources, assets, runtime manifest and application version. Cached decisions do not override existing labels.

## Portable model audit

The research CUDA run used TF32. Exact RGB inputs alone did not reproduce its scores on full-precision ONNX: clip2 frame 0 changed from 0.087879613 to 0.08101057. Deployment was recalibrated on the **same reserved 218 frames**: 125 meaningful-fire and 93 eligible frames. The complete evaluation recording was not used to select the new threshold.

- CPU threshold: **−1.7570972442626953**, plus a conservative **0.0001 abstention margin**.
- Maximum CPU/DirectML calibration score difference: **0.00001034**.
- Maximum Windows CPU/Linux CUDA difference across the same 218 frames: **0.00001440**, with **no changed clear/retain decisions**.

`scripts/export_no_fire.py --calibration-dataset DATASET` reproduces the audit. It rejects a changed calibration dataset hash. Model, source-checkpoint and runtime archive hashes are pinned in `no-fire-model.json`. Historical TF32 results remain separate.

## Complete native recording check

The familiar clip2 recording contains **19,553 frames** at 1920 × 1080 and 60 fps. The portable CPU implementation produced:

| Outcome | Count | Rate |
| --- | ---: | ---: |
| TP: eligible frames correctly cleared | 1,158 / 8,908 | 13.00% |
| FP: meaningful-fire frames wrongly cleared | 95 / 10,645 | 0.8924% |
| Wrong decisions among all cleared frames | 95 / 1,253 | 7.58% |

Ten decisions differ from the original TF32 research implementation: four additional correct clears and six retained eligible frames. All 95 false-positive frames are unchanged.

These are correlated familiar-video results, **not independent accuracy estimates**. The reserved calibration frames came from this recording. The original 24-pixel-wide box cutoff is a size proxy, not a human-readability oracle. A clear decision does not prove that no tiny, obscured or unreadable flame exists. Recheck automatic labels when additional phase readings matter.

## Speed and parallelism

The complete sequential decode, preprocessing, inference and result write took **551.585 seconds**, or **35.45 frames/second**, using two bounded frame workers and two CPU inference threads. Other agents were using the CPU, so this is not an isolated speed record.

On the same 2,200-frame segment, one worker took **134.744 seconds** and two took **69.615 seconds**: **1.94× faster**, with identical frame decisions and 243 clears. Model access remains serialized to avoid oversubscription.

Warm model-only medians for nine views on the test laptop:

| Backend | Time |
| --- | ---: |
| Windows CPU, two threads | 13.6 ms |
| Windows CPU, four threads | 14.2 ms |
| Windows DirectML adapter 0 | 8.3 ms |
| Windows DirectML adapter 1 | 34.4 ms |
| Linux/WSL CPU, two threads | 22.8275 ms |
| Linux/WSL CUDA, RTX 4060 Laptop | 22.8812 ms |

Automatic selection compares startup probe scores and timings against CPU. It rejects drift above 0.0001 or a speed gain below 10%. The tested Linux setup therefore offers no measured CUDA speed benefit. CUDA TF32 is explicitly disabled. Initial Windows GPU preparation measured about 30 seconds; the engine is reused for later scans. Cancellation cannot interrupt an in-progress native graph compilation.

Orange threshold checks stop as soon as their decision is known. Prepared GUI detection caches immutable templates and geometry, never an earlier frame's detected mask. Targeted tests verify unchanged decisions.

## Distribution

The installed app needs no Python or torchvision. Windows includes the pinned DirectML runtime. Linux includes CPU and CUDA providers; GPU use requires compatible CUDA 12 and cuDNN 9 vendor libraries. Missing or unsuitable acceleration leaves CPU available. OpenVINO/MIGraphX require a compatible user-supplied runtime; their code paths are not evidence of tested Intel/AMD Linux hardware.

Linux libraries ship inside `ai/native.zip`, avoiding AppImage's mandatory ELF dependency scan. First use extracts three fixed library names into the app's local cache, checks SHA-256, publishes each file atomically and repairs damaged copies. The Linux package gate loads the model on CPU from the extracted package. Weights, vendor binaries, recordings and generated caches stay outside Git.
