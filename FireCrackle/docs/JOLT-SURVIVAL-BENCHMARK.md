# Held-out survival/LAN Jolt clock validation

2026-10-16. No detector or interpolation parameters were changed. This follows
[the first three-clip experiment](JOLT-BENCHMARK.md), which could not establish
lag improvement because the relevant holds lacked usable Jolt coverage.

**Result:** Jolt substantially reduces the large clock/phase errors left after
the first major stall, where its clock is available. It does not recover the
interior of the hold, does not cover the second hold, and is not uniformly more
accurate on ordinary frames. The review-alert count does not improve.

## Independent input checks

- Recording: `2026-10-16 18-23-42.mkv`, 82,686 frames, 1,378.133 s, reported as
  survival gameplay with single-player opened to LAN.
- Video SHA-256: `69159829c28019affc47e35b923bca34ad9841ce96600a8dbe7511e6e545f90a`.
- Joined labels: `survival1.jsonl`, SHA-256
  `801c753dcfde61b09778eef3d8cfa55e340a7a967d6bf6090c6d5d6ce9184c9c`.
- All 82,686 frame numbers align; zero decoded-tick mismatches. Every logged
  frame has the expected 16-row sheet offset, and `(client tick − sprite step)
  modulo 32 equals 30 throughout. The benchmark uses oracle sprite labels,
  **not** newly predicted fire labels.
- There are 37,834 fire-visible frames. The observed client counter loses
  75.66 nominal ticks relative to the video's first-to-last timestamps. This is
  a measured difference between clocks, not an assertion of removed footage.

## Actual Jolt scan and counter agreement

Official Splosh JoltCracker 2.3, `--jobs 4 --gpu off`, scanned the whole original
video. It reports the bar readable in 98.31% of frames and recovers 575 readings
(571 distinct timestamps), in two sections:

| Section | Video time | Resolved readings |
|---|---|---:|
| Before the major stall | 0:02.467–14:23.900 | 302 |
| After the major stall | 14:29.350–22:38.133 | 273 |

**All 575 accepted readings have exactly the same client-minus-GUI offset:
445 ticks.** GUI tick minus sprite step modulo 32 is likewise always 1 at those
readings, including on both sides of the major stall. This independently
supports the shared-clock relationship on this survival/LAN recording. It is
not a guarantee for pauses, world changes, reloads, or other recordings.

Jolt reports one `stalled` interval and no `removed` intervals on the unedited
clip. Unresolved readings are excluded; no candidate tick was substituted.

## Paired comparison on identical fire frames

The production `timeReference` lookup supplies observed ticks at readings and
linear estimates between readings in the same imported section. It supplies no
clock across the reported break or outside the outer readings.

36,846 of 37,834 fire frames have a clock value: **97.39% coverage**. The 988
uncovered fire frames are excluded from both sides of the paired comparison.
Most paired clock values are estimates; only 267 raw readings coincide with
visible fire. Raw-reading counts include coincident hunger/heart readings.

Phase deviations below are signed circular distances to each clock's fitted
modal reference, using the existing robust ruler and the same paired frames.
They measure agreement with a steady fire clock, not a detector false-positive
rate or label accuracy.

| Paired phase measure | Video time | Jolt clock |
|---|---:|---:|
| Median absolute deviation | 0.19 ticks | 0.32 ticks |
| 99th percentile | 7.31 ticks | 1.32 ticks |
| Frames deviating by more than 2 ticks | 2,010 | 48 |
| Worst deviation | 7.81 ticks | 4.75 ticks |

For an unwrapped clock-error check, the first observed GUI tick fixes an additive
origin. The independently logged client tick, minus the observed constant 445,
is used only to judge errors; it is never an input to either clock lookup.

| Paired clock error against recorded ticks | Video time | Jolt clock |
|---|---:|---:|
| Median absolute error | 0.32 ticks | 0.34 ticks |
| 99th percentile | 57.66 ticks | 1.61 ticks |
| Frames with error greater than 2 ticks | 2,010 | 95 |
| Worst absolute error | 59.66 ticks | 5.09 ticks |

The large tail improvement is real on the matched coverage. Typical-frame error
is slightly worse. The worst interpolation error occurs at 7:46.200: 5.09 ticks.
Sparse readings cannot locate every short scheduling/capture disturbance inside
their interval, even when their endpoints are correct.

## What happens at the holds

Frame IDs independently identify three periods of repeated captured output:

| Hold | Frames | Duration | Fire evidence | Jolt support |
|---|---|---:|---|---|
| Startup | 0–36 | 0.600 s | none | before first resolved reading |
| Main hold | 51895–52094, 14:24.917–14:28.233 | 3.316 s | 200 fire frames | resolved readings on both sides; unknown inside |
| Later hold | 81712–81822, 22:41.867–22:43.700 | 1.833 s | none during hold | after last resolved reading |

Around the main hold, Jolt's bracketing readings are 14:23.900 and 14:29.350.
The video advances 109 nominal ticks, while **both the recovered GUI counter and
the independently logged client counter advance 52 ticks**. That is a 57-tick
(2.85 s) clock discrepancy, matching Jolt's stalled-time estimate. The fire–GUI
phase difference at the two readings is zero. The 3.316 s held-output duration
and 2.85 s clock loss measure different quantities and should not be conflated.

All 200 held fire frames lie in the imported break; the app correctly gives them
no estimated Jolt clock. It has not reconstructed their internal tick timing.
The first visible fire after this hold appears at 14:39.967; the first later
resolved bar reading with visible fire is at 14:44.967 and has the same exact
fire–GUI phase as before. The video-time checker reports a persistent change
at that renewed fire sighting; canonical timing removes that large offset.

## Same checker, different clock: alert counts

For a controlled algorithm comparison, the existing production `phase_v2`
checker was run twice on the identical 36,846 fire frames: once with video PTS,
once with canonical GUI ticks divided by 20 as its time coordinate. All settings
stay at defaults. This is a benchmark adapter, not a change to the application.

| Production checker input | Events |
|---|---:|
| Video time, paired coverage | 14 |
| Canonical GUI time, paired coverage | 15 |
| Video time, all 37,834 fire frames | 19 |

Canonical timing removes the large post-stall offset, but interpolation still
produces small excursions and an approximately one-tick shift elsewhere. It
does **not** reduce the total review-event count. The current frontend Jolt
mode uses a different per-frame first-reference rule and marks 49 frames; that
number must not be compared directly with these grouped event counts.

## Held-out readings

Each eligible interior reading was removed before fitting its clock value from
neighbours in the same section. There are 567 distinct held-out timestamps.
The comparison predicts from the prior retained reading at 20 Hz for video time.

| Absolute error against withheld GUI reading | Video prediction | Jolt fit |
|---|---:|---:|
| Median | 0.00 ticks | 0.14 ticks |
| 99th percentile | 1.00 ticks | 0.91 ticks |
| Maximum | 1.68 ticks | 1.34 ticks |

This test supports modest tail improvement, not exactness between anchors. The
dense ground-truth comparison above additionally exposes errors that withheld
bar-reading timestamps alone would miss.

## Reproduction

From the repository root, with FFmpeg/ffprobe on PATH for the externally
downloaded [official Jolt scanner](https://splosh.icu/jolt):

```text
jolt "fire-detection/data/video/2026-10-16 18-23-42.mkv" --jobs 4 --gpu off --json .board/jolt-survival/survival1.json --html .board/jolt-survival/survival1.html
python FireCrackle/scripts/jolt-survival-benchmark.py --ffprobe PATH/ffprobe.exe
```

In `FireCrackle`, set `JOLT_SURVIVAL_BENCHMARK=1` and run:

```text
npm exec vitest -- run --config scripts/vitest.survival.config.ts
```

That creates the local paired native input. From the repository root:

```text
cargo run --offline --release --manifest-path FireCrackle/crates/studio_core/Cargo.toml --example jolt_benchmark -- .board/jolt-survival/native-input.json .board/jolt-survival/native.json
```

Run the opt-in test again to include the same-checker comparison in
[jolt-survival-summary.json](../jolt-survival-summary.json). Quantiles use linear
interpolation of order statistics. Recording, joined labels, scanner HTML/JSON,
and detailed frame data remain local and ignored. This is one held-out clip;
no general accuracy/causality claim or application tuning is made.
