# Occlusion mask versus strong baselines across recordings

2026-10-17. These are paired, exact-sprite top1 results on frozen held-out quad
cases, not dense accuracy over every frame of a video. The new mask is the frozen
fine-tuned checkpoint from experiment78384b9. No retraining, threshold fitting or
per-video mask selection was performed for this comparison. App defaults remain unchanged.

**The mask is not a consistent replacement for our strongest baseline.** It helps
rough quads on the older clips, slightly hurts their exact cases, and has the
opposite pattern on the new recording. Both gains and regressions are retained.

## What “best baseline” means here

The earlier boundary study selected **facing1** using its frozen tuning rule. This
is the legitimate tuning-selected baseline, and is reported separately below.

The strongest earlier quad1 research results were **facing4** for exact quads
(95/310) and **jitter_max_pairs1/4** for rough quads (both68/310). To address the
request for our best existing result, the main table uses **facing4 exact** and
**jitter_max_pairs4 rough**, fixed across all videos. These are historical
test-selected references, not newly validated choices or different winners picked
for each video. The companion table includes all six baselines, including
jitter_max_pairs1. No best-after number is substituted for a weak after result.

Every “after” uses **the same baseline as its before**, with the frozen soft mask
multiplying observation weights. The mask is not compared only against the weaker
shipped colour method. Native RGB, eligibility, candidate set and supplied quad
are shared within each pair. No expected sprite is provided to mask inference.

## Main comparison against prior strong exact/rough methods

| Recording | Quad | Cases | Prior strong baseline | Same baseline + mask | Change |
|---|---|---:|---:|---:|---:|
| Quad clip (2026-10-16 00-40-22) | Exact | 310 | 95/310 (30.6%) | 94/310 (30.3%) | -0.3 pp |
| Quad clip | Rough | 310 | 68/310 (21.9%) | 73/310 (23.5%) | +1.6 pp |
| Survival (2026-10-16 18-23-42) | Exact | 74 | 31/74 (41.9%) | 30/74 (40.5%) | -1.4 pp |
| Survival | Rough | 74 | 22/74 (29.7%) | 24/74 (32.4%) | +2.7 pp |
| New recording (2026-10-17 18-28-42) | Exact | 48 | 29/48 (60.4%) | 31/48 (64.6%) | +4.2 pp |
| New recording | Rough | 48 | 22/48 (45.8%) | 21/48 (43.8%) | -2.1 pp |

Pooled exact results tie155/432 (35.9%). Pooled rough results improve112/432
(25.9%) to118/432 (27.3%). These are case-weighted summaries, dominated by quad1,
not equal-video averages or evidence of a general improvement.

## Previously tuning-selected baseline (facing1)

| Recording | Exact before → after | Rough before → after |
|---|---:|---:|
| Quad clip | 90 → 96 /310 | 54 → 60 /310 |
| Survival | 29 → 29 /74 | 19 → 20 /74 |
| New recording | 30 → 30 /48 | 18 → 18 /48 |

The older quad clip therefore has a better observed exact count with
facing1+mask (96) than facing4 without it (95), but changing baseline methods and
then claiming the mask alone rescued one case would be misleading. The proper
paired comparison is90→96 for facing1 or95→94 for facing4. The report keeps both.

## All six paired methods (correct counts)

| Recording / quad | Colour | Pair4 | Facing1 | Facing4 | Shift-pair1 | Shift-pair4 |
|---|---:|---:|---:|---:|---:|---:|
| Quad / exact | 87→90 | 92→91 | 90→96 | 95→94 | 87→91 | 87→89 |
| Quad / rough | 59→62 | 58→60 | 54→60 | 60→63 | 68→74 | 68→73 |
| Survival / exact | 27→28 | 30→28 | 29→29 | 31→30 | 29→28 | 30→29 |
| Survival / rough | 19→21 | 21→20 | 19→20 | 20→19 | 21→23 | 22→24 |
| New / exact | 28→27 | 29→30 | 30→30 | 29→31 | 28→26 | 28→26 |
| New / rough | 16→18 | 21→19 | 18→18 | 19→16 | 21→19 | 22→21 |

All six unmasked quad1 counts, in both modes, exactly reproduce the frozen earlier
boundary study. This checks that the comparator was not weakened. Source hashes
and per-case outputs are retained. The new comparison regenerates all mask fields
with the same native-image float-bilinear crop path; earlier tables that used a
cached quantized new-recording crop are not copied into this table.

