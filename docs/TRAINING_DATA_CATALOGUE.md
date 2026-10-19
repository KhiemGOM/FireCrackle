# Video training data catalogue

This is the canonical, growing register for FireCrackle/fire-detection video research. Every AI training, fine-tuning, distillation, calibration and model-comparison run must read it and account for **all available relevant sources**, rather than silently choosing a convenient old subset. The policy is also required by the root `AGENTS.md`.

Initial audit: 19 October 2026. The 12 original files total 3,503.674 seconds (58.4 minutes), including unqualified pilots; that is not 58.4 minutes of independently labelled fire.

Local recordings, annotations, frame images, game assets, tensors and model weights remain ignored/private. This document and the accompanying inventory contain paths, counts and schemas, not copied training examples. Paths are relative to the repository root unless explicitly stated otherwise.

## Required training protocol

Before spending compute on a new experiment, agree on the concrete run with the
owner: target/material, exact source videos/exclusions, real versus synthetic data,
models, split counts, time budget and metric. Wait for the owner's go-ahead and
keep that scope. Real recorded examples are the default; synthetic fire examples
or synthetic-fire-trained checkpoints require explicit agreement. Explain generic
pretrained initialization separately. Report what is actually running plainly.

1. Refresh the inventory before preparing a run:

   ```powershell
   python scripts/catalogue_training_data.py --write
   python scripts/catalogue_training_data.py --check
   ```

2. Build a coverage manifest listing **every original recording and relevant dataset family below** as `train`, `validation`, `test`, `excluded` or `unavailable`. Include paths/hashes, actual selected counts, task/material, label quality, preprocessing hashes, split boundaries and an explicit reason for every exclusion. Raw clips with no usable truth still need an entry; they may supply screened backgrounds or require annotation. Do not silently skip the newest recording.
3. Use all eligible **training** sources for the task. Do not concatenate every cache: many contain the same frames/quads, synthetic variants, or predictions. Deduplicate by original recording + rendered frame (`f`) + target/plane identity, retaining provenance and sampling weights. Document balancing/downsampling and before/after counts per source.
4. Freeze validation/test before fitting. Split by recording/session, or declared contiguous time/render-frame blocks with a purge gap. Keep adjacent frames, repeated OBS frames, alternate crops, rough/exact versions and codec/synthetic descendants of one example on the same side of the split. Never merge validation/test into training merely to claim full coverage. Existing familiar clips are development/transfer checks, not fresh independent validation.
5. Match supervision to the task: presence, first-person row, world quad identity, GUI mask, partial ownership and animation phase are different labels. Predictions and app auto-labels are not human/renderer truth. Preserve unknown pixels, exclusions, warnings and material identity. No-fire for normal fire is not automatically no-soul-fire or no-water.
6. Preserve the single canonical veil/portal implementation and version/hash every preprocessing stage. Rebuild/recalibrate stale caches instead of mixing incompatible preprocessing silently.
7. Report per-recording and pooled results, the existing matcher baseline, false accepts/false clears/wrong rows, abstentions/coverage, and runtime. State both sample counts and independent recording/session counts. Publish the coverage manifest next to each run's manifest/report and link this catalogue plus its Git commit.
8. Register every new recording, label stream, ownership session or reusable derived pool **before it is used**. Refresh generated inventories and add its semantic mapping/quality notes here. A controlled single-source or synthetic-only ablation is allowed when explicitly named as an ablation with full coverage/exclusion accounting; it is not an all-data result.

Suggested run coverage record:

```json
{
  "catalogue_commit": "<git SHA>",
  "inventory_sha256": "<sha256 of docs/TRAINING_DATA_INVENTORY.json>",
  "task": "<presence | sprite row | quad matching | GUI | ownership>",
  "sources": [{"recording": "<original path>", "dataset": "<manifest path>",
    "role": "train", "material": "normal_fire", "samples_available": 0,
    "samples_used": 0, "reason": "<selection/exclusion reason>",
    "video_sha256": "<hash>", "labels_sha256": "<hash>",
    "split": "<session/time block bounds and purge>",
    "preprocessing_sha256": {"veil.rs": "<hash>"}}]
}
```

## Original recording register

The generated original-video table below gives measured duration, resolution and rate. A filename timestamp is an identifier, not a guaranteed synchronization clock. Align capture labels using the visible sync strip and renderer frame IDs.

| ID / aliases | Original under `fire-detection/data/video/` | Available annotations and intended use |
|---|---|---|
| V01 / `early` | `2026-10-15 14-15-51.mkv` | `.board/pov-independent-20261018/early.joined.jsonl`; capture `labels-20261015-140934.jsonl`. Additional POV validation source; previously used in other preprocessing work, so not globally blind. |
| V02 / `clip1` | `2026-10-15 14-48-36.mkv` | `data/joined/clip1.jsonl`, legacy feature tables, quad pools, background pools and app project. Normal block/entity/first-person research; heavily reused development source. |
| V03 / `clip2` | `2026-10-15 18-18-16.mkv` | `data/joined/clip2.jsonl`, legacy feature tables, quad pools and app project. Historically no-fire calibration and POV research; background validation in some synthetic work. |
| V04 / capture pilot | `2026-10-15 23-48-59.mkv` | Original exists; no canonical joined stream registered. Treat as unqualified pilot until exact label alignment and content audit. |
| V05 / capture pilot | `2026-10-15 23-50-25.mkv` | Original and app project exist; no canonical joined renderer stream registered. Manual/auto app annotations require provenance review before training. |
| V06 / `quad1`, `clip3` | `2026-10-16 00-40-22.mkv` | `data/joined/quad1.jsonl` plus `quad1.raw-labels.jsonl`; raw source `labels-20261016-003956.jsonl`. Explicit projected quad geometry/UV. Primary historical matcher benchmark, not a fresh holdout. |
| V07 / short pilot | `2026-10-16 01-41-58.mkv` | No canonical joined stream registered. Audit pairing/content before using labels. |
| V08 / short pilot/remux candidate | `2026-10-16 01-42-43.mp4` | No canonical joined stream registered. Similar timing is not proof it duplicates V07; verify hashes/frames before deduplication. |
| V09 / `survival1`, `survival` | `2026-10-16 18-23-42.mkv` | `data/joined/survival1.jsonl` and `survival1.raw-labels.jsonl`; raw source `labels-20261016-181808.jsonl`. Dense real-quad training/review pools, backgrounds, presence and GUI/veil research. Preserve existing temporal exclusion windows. |
| V10 / `later` | `2026-10-17 17-04-31.mkv` | `.board/pov-independent-20261018/later.joined.jsonl`; capture `labels-20261017-170335.jsonl`. Separate POV validation recording, familiar to other preprocessing studies. |
| V11 / `new_recording`, recorded ownership | `2026-10-17 18-28-42.mkv` | `.board/ownership-review/sync.jsonl` maps video `n` to renderer `f`/tick (no label object); `.board/occlusion-recorded/manifest.json` points to renderer ownership session `ownership-ebe022b2-f48a-456d-8c2c-169aedede5f9`. Partial locally audited ownership supervision; not a globally correct oracle mask. |
| V12 / real soul-fire | `2026-10-19 16-49-48.mkv` | `.board/soul-quad/joined.jsonl`, `.board/soul-quad/recording-labels.jsonl`, and `.board/soul-quad/real/manifest.json`; normal and soul labels coexist in the new capture schema. Declared tune/validation bounds and material-specific truth must be preserved. Do not treat normal `fires` as soul truth or invent a soul first-person overlay. |

V12 also contains ordinary fire: do not exclude the whole recording from normal-fire training just because it was recorded for soul fire. The current real-only phase pipeline registers its eligible normal-fire quads separately. Material admission must inspect per-frame/per-target labels.

`data/joined/` in this register means `fire-detection/data/joined/`. Verify raw-log pairings through strip alignment; file modification time is not evidence. The generated inventory lists all additional orphan/empty capture logs so they cannot be overlooked, but an orphan is not automatically a labelled recording.

## Schema and supervision guide

### S1 — capture label JSONL (`labels-*.jsonl`, `*.raw-labels.jsonl`)

One renderer-frame record per line. Historical common fields: `f` renderer frame ID, `tick` client tick, `f0`/`f1` physical texture rows, `w`/`h` framebuffer dimensions, `fire` boolean, `fires[]` source descriptions. Source fields include `src` (`block`, `entity`, `overlay`), position/box, visibility, veil, distance, sprite `parts[]`; later versions include projected `quads[]`.

The soul-capable stream additionally has `s0`/`s1`, `soul` and `soul_fires[]`. These fields are absent from startup/older-schema rows in the same file; missing is not a negative label. Normal-fire targets remain in `fire`/`fires[]`. The soul real manifest has 2,905 cases (tune 2,103 / validation 802) at stride 60, with `tune_end=5880` and `validation_start=6120`; keep that purge/split when reproducing its historical results.

Quad fields in older logs include `s` sheet, `m` mirror bit, `row` **physical** row, `c` eight projected corner coordinates, `uv` eight texture coordinates, `vis`, `veil`. Not every historical log has quads: early/clip1/clip2 should not be assumed to provide plane corners merely because source boxes exist. Capture dimensions can be 2560 x 1440 while the video is 1920 x 1080; normalize/project using the recorded framebuffer dimensions before mapping to video pixels. New soul-capable records add explicit soul/material fields; consult each observed schema and the capture producer before selecting targets. Empty logs and menu/startup rows with `f0=f1=-1` are not usable sprite labels. A blank `fires[]` in old logs does not establish absence of material the old recorder did not capture.

### S2 — strip-joined JSONL

`{n, tick, f, tick_ok, label}`: `n` is the **decoded video frame index**, `f` is the matched renderer frame, `tick` is decoded strip tick, `tick_ok` checks correspondence, `label` is the S1 capture object or null. Filter missing/invalid synchronization and keep duplicate renderer frames grouped. Normalized app fire animation indices differ from raw physical rows: sheet 0 applies the established 16-row metadata offset; sheet 1 has no such offset. Soul sheet 0 likewise uses its declared atlas offset. Apply conversion exactly once.

### S3 — known-quad case manifest and native frame cache

Usually `manifest.json` containing dimensions, `samples[]`, exclusions/skips, and sometimes source hashes. Samples commonly carry `id`, decoded `frame`, normalized four-corner `quad`, `expected: [sheet, row, mirrored]`, source/visibility/veil and a split (`train`, `validation`, `test`, or `tune`). Historical normal-fire quad/AI pools directly copy the physical `q.row` from the recorder; their expected row is not automatically an app animation index. Soul real cases explicitly normalize sheet 0 by 16. Validate the producer and reference atlas before converting; no universal row convention applies to all caches. Soul cases additionally preserve `rendered_frame`, `physical_row`, material-specific selection and preprocessing hashes.

Native caches in `FireCrackle/src-tauri/target/actual-quad1`, `quad-eval-clip1`, `quad-eval-clip2` and related folders are **derived**, not new recordings. Inspect the exact manifest schema in the inventory. `exact` and `rough` refer to alternative geometry for the same observations; they cannot cross a train/test boundary.

### S4 — sprite-classification NPZ

Common `x` image tensors and `y` class IDs, split across `train.npz`/`val.npz`; exact dimensions, ordering and dtype are enumerated for every file below. Do not assume all archives use NCHW, RGB or the same class encoding. Historical 128-way appearance models in `render.py`/`prepare_survival_train.py` use `y = sheet*64 + physical_row*2 + mirror`; this is different from the UI exclusion ID `sheet*64 + mirror*32 + row`. row32 models remove appearance ambiguity and learn a different target. Read the producing script and matching manifest before decoding `y`.

### S5 — renderer ownership sessions

`ownership-<uuid>/frame-XXXXXXXX.json` describes per-frame renderer IDs/quads, image paths/hashes, projection/UV, and audit warnings. Paired `*-rgb.png` and `*-ids.png` are frame images and encoded ownership IDs. Recorded-mask preparation decodes IDs as `R + 256*G + 65536*B`; `0xffffff` means **unknown**, not background. Keep partial coverage and warnings. Session versions differ and early sessions can be broken/all-unknown; inspect the actual audit, not just file counts.

