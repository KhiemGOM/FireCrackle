# Remaining GUI-mask techniques: fixed protocol

2026-10-18. Test the four owner-requested techniques separately and together. Reused four-clip development cohort; no production/default promotion from these results.

1. **Compression edges:** square/Chebyshev expansion radii0,2,4,8 native video pixels. Prefix-sum mask queries provide exact clipped boxes, not guessed rectangles.
2. **Uncertain GUI:** known opaque GUI and unknown item/crosshair/effect interiors always have weight0. Translucent GUI reliability weights0,0.25,0.5,1. The reliability at a probe is the minimum within the expansion box. Excluded pixels never become negative evidence; surviving weights normalize the numerator and denominator together.
3. **Texture cells:** compare probe pooling with equal visible texture-cell pooling. Geometry follows canonical Minecraft overlay planes and draw order; cell key is plane+16x16 texel. Average signed colour matches within each visible cell, then average visible cells equally. Missing cells are omitted. This is inferred template ownership, not oracle observed-pixel ownership. Compare standardized weighted sums versus standardized normalized means for ranking; original versus weighted silhouette; original versus visible-score FOV choice.16 masks×2 pooling×2 ranking×2 silhouette×2 FOV =256 proposal methods. Acceptance threshold0.5 stays fixed. At least5 usable probes and weight mass5; cell mode also needs at least5 visible cells. Compare no extra gate, margin>=0.5, and margin>=0.5+horizontal spread>=2. Preserve original and opaque-only decisions and their original row.
4. **Temporal integration:** prediction-only20Hz modulo32 agreement, tolerances1 or2 ticks; require one neighbor or both sides within0.75seconds. Compare no temporal gate, one-neighbor/tolerance1, both-sides/tolerance1, one-neighbor/tolerance2. Keep original/opaque-only acceptances protected. Cut signals use32x18 raw RGB area-mean thumbnails (mean absolute normalized difference thresholds0.15/0.30) and timestamp gaps>0.75seconds. These are fallible shot-change signals, not guaranteed cut detection. Mod ticks and fire truth are evaluation-only. No temporal filling below the fixed per-frame acceptance threshold in this round.

Extract the full sampled cohort, not just earlier candidate frames: expansion and cell weighting can create previously unseen proposals. Canonical probe hits/warmth and per-row geometry come from Rust; Python only combines these observations. Capture all radius categories once, plus scene thumbnails. Verify raw and radius0 hard masks reproduce canonical cached outputs before interpreting new results. Native source, executable, texture assets, video identity and joined truth hashes tie caches to inference versions.

For temporal controls, introduce deterministic contiguous-timestamp splices at30% and65% of each sampled sequence, moving to source positions55% and10% respectively. Record the authored cut positions only for evaluation; the algorithm sees thumbnails/timestamps. Measure boundary detections, cross-boundary support and classification errors. Never treat the authored boundary list as detected cuts. Also test clean temporal resets and modulo wrap with unit controls.

Report per-technique fixed controls, pooled/per-clip correct acceptance, presence false positives, wrong rows, retained/lost baseline matches and three-recording selection/excluded-recording evaluation. Some combinations will duplicate predictions. Do not refine these finite grids after results. New recording validation remains separate and necessary.

## Completed primary results

Captured and evaluated all13,431 sampled frames:1,513 first-person overlays and11,918 negatives.256 proposal methods×3 confidence gates×2 shot thresholds×4 temporal modes =6,144 configurations, producing127 distinct accepted-label outputs. Configurations and adjacent frames are correlated development comparisons.

| Primary method / best observed family | Correct /1,513 | False positives | Wrong accepted rows |
|---|---:|---:|---:|
| Original | 1,396 | 0 | 0 |
| Previous opaque-only normalized acceptance | 1,442 | 0 | 0 |
| Previous frozen spread+margin rule | 1,483 | 0 | 0 |
| Best primary combination | 1,483 | 0 | 0 |
| Best texture-cell pooling combination with zero observed errors | 1,479 | 0 | 0 |
| Best one-neighbor temporal combination with zero observed errors | 1,483 | 0 | 0 |
| Best two-sided temporal combination with zero observed errors | 1,477 | 0 | 0 |

The primary selected configuration is radius0, translucent weight0, probe pooling, standardized sum ranking, weighted silhouette, original FOV and margin>=0.5+horizontal spread. It gives192/194,917/932,3/3,371/384 correct per clip. It ties the previous frozen result; it does not improve recall. All original and opaque-only labels are protected, so no originally correct result is lost.

### Matched controls

Change only the indicated field of the selected primary configuration:

| Changed field | Correct | False positives |
|---|---:|---:|
| Radius0 | 1,483 | 0 |
| Radius2 | 1,483 | 1 |
| Radius4 | 1,483 | 1 |
| Radius8 | 1,483 | 1 |
| Translucent weight0.25,0.5 or1 | 1,483 | 0 each |
| Cell pooling instead of probe pooling | 1,477 | 1 |

