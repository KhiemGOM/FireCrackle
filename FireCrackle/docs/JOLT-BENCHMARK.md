# Jolt clock benchmark — clips 1, 2 and quad-data clip 3

2026-10-16. Production clock/ruler implementation: `72b8432`. No clock or matching
constants were tuned during this experiment. Machine-readable results are in
[jolt-benchmark-summary.json](../jolt-benchmark-summary.json).

Jolt adds useful independent evidence, especially for cuts of a whole fire cycle.
It should complement video-time analysis. This test does **not** establish that
its interpolated clock reliably removes lag throughout these recordings.

## Inputs and creative-mode exclusion

| Clip | Recording | Joined truth | Video frames | Resolved Jolt readings | Fire-visible scored readings |
|---|---|---|---:|---:|---:|
| 1 | `2026-10-15 14-48-36.mkv` | `clip1.jsonl` | 32,626 | 54 | 31 |
| 2 | `2026-10-15 18-18-16.mkv` | `clip2.jsonl` | 19,553 | 23 | 17 |
| 3 | `2026-10-16 00-40-22.mkv` | `quad1.jsonl` | 7,094 | 6 | 6 |

Only accepted readings from a visible hunger/heart bar are scored. A phase
observation also requires actual visible fire in the joined mod labels. Creative
frames and frames without a resolved reading do not enter the paired metrics.
The entire interval between two readings is **not** asserted to be survival
footage. This deliberately conservative scoring avoids guessing mode from gaps.

Joined ground truth supplies the correct sprite step, not a fresh fire detector
prediction. The logged client tick is used only to inspect clock differences;
it is never supplied to either fitted clock. Frame pairing uses native PTS, not
the scanner's rounded FPS estimate. All cut-output frame counts and presentation
times were checked against the exact kept-source-frame mapping (<2 ms error).

## Original footage: exact readings and interpolation

At the actual resolved Jolt readings, GUI tick minus sprite step is constant
inside every imported continuous section. The remaining video-time residual
99th percentiles are 0.95 ticks for clip 1, 0.58/0.96 ticks for clip 2's two
sections, and 0.38 ticks for clip 3. Jolt's corresponding within-section residual
is zero. These are sampled exact readings, **not** proof of zero error between
readings or throughout the footage.

To test the interpolation itself, each interior, fire-visible Jolt reading was
removed before the production `timeReference` lookup was run at that timestamp.
It must estimate from the surrounding readings in the same section. The video
baseline predicts forward at 20 Hz from the immediately preceding retained GUI
reading. Errors below are against the withheld resolved GUI tick, in ticks.

| Clip | Withheld readings | Median error: video / Jolt fit | 99th percentile: video / Jolt fit |
|---|---:|---:|---:|
| 1 | 30 | 0.16 / 0.17 | 1.24 / 1.24 |
| 2 | 13 | 0.32 / 0.37 | 1.00 / 0.96 |
| 3 | 4 | 0.16 / 0.16 | 0.34 / 0.19 |

The fit is not uniformly better. Clip 1 has no tail improvement; clip 3 has a
smaller tail on only four withheld readings. Sub-tick estimates remain estimates.
Quantiles use linear interpolation of order statistics; these correlated samples
are too small to establish a general accuracy or false-positive rate.

## Lag and the excluded mode-change gap

Jolt reports a stalled interval in clip 2 between 97.500 and 110.867 s, estimating
4.217 seconds behind video time. Inspection at 103 s shows creative mode. The
logged-client-minus-GUI offset changes from 622 to 705 ticks across this gap;
the observed fire–GUI phase changes by 13 ticks modulo 32. Per the user's request,
this **cross-creative interval is excluded as a lag-performance case**.

The current UI's global first-pair residual rule nevertheless produces 13 flags
on the later sampled labels if the two sections are analysed together. Those
flags document current cross-section behaviour; they are not counted as errors
in the eligible survival-section benchmark. A single global phase must not be
advertised as automatically immune to mode/pause/session discontinuities.