`.board/occlusion-recorded/recorded.npz` contains rectified `rgb`, target-plane mask `target`, supervision-valid mask `valid`, and foreign-fire mask `foreign`. Their axes/dtypes are in the inventory. The matching manifest records accepted plane IDs, positive/valid/foreign pixel counts, warnings, source JSON/hashes, and preprocessing version. Known split: 600-render-frame blocks with 100-frame boundary purge; roles assigned by block modulo 5. These are partial renderer-supervised targets, not global oracle masks.

Current ownership-session audit (all exported `ground_truth` flags are false):

| Session suffix | JSON/RGB/ID triplets | Export status / usable-evidence warning |
|---|---:|---|
| `aa9c6e80-3dab-4b58-bc3a-7011cbd8626b` | 26 | All `experimental_unvalidated`; old schema has no `known_fire_pixels` field. Do not infer successful masking from missing issue fields. |
| `e6eb5afd-80bf-4f7c-9125-fda8aeea0352` | 459 | 451 `rejected_sample`, 8 `experimental_unvalidated`; 7 frames report known fire pixels. Audit locally; do not use as a full-frame oracle. |
| `ebe022b2-f48a-456d-8c2c-169aedede5f9` | 105 | 99 `rejected_sample`, 6 `experimental_unvalidated`; 45 frames report known fire pixels. The established partial audit retains 178 planes from 25 source frames: train 101 / validation 29 / test 48. |

`known_fire_pixels` counts above describe exporter metadata, not independent verification of correct pixel ownership. A rejected frame may contain locally consistent mapped planes; the explicit partial-audit path is required before any such regions enter training.

### S6 — weak ownership, GUI and no-fire feature archives

`.board/occlusion-mask/{synthetic,survival,mixed}` are different training regimes; survival masks there are weak rules, not recorded ownership truth. Their `freeze.json` lists exact training/selection IDs and requires exclusion of neighbors within 60 frames for corresponding final survival checks. Do not relabel these as independent new ground truth.

No-fire archives under `.board/no-fire-*`, image-presence and related roots contain frame features, classifications, masks or derived targets. Per-file keys, shapes and dtypes appear below. Only use targets after checking the generating script: a detector prediction/accepted clear is not automatically renderer-labelled no-fire truth. GUI-mask overlays and GUI-piece labels are separate from world ownership and veil neutrality.

### S7 — app projects, reviews, predictions and CSVs

`*.firecrackle/*.json` are application/project state, not an interchangeable renderer dataset. Labels can be manual, first-person-tool or no-fire-tool sourced; retain human-check/provenance and saved exclusions. Review JSONs can whitelist/blacklist crops. CSV headers and all project schemas are listed in the inventory. Predictions JSONL and frozen benchmark outputs provide diagnostics or explicit pseudo-label experiments; never silently treat them as ground truth. Jolt imports label GUI-clock evidence and phase analysis, not sprite appearance or ownership masks.

## Reusable dataset families and producers

| Family / roots | What it contains | Producer / constraints |
|---|---|---|
| `.board/fire-ai/{quad1,survival,survival-train,survival-train-dense,baseline-reviewed,survival-curated}` | Real rectified/known-quad cases, dense survival training, reviewed selections and tensors | `FireCrackle/scripts/fire-ai/prepare_real.py`, `prepare_survival_train.py`, `apply_review.py`; preserve review/split manifests. These overlap. |
| `.board/fire-ai/{backgrounds,backgrounds-reviewed,negative,large-bg,pilot,codec}` | Video-derived backgrounds, negative crops, synthetic/codec variants | `prepare_backgrounds.py`, synthetic render/train scripts, `codec_test.py`; background source recording still defines leakage group. |
| `.board/row32-real` | New real-only normal-fire pipeline accounts for eight mapped recording identities, including the new mixed-material recording and explicitly ineligible box-only sources | `FireCrackle/scripts/fire-ai/row32/real/`; inspect `inventory.json`, `candidates.json`, `selected.json` and per-source frame caches. An active pipeline can change after this snapshot. |
| `.board/row32`, `.board/row32-large`, `.board/row32-real`, `.board/row32-128` | Phase-only model datasets/reports; `row32-real` uses recorded normal-fire RGB only, whole-video fit/calibration/test roles, and fresh shared unveil; `row32-128` re-extracts the exact same cohorts at128px from native frames, never upsizes64px crops | `FireCrackle/scripts/fire-ai/row32/`; do not mix class encoding with appearance models. Per-run `coverage.json` accounts for all originals and pending ownership audits; per-case truth/predictions remain private. The128px comparison keeps the same sources/splits/targets and adds no independent observations. |
| `.board/boundary-robust/{additional,codec-data}` | Additional known-quad and encoding controls | Existing frozen geometry and same underlying videos; codec variants add no independent observations. |
| `.board/occlusion-mask/{synthetic,survival,mixed}` | Synthetic and weak-real ownership regimes, frozen selected checkpoints, downstream pools | `FireCrackle/scripts/fire-ai/occlusion/{core.py,run.py,survival.py}` and freeze manifests; preserve training/selection IDs, 60-frame exclusions and shared preprocessing hashes. |
| `.board/occlusion-recorded` | Audited partial real ownership NPZ and training/evaluation branches | `FireCrackle/scripts/fire-ai/occlusion_recorded/prepare.py`; session ID and validity masks are mandatory. `previous`, `scratch`, `finetune` outputs reuse source pools. |
| `.board/occlusion-all-videos`, `.board/gui-occlusion-eval`, `.board/occlusion-review` | Cross-video exact/rough evaluation/review manifests | Evaluation pools, not automatically extra training. Old survival/quad1/new-recording samples overlap their parents. |
| `.board/no-fire-*`, `.board/image-presence`, `.board/fire-positive-temporal`, `.board/fire-size-gallery`, `.board/fire-blob-support`, `.board/fire-color-support` | No-fire/presence/retention/temporal feature caches, reviews and diagnostic targets | `fire-detection/bench/no_fire/`; check clear eligibility, translucency abstention, calibration clips and target provenance. |
| `.board/pov-*` | POV/GUI/veil ablations, additional joined labels, sampled predictions and frozen reports | `fire-detection/bench/pov_*.py`; `.board/pov-independent-20261018` holds the early/later joined truth. Predictions are not training truth. |
| `.board/soul-quad/real` | New real soul known-quad cases and tune/validation split | `FireCrackle/scripts/prepare-soul-quad-eval.py`; keep material/physical/normalized rows separate, and documented time bounds. |
| `.board/jolt-*`, `.board/survival-*` | Clock reports, cut edits, complete-label app demonstrations | Timing/analysis evidence. Derived cut videos inherit their original split; GUI clock is not a sprite label. |

All concrete manifest/NPZ paths, counts and schemas—including variants not singled out in this table—are listed in the generated appendix. Do not assume a family root with only reports contains additional trainable tensors.

## Coverage boundaries and maintenance

- Inspected roots: `fire-detection/data`, `fire-detection/mod/run/firelabel`, `.board`, and non-build-cache dataset directories inside `FireCrackle/src-tauri/target`. Game assets, dependency/build trees, releases and duplicate worktrees are excluded from traversal. The personal Videos/Downloads directories contain unrelated media and are not automatically admitted as project training data.
- The source register is curated; the inventory is a physical snapshot. Discovery cannot infer label correctness, material meaning, frame alignment or independence. Schema samples (including selected optional fire/quad structures) do not prove every record has the same optional fields; validate full selected inputs in the training preflight.
- Tensor headers are read without decompressing/loading complete arrays or unpickling object arrays. Video duration/rate/resolution come from local `ffprobe`; frame counts must come from decoded/joined records when the container omits them.
- Do not delete old questionable sessions or overwrite historical results during catalogue maintenance. Mark invalid/unavailable and retain the reason. Do not reconstruct oracle masks from weak or broken supervision.
- When working from another machine or fresh clone, local paths may be unavailable. Report that explicitly rather than silently training on the tiny subset that happens to exist.

<!-- GENERATED INVENTORY: run scripts/catalogue_training_data.py --write -->

## Complete discovered inventory

Generated by the inventory command. Counts are physical local files, not independent samples. Full field/type trees, exact paths, split counts and array dimensions are in [TRAINING_DATA_INVENTORY.json](TRAINING_DATA_INVENTORY.json).

### Original video measurements

| Original file | Seconds | Resolution | Average FPS |
|---|---:|---|---|
| `fire-detection/data/video/2026-10-15 14-15-51.mkv` | 156.684000 | 1920 x 1080 | 60/1 |
| `fire-detection/data/video/2026-10-15 14-48-36.mkv` | 543.817000 | 1920 x 1080 | 60/1 |
| `fire-detection/data/video/2026-10-15 18-18-16.mkv` | 325.887000 | 1920 x 1080 | 60/1 |
| `fire-detection/data/video/2026-10-15 23-48-59.mkv` | 47.017000 | 1920 x 1080 | 60/1 |
| `fire-detection/data/video/2026-10-15 23-50-25.mkv` | 78.884000 | 1920 x 1080 | 60/1 |
| `fire-detection/data/video/2026-10-16 00-40-22.mkv` | 118.284000 | 1920 x 1080 | 60/1 |
| `fire-detection/data/video/2026-10-16 01-41-58.mkv` | 18.550000 | 1920 x 1080 | 60/1 |
| `fire-detection/data/video/2026-10-16 01-42-43.mp4` | 84.084000 | 1920 x 1080 | 60/1 |
| `fire-detection/data/video/2026-10-16 18-23-42.mkv` | 1378.150000 | 1920 x 1080 | 60/1 |
| `fire-detection/data/video/2026-10-17 17-04-31.mkv` | 54.417000 | 1920 x 1080 | 60/1 |
| `fire-detection/data/video/2026-10-17 18-28-42.mkv` | 533.350000 | 1920 x 1080 | 60/1 |
| `fire-detection/data/video/2026-10-19 16-49-48.mkv` | 164.550000 | 1920 x 1080 | 60/1 |

### Raw capture logs (34)

| Local path | Contents / observed schema |
|---|---|
| `.board/soul-quad/recording-labels.jsonl` | 88320 records; f, f0, f1, fire, fires, h, s0, s1, soul, soul_fires, tick, w |
| `fire-detection/data/joined/quad1.raw-labels.jsonl` | 19576 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/data/joined/survival1.raw-labels.jsonl` | 98243 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261015-040511.jsonl` | 15720 records; f, f0, f1, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-041628.jsonl` | 43987 records; f, f0, f1, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-042415.jsonl` | 53 records; f, f0, f1, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-042436.jsonl` | 2992755 records; f, f0, f1, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-124326.jsonl` | 45 records; f, f0, f1, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-124349.jsonl` | 36720 records; box, f, f0, f1, fire, fires, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-125319.jsonl` | 7680 records; box, f, f0, f1, fire, fires, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-125624.jsonl` | 80223 records; box, f, f0, f1, fire, fires, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-131124.jsonl` | 57 records; box, f, f0, f1, fire, fires, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-131146.jsonl` | 44627 records; box, f, f0, f1, fire, fires, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-131921.jsonl` | 13 records; box, f, f0, f1, fire, fires, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-131941.jsonl` | 287884 records; f, f0, f1, fire, fires, tick |
| `fire-detection/mod/run/firelabel/labels-20261015-140759.jsonl` | 0 records;  |
| `fire-detection/mod/run/firelabel/labels-20261015-140934.jsonl` | 141744 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261015-143556.jsonl` | 96 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261015-143621.jsonl` | 20825 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261015-144011.jsonl` | 55 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261015-144433.jsonl` | 10180 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261015-144739.jsonl` | 97862 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261015-150729.jsonl` | 58 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261015-181718.jsonl` | 1764189 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261015-233435.jsonl` | 51 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261016-003956.jsonl` | 19576 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261016-004546.jsonl` | 0 records;  |
| `fire-detection/mod/run/firelabel/labels-20261016-181808.jsonl` | 98243 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261016-184703.jsonl` | 0 records;  |
| `fire-detection/mod/run/firelabel/labels-20261017-165613.jsonl` | 17760 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261017-170335.jsonl` | 6555 records; f, f0, f1, fire, fires, h, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261017-170621.jsonl` | 0 records;  |
| `fire-detection/mod/run/firelabel/labels-20261019-162844.jsonl` | 109791 records; f, f0, f1, fire, fires, h, s0, s1, soul, soul_fires, tick, w |
| `fire-detection/mod/run/firelabel/labels-20261019-165838.jsonl` | 0 records;  |

