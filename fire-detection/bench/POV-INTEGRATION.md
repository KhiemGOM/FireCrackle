# First-person Auto integration for 0.3.0

The GUI-aware first-person matcher is now shared production Rust code in `core/src/pov.rs`. The desktop scan calls this same implementation. All **15,964 sampled decisions** match the frozen expanded research policy exactly, including abstentions and negatives. It accepts **1,839 / 1,862 first-person-fire samples (98.8%)**, with **0 wrong accepted rows** and **0 false positives / 14,102 non-overlay samples**.

These are first-person sprite labels, not No-fire classifications. An abstention does not mean no fire. The four development recordings and two separate recordings are pooled only by frame counts; the latter had appeared in other preprocessing research. They share a local setup and have correlated frames. See [the separate-recording protocol](POV-INDEPENDENT-VALIDATION.md) for limits and the pre-integration baseline. No future zero-error guarantee is inferred.

## Frozen acceptance policy

- Choose 70/60-degree FOV from raw colour evidence, with ties choosing 70. Keep the candidate row chosen from the raw combined colour/silhouette ranking.
- Use the sole canonical automatic veil detector and inverse in `veil.rs`. Try the opposite veil hypothesis only within 0.03 of the detector's share threshold. No second inverse or GUI-specific veil detector exists.
- For each hypothesis accept raw evidence or opaque-excluded evidence at 0.5. Broad GUI-neutral evidence additionally needs a combined-score margin of 0.5 and support spanning at least two horizontal bins. Excluded pixels enter neither the matching nor mismatching probe counts.
- Mask confirmed screen panels as well as HUD pieces. Preserve conservative fitting and unreliable-GUI fallback to raw evidence.
- Select the eligible branch with the strongest evidence; automatic veil wins exact ties. No recorded row, clock, previous frame, future frame or temporal interpolation enters inference.

## Exact optimizations

`GuiDetector` prepares immutable templates and coarse search geometry once per frame size. HUD shape templates are cached by dimensions and layers, independently of screen position. Lazy luminance rows avoid repeatedly converting the same frame pixels. The current frame still supplies every fit and correlation score; these caches never reuse previous-frame detections.

Reference sums and bounds are reused only for fully in-frame, unit-step correlations. Clipped correlations retain the original path. A unit test compares the optimized and compiled coarse correlations bit-for-bit against the dense formula, including clipped and stepped controls.

Raw diagnostics omit unused spatial bins; broad diagnostics collect spatial support only for the selected candidate. Only the FOV selected from raw evidence runs the mask stages. An already-accepted sole viable row needs no GUI work. A masked subset cannot create matching probes: at least five retained probes with evidence at least 0.5 require at least four original hits. Branches below that necessary bound cannot qualify and skip the GUI. A sole viable branch accepted by the opaque mask can skip broad scoring. These shortcuts preserve the frozen output row, not necessarily unused diagnostic values.

The scan uses at most four inference workers and bounds decoder threads. Cancellation and save behavior remain in the desktop scan layer. GUI preparation is reusable across workers and synchronized; per-frame masks remain separate.

## Production parity

`pov_scan` calls the actual production `PovMatcher`, using the same asset set as `studio_core::gui::pov_textures()`. `pov_integration.py` verifies video, source, asset, executable, frozen-reference and output hashes before reusing a capture. Parallel output is checked by unique frame index, not completion order. Frozen research caches are not overwritten.

| Recording | Scored samples | Correct / fire samples | False positives / non-overlay | Decision differences |
|---|---:|---:|---:|---:|
| clip1 | 6,526 | 193 / 194 | 0 / 6,332 | 0 |
| clip2 | 3,911 | 922 / 932 | 0 / 2,979 | 0 |
| quad1 | 237 | 3 / 3 | 0 / 234 | 0 |
| survival1 | 2,757 | 378 / 384 | 0 / 2,373 | 0 |
| early, separate | 1,880 | 5 / 5 | 0 / 1,875 | 0 |
| later, separate | 653 | 338 / 344 | 0 / 309 | 0 |
| Total | **15,964** | **1,839 / 1,862** | **0 / 14,102** | **0** |

All 1,839 accepted rows are correct. The 23 remaining positive samples abstain. The pre-integration raw/automatic-veil baseline accepts 1,676 / 1,862 (90.0%), also with zero observed accepted errors on this sample set.

