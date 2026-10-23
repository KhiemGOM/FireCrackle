# Automatic scan profiling — 21 October 2026

The first limit was software scheduling, not exhausted hardware. First-person
scanning used at most four CPU workers; no-fire used two. The measured machine
has an i9-13900HX, 32 logical CPUs and an RTX 4060 Laptop GPU. No-fire selected
`GPU (DirectML 0)` through its existing numerical/speed checks. The DirectML
adapter number is recorded as reported, rather than assuming its GPU name.

| Workload | Before | After |
|---|---:|---:|
| First-person processing, same 32 cached real RGB samples | 42.1 fps (4 workers) | 83.6 fps (12 workers) |
| No-fire processing, same samples | 27.9 fps (2 workers) | 53.6 fps (12 workers) |
| First-person scan including decode, 600 frames of the owner's 1440p60 AV1 recording | 28.8 fps | 45.1 fps |

Processing-only rates exclude disk/video decoding. The real stream rates include
them. These are local measurements with the owner's other applications/scans
left running, not universal speed promises. Two repetitions per worker count
were used for the processing samples; the stream comparison is one pass each.

## Bottlenecks and retained changes

On the initial 24-frame timing sample, canonical GUI work averaged about 90 ms:
37 ms fitting the HUD, 15 ms marking pieces, 11 ms text and 27 ms interaction
panels/remaining work. First-person detection often needs that path. The GPU
accelerates the CNN, not this CPU GUI work. Native AV1 decoding/RGB conversion
also becomes important in the 1440p stream.

All scanners now use the existing CPU/memory budget with a maximum of 12 workers.
It still reduces the count on smaller CPUs or large frames and keeps the recycled
RGB pool near the previous 256 MiB budget. No-fire no longer hardcodes two workers;
the first-person dispatcher no longer silently clamps a larger budget back to four.

Two exact preprocessing optimizations are retained:

- Vertical orange-mask dilation visits contiguous rows instead of striding the
  image once per column. Its mean sampled time fell from 10.85 to 7.50 ms.
- Frozen resize coefficients for the full-frame/tile dimensions are cached once.
  Pixels, model outputs and GUI decisions are never cached across frames here.

No thresholds, models, fire evidence, GUI templates, veil rules, resolution or
sampling cadence changed. The remaining expensive GUI fitting was not weakened
to manufacture a speedup. First no-fire provider setup still took 22–30 seconds;
the existing in-process engine reuse handles subsequent scans.

## Verification and scope

The 32 RGB inputs are 12 time-spread samples from catalogue V02/clip1 and 20 from
V03/clip2 (including eight historical cleared-prediction timing cases). They are
cached real decoded pixels. Seeked timing samples and historical predictions are
not ground truth; this is not a new accuracy or model-comparison experiment.

All 32 before/after first-person/no-fire decisions matched, including three
first-person labels and seven no-fire clears. All 600 stream decisions matched
(none accepted in that particular segment). The frozen Pillow hashes for all nine
model views passed. Contiguous dilation matches a direct square-neighbourhood
reference, including boundaries, small images and radii larger than the image.
Existing capped-component, cancellation and parallel frame-index tests passed.

No-fire still requires native 1920×1080 input; the 1440p stream measurement applies
to first-person scanning only. Source/model/input hashes, stage means and raw
aggregate timings are in [AUTO_SCAN_PERFORMANCE.json](AUTO_SCAN_PERFORMANCE.json).
Ignored local reproduction inputs and adapters live in `.board/scan-profile/`.
