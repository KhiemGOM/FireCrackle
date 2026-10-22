# Actual quad evaluation and bounded fitting

2026-10-16. The app now optimizes position, independent corners and perspective separately for every eligible sprite. It uses bounded Nelder–Mead rather than the old shared size/offset grid. The search envelope is 120% of the original quad, centred in its own projective plane (unit coordinates -0.1 through 1.1). Folded quads are rejected. This is a finite-budget local optimization, not a guaranteed global maximum.

**Adjust quad defaults on**, as requested. The saved off setting keeps corners fixed. Atlas filters are applied before matching. A worker runs fitting without blocking the interface; stale frames/options and cancellation are guarded. Results remain preview candidates; Confirm/Enter alone saves labels. Persistence integration is shared with the interface preferences work.

All eligible appearances receive a coarse fit; the strongest six receive finer fitting. Fine evidence uses four probes per texture cell. Repeated probes of the same native pixel have capped weight so shrinking onto a bright speck cannot invent independent evidence. Unknown and mismatching samples add zero; there are no negative votes. The initial outline's fine score is retained if a proposed fit is worse.

## Real recording and protocol

Video: `../fire-detection/data/video/2026-10-16 00-40-22.mkv`. Joined truth: `../fire-detection/data/joined/quad1.jsonl`, SHA-256 `c3a39b59346ae4030e45099ebabd1bfc9d2b4e8a722341e5ca881ae8999147a0`. Video frames remain native 1920×1080 RGB; framebuffer coordinates are normalized using each label's dimensions. The matcher receives full quad corners, not grouped bounding boxes. Row/sheet/mirror truth is used after prediction only, with no clock or truth-based sprite filtering.

Before inspecting scores, the split was fixed to tuning frames `n < 4136`, a 240-frame gap, and validation `n >= 4376`. Every 60th decoded frame was sampled. The usable corpus has 1128 quads: 818 tuning and 310 validation, with no fire quads in the gap. Tests exclude missing/behind-camera corners, back faces, area below 30 framebuffer pixels², wholly off-screen quads, and extreme projections beyond 16 viewport dimensions. Corners are never clamped. UVs anchor the clockwise corner cycle to the texture's top edge, preserving rotated surfaces without using mirror truth to order corners.

An initial ordering check sorted edge endpoints by screen x. Its correction admitted 45 additional rotated quads (42 tuning, 3 validation); all earlier corner arrays stayed identical. The original 307 validation predictions were reused unchanged and the three additional cases were evaluated separately. Scoring and optimizer parameters were frozen before validation; none was retuned afterward. The late segment has 129 block and 181 entity quads, **no first-person overlay quads**. Thus this run does not establish first-person HUD accuracy or independent-recording generalization.

## Exact supplied outlines: validation

Correct means exact sheet + row + mirror. “Pass gate” is the existing uncalibrated score/support/margin rule, not a probability or proven confidence. Wrong passes are kept in the table.

| Method | Quads | Correct first | Correct top 3 | Pass gate | Wrong passes |
|---|---:|---:|---:|---:|---:|
| Previous sampler, fixed corners | 310 | 79 | 95 | 65 | 20 |
| Four-probe sampler, fixed corners | 310 | 78 | 94 | 63 | 20 |
| Previous size/offset grid | 310 | 70 | 83 | 57 | 19 |
| New per-sprite corner optimizer | 310 | 66 | 83 | 66 | 33 |

The optimizer increases its objective, but **does not improve exact identification on accurate outlines**. Extra geometric freedom can overfit another visible fire face. The score gate is not reliable enough for automatic labels. Of the 181 entity quads, the new fixed-corner method passed 42, all correct; optimization passed 39, of which 32 were correct. These correlated samples and abstentions do not establish a zero error rate.

Camera-facing labels may still describe a plane covered by another fire plane. Existing visibility checks handle world/entity/GUI occluders but do not resolve every fire-over-fire overlap. Visual inspection of tuning frame 300 showed a labelled fire_0 plane with a fire_1 face drawn across it. This is a known interpretation limitation, **not an excuse to remove the recorded errors**. No absence/negative-region dataset was evaluated, so presence false-positive rates are unknown.

## Deliberately rough outlines: paired validation subset

The 39 case IDs were fixed as every eighth member of the original validation list. Their real video pixels were unchanged. Width was perturbed to 112%, height to 92%, centre shifted by 3%/-2%, and two corners perturbed independently. Neither method receives the original corners during fitting.

| Method | Quads | Correct first | Correct top 3 | Pass gate | Wrong passes |
|---|---:|---:|---:|---:|---:|
| Previous grid | 39 | 6 | 9 | 6 | 4 |
| New optimizer | 39 | 9 | 11 | 8 | 4 |

The new evidence score improved in 35/39 and never decreased from the unadjusted rough outline. Exact matching improved on this small subset, but 30/39 first guesses were still wrong. Fitting the outline and identifying the sprite remain separate problems. Unfiltered fitting took approximately one second per quad on this machine; the worker keeps the UI responsive. Timing is not a realtime detector claim.

## Evidence and reproduction

`actual-quad-results.csv` records all paired validation predictions, original corners, ground truth, scores, status and errors. Native frames, manifests and detailed experimental outputs are ignored under `src-tauri/target/actual-quad1`. Baseline source is commit `b6811ea`; tested matcher SHA-256 `cdbdc4a60fd84ad00e9cbe38ef33d72217db56e8447c2f3c5267c3edaa92d686`, optimizer `88eca09b568e621baac3f713e5a4ba9df8c163fc2f87b96fac7b9f9dc13d3be5`.

From `FireCrackle`, prepare with Python `scripts/prepare-actual-quad-eval.py VIDEO JOINED OUT --ffmpeg PATH --stride 60`. Evaluate with `node scripts/actual-quad-eval.mjs OUT validation TAG MODE EVERY`, where MODE is `fixed`, `refine` or `rough`. Use `--source-ref b6811ea` to compile the old matcher from Git; `--only-ids` accepts a comma-separated list from the CSV to reproduce the exact rough subset. No extra compression is applied. Rarity-weighted and neighbouring-patch scoring experiments were rejected on the tuning segment and are not in the app.

Projection/normalization tests cover off-screen corners, winding, mirror-independent geometry, rotated axes, extreme projection and missing/nonfinite input. App tests cover the optimizer bounds, independent corner fitting, nondecreasing evidence, native-pixel vote limits, filters, default-on/off behavior and worker cancellation/stale frames. Typechecking and the standalone Tauri build pass. The desktop app has not been launched for UI verification.