The well-known clip-2 held capture at frames 13862–14003 (about 231–233 s) is
outside this scan's resolved Jolt span (73.500–169.483 s). An inspected frame at
233 s shows the Options menu. There is no measured Jolt clock at that hold, so
this experiment cannot show that interpolation fixes it. No clock was invented
there to produce a favourable result.

## Nine actual random-cut videos

Seed `20261016`. Three cuts per clip, targeting 0.15, 0.65 and exactly 1.6 s;
positions were randomised within the longest original Jolt run. The exact
durations vary with the native frame timestamps. Windows were encoded with
lossless H.264 (`libx264`, CRF 0, no scaling), then the real Jolt scanner was run
again on each edited video. This is not a synthetic alteration of its JSON.

The production video-time checker (`phase_v2`, default settings) receives the
same fire-visible observations as the clock comparison. A new alert endpoint
must occur at the adjacent before/first two after observations, excluding source
endpoints already flagged on the uncut clip. Jolt must emit a `removed` interval
that brackets the known cut. These are different evidence channels and both
remain visible; GUI-normalised fire phase itself cancels a joint clock jump.

| Clip | Removed seconds | Video-time alert | Jolt removed-footage report |
|---|---:|---|---|
| 1 | 0.150 | missed | missed — no resolved reading after the cut in the window |
| 1 | 0.650 | found | found |
| 1 | 1.600 | missed | found |
| 2 | 0.167 | found | found |
| 2 | 0.650 | found | found |
| 2 | 1.600 | missed | missed — earlier readings were unresolved |
| 3 | 0.166 | found | found |
| 3 | 0.667 | found | found |
| 3 | 1.600 | missed | found |

Total on all nine attempted videos: **video time 5/9; Jolt report 7/9**. Both Jolt
misses are retained in that denominator. Only seven edited scans resolved GUI
readings on both sides; all seven were detected by the Jolt report. Cut locations
are brackets between readings, sometimes several seconds wide, not exact frames.

Both extra findings are complete 32-tick fire cycles. A fire-row phase can be
unchanged after removing 1.6 s, while the unwrapped GUI counter still reveals
missing elapsed time. Conversely, every directly observed fire–GUI phase remained
steady on these edited windows: **using only that canonical phase would conceal
the cuts**. The independent Jolt/video timing and Jolt break reports are essential.

These are nine small demonstration trials on existing development clips. The
paired video-time result is not the recall of a fully/densely labelled workflow;
sparse GUI observations limit both its input and localisation. Do not generalise
7/9 versus 5/9 into a certified detector improvement.

## Reproduction and provenance

Use [Splosh JoltCracker](https://splosh.icu/jolt) 2.3, executable SHA-256
`60180931a2c1036d6253729d553df691235cbfe8a6ccd64c24cc3d7593dfe34c`.
All scans used `--jobs 4 --gpu off`. Jolt is externally downloaded and is not
added to the app or installer. Jolt cracking credits: Splosh, Dart and repeater64.

From the repository root, scan each original recording to
`.board/jolt-bench/clip{1,2,3}.json` with Jolt's `--json` and `--html` options.
Put FFmpeg/ffprobe on PATH for Jolt, then run:

```text
python FireCrackle/scripts/jolt-benchmark.py --ffmpeg PATH/ffmpeg.exe --jolt PATH/jolt.exe --cuts
cargo run --offline --release --manifest-path FireCrackle/crates/studio_core/Cargo.toml --example jolt_benchmark -- .board/jolt-bench/inputs.json .board/jolt-bench/native.json
```

In `FireCrackle`, set `JOLT_BENCHMARK=1` in the environment and run:

```text
npm exec vitest -- run --config scripts/vitest.jolt.config.ts
```

The opt-in runner calls the production parser, clock lookup, Jolt phase adapter
and existing robust ruler. Raw reports, detailed per-reading outputs, and exact
source-frame mappings stay local in ignored `.board/jolt-bench`; the compact
summary is versioned. Joined-label hashes are retained in the local input manifest.
No tuning or changes to application detection rules were made for this benchmark.