### Synchronized frame labels (7)

| Local path | Contents / observed schema |
|---|---|
| `.board/pov-independent-20261018/early.joined.jsonl` | 9400 records; f, label, n, tick, tick_ok |
| `.board/pov-independent-20261018/later.joined.jsonl` | 3263 records; f, label, n, tick, tick_ok |
| `.board/soul-quad/joined.jsonl` | 9870 records; f, label, n, tick, tick_ok |
| `fire-detection/data/joined/clip1.jsonl` | 32626 records; f, label, n, tick, tick_ok |
| `fire-detection/data/joined/clip2.jsonl` | 19553 records; f, label, n, tick, tick_ok |
| `fire-detection/data/joined/quad1.jsonl` | 7094 records; f, label, n, tick, tick_ok |
| `fire-detection/data/joined/survival1.jsonl` | 82686 records; f, label, n, tick, tick_ok |

### Synchronization maps (no per-frame label object) (1)

| Local path | Contents / observed schema |
|---|---|
| `.board/ownership-review/sync.jsonl` | 31999 records; f, n, tick |

### Renderer ownership sessions (3)

| Local path | Contents / observed schema |
|---|---|
| `fire-detection/mod/run/firelabel/ownership-aa9c6e80-3dab-4b58-bc3a-7011cbd8626b` | 26 JSON sidecars; 26 RGB / 26 ID PNGs; 0 frames with issues; 0 with known fire pixels; schema in inventory |
| `fire-detection/mod/run/firelabel/ownership-e6eb5afd-80bf-4f7c-9125-fda8aeea0352` | 459 JSON sidecars; 459 RGB / 459 ID PNGs; 451 frames with issues; 7 with known fire pixels; schema in inventory |
| `fire-detection/mod/run/firelabel/ownership-ebe022b2-f48a-456d-8c2c-169aedede5f9` | 105 JSON sidecars; 105 RGB / 105 ID PNGs; 99 frames with issues; 45 with known fire pixels; schema in inventory |

### Dataset manifests and frozen/reviewed pools (170)