Other expanded-mask settings can reach1,483/0 when paired with different ranking and temporal rules, but none beats radius0. Partial translucent weights do not improve this matched control. Equal texture-cell weighting removes projected-area bias but does not improve accuracy on this grid; the strongest zero-error cell combination gives1,479. These are measured results on these recordings, not proof that every boundary or uncertainty model fails. Soft weights here apply to translucent GUI; unknown item interiors remain zero-weight throughout.

The primary one-neighbor normalized-ranking variant reaches the same pooled1,483 on a different set of frames. Three-recording selection yields191/0,917/0,3/0,369/0 correct/false-positive on the excluded clips:1,480 correct,0 false positives,0 wrong rows. This removes the earlier transfer-check false positive but sacrifices recall. All clips were inspected in earlier research; this is not independent validation.

## Secondary post-hoc anchor union

After observing complementary primary predictions, test a separate union: retain every acceptance and row from the **previous frozen spread+margin rule**, then allow extra acceptances from each declared new configuration. The anchor takes row priority if both accept. This was added after primary results, so it is explicitly post-hoc and is not part of the predeclared primary result.

The best observed union gives **1,486/1,513 correct,0 false positives,0 wrong rows,90 recoveries and0 losses versus the original**. Its extra branch uses radius0, translucent weight0, probe pooling, normalized mean ranking, original silhouette, visible-score FOV and one-neighbor agreement within1tick. The shot threshold is0.15. The per-clip counts are192/194,920/932,3/3,371/384.

The three extra correct frames are all in clip2:9745(row12),14350(row13),15025(row13). These are separated observations from one recording, not new independent recordings. Native and NumPy implementations agree across all256 proposal methods on these actual fire frames at1e-10, as well as on synthetic weighted-cell controls.

Three-recording union selection evaluates at192/0,917/0,3/0,371/0 on the excluded recordings: **1,483 correct and0 errors**, tying the old anchor. When clip2 is excluded, its3 additional recoveries do not transfer through rule selection. The anchor itself was developed on these reused clips; this is an exploratory transfer check with a frozen development anchor, not a fresh holdout. No automatic app behavior changed.

## Cut and lag limitations

The timestamp-based temporal model assumes20Hz relative progression; it does not have a recovered Jolt clock. Held animation and video/game lag can therefore reject otherwise correct additional matches. True mod ticks are never prediction inputs.

Temporal-assisted labels are also not independent evidence for a phase/lag analysis: accepting a row partly because its timing looks expected can select against genuine timing anomalies. Any future integration must retain this provenance and avoid treating these additions as independently verified phase evidence. This experiment does not add them to the app.

Eight authored boundaries were inserted across the four sequences. The0.15 thumbnail threshold detects **2/8**, both in survival;0.30 detects **1/8**. The corresponding total shot-change signals are249 and43. These signals are not verified cuts, so no real-cut precision claim is possible. Many cuts between similar-looking scenes are missed.

On the fixed masked control, the loose2tick temporal variant has2 possible matching support links across an undetected clip2 boundary. There are no observed classification errors in these particular spliced controls, but that does not establish that crossing an undetected cut is safe. Strict1tick support has0 such links in these controls; this is still a small reused test. Detected boundaries are always respected by construction and by tests. Temporal gating also loses several correct recoveries in the spliced sequences.

Consequently, a robust cut/continuity source remains unresolved. Do not promote the thumbnail threshold to a guaranteed cut detector, do not feed authored boundaries into inference, and do not enable the post-hoc union as an automatic rule from these results alone.

## Reproduction, provenance and checks

- Build the release `pov_gui_probes` example; run `pov_gui_remaining.py --extract-only` to capture canonical probe observations once. The compressed full caches total about684MB, excluding pilot/features. Local game assets, recordings, observations, binaries and caches remain ignored and are not committed.
- `pov_gui_remaining.py --analyze-only` derives/cache-checks weighted/cell proposals and evaluates the fixed primary matrix plus the separately labelled secondary union. Feature fingerprints cover feature functions/constants, aggregation implementation, probe metadata and parent predictions. Post-processing/report changes do not silently invalidate or overwrite inference versions.
- Every sampled frame reproduces prior unmasked, opaque+interior and all-GUI per-row signed sums, usable counts and standardized silhouette components at1e-8. Probe hits, veil correction and template geometry come from shared Rust. The native aggregation helper performs only weighted arithmetic; it contains no GUI, veil or chroma rules.
- 36 Python tests pass, including fractional neutrality, area-bias removal, temporal modulo wrap, detected-cut resets, authored-boundary non-oracle behavior, protected decisions, native/NumPy parity and union row priority.27 Rust silhouette tests pass, plus the native dilation test and standalone aggregation test.
- All owned Rust files pass formatting checks. The normal900-frame full-score output remains SHA256 `6BE53450ABAA94F1DC879C5B245F6F4DE7808826CE5F0E639520B7136F3F0D26`. Normal matching allocates no probe-export layout; the shared sampling refactor preserves production outputs. No app default changed.