The supplied rough quad is the fixed prior width1.12/height0.92 perturbation,
translation and two corner offsets. Shift-pair methods also search their unchanged
3x3 translation bank. The mask is predicted once in the supplied quad's UV frame;
jitter probes are mapped back to that same frame before mask lookup. Outside-field
mask evidence is zero. Candidate pools are recomputed under the corresponding
masked or unmasked observations; no ground-truth candidate is inserted.

## Independence and uncertainty

- Quad1:310 frozen validation cases from28 frames; the818-case tuning pool is excluded.
- Survival:74 unique held-out cases from55 frames, combining36 cases from the older
  survival pool and38 additional cases. The15 reviewed cases are **all excluded**
  because they lie within60 video frames of the initial mask model's original
  training/selection data. They must not be counted as independent successes.
- New clip:48 test cases from6 rendered frames. Training and validation cases are
  excluded. These are locally audited, partial renderer-ID sidecars, **not certified
  full ownership truth**. Unknown regions were excluded from training. The benchmark
  uses their lossless sidecars, not necessarily frames retained by OBS.

For the main strong-baseline comparisons, gains/losses are4/5 (quad exact),6/1
(quad rough),0/1 (survival exact),2/0 (survival rough),2/0 (new exact),1/2 (new rough).
Frame-cluster bootstrap95% intervals for net percentage-point change are
[-2.04,+1.42], [0,+3.32], [-4.35,0], [0,+7.04], [0,+5.56], and[-4.48,0]
respectively. Six frames provide weak uncertainty estimates for the new clip;
these numbers do not justify claiming a statistically established general gain.

This benchmark tests known-quad sprite selection, not the first-person automatic
labeller, no-fire detection, general glass/water segmentation, or timeline analysis.

## Coverage of every video file currently present

| Video file | Status in this comparison |
|---|---|
| 2026-10-15 14-15-51.mkv | No compatible frozen aligned quad benchmark |
| 2026-10-15 14-48-36.mkv (Clip1) | Box labels only; zero recorded quad corners |
| 2026-10-15 18-18-16.mkv (Clip2) | Box labels only; zero recorded quad corners |
| 2026-10-15 23-48-59.mkv | No compatible frozen aligned quad benchmark |
| 2026-10-15 23-50-25.mkv | No compatible frozen aligned quad benchmark |
| 2026-10-16 00-40-22.mkv (Quad1) | Scored310 held-out quad cases, both modes |
| 2026-10-16 01-41-58.mkv | No compatible frozen aligned quad benchmark |
| 2026-10-16 01-42-43.mp4 | No compatible frozen aligned quad benchmark |
| 2026-10-16 18-23-42.mkv (Survival1) | Scored74 unique held-out quad cases, both modes |
| 2026-10-17 17-04-31.mkv | Failed ownership prototype/all-unknown masks; excluded |
| 2026-10-17 18-28-42.mkv (New) | Scored48 partial-label held-out cases, both modes |

Inventory checked32,626 joined Clip1 frames and19,553 Clip2 frames: neither contains
quad corners. Their boxes cannot legitimately stand in for the missing fire planes.
No accuracy is invented for the eight unscored files, and no tuning uses their boxes.
The three scored videos are sampled benchmarks, not exhaustive scores over their
millions of recorded quads or every video frame.

## Reproduce

Using the existing Python research environment, run `prepare.py`. Then for each
video (`quad1`, `survival1`, `new_recording`) and mode (`exact`, `rough`), run
`node evaluate.mjs .board/occlusion-all-videos/VIDEO/MODE
.board/occlusion-all-videos/VIDEO/MODE-score`. Finally run `summarize.py`.

`node --test evaluate.test.mjs` covers identity-mask parity, nonnegative evidence
removal, shifted mask coordinates and deterministic eligibility-aware ranking.
The aggregate script asserts parity with all twelve earlier quad1 method counts.

Ignored artifacts: `.board/occlusion-all-videos/protocol.json`, `summary.json`,
`table.md`, `all-methods.md`, and per-video native frames/masks/per-case results.
The checkpoint is `.board/occlusion-recorded/finetune/best.pt`, SHA256
`151145d46d92b0725c2557144d2b897d1bfa5aa57ae5f0c628232dd9d1f22a76`.
No app implementation, raw footage, game assets or model weights were committed.