| Local path | Contents / observed schema |
|---|---|
| `.board/boundary-robust/additional/manifest.json` | {"samples_count":38,"samples_splits":{"validation":38}}; fields: id, frame, quad, expected, source, visibility, veil, split, min_edge |
| `.board/boundary-robust/audit-cases.json` | {"records_count":13}; fields: type, example_length, item |
| `.board/boundary-robust/codec-data/h264-crf24/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/boundary-robust/codec-data/h264-crf32/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/boundary-robust/codec-data/uncompressed/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/fire-ai/backgrounds-reviewed/manifest.json` | {}; fields: guard_frames, stride, patches_per_frame, sources, review |
| `.board/fire-ai/backgrounds/manifest.json` | {}; fields: guard_frames, stride, patches_per_frame, sources |
| `.board/fire-ai/baseline-reviewed/manifest.json` | {"samples_count":15,"samples_splits":{"validation":15}}; fields: id, frame, quad, expected, source, split, visibility, veil |
| `.board/fire-ai/codec/h264-crf24/manifest.json` | {"samples_count":128,"samples_splits":{"validation":128}}; fields: shot, frame, quad, expected, split, source, visibility, veil, id |
| `.board/fire-ai/codec/h264-crf32/manifest.json` | {"samples_count":128,"samples_splits":{"validation":128}}; fields: shot, frame, quad, expected, split, source, visibility, veil, id |
| `.board/fire-ai/codec/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: shot, frame, quad, expected, split, source, visibility, veil, id |
| `.board/fire-ai/codec/uncompressed/manifest.json` | {"samples_count":128,"samples_splits":{"validation":128}}; fields: shot, frame, quad, expected, split, source, visibility, veil, id |
| `.board/fire-ai/inventory.json` | {}; fields: quad1, survival1 |
| `.board/fire-ai/large-bg/freeze.json` | {}; fields: unique_training_examples, epochs, steps_per_epoch, seed, render_seed_start, validation_seed_start, checkpoint_sha256, background_manifest_sha256, selection, sources |
| `.board/fire-ai/quad1/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, quad, expected, source, visibility, veil, split |
| `.board/fire-ai/resnet18/freeze.json` | {}; fields: architecture, parameters, paired_control, unique_training_examples, epochs, steps_per_epoch, seed, render_seed_start, validation_seed_start, checkpoint_sha256, background_manifest_sha256, selection, sources |
| `.board/fire-ai/resnet18/small-control/freeze.json` | {}; fields: architecture, parameters, paired_control, unique_training_examples, epochs, steps_per_epoch, seed, render_seed_start, validation_seed_start, checkpoint_sha256, background_manifest_sha256, selection, sources |
| `.board/fire-ai/survival-curated/review.json` | {"train_count":100,"val_count":15}; fields: reviewer, rule, selected_before, source_joined_sha256, screening, train, val, reviewed_train, reviewed_val |
| `.board/fire-ai/survival-fit/freeze.json` | {}; fields: initial, train_crops, real_validation_crops, steps_per_epoch, selection, initial_sha256, checkpoint_sha256, training_seconds, sources |
| `.board/fire-ai/survival-train-dense/manifest.json` | {"command_count":16,"samples_count":319,"samples_splits":{"train":288,"val":31}}; fields: id, frame, quad, label, source, split, quality, crop_sha256 |
| `.board/fire-ai/survival-train/manifest.json` | {"command_count":16,"samples_count":49,"samples_splits":{"train":46,"val":3}}; fields: id, frame, quad, label, source, split, quality, crop_sha256 |
| `.board/fire-ai/survival/manifest.json` | {"samples_count":52,"samples_splits":{"validation":52}}; fields: id, frame, quad, expected, source, visibility, veil, split |
| `.board/fire-ai/survival/review.json` | {"plausible_isolated_count":4}; fields: method, plausible_isolated, others, game_mode, note |
| `.board/fire-size-gallery/cases.json` | {"records_count":57,"records_splits":{"unspecified":57}}; fields: source, frame, box, width, height, box_area, box_percent, shorter_side, label_w, label_h, source_kind, visibility_fraction, id, target_area, rank, opaque_estimate, image, visual_review |
| `.board/image-presence/continuation/checkout/FireCrackle/scripts/fire-ai/survival-review.json` | {"train_count":100,"val_count":15}; fields: reviewer, rule, selected_before, source_joined_sha256, screening, train, val, reviewed_train, reviewed_val |
| `.board/image-presence/continuation/full-clip2/review/manifest.json` | {"frames_count":95,"frames_splits":{"unspecified":95},"moments_count":11,"moments_splits":{"unspecified":11}}; fields: frames, moments, source, fps, provenance, scope |
| `.board/image-presence/continuation/resnets/resnet18/freeze.json` | {}; fields: epoch, development_loss, weights_sha256 |
| `.board/image-presence/continuation/resnets/resnet50/freeze.json` | {}; fields: epoch, development_loss, weights_sha256 |
| `.board/image-presence/continuation/run3/control/freeze.json` | {}; fields: selected_epoch, development_loss, weights_sha256 |
| `.board/image-presence/continuation/run3/positive_aux/freeze.json` | {}; fields: selected_epoch, development_loss, weights_sha256 |
| `.board/image-presence/continuation/vit1/vit_b_16/freeze.json` | {}; fields: epoch, development_loss, weights_sha256 |
| `.board/image-presence/run1/dataset.json` | {"rows_count":1579,"rows_splits":{"unspecified":1579}}; fields: provenance, rows |
| `.board/image-presence/run1/freeze.json` | {}; fields: selected_epoch, best_development_loss, weights_sha256, device, torch, training_frames, development_frames |
| `.board/image-presence/run2/dataset.json` | {"positives_count":192,"positives_splits":{"unspecified":192},"negative_frames_count":422,"negative_frames_splits":{"unspecified":422},"development_count":83,"development_splits":{"unspecified":83}}; fields: positives, negative_frames, development, provenance, sampled_fit_frames |
| `.board/image-presence/run2/freeze.json` | {}; fields: epoch, weights_sha256, review_sha256, positive_crops, negative_crops, sampled_fit_frames, development_frames, best_development_frame_loss |
| `.board/image-presence/run2/review.json` | {}; fields: clip1-90, clip1-1470, clip1-1500, clip1-1530, clip1-1560, clip1-1650, clip1-1680, clip1-1740, clip1-1920, clip1-1950, clip1-1980, clip1-2010, clip1-2040, clip1-2130, clip1-2370, clip1-2400, clip1-2430, clip1-2460, clip1-2490, clip1-2520, clip1-2850, clip1-2910, clip1-2940, clip1-3360, clip1-3420, clip1-3450, clip1-3480, clip1-3510, clip1-3660, clip1-3870, clip1-3990, clip1-4050, clip1-4110, clip1-4170, clip1-5370, clip1-5400, clip1-5610, clip1-6570, clip1-6660, clip1-6720, clip1-6810, clip1-7170, clip1-7350, clip1-7410, clip1-7770, clip1-7950, clip1-8460, clip1-8550, clip1-8610, clip1-8640, clip1-8670, clip1-8700, clip1-8940, clip1-9120, clip1-9660, clip1-9720, clip1-9750, clip1-9780, clip1-9900, clip1-9930, clip1-9990, clip1-10020, clip1-10050, clip1-10140, clip1-10530, clip1-10560, clip1-10590, clip1-10650, clip1-10680, clip1-10710, clip1-10740, clip1-10770, clip1-11190, clip1-11220, clip1-11280, clip1-11340, clip1-11670, clip1-12030, clip1-12180, clip1-12240, clip1-12420, clip1-12540, clip1-12600, clip1-12630, clip1-12660, clip1-12720, clip1-12750, clip1-12810, clip1-12900, clip1-12960, clip1-13170, clip1-13350, clip1-13530, clip1-13830, clip1-14550, clip1-14580, clip1-14820, clip1-14970, clip1-15000, clip1-15030, clip1-15060, clip1-15150, clip1-15750, clip1-15780, clip1-15810, clip1-15990, clip1-16590, clip1-16620, clip1-16650, clip1-16680, clip1-16710, clip1-18150, clip1-18360, clip1-20970, clip1-22650, clip1-22740, clip1-22800, clip1-22830, clip1-22860, clip1-22920, clip1-22950, clip1-22980, clip1-23040, clip1-23190, clip1-23340, clip1-23370, clip1-23400, clip1-23430, clip1-23490, clip1-23850, clip1-23880, clip1-24390, clip1-24480, clip1-24510, clip1-25050, clip1-25110, clip1-25200, clip1-25380, clip1-25590, clip1-25650, clip1-25680, clip1-25890, quad1-480, quad1-510, quad1-570, quad1-810, quad1-840, quad1-870, quad1-900, quad1-930, quad1-1020, quad1-1050, quad1-1080, quad1-1110, quad1-1140, quad1-1170, quad1-1200, quad1-1230, quad1-1350, quad1-1380, quad1-1410, quad1-1440, quad1-1470, quad1-1500, quad1-1530, quad1-1620, quad1-1680, quad1-1830, quad1-1860, quad1-1890, quad1-1920, quad1-1950, quad1-1980, quad1-2010, quad1-2040, quad1-2070, quad1-2100, quad1-2190, quad1-2220, quad1-2250, quad1-2280, quad1-2310, quad1-2340, quad1-2370, quad1-2640, quad1-5160, quad1-5190, quad1-5220, quad1-5250, quad1-5280, quad1-5310, quad1-5340 |
| `.board/no-fire-parallel/fragment-review/manifest.json` | {"cases_count":13,"cases_splits":{"unspecified":13}}; fields: source, frame, seconds, score, context, raw, auto, unveiled, veil_share, crops, max_native_width, raw_rgb_sha256 |
| `.board/no-fire-parallel/fragment-review/translucency-new/examples.json` | {"records_count":7,"records_splits":{"unspecified":7}}; fields: seconds, menu_unveiled, fit, guard |
| `.board/occlusion-all-videos/new_recording/exact/manifest.json` | {"samples_count":48,"samples_splits":{"unspecified":48}}; fields: id, frame, quad, expected, source, mask_index |
| `.board/occlusion-all-videos/new_recording/rough/manifest.json` | {"samples_count":48,"samples_splits":{"unspecified":48}}; fields: id, frame, quad, expected, source, mask_index |
| `.board/occlusion-all-videos/quad1/exact/manifest.json` | {"samples_count":310,"samples_splits":{"unspecified":310}}; fields: id, frame, quad, expected, source, mask_index |
| `.board/occlusion-all-videos/quad1/rough/manifest.json` | {"samples_count":310,"samples_splits":{"unspecified":310}}; fields: id, frame, quad, expected, source, mask_index |
| `.board/occlusion-all-videos/survival1/exact/manifest.json` | {"samples_count":74,"samples_splits":{"unspecified":74}}; fields: id, frame, quad, expected, source, mask_index |
| `.board/occlusion-all-videos/survival1/rough/manifest.json` | {"samples_count":74,"samples_splits":{"unspecified":74}}; fields: id, frame, quad, expected, source, mask_index |
| `.board/occlusion-mask/mixed/additional-exact/manifest.json` | {"samples_count":38,"samples_splits":{"validation":38}}; fields: id, frame, quad, expected, source, visibility, veil, split, min_edge, mask_index |
| `.board/occlusion-mask/mixed/additional-rough/manifest.json` | {"samples_count":38,"samples_splits":{"validation":38}}; fields: id, frame, quad, expected, source, visibility, veil, split, min_edge, mask_index |
| `.board/occlusion-mask/mixed/codec-h264-crf24/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/occlusion-mask/mixed/codec-h264-crf32/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/occlusion-mask/mixed/codec-uncompressed/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/occlusion-mask/mixed/freeze.json` | {"masks_count":6,"real_train_ids_count":100,"real_selection_ids_count":15}; fields: seed, training_source, train_seed_start, val_seed_start, test_seed_start, epochs, steps, examples, parameters, selected_epoch, checkpoint_sha256, background_manifest_sha256, selection, masks, rule, real_use, real_train_ids, real_selection_ids, weak_rule, survival_train_sha256, survival_review_sha256, sources |
| `.board/occlusion-mask/mixed/quad1-exact/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/mixed/quad1-rough/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/mixed/reviewed-exact/manifest.json` | {"samples_count":15,"samples_splits":{"validation":15}}; fields: id, frame, quad, expected, source, split, visibility, veil, mask_index |
| `.board/occlusion-mask/mixed/reviewed-rough/manifest.json` | {"samples_count":15,"samples_splits":{"validation":15}}; fields: id, frame, quad, expected, source, split, visibility, veil, mask_index |
| `.board/occlusion-mask/mixed/survival-exact/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/mixed/survival-rough/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/mixed/synthetic/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split, has_target |
| `.board/occlusion-mask/survival/additional-exact/manifest.json` | {"samples_count":38,"samples_splits":{"validation":38}}; fields: id, frame, quad, expected, source, visibility, veil, split, min_edge, mask_index |
| `.board/occlusion-mask/survival/additional-rough/manifest.json` | {"samples_count":38,"samples_splits":{"validation":38}}; fields: id, frame, quad, expected, source, visibility, veil, split, min_edge, mask_index |
| `.board/occlusion-mask/survival/codec-h264-crf24/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/occlusion-mask/survival/codec-h264-crf32/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/occlusion-mask/survival/codec-uncompressed/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/occlusion-mask/survival/freeze.json` | {"masks_count":6,"real_train_ids_count":100,"real_selection_ids_count":15}; fields: seed, training_source, train_seed_start, val_seed_start, test_seed_start, epochs, steps, examples, parameters, selected_epoch, checkpoint_sha256, background_manifest_sha256, selection, masks, rule, real_use, real_train_ids, real_selection_ids, weak_rule, survival_train_sha256, survival_review_sha256, sources |
| `.board/occlusion-mask/survival/quad1-exact/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/survival/quad1-rough/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/survival/reviewed-exact/manifest.json` | {"samples_count":15,"samples_splits":{"validation":15}}; fields: id, frame, quad, expected, source, split, visibility, veil, mask_index |
| `.board/occlusion-mask/survival/reviewed-rough/manifest.json` | {"samples_count":15,"samples_splits":{"validation":15}}; fields: id, frame, quad, expected, source, split, visibility, veil, mask_index |
| `.board/occlusion-mask/survival/survival-exact/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/survival/survival-rough/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/survival/synthetic/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split, has_target |
| `.board/occlusion-mask/synthetic/additional-exact/manifest.json` | {"samples_count":38,"samples_splits":{"validation":38}}; fields: id, frame, quad, expected, source, visibility, veil, split, min_edge, mask_index |
| `.board/occlusion-mask/synthetic/additional-rough/manifest.json` | {"samples_count":38,"samples_splits":{"validation":38}}; fields: id, frame, quad, expected, source, visibility, veil, split, min_edge, mask_index |
| `.board/occlusion-mask/synthetic/codec-h264-crf24/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/occlusion-mask/synthetic/codec-h264-crf32/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/occlusion-mask/synthetic/codec-uncompressed/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split |
| `.board/occlusion-mask/synthetic/freeze.json` | {"masks_count":6,"real_train_ids_count":100,"real_selection_ids_count":15}; fields: seed, training_source, train_seed_start, val_seed_start, test_seed_start, epochs, steps, examples, parameters, selected_epoch, checkpoint_sha256, background_manifest_sha256, selection, masks, rule, real_use, real_train_ids, real_selection_ids, weak_rule, survival_train_sha256, survival_review_sha256, sources |
| `.board/occlusion-mask/synthetic/quad1-exact/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/synthetic/quad1-rough/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/synthetic/reviewed-exact/manifest.json` | {"samples_count":15,"samples_splits":{"validation":15}}; fields: id, frame, quad, expected, source, split, visibility, veil, mask_index |
| `.board/occlusion-mask/synthetic/reviewed-rough/manifest.json` | {"samples_count":15,"samples_splits":{"validation":15}}; fields: id, frame, quad, expected, source, split, visibility, veil, mask_index |
| `.board/occlusion-mask/synthetic/survival-exact/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/synthetic/survival-rough/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, quad, expected, source, visibility, veil, split, mask_index |
| `.board/occlusion-mask/synthetic/synthetic/manifest.json` | {"samples_count":1024,"samples_splits":{"validation":1024}}; fields: id, frame, quad, expected, source, split, has_target |
| `.board/occlusion-recorded/finetune/new-test-rough/manifest.json` | {"samples_count":48,"samples_splits":{"validation":48}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/finetune/new-test/manifest.json` | {"samples_count":48,"samples_splits":{"validation":48}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/finetune/quad1-rough/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/finetune/quad1/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/finetune/reviewed/manifest.json` | {"samples_count":15,"samples_splits":{"validation":15}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/finetune/survival-rough/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/finetune/survival/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/finetune/synthetic/manifest.json` | {"samples_count":256,"samples_splits":{"validation":256}}; fields: id, frame, quad, expected, source, split, has_target |
| `.board/occlusion-recorded/manifest.json` | {"samples_count":178,"samples_splits":{"validation":29,"train":101,"test":48},"source_frames_count":25,"source_frames_splits":{"unspecified":25}}; fields: id, frame, split, sheet, row, expected, quad, source_json, warning_count, issue_free, global_ground_truth, positive_pixels, valid_pixels, foreign_pixels, sprite_disagreement, unveil_applied, crop |
| `.board/occlusion-recorded/previous/new-test-rough/manifest.json` | {"samples_count":48,"samples_splits":{"validation":48}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/previous/new-test/manifest.json` | {"samples_count":48,"samples_splits":{"validation":48}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/previous/quad1-rough/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/previous/quad1/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/previous/reviewed/manifest.json` | {"samples_count":15,"samples_splits":{"validation":15}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/previous/survival-rough/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/previous/survival/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/previous/synthetic/manifest.json` | {"samples_count":256,"samples_splits":{"validation":256}}; fields: id, frame, quad, expected, source, split, has_target |
| `.board/occlusion-recorded/scratch/new-test-rough/manifest.json` | {"samples_count":48,"samples_splits":{"validation":48}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/scratch/new-test/manifest.json` | {"samples_count":48,"samples_splits":{"validation":48}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/scratch/quad1-rough/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/scratch/quad1/manifest.json` | {"samples_count":310,"samples_splits":{"validation":310}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/scratch/reviewed/manifest.json` | {"samples_count":15,"samples_splits":{"validation":15}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/scratch/survival-rough/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/scratch/survival/manifest.json` | {"samples_count":36,"samples_splits":{"validation":36}}; fields: id, frame, mask_index, quad, expected, source, split |
| `.board/occlusion-recorded/scratch/synthetic/manifest.json` | {"samples_count":256,"samples_splits":{"validation":256}}; fields: id, frame, quad, expected, source, split, has_target |
| `.board/occlusion-review/manifest.json` | {"cases_count":50,"cases_splits":{"unspecified":50}}; fields: code, sample, width, height, native_source, min_edge, dataset, crop_sha256 |
| `.board/ownership-review/examples.json` | {"records_count":3,"records_splits":{"unspecified":3}}; fields: frame, video_frame, hashes_ok, fire_pixels, issues, dominant_id, video_rgb_mae_excluding_strip |
| `.board/pov-dual-veil-v2/clip1.meta.json` | {}; fields: signature, seconds |
| `.board/pov-dual-veil-v2/clip2.meta.json` | {}; fields: signature, seconds |
| `.board/pov-dual-veil-v2/quad1.meta.json` | {}; fields: signature, seconds |
| `.board/pov-dual-veil-v2/survival1.meta.json` | {}; fields: signature, seconds |
| `.board/pov-dual-veil/clip1-pilot20.meta.json` | {}; fields: signature, seconds |
| `.board/pov-dual-veil/clip1.meta.json` | {}; fields: signature, seconds |
| `.board/pov-dual-veil/clip2.meta.json` | {}; fields: signature, seconds |
| `.board/pov-dual-veil/quad1.meta.json` | {}; fields: signature, seconds |
| `.board/pov-dual-veil/survival1.meta.json` | {}; fields: signature, seconds |
| `.board/pov-gui-ablation/clip1-pilot20.meta.json` | {}; fields: source_hashes, truth_sha256, stride, total, width, height, threshold, video, video_bytes, seconds |
| `.board/pov-gui-ablation/clip1.meta.json` | {}; fields: source_hashes, truth_sha256, stride, total, width, height, threshold, video, video_bytes, seconds |
| `.board/pov-gui-ablation/clip2.meta.json` | {}; fields: source_hashes, truth_sha256, stride, total, width, height, threshold, video, video_bytes, seconds |
| `.board/pov-gui-ablation/quad1.meta.json` | {}; fields: source_hashes, truth_sha256, stride, total, width, height, threshold, video, video_bytes, seconds |
| `.board/pov-gui-ablation/survival1.meta.json` | {}; fields: source_hashes, truth_sha256, stride, total, width, height, threshold, video, video_bytes, seconds |
| `.board/pov-gui-integrated/clip1-spatial.meta.json` | {}; fields: native, manifest, parent, assets |
| `.board/pov-gui-integrated/clip2-spatial.meta.json` | {}; fields: native, manifest, parent, assets |
| `.board/pov-gui-integrated/survival1-spatial.meta.json` | {}; fields: native, manifest, parent, assets |
| `.board/pov-gui-remaining/clip1-features.meta.json` | {}; fields: feature_code_sha256, aggregation_sha256, cache_meta_sha256, parent_predictions_sha256 |
| `.board/pov-gui-remaining/clip1-pilot20-features.meta.json` | {}; fields: analysis_sha256, cache_meta_sha256 |
| `.board/pov-gui-remaining/clip1-pilot20.jsonl.meta.json` | {}; fields: native_sha256, source_hashes, assets, video_sha256, video_bytes, truth_sha256, stride, total, width, height |
| `.board/pov-gui-remaining/clip1.jsonl.meta.json` | {}; fields: native_sha256, source_hashes, assets, video_sha256, video_bytes, truth_sha256, stride, total, width, height |
| `.board/pov-gui-remaining/clip2-features.meta.json` | {}; fields: feature_code_sha256, aggregation_sha256, cache_meta_sha256, parent_predictions_sha256 |
| `.board/pov-gui-remaining/clip2.jsonl.meta.json` | {}; fields: native_sha256, source_hashes, assets, video_sha256, video_bytes, truth_sha256, stride, total, width, height |
| `.board/pov-gui-remaining/quad1-features.meta.json` | {}; fields: feature_code_sha256, aggregation_sha256, cache_meta_sha256, parent_predictions_sha256 |
| `.board/pov-gui-remaining/quad1.jsonl.meta.json` | {}; fields: native_sha256, source_hashes, assets, video_sha256, video_bytes, truth_sha256, stride, total, width, height |
| `.board/pov-gui-remaining/survival1-features.meta.json` | {}; fields: feature_code_sha256, aggregation_sha256, cache_meta_sha256, parent_predictions_sha256 |
| `.board/pov-gui-remaining/survival1.jsonl.meta.json` | {}; fields: native_sha256, source_hashes, assets, video_sha256, video_bytes, truth_sha256, stride, total, width, height |
| `.board/pov-gui-stages/clip1-pilot20.meta.json` | {"configs_count":144,"configs_splits":{"unspecified":144}}; fields: sources, truth_sha256, stride, total, threshold, configs, video, video_bytes, seconds |
| `.board/pov-gui-stages/clip1.meta.json` | {"configs_count":144,"configs_splits":{"unspecified":144}}; fields: sources, truth_sha256, stride, total, threshold, configs, video, video_bytes, seconds |
| `.board/pov-gui-stages/clip2.meta.json` | {"configs_count":144,"configs_splits":{"unspecified":144}}; fields: sources, truth_sha256, stride, total, threshold, configs, video, video_bytes, seconds |
| `.board/pov-gui-stages/quad1.meta.json` | {"configs_count":144,"configs_splits":{"unspecified":144}}; fields: sources, truth_sha256, stride, total, threshold, configs, video, video_bytes, seconds |
| `.board/pov-gui-stages/survival1.meta.json` | {"configs_count":144,"configs_splits":{"unspecified":144}}; fields: sources, truth_sha256, stride, total, threshold, configs, video, video_bytes, seconds |
| `.board/pov-gui-support/clip1-spatial.meta.json` | {}; fields: native_sha256, source_sha256, frames_sha256, parent_meta_sha256, assets |
| `.board/pov-gui-support/clip2-spatial.meta.json` | {}; fields: native_sha256, source_sha256, frames_sha256, parent_meta_sha256, assets |
| `.board/pov-gui-support/survival1-spatial.meta.json` | {}; fields: native_sha256, source_sha256, frames_sha256, parent_meta_sha256, assets |
| `.board/pov-independent-20261018/early.meta.json` | {}; fields: signature, seconds |
| `.board/pov-independent-20261018/later.meta.json` | {}; fields: signature, seconds |
| `.board/pov-integration/final-lint/later.meta.json` | {}; fields: signature, seconds, output_sha256 |
| `.board/pov-integration/final-v1/clip1.meta.json` | {}; fields: signature, seconds, output_sha256 |
| `.board/pov-integration/final-v1/clip2.meta.json` | {}; fields: signature, seconds, output_sha256 |
| `.board/pov-integration/final-v1/early.meta.json` | {}; fields: signature, seconds, output_sha256 |
| `.board/pov-integration/final-v1/later.meta.json` | {}; fields: signature, seconds, output_sha256 |
| `.board/pov-integration/final-v1/quad1.meta.json` | {}; fields: signature, seconds, output_sha256 |
| `.board/pov-integration/final-v1/survival1.meta.json` | {}; fields: signature, seconds, output_sha256 |
| `.board/row32-128/manifest.json` | {"samples_count":3780,"samples_splits":{"calibration":157,"train":3006,"test":617}}; fields: id, video, video_file, joined, split, frame, render_frame, quad, width, height, phase, source, visibility, veil, min_edge, readability, unveil_applied, veil_share, crop_sha256, reference64_crop_sha256, input_size |
| `.board/row32-real/candidates.json` | {"records_count":6224,"records_splits":{"test":901,"train":5083,"calibration":240}}; fields: id, video, video_file, joined, split, frame, render_frame, quad, width, height, phase, source, visibility, veil, min_edge |
| `.board/row32-real/inventory.json` | {"recordings_count":8,"recordings_splits":{"inventory_only":3,"test":1,"train":3,"calibration":1}}; fields: recordings, protocol |
| `.board/row32-real/later/manifest.json` | {"samples_count":157,"samples_splits":{"calibration":157},"command_count":18}; fields: id, video, video_file, joined, split, frame, render_frame, quad, width, height, phase, source, visibility, veil, min_edge, readability, unveil_applied, veil_share, crop_sha256 |
| `.board/row32-real/manifest.json` | {"samples_count":3780,"samples_splits":{"calibration":157,"train":3006,"test":617}}; fields: id, video, video_file, joined, split, frame, render_frame, quad, width, height, phase, source, visibility, veil, min_edge, readability, unveil_applied, veil_share, crop_sha256 |
| `.board/row32-real/new_normal/manifest.json` | {"samples_count":120,"samples_splits":{"train":120},"command_count":18}; fields: id, video, video_file, joined, split, frame, render_frame, quad, width, height, phase, source, visibility, veil, min_edge, readability, unveil_applied, veil_share, crop_sha256 |
| `.board/row32-real/ownership/manifest.json` | {"samples_count":69,"samples_splits":{"train":69}}; fields: id, video, video_file, split, frame, render_frame, quad, width, height, phase, source, source_json, source_rgb, source_rgb_sha256, warning_count, global_ground_truth, legacy_quality_screened, readability, unveil_applied, veil_share, crop_sha256 |
| `.board/row32-real/quad1/manifest.json` | {"samples_count":617,"samples_splits":{"test":617},"command_count":18}; fields: id, video, video_file, joined, split, frame, render_frame, quad, width, height, phase, source, visibility, veil, min_edge, readability, unveil_applied, veil_share, crop_sha256 |
| `.board/row32-real/selected.json` | {"records_count":3781,"records_splits":{"test":617,"train":3007,"calibration":157}}; fields: id, video, video_file, joined, split, frame, render_frame, quad, width, height, phase, source, visibility, veil, min_edge, readability |
| `.board/row32-real/survival1/manifest.json` | {"samples_count":2818,"samples_splits":{"train":2818},"command_count":18}; fields: id, video, video_file, joined, split, frame, render_frame, quad, width, height, phase, source, visibility, veil, min_edge, readability, unveil_applied, veil_share, crop_sha256 |
| `.board/row32/extra-eligible.json` | {"records_count":190,"records_splits":{"train":175,"val":15}}; fields: id, frame, quad, label, source, split, quality, crop_sha256 |
| `.board/row32/selected.json` | {"records_count":456,"records_splits":{"tune":242,"validation":214}}; fields: id, frame, quad, expected, source, visibility, veil, split, kind, phase, baselinePhase, dir, width, height, manifest_sha256 |
| `.board/soul-quad/real/manifest.json` | {"samples_count":2905,"samples_splits":{"tune":2103,"validation":802}}; fields: id, frame, rendered_frame, split, quad, expected, physical_row, visibility, veil, source, unveiled |
| `FireCrackle/src-tauri/target/actual-quad1/manifest.json` | {"samples_count":1128,"samples_splits":{"tune":818,"validation":310}}; fields: id, frame, quad, expected, source, visibility, veil, split |
| `FireCrackle/src-tauri/target/quad-eval-clip1/manifest.json` | {"native_size_count":2,"samples_count":1167,"samples_splits":{"unspecified":1167}}; fields: file, frame, width, height, box, expected, source, visibility, veil, min_pixels |
| `FireCrackle/src-tauri/target/quad-eval-clip2/manifest.json` | {"native_size_count":2,"samples_count":257,"samples_splits":{"unspecified":257}}; fields: file, frame, width, height, box, expected, source, visibility, veil, min_pixels |

### NPZ datasets and feature/prediction caches (131)

| Local path | Contents / observed schema |
|---|---|
| `.board/fire-ai/backgrounds-reviewed/train.npz` | x: [344, 160, 160, 3] |u1 |
| `.board/fire-ai/backgrounds-reviewed/val.npz` | x: [230, 160, 160, 3] |u1 |
| `.board/fire-ai/backgrounds/train.npz` | x: [417, 160, 160, 3] |u1 |
| `.board/fire-ai/backgrounds/val.npz` | x: [314, 160, 160, 3] |u1 |
| `.board/fire-ai/codec/h264-crf24.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/codec/h264-crf32.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/codec/predictions-h264-crf24.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/codec/predictions-h264-crf32.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/codec/predictions-uncompressed.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/codec/uncompressed.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/large-bg/codec/h264-crf24.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/large-bg/codec/h264-crf32.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/large-bg/codec/predictions-h264-crf24.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/large-bg/codec/predictions-h264-crf32.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/large-bg/codec/predictions-uncompressed.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/large-bg/codec/uncompressed.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/large-bg/curated-survival/predictions-val.npz` | order: [15, 128] <i8; confidence: [15] <f4; truth: [15] <i8 |
| `.board/fire-ai/large-bg/curated-survival/val.npz` | x: [15, 64, 64, 3] |u1; y: [15] <i8 |
| `.board/fire-ai/large-bg/quad1/predictions-real.npz` | order: [310, 128] <i8; confidence: [310] <f4; truth: [310] <i8 |
| `.board/fire-ai/large-bg/quad1/real.npz` | x: [310, 64, 64, 3] |u1; y: [310] <i8 |
| `.board/fire-ai/large-bg/survival/predictions-real.npz` | order: [52, 128] <i8; confidence: [52] <f4; truth: [52] <i8 |
| `.board/fire-ai/large-bg/survival/real.npz` | x: [52, 64, 64, 3] |u1; y: [52] <i8 |
| `.board/fire-ai/large-bg/synthetic-test/predictions-negative-bg.npz` | order: [256, 128] <i8; confidence: [256] <f4; truth: [256] <i8 |
| `.board/fire-ai/large-bg/synthetic-test/predictions-real-bg.npz` | order: [4096, 128] <i8; confidence: [4096] <f4; truth: [4096] <i8 |
| `.board/fire-ai/large-bg/synthetic-val.npz` | x: [2048, 64, 64, 3] |u1; y: [2048] <i8 |
| `.board/fire-ai/negative/negative.npz` | x: [256, 64, 64, 3] |u1; y: [256] <i8 |
| `.board/fire-ai/negative/predictions-negative.npz` | order: [256, 128] <i8; confidence: [256] <f4; truth: [256] <i8 |
| `.board/fire-ai/negative/predictions-real.npz` | order: [256, 128] <i8; confidence: [256] <f4; truth: [256] <i8 |
| `.board/fire-ai/negative/real.npz` | x: [256, 64, 64, 3] |u1; y: [256] <i8 |
| `.board/fire-ai/pilot/clean.npz` | x: [2048, 64, 64, 3] |u1; y: [2048] <i8 |
| `.board/fire-ai/pilot/hard.npz` | x: [2048, 64, 64, 3] |u1; y: [2048] <i8 |
| `.board/fire-ai/pilot/predictions-clean.npz` | order: [2048, 128] <i8; confidence: [2048] <f4; truth: [2048] <i8 |
| `.board/fire-ai/pilot/predictions-hard.npz` | order: [2048, 128] <i8; confidence: [2048] <f4; truth: [2048] <i8 |
| `.board/fire-ai/pilot/predictions-rough.npz` | order: [2048, 128] <i8; confidence: [2048] <f4; truth: [2048] <i8 |
| `.board/fire-ai/pilot/predictions-val.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/pilot/rough.npz` | x: [2048, 64, 64, 3] |u1; y: [2048] <i8 |
| `.board/fire-ai/pilot/train.npz` | x: [16384, 64, 64, 3] |u1; y: [16384] <i8 |
| `.board/fire-ai/pilot/val.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/quad1/predictions-real.npz` | order: [310, 128] <i8; confidence: [310] <f4; truth: [310] <i8 |
| `.board/fire-ai/quad1/real.npz` | x: [310, 64, 64, 3] |u1; y: [310] <i8 |
| `.board/fire-ai/resnet18/codec/h264-crf24.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/resnet18/codec/h264-crf32.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/resnet18/codec/predictions-h264-crf24.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/resnet18/codec/predictions-h264-crf32.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/resnet18/codec/predictions-uncompressed.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/resnet18/codec/uncompressed.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/resnet18/curated-survival/predictions-val.npz` | order: [15, 128] <i8; confidence: [15] <f4; truth: [15] <i8 |
| `.board/fire-ai/resnet18/curated-survival/val.npz` | x: [15, 64, 64, 3] |u1; y: [15] <i8 |
| `.board/fire-ai/resnet18/quad1/predictions-real.npz` | order: [310, 128] <i8; confidence: [310] <f4; truth: [310] <i8 |
| `.board/fire-ai/resnet18/quad1/real.npz` | x: [310, 64, 64, 3] |u1; y: [310] <i8 |
| `.board/fire-ai/resnet18/small-control/codec/h264-crf24.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/resnet18/small-control/codec/h264-crf32.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/resnet18/small-control/codec/predictions-h264-crf24.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/resnet18/small-control/codec/predictions-h264-crf32.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/resnet18/small-control/codec/predictions-uncompressed.npz` | order: [1024, 128] <i8; confidence: [1024] <f4; truth: [1024] <i8 |
| `.board/fire-ai/resnet18/small-control/codec/uncompressed.npz` | x: [1024, 64, 64, 3] |u1; y: [1024] <i8 |
| `.board/fire-ai/resnet18/small-control/curated-survival/predictions-val.npz` | order: [15, 128] <i8; confidence: [15] <f4; truth: [15] <i8 |
| `.board/fire-ai/resnet18/small-control/curated-survival/val.npz` | x: [15, 64, 64, 3] |u1; y: [15] <i8 |
| `.board/fire-ai/resnet18/small-control/quad1/predictions-real.npz` | order: [310, 128] <i8; confidence: [310] <f4; truth: [310] <i8 |
| `.board/fire-ai/resnet18/small-control/quad1/real.npz` | x: [310, 64, 64, 3] |u1; y: [310] <i8 |
| `.board/fire-ai/resnet18/small-control/survival/predictions-real.npz` | order: [52, 128] <i8; confidence: [52] <f4; truth: [52] <i8 |
| `.board/fire-ai/resnet18/small-control/survival/real.npz` | x: [52, 64, 64, 3] |u1; y: [52] <i8 |
| `.board/fire-ai/resnet18/small-control/synthetic-test/predictions-negative-bg.npz` | order: [256, 128] <i8; confidence: [256] <f4; truth: [256] <i8 |
| `.board/fire-ai/resnet18/small-control/synthetic-test/predictions-real-bg.npz` | order: [4096, 128] <i8; confidence: [4096] <f4; truth: [4096] <i8 |
| `.board/fire-ai/resnet18/survival/predictions-real.npz` | order: [52, 128] <i8; confidence: [52] <f4; truth: [52] <i8 |
| `.board/fire-ai/resnet18/survival/real.npz` | x: [52, 64, 64, 3] |u1; y: [52] <i8 |
| `.board/fire-ai/resnet18/synthetic-test/predictions-negative-bg.npz` | order: [256, 128] <i8; confidence: [256] <f4; truth: [256] <i8 |
| `.board/fire-ai/resnet18/synthetic-test/predictions-real-bg.npz` | order: [4096, 128] <i8; confidence: [4096] <f4; truth: [4096] <i8 |
| `.board/fire-ai/resnet18/synthetic-val.npz` | x: [2048, 64, 64, 3] |u1; y: [2048] <i8 |
| `.board/fire-ai/survival-curated/predictions-val.npz` | order: [15, 128] <i8; confidence: [15] <f4; truth: [15] <i8 |
| `.board/fire-ai/survival-curated/train.npz` | x: [100, 64, 64, 3] |u1; y: [100] <i8 |
| `.board/fire-ai/survival-curated/val.npz` | x: [15, 64, 64, 3] |u1; y: [15] <i8 |
| `.board/fire-ai/survival-fit/quad1/predictions-real.npz` | order: [310, 128] <i8; confidence: [310] <f4; truth: [310] <i8 |
| `.board/fire-ai/survival-fit/quad1/real.npz` | x: [310, 64, 64, 3] |u1; y: [310] <i8 |
| `.board/fire-ai/survival-train-dense/train.npz` | x: [288, 64, 64, 3] |u1; y: [288] <i8 |
| `.board/fire-ai/survival-train-dense/val.npz` | x: [31, 64, 64, 3] |u1; y: [31] <i8 |
| `.board/fire-ai/survival-train/train.npz` | x: [46, 64, 64, 3] |u1; y: [46] <i8 |
| `.board/fire-ai/survival-train/val.npz` | x: [3, 64, 64, 3] |u1; y: [3] <i8 |
| `.board/fire-ai/survival/predictions-real.npz` | order: [52, 128] <i8; confidence: [52] <f4; truth: [52] <i8 |
| `.board/fire-ai/survival/real.npz` | x: [52, 64, 64, 3] |u1; y: [52] <i8 |
| `.board/fire-color-support/pixels.npz` | raw: [6930, 3] |u1; corrected: [6930, 3] |u1; expected: [6930, 3] |u1 |
| `.board/no-fire-pilot/clip1.npz` | x: [1088, 232] <f4; frames: [1088] <i8; truth: [1088, 4] <f8; thumbs: [1088, 144, 256, 3] |u1 |
| `.board/no-fire-pilot/clip2.npz` | x: [652, 232] <f4; frames: [652] <i8; truth: [652, 4] <f8; thumbs: [652, 144, 256, 3] |u1 |
| `.board/no-fire-pilot/color-clusters.npz` | centres: [16, 3] <f8; lut: [4096] <i8 |
| `.board/no-fire-pilot/quad1.npz` | x: [237, 232] <f4; frames: [237] <i8; truth: [237, 4] <f8; thumbs: [237, 144, 256, 3] |u1 |
| `.board/no-fire-pilot/survival1.npz` | x: [2757, 232] <f4; frames: [2757] <i8; truth: [2757, 4] <f8; thumbs: [2757, 144, 256, 3] |u1 |
| `.board/occlusion-recorded/recorded.npz` | rgb: [178, 64, 64, 3] |u1; target: [178, 64, 64] |b1; valid: [178, 64, 64] |b1; foreign: [178, 64, 64] |b1 |
| `.board/pov-gui-integrated/clip1.npz` | frames: [6526] <i8; truth: [6526] <i8; rows: [6526, 1008] |u1; accepted: [6526, 1008] |b1 |
| `.board/pov-gui-integrated/clip2.npz` | frames: [3911] <i8; truth: [3911] <i8; rows: [3911, 1008] |u1; accepted: [3911, 1008] |b1 |
| `.board/pov-gui-integrated/quad1.npz` | frames: [237] <i8; truth: [237] <i8; rows: [237, 1008] |u1; accepted: [237, 1008] |b1 |
| `.board/pov-gui-integrated/survival1.npz` | frames: [2757] <i8; truth: [2757] <i8; rows: [2757, 1008] |u1; accepted: [2757, 1008] |b1 |
| `.board/pov-gui-remaining/clip1-features.npz` | frames: [6526] <i8; rows: [6526, 256] <i2; scores: [6526, 256] <f8; margins: [6526, 256] <f8; spans: [6526, 256] |u1; thumbs: [6526, 1728] |u1; protected: [6526] |b1; saved_rows: [6526] <i8; original_accept: [6526] |b1; truth: [6526] <i8 |
| `.board/pov-gui-remaining/clip1-pilot20-features.npz` | frames: [20] <i8; rows: [20, 256] <i2; scores: [20, 256] <f8; margins: [20, 256] <f8; spans: [20, 256] |u1; thumbs: [20, 1728] |u1; protected: [20] |b1; saved_rows: [20] <i8; original_accept: [20] |b1; truth: [20] <i8 |
| `.board/pov-gui-remaining/clip2-features.npz` | frames: [3911] <i8; rows: [3911, 256] <i2; scores: [3911, 256] <f8; margins: [3911, 256] <f8; spans: [3911, 256] |u1; thumbs: [3911, 1728] |u1; protected: [3911] |b1; saved_rows: [3911] <i8; original_accept: [3911] |b1; truth: [3911] <i8 |
| `.board/pov-gui-remaining/quad1-features.npz` | frames: [237] <i8; rows: [237, 256] <i2; scores: [237, 256] <f8; margins: [237, 256] <f8; spans: [237, 256] |u1; thumbs: [237, 1728] |u1; protected: [237] |b1; saved_rows: [237] <i8; original_accept: [237] |b1; truth: [237] <i8 |
| `.board/pov-gui-remaining/survival1-features.npz` | frames: [2757] <i8; rows: [2757, 256] <i2; scores: [2757, 256] <f8; margins: [2757, 256] <f8; spans: [2757, 256] |u1; thumbs: [2757, 1728] |u1; protected: [2757] |b1; saved_rows: [2757] <i8; original_accept: [2757] |b1; truth: [2757] <i8 |
| `.board/pov-gui-stages/clip1-pilot20-predictions.npz` | frames: [20] <i8; truth: [20] <i8; rows: [20, 360] |u1; scores: [20, 360] <f8; base_rows: [20] <i8; base_scores: [20] <f8 |
| `.board/pov-gui-stages/clip1-predictions.npz` | frames: [6526] <i8; truth: [6526] <i8; rows: [6526, 360] |u1; scores: [6526, 360] <f8; base_rows: [6526] <i8; base_scores: [6526] <f8 |
| `.board/pov-gui-stages/clip2-predictions.npz` | frames: [3911] <i8; truth: [3911] <i8; rows: [3911, 360] |u1; scores: [3911, 360] <f8; base_rows: [3911] <i8; base_scores: [3911] <f8 |
| `.board/pov-gui-stages/quad1-predictions.npz` | frames: [237] <i8; truth: [237] <i8; rows: [237, 360] |u1; scores: [237, 360] <f8; base_rows: [237] <i8; base_scores: [237] <f8 |
| `.board/pov-gui-stages/survival1-predictions.npz` | frames: [2757] <i8; truth: [2757] <i8; rows: [2757, 360] |u1; scores: [2757, 360] <f8; base_rows: [2757] <i8; base_scores: [2757] <f8 |
| `.board/pov-gui-support/clip1-spatial-predictions.npz` | frames: [6526] <i8; rows: [6526] <i8; truth: [6526] <i8; accepted: [6526, 70] |b1 |
| `.board/pov-gui-support/clip1.npz` | frames: [6526] <i8; truth: [6526] <i8; rows: [6526] <i8; accepted: [6526, 206] |b1; base: [6526] |b1; opaque: [6526] |b1; used: [6526] <f8; hits: [6526] <f8; raw_margin: [6526] <f8; mask_margin: [6526] <f8; colour_margin: [6526] <f8; raw_evidence: [6526] <f8; visible_evidence: [6526] <f8; silhouette: [6526] <f8; never: [6526] <f8 |
| `.board/pov-gui-support/clip2-spatial-predictions.npz` | frames: [3911] <i8; rows: [3911] <i8; truth: [3911] <i8; accepted: [3911, 70] |b1 |
| `.board/pov-gui-support/clip2.npz` | frames: [3911] <i8; truth: [3911] <i8; rows: [3911] <i8; accepted: [3911, 206] |b1; base: [3911] |b1; opaque: [3911] |b1; used: [3911] <f8; hits: [3911] <f8; raw_margin: [3911] <f8; mask_margin: [3911] <f8; colour_margin: [3911] <f8; raw_evidence: [3911] <f8; visible_evidence: [3911] <f8; silhouette: [3911] <f8; never: [3911] <f8 |
| `.board/pov-gui-support/quad1-spatial-predictions.npz` | frames: [237] <i8; rows: [237] <i8; truth: [237] <i8; accepted: [237, 70] |b1 |
| `.board/pov-gui-support/quad1.npz` | frames: [237] <i8; truth: [237] <i8; rows: [237] <i8; accepted: [237, 206] |b1; base: [237] |b1; opaque: [237] |b1; used: [237] <f8; hits: [237] <f8; raw_margin: [237] <f8; mask_margin: [237] <f8; colour_margin: [237] <f8; raw_evidence: [237] <f8; visible_evidence: [237] <f8; silhouette: [237] <f8; never: [237] <f8 |
| `.board/pov-gui-support/survival1-spatial-predictions.npz` | frames: [2757] <i8; rows: [2757] <i8; truth: [2757] <i8; accepted: [2757, 70] |b1 |
| `.board/pov-gui-support/survival1.npz` | frames: [2757] <i8; truth: [2757] <i8; rows: [2757] <i8; accepted: [2757, 206] |b1; base: [2757] |b1; opaque: [2757] |b1; used: [2757] <f8; hits: [2757] <f8; raw_margin: [2757] <f8; mask_margin: [2757] <f8; colour_margin: [2757] <f8; raw_evidence: [2757] <f8; visible_evidence: [2757] <f8; silhouette: [2757] <f8; never: [2757] <f8 |
| `.board/row32-128/real.npz` | x: [3780, 128, 128, 3] |u1; y: [3780] <i8; split: [3780] <U11; video: [3780] <U10 |
| `.board/row32-128/resnet101/predictions.npz` | indices: [617] <i8; logits: [617, 32] <f4; truth: [617] <i8; calibration_indices: [157] <i8; calibration_logits: [157, 32] <f4 |
| `.board/row32-large/resnet101/orange/predictions.npz` | indices: [99] <i8; logits: [99, 32] <f4; truth: [99] <i8 |
| `.board/row32-large/resnet101/soul/predictions.npz` | indices: [115] <i8; logits: [115, 32] <f4; truth: [115] <i8 |
| `.board/row32-real/later/crops.npz` | x: [157, 64, 64, 3] |u1; y: [157] <i8 |
| `.board/row32-real/new_normal/crops.npz` | x: [120, 64, 64, 3] |u1; y: [120] <i8 |
| `.board/row32-real/ownership/crops.npz` | x: [69, 64, 64, 3] |u1; y: [69] <i8 |
| `.board/row32-real/quad1/crops.npz` | x: [617, 64, 64, 3] |u1; y: [617] <i8 |
| `.board/row32-real/real.npz` | x: [3780, 64, 64, 3] |u1; y: [3780] <i8; split: [3780] <U11; video: [3780] <U10 |
| `.board/row32-real/resnet101/historical-predictions.npz` | indices: [99] <i8; logits: [99, 32] <f4; truth: [99] <i8 |
| `.board/row32-real/resnet101/predictions.npz` | indices: [617] <i8; logits: [617, 32] <f4; truth: [617] <i8; calibration_indices: [157] <i8; calibration_logits: [157, 32] <f4 |
| `.board/row32-real/resnet18/historical-predictions.npz` | indices: [99] <i8; logits: [99, 32] <f4; truth: [99] <i8 |
| `.board/row32-real/resnet18/predictions.npz` | indices: [617] <i8; logits: [617, 32] <f4; truth: [617] <i8; calibration_indices: [157] <i8; calibration_logits: [157, 32] <f4 |
| `.board/row32-real/survival1/crops.npz` | x: [2818, 64, 64, 3] |u1; y: [2818] <i8 |
| `.board/row32-real/vit_b16/historical-predictions.npz` | indices: [99] <i8; logits: [99, 32] <f4; truth: [99] <i8 |
| `.board/row32-real/vit_b16/predictions.npz` | indices: [617] <i8; logits: [617, 32] <f4; truth: [617] <i8; calibration_indices: [157] <i8; calibration_logits: [157, 32] <f4 |
| `.board/row32/predictions-orange.npz` | indices: [99] <i8; logits: [99, 32] <f4; synthetic_logits: [99, 32] <f4; truth: [99] <i8 |
| `.board/row32/predictions-soul.npz` | indices: [115] <i8; logits: [115, 32] <f4; synthetic_logits: [115, 32] <f4; truth: [115] <i8 |
| `.board/row32/real.npz` | x: [456, 64, 64, 3] |u1; y: [456] <i8; kind: [456] <U6; split: [456] <U10 |
| `.board/row32/separate/orange-extra/predictions.npz` | indices: [99] <i8; logits: [99, 32] <f4; truth: [99] <i8 |
| `.board/row32/separate/orange/predictions.npz` | indices: [99] <i8; logits: [99, 32] <f4; truth: [99] <i8 |
| `.board/row32/separate/soul/predictions.npz` | indices: [115] <i8; logits: [115, 32] <f4; truth: [115] <i8 |

### Legacy joined feature tables (26)

| Local path | Contents / observed schema |
|---|---|
| `fire-detection/data/joined/blobs10.csv` | n, area, bw, bh, fill, compact, lum, lumstd, white, sat, rough, truth |
| `fire-detection/data/joined/blobs5_A.csv` | n, area, bw, bh, fill, compact, lum, lumstd, white, sat, rough, truth |
| `fire-detection/data/joined/blobs5_B.csv` | n, area, bw, bh, fill, compact, lum, lumstd, white, sat, rough, truth |
| `fire-detection/data/joined/blobs5_C.csv` | n, area, bw, bh, fill, compact, lum, lumstd, white, sat, rough, truth |
| `fire-detection/data/joined/blobs5_clip2.csv` | n, area, bw, bh, fill, compact, lum, lumstd, white, sat, rough, truth |
| `fire-detection/data/joined/colorfilter10.csv` | n, fire, area, mind, veil, c12_0_tot, c12_0_big, c12_1_tot, c12_1_big, c12_2_tot, c12_2_big, c24_0_tot, c24_0_big, c24_1_tot, c24_1_big, c24_2_tot, c24_2_big, c40_0_tot, c40_0_big, c40_1_tot, c40_1_big, c40_2_tot, c40_2_big |
| `fire-detection/data/joined/features10.csv` | n, fire, area, mind, veil, f0, f1, mean_luma, dark, r_cnt, r_strict, r_bright, r_blobs20, r_largest, r_inbig50, r_rough, r_roughbig, u_cnt, u_strict, u_bright, u_blobs20, u_largest, u_inbig50, u_rough, u_roughbig |
| `fire-detection/data/joined/flicker5.csv` | n, fire, area, mind, veil, gap, bg, t30_tot, t30_in6, t30_big, t60_tot, t60_in6, t60_big |
| `fire-detection/data/joined/frames3.csv` | n, fire, area, mind, veil, positives, largest, max_p |
| `fire-detection/data/joined/frames5_A.csv` | n, fire, area, mind, veil |
| `fire-detection/data/joined/frames5_B.csv` | n, fire, area, mind, veil |
| `fire-detection/data/joined/frames5_C.csv` | n, fire, area, mind, veil |
| `fire-detection/data/joined/frames5_clip2.csv` | n, fire, area, mind, veil |
| `fire-detection/data/joined/overlay5.csv` | n, has_overlay, truth_row, vis, veil, row60, z60, r60, n60, row70, z70, r70, n70, row80, z80, r80, n80, row90, z90, r90, n90, row100, z100, r100, n100, row110, z110, r110, n110 |
| `fire-detection/data/joined/overlay5_clip1_f.csv` | n, has_overlay, truth_row, vis, veil, row70, z70, r70, n70, sil_row, sil_agree, sil_pres, col_row, col_score, veiled, uv_row, uv_pres, uv_col, f60_row, f60_pres, f60_col |
| `fire-detection/data/joined/overlay5_clip1_g.csv` | n, has_overlay, truth_row, vis, veil, row70, z70, r70, n70, sil_row, sil_agree, sil_pres, col_row, col_score, veiled, uv_row, uv_pres, uv_col, f60_row, f60_pres, f60_col, fin_row, fin_fov, fin_ev, fin_pres |
| `fire-detection/data/joined/overlay5_clip1_h.csv` | n, has_overlay, truth_row, vis, veil, row70, z70, r70, n70, sil_row, sil_agree, sil_pres, col_row, col_score, veiled, uv_row, uv_pres, uv_col, f60_row, f60_pres, f60_col, fin_row, fin_fov, fin_ev, fin_pres |
| `fire-detection/data/joined/overlay5_clip1_v.csv` | n, has_overlay, truth_row, vis, veil, row70, z70, r70, n70, sil_row, sil_agree, sil_pres, col_row, col_score, veiled, uv_row, uv_pres |
| `fire-detection/data/joined/overlay5_clip2.csv` | n, has_overlay, truth_row, vis, veil, row70, z70, r70, n70, sil_row, sil_agree, sil_pres, col_row, col_score |
| `fire-detection/data/joined/overlay5_clip2_f.csv` | n, has_overlay, truth_row, vis, veil, row70, z70, r70, n70, sil_row, sil_agree, sil_pres, col_row, col_score, veiled, uv_row, uv_pres, uv_col, f60_row, f60_pres, f60_col |
| `fire-detection/data/joined/overlay5_clip2_g.csv` | n, has_overlay, truth_row, vis, veil, row70, z70, r70, n70, sil_row, sil_agree, sil_pres, col_row, col_score, veiled, uv_row, uv_pres, uv_col, f60_row, f60_pres, f60_col, fin_row, fin_fov, fin_ev, fin_pres |
| `fire-detection/data/joined/overlay5_clip2_h.csv` | n, has_overlay, truth_row, vis, veil, row70, z70, r70, n70, sil_row, sil_agree, sil_pres, col_row, col_score, veiled, uv_row, uv_pres, uv_col, f60_row, f60_pres, f60_col, fin_row, fin_fov, fin_ev, fin_pres |
| `fire-detection/data/joined/overlay5_clip2_v.csv` | n, has_overlay, truth_row, vis, veil, row70, z70, r70, n70, sil_row, sil_agree, sil_pres, col_row, col_score, veiled, uv_row, uv_pres |
| `fire-detection/data/joined/overlay5_col.csv` | n, has_overlay, truth_row, vis, veil, row70, z70, r70, n70, sil_row, sil_agree, sil_pres, col_row, col_score |
| `fire-detection/data/joined/overlay5_sil.csv` | n, has_overlay, truth_row, vis, veil, row70, z70, r70, n70, sil_row, sil_agree, sil_pres |
| `fire-detection/data/joined/patches20.csv` | n, px, py, truth, pal, strict, bright, white, dark, lum, lumstd, grad, big, sat, warm, ring |

### Manual/application project files (13)

| Local path | Contents / observed schema |
|---|---|
| `.board/blind-challenge/test/Blind test.mkv.firecrackle/jolt.json` | sampled schema only records; clock, data, session, version |
| `.board/blind-challenge/test/Blind test.mkv.firecrackle/project.json` | sampled schema only records; fingerprint, frames, index, meta, version, video_path, video_size, warnings |
| `.board/blind-challenge/test/Blind test.mkv.firecrackle/thumbs/meta.json` | sampled schema only records; fingerprint, frames, quality, stride, width |
| `.board/survival-desktop/Survival complete analysis.mkv.firecrackle/jolt.json` | sampled schema only records; clock, data, session, version |
| `.board/survival-desktop/Survival complete analysis.mkv.firecrackle/project.json` | sampled schema only records; fingerprint, frames, index, meta, version, video_path, video_size, warnings |
| `.board/survival-desktop/Survival complete analysis.mkv.firecrackle/thumbs/meta.json` | sampled schema only records; fingerprint, frames, quality, stride, width |
| `fire-detection/data/video/2026-10-15 14-48-36.mkv.firecrackle/project.json` | sampled schema only records; fingerprint, frames, index, meta, version, video_path, video_size, warnings |
| `fire-detection/data/video/2026-10-15 14-48-36.mkv.firecrackle/thumbs/meta.json` | sampled schema only records; fingerprint, frames, quality, stride, width |
| `fire-detection/data/video/2026-10-15 18-18-16.mkv.firecrackle/gui.json` | sampled schema only records; answer |
| `fire-detection/data/video/2026-10-15 18-18-16.mkv.firecrackle/project.json` | sampled schema only records; fingerprint, frames, index, meta, version, video_path, video_size, warnings |
| `fire-detection/data/video/2026-10-15 18-18-16.mkv.firecrackle/thumbs/meta.json` | sampled schema only records; fingerprint, frames, quality, stride, width |
| `fire-detection/data/video/2026-10-15 23-50-25.mkv.firecrackle/project.json` | sampled schema only records; fingerprint, frames, index, meta, version, video_path, video_size, warnings |
| `fire-detection/data/video/2026-10-15 23-50-25.mkv.firecrackle/thumbs/meta.json` | sampled schema only records; fingerprint, frames, quality, stride, width |

### Other frame records and predictions (not automatically truth) (56)

| Local path | Contents / observed schema |
|---|---|
| `.board/blind-challenge/test/Blind test.mkv.firecrackle/labels.jsonl` | sampled schema only records; frame, label, version |
| `.board/image-presence/continuation/full-clip2/gates.jsonl` | sampled schema only records; cnn, cnn_candidate, common_blocked, fire, frame, gui, material, orange_area, purple, raw_fire, retention, rules, score, share, thumbnail, union, unveiled, views_sha256 |
| `.board/image-presence/continuation/full-clip2/scores.jsonl` | sampled schema only records; cnn, cnn_candidate, fire, frame, orange_area, raw_fire, rules, score, share, union, unveiled, views_sha256 |
| `.board/no-fire-deploy/native-full-portable.jsonl` | sampled schema only records; clear, frame |
| `.board/no-fire-deploy/native-prepared-2.jsonl` | sampled schema only records; clear, frame |
| `.board/no-fire-deploy/native-sampled.jsonl` | sampled schema only records; clear, frame |
| `.board/no-fire-deploy/native-workers-1.jsonl` | sampled schema only records; clear, frame |
| `.board/no-fire-deploy/native-workers-2.jsonl` | sampled schema only records; clear, frame |
| `.board/no-fire-width24/clip1-targets.jsonl` | sampled schema only records; clear_positive, frame, native_boxes, raw_fire, source, target |
| `.board/no-fire-width24/clip2-targets.jsonl` | sampled schema only records; clear_positive, frame, native_boxes, raw_fire, source, target |
| `.board/no-fire-width24/quad1-targets.jsonl` | sampled schema only records; clear_positive, frame, native_boxes, raw_fire, source, target |
| `.board/no-fire-width24/survival1-targets.jsonl` | sampled schema only records; clear_positive, frame, native_boxes, raw_fire, source, target |
| `.board/pov-dual-veil-v2/clip1.jsonl` | sampled schema only records; auto, gui_ms, modes, n, screen_hits, screen_modes, screen_ms, screen_pixels, share, threshold, veil_ms |
| `.board/pov-dual-veil-v2/clip2.jsonl` | sampled schema only records; auto, gui_ms, modes, n, screen_hits, screen_modes, screen_ms, screen_pixels, share, threshold, veil_ms |
| `.board/pov-dual-veil-v2/miss-screen-pilot.jsonl` | sampled schema only records; auto, gui_reliable, index, modes, screen_hits, screen_pixels |
| `.board/pov-dual-veil-v2/quad1.jsonl` | sampled schema only records; auto, gui_ms, modes, n, screen_hits, screen_modes, screen_ms, screen_pixels, share, threshold, veil_ms |
| `.board/pov-dual-veil-v2/survival1.jsonl` | sampled schema only records; auto, gui_ms, modes, n, screen_hits, screen_modes, screen_ms, screen_pixels, share, threshold, veil_ms |
| `.board/pov-dual-veil/clip1-incomplete-opaque-items-control.jsonl` | sampled schema only records; auto, gui_ms, modes, n, share, veil_ms |
| `.board/pov-dual-veil/clip1-pilot20.jsonl` | sampled schema only records; auto, gui_ms, modes, n, share, veil_ms |
| `.board/pov-dual-veil/clip1.jsonl` | sampled schema only records; auto, gui_ms, modes, n, screen_hits, screen_modes, screen_ms, screen_pixels, share, threshold, veil_ms |
| `.board/pov-dual-veil/clip2.jsonl` | sampled schema only records; auto, gui_ms, modes, n, screen_hits, screen_modes, screen_ms, screen_pixels, share, threshold, veil_ms |
| `.board/pov-dual-veil/quad1.jsonl` | sampled schema only records; auto, gui_ms, modes, n, screen_hits, screen_modes, screen_ms, screen_pixels, share, threshold, veil_ms |
| `.board/pov-dual-veil/survival1.jsonl` | sampled schema only records; auto, gui_ms, modes, n, screen_hits, screen_modes, screen_ms, screen_pixels, share, threshold, veil_ms |
| `.board/pov-gui-integrated/clip1-spatial.jsonl` | sampled schema only records; fractions, n, reliable, stats, veiled |
| `.board/pov-gui-integrated/clip2-spatial.jsonl` | sampled schema only records; fractions, n, reliable, stats, veiled |
| `.board/pov-gui-integrated/survival1-spatial.jsonl` | sampled schema only records; fractions, n, reliable, stats, veiled |
| `.board/pov-gui-misses/counterfactual.jsonl` | sampled schema only records; auto, gui_reliable, index, modes, screen_pixels |
| `.board/pov-gui-misses/screen-counterfactual.jsonl` | sampled schema only records; auto, gui_reliable, index, modes, screen_pixels |
| `.board/pov-gui-stages/clip1-pilot20.jsonl` | sampled schema only records; fractions, n, reliable, stats, veiled |
| `.board/pov-gui-stages/clip1.jsonl` | sampled schema only records; fractions, n, reliable, stats, veiled |
| `.board/pov-gui-stages/clip2.jsonl` | sampled schema only records; fractions, n, reliable, stats, veiled |
| `.board/pov-gui-stages/quad1.jsonl` | sampled schema only records; fractions, n, reliable, stats, veiled |
| `.board/pov-gui-stages/survival1.jsonl` | sampled schema only records; fractions, n, reliable, stats, veiled |
| `.board/pov-gui-support/clip1-spatial.jsonl` | sampled schema only records; fractions, n, reliable, stats, veiled |
| `.board/pov-gui-support/clip2-spatial.jsonl` | sampled schema only records; fractions, n, reliable, stats, veiled |
| `.board/pov-gui-support/survival1-spatial.jsonl` | sampled schema only records; fractions, n, reliable, stats, veiled |
| `.board/pov-independent-20261018/early.predictions.jsonl` | sampled schema only records; auto, gui_ms, modes, n, screen_hits, screen_modes, screen_ms, screen_pixels, share, threshold, veil_ms |
| `.board/pov-independent-20261018/later.predictions.jsonl` | sampled schema only records; auto, gui_ms, modes, n, screen_hits, screen_modes, screen_ms, screen_pixels, share, threshold, veil_ms |
| `.board/pov-independent-20261018/shipped-parity-all.jsonl` | sampled schema only records; candidate_row, detected, evidence, fov, n, row, veiled |
| `.board/pov-independent-20261018/shipped-parity.jsonl` | sampled schema only records; candidate_row, detected, evidence, fov, n, row, veiled |
| `.board/pov-integration/final-lint/later.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/final-v1/clip1.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/final-v1/clip2.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/final-v1/early.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/final-v1/later.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/final-v1/quad1.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/final-v1/survival1.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/later-full-new.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/later-full-old.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/later-gui-profile.jsonl` | sampled schema only records; fit_ms, n, pieces_ms, reliable, text_ms |
| `.board/pov-integration/later-new-cached.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/later-new-initial.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/later-new-planned.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/pov-integration/later-old.jsonl` | sampled schema only records; dual, gui, ms, n, row |
| `.board/survival-desktop/Survival complete analysis.mkv.firecrackle/labels.jsonl` | sampled schema only records; frame, label, version |
| `fire-detection/data/video/2026-10-15 18-18-16.mkv.firecrackle/labels.jsonl` | sampled schema only records; frame, label, predicted, version |

### Standalone NPY arrays (grouped by directory and schema)

Exact individual file paths and headers are in the JSON inventory. These include raw crop caches, reference sprites and predictions; grouping does not imply all are training examples.

| Directory | Files | Shape / dtype |
|---|---:|---|
| `.board/fire-color-support` | 4 | {"shape":[32768],"dtype":"\|b1","fortran_order":false} |
| `.board/image-presence/run1/cache` | 111 | {"shape":[18,224,224,3],"dtype":"\|u1","fortran_order":false} |
| `.board/image-presence/run1/cache` | 1468 | {"shape":[9,224,224,3],"dtype":"\|u1","fortran_order":false} |
| `.board/image-presence/run2/cache` | 187 | {"shape":[1,224,224,3],"dtype":"\|u1","fortran_order":false} |
| `.board/image-presence/run2/cache` | 377 | {"shape":[1,4,224,224,3],"dtype":"\|u1","fortran_order":false} |
| `.board/image-presence/run2/cache` | 5 | {"shape":[2,224,224,3],"dtype":"\|u1","fortran_order":false} |
| `.board/image-presence/run2/cache` | 45 | {"shape":[2,4,224,224,3],"dtype":"\|u1","fortran_order":false} |
| `.board/image-presence/run2/cache` | 81 | {"shape":[40,224,224,3],"dtype":"\|u1","fortran_order":false} |
| `.board/image-presence/run2/cache` | 2 | {"shape":[80,224,224,3],"dtype":"\|u1","fortran_order":false} |
| `.board/no-fire-pilot` | 5 | {"shape":[1088],"dtype":"<f8","fortran_order":false} |
| `.board/no-fire-pilot` | 5 | {"shape":[237],"dtype":"<f8","fortran_order":false} |
| `.board/no-fire-pilot` | 5 | {"shape":[2757],"dtype":"<f8","fortran_order":false} |
| `.board/no-fire-pilot` | 5 | {"shape":[652],"dtype":"<f8","fortran_order":false} |
| `.board/row32` | 1 | {"shape":[4,32,16,16,4],"dtype":"\|u1","fortran_order":false} |
| `fire-detection/data/debug` | 1 | {"shape":[5084961,3],"dtype":"<f8","fortran_order":false} |
| `fire-detection/data/debug` | 1 | {"shape":[5084961,3],"dtype":"<i8","fortran_order":false} |
| `fire-detection/data/debug` | 1 | {"shape":[7416780,3],"dtype":"<i8","fortran_order":false} |

### Videos outside the original-recording folder

Derived clips, fixtures and copies are not additional independent recordings. Group them with their source; if provenance is unresolved, audit it before admitting the video as an independent source.

- `.board/blind-challenge/test/Blind test.mkv`
- `.board/fire-ai/codec/h264-crf24.mp4`
- `.board/fire-ai/codec/h264-crf32.mp4`
- `.board/fire-size-gallery/controlled-0.5-crf18.mkv`
- `.board/fire-size-gallery/controlled-0.5-crf28.mkv`
- `.board/fire-size-gallery/controlled-0.5-crf38.mkv`
- `.board/fire-size-gallery/controlled-0.75-crf18.mkv`
- `.board/fire-size-gallery/controlled-0.75-crf28.mkv`
- `.board/fire-size-gallery/controlled-0.75-crf38.mkv`
- `.board/fire-size-gallery/controlled-1-crf18.mkv`
- `.board/fire-size-gallery/controlled-1-crf28.mkv`
- `.board/fire-size-gallery/controlled-1-crf38.mkv`
- `.board/fire-size-gallery/controlled-1.5-crf18.mkv`
- `.board/fire-size-gallery/controlled-1.5-crf28.mkv`
- `.board/fire-size-gallery/controlled-1.5-crf38.mkv`
- `.board/fire-size-gallery/controlled-2-crf18.mkv`
- `.board/fire-size-gallery/controlled-2-crf28.mkv`
- `.board/fire-size-gallery/controlled-2-crf38.mkv`
- `.board/fire-size-gallery/controlled-3-crf18.mkv`
- `.board/fire-size-gallery/controlled-3-crf28.mkv`
- `.board/fire-size-gallery/controlled-3-crf38.mkv`
- `.board/no-fire-parallel/desktop-scan.mkv`
- `.board/survival-desktop/Survival complete analysis.mkv`
- `FireCrackle/src-tauri/target/pov-smoke.mkv`

### Inspection errors

Errors must be resolved or explicitly excluded before training.

- None.