## Runtime

The later recording's identical 653 sampled frames, four workers: the initial integrated implementation took 22.03 s, coarse geometry caching 19.86 s, HUD shape caching 13.58 s, and the final implementation 10.94 s. These are successive local measurements, not a hardware-independent speed guarantee. The old raw-only method measured 7.28 s on that sampled workload: the stronger GUI-aware method still costs more. The six-video parity captures ran with overlapping validation workloads, so their elapsed times are not used as controlled throughput measurements.

Full-rate paired run on all 3,263 frames of the later 1920×1080/60 fps recording, four workers, old then new, with other CPU scans/builds paused:

| Method | Scan time | Throughput | Correct / fire frames | Wrong rows | False positives / non-overlay |
|---|---:|---:|---:|---:|---:|
| Old raw/automatic veil | 12.78 s | 255 fps | 1,379 / 1,716 (80.4%) | 0 | 0 / 1,547 |
| New GUI-aware | 64.85 s | 50 fps | 1,692 / 1,716 (98.6%) | 0 | 0 / 1,547 |

Setup adds 31.8 ms old / 61.8 ms new. This is one local end-to-end decode/inference run per method, not an isolated kernel benchmark or repeated confidence interval. The new method is about 5.1 times slower on this full-rate workload despite the optimizations; the higher coverage comes with substantial GUI-fitting cost. The 653-frame sampled subset exactly matches the final frozen capture. Full-rate quality results are separate from the sampled totals above: overlapping frames are not counted twice. Local truth, output and source hashes are saved in `.board/pov-integration/later-full-report.json`.

## Build and reproduction

Run the normal frontend `npm run build`, `npm test` or `npm run dev` prerequisite before a clean direct backend build. `scripts/build-veil.mjs` prepares the ignored recipe-book RGBA texture as well as the existing portal asset and WASM. The build extracts the vanilla texture from the locally available or SHA-1-verified official client JAR; it does not ship the JAR. No game assets, native binaries, videos or prediction caches are committed.

Build `cargo build --release --manifest-path fire-detection/core/Cargo.toml --example pov_scan`, then run `python fire-detection/bench/pov_integration.py --tag NEW_TAG`. The six-recording frozen local capture is `.board/pov-integration/final-v1`, measured before the final mechanical lint cleanup. Its executable is preserved as `.board/pov-integration/pov-scan-prelint.exe`; reuse requires the matching native executable and source/asset signature, rather than silently accepting the current build. Metadata stores all source/asset hashes and exact strides/counts. The historical separate-recording scripts retain their original method names for reproducibility.

Six-recording and full-rate benchmark native SHA-256: `c7227845fea218b224b0ec2efeaaa9472089b9435ab2d612999d4afdbd3f5708`. Analysis SHA-256: `f3040d7acee41164edc5a25c67625e6e9edf0a8c1b35ce5f0013fe53a0437cee`. Per-source metadata records all individual source and asset hashes.

The final CI lint pass moved the test module, removed redundant references, replaced equivalent range/Option expressions, and annotated explicit-geometry helper signatures and partial test-only module inclusion. It changed no thresholds, masks, score arithmetic or veil implementation. All 140 targeted core tests were rerun, including the exact correlation test and five portal tests; all pass. The rebuilt native SHA-256 is `9bc4dc68985584bef7f79a26bf1afe7b1c277ebbcaa56254412b7ab7bc8f5e1e`. A fresh `.board/pov-integration/final-lint` capture of all 653 later-video samples again has **zero differences** from the frozen research policy, with 338 / 344 correct rows and zero false positives / 309. The full six-recording and full-rate tables above retain their original measured executable provenance; they are not falsely presented as fresh captures from the lint-cleaned executable.

Targeted validation: 134 core integration tests across GUI, text, screen, first-person, silhouette and veil paths; one exact correlation unit test; 50 POV Python tests; 11 studio-core GUI tests; six asset decoder/transport tests; six Auto UI tests. The desktop integration agent additionally reports six passing `pov::tests` (one external fixture ignored) including cancellation/progress/stale-save controls, and two passing no-fire scan tests (two external fixtures ignored). No veil constants or inverse math changed.
