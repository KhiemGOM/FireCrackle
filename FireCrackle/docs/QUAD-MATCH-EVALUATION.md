# Quad matching: awaiting actual quad data

2026-10-16. User stopped tuning on the old bounding-box dataset. No further fitting or threshold selection will use that dataset.

The old `clip1.jsonl` / `clip2.jsonl` labels contain visible, axis-aligned boxes grouped by sheet/mirror. A box can surround several overlapping faces, a cropped texture or both. It is not the full projected texture quad used by the app. Expanding a candidate by its opaque alpha hull does not recover that missing geometry. The experiment below is an archived bbox-adapter diagnostic, **not an accuracy evaluation of the manual-quad matcher**.

| Input | Search | Parts | Exact top guess | “clear” guesses | Exact among “clear” |
|---|---|---:|---:|---:|---:|
| Clip 1 | Uniform scale | 1167 | 56 | 36 | 13 |
| Clip 1 | Independent width/height | 1167 | 49 | 34 | 12 |
| Clip 2 | Uniform scale | 257 | 15 | 2 | 2 |
| Clip 2 | Independent width/height | 257 | 10 | 2 | 2 |

Counts are strict sheet + row + mirror matches. “clear” is the existing, uncalibrated score gate, not a reliability claim. Multiple parts in a frame are correlated. There are no no-fire oracle boxes here, so these counts do not measure presence false positives. All sampled frames were taken at decoded indices divisible by 300, at native 1920×1080 without resizing or recompression. Label coordinates were scaled from framebuffer dimensions. Truth row/sheet/mirror were used after prediction only; candidate expansion used each candidate's own alpha hull.

The independent 80%/100%/120% width/height search implements the requested rough-proportion tolerance. Its factors were not fitted to these bbox results. Colour mask constants come from the prior palette/chromaticity work; the additive vote rule keeps unknown/mismatching samples neutral. No bbox-derived tuning has been applied. The app says “Colour guess” and still requires separate confirmation.

Archived predictions: `quad-match-evaluation.csv` (2848 rows: two search modes over the same 1424 labelled parts). Native crop caches and detailed outputs remain ignored under `src-tauri/target/quad-eval-clip1` and `quad-eval-clip2`. The scripts in `scripts/` reproduce this **bbox diagnostic only**; they are not the evaluator for the upcoming quad dataset.

Input SHA-256:

- clip1 joined labels: `062d69d4b2a4a774fc37517f936fc17402e18ad3e6372a769f55c6d272e92640`
- clip2 joined labels: `12806d99dd66b4a293b9e0e7379446bce0ad955613a472410245a985ea993af3`
- evaluated matcher: `66e01757244535ced419ed5d58d67c4871c2e81d495daf735c17690745b5a97e`

## Next recording

The recorder's v4 schema already supported per-quad labels, but `FireLabeler` did not pass them into the log. It now does for blocks, entities and first-person overlay, using the same geometry evaluated for visibility. Each visible quad records full projected corners (including off-screen coordinates), vertex UVs, sheet/row/mirror, visibility and veil. Behind-camera corners produce `c:null`; no invented coordinates are written. Existing grouped boxes remain available.

Recording JAR: `../fire-detection/mod/build/libs/firelabel-0.1.0.jar`. Build and all 205 Java tests pass, including projection-to-log tests. This has not been verified by launching Minecraft. The collection job must first inspect a short real recording/log for nonempty `fires[].quads`, then collect the actual dataset. Include isolated fires, varied proportions/distance, partial occlusion, edge-of-frame cases and first-person overlay. Keep the sync strip and full viewport visible; disable the debug boxes. Save the video and matching raw JSONL together.

Further fitting and empirical accuracy claims wait for those actual per-quad labels.
