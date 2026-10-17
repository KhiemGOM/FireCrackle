# Separate-recording first-person validation

Protocol registered 2026-10-18 before reading matcher predictions.

## Selection and limits

Use two available recordings outside the four-recording first-person development set: `2026-10-15 14-15-51.mkv` and `2026-10-17 17-04-31.mkv`. Select them because dense capture logs exist, not because of detector results. Decode every synchronization strip and join exact render-frame IDs and ticks to those logs. Sample every fifth encoded frame, matching the earlier short-clip evaluation cadence. Exclude invalid/unmatched truth explicitly; never treat missing labels as no first-person fire.

These are separate first-person evaluation recordings, from the same local Minecraft setup. Both have previously been inspected in separate no-fire/material research, including shared preprocessing work. Therefore they are **not pristine holdouts for the entire research pipeline**, nor independent players, resource packs, versions or codecs. Keep their results separate from reused-development totals before giving combined counts. Dense adjacent frames are correlated, not independent trials.

## Frozen inference

Use the existing `pov_dual_veil` binary and sources from commit `2b43679967cadeee9082c0d7de4ae46f15b85be3`, with the same GUI assets as the completed V2 capture. Do not alter color/evidence thresholds, FOV selection, neutral-mask rules, the 0.03 detector-distance schedule or highest-eligible-evidence branch policy after seeing these predictions. No true rows, sync ticks or recorded veil state enter inference. True rows enter scoring only.

At the time this protocol was registered, the shipped automatic labeller used unmasked automatic-veil matching. The tables retain that historical baseline, named “Pre-integration app method” below. The expanded method has since been integrated for 0.3.0 and verified decision-for-decision on all six recordings; see [POV-INTEGRATION.md](POV-INTEGRATION.md). The cache method key `shipped` continues to identify the historical baseline, not the new implementation.

## Metrics

- Correct-row coverage: accepted correct rows / all valid frames containing first-person fire.
- Accepted-label precision: accepted correct rows / all accepted labels. Wrong accepted rows count as errors even when fire is present.
- False-positive rate: accepted labels on frames without first-person fire / all valid frames without first-person fire. World fire can be present in this negative group.
- Report abstentions, wrong accepted rows, denominators and exact error frame IDs. Do not call abstentions correct No-fire classifications or collapse these into an undefined overall accuracy.
- Zero observed errors is a finite-sample observation, not a guarantee. No beta change to the separate No-fire checker is authorized by this experiment.

## Completed checks

All 9,400 early-video frames and 3,263 later-video frames decoded, matched a capture label and passed the tick check; none were undecodable, unmatched or tick-mismatched. At stride five this yields 1,880 + 653 = **2,533 scored samples**, including **349 overlay-positive and 2,184 non-overlay frames**. No truth exclusions occurred. Both recordings are encoded at 1920×1080/60 fps; the logs record differing game render sizes (2560×1440 early, 1280×720 later), so this also exercises full-viewport rescaling rather than cropping.

| Separate recording | Method | Correct / overlay frames | Accepted wrong rows | False positives / non-overlay frames |
|---|---|---:|---:|---:|
| early | Pre-integration app method | 5/5 | 0 | 0/1,875 |
| early | Expanded research method | 5/5 | 0 | 0/1,875 |
| later | Pre-integration app method | 275/344 | 0 | 0/309 |
| later | Expanded research method | 338/344 | 0 | 0/309 |
| Both | Pre-integration app method | **280/349 (80.2%)** | **0** | **0/2,184** |
| Both | Expanded research method | **343/349 (98.3%)** | **0** | **0/2,184** |

Every accepted row was correct for both methods in these separate recordings. The early video has only five positive samples; it mainly adds specificity controls. The later video supplies most of the positive evidence. No constants were changed after either result.

The expanded method's six abstentions are later-video frames **2645, 2650, 2655, 3160, 3165, 3170**. The first three choose wrong candidates but reject them; the last three choose the true row but reject it. These remain errors of coverage, not false accepted labels. No interpolation fills them.

## Repeated frames

The later video contains many duplicated render frames. Reporting one first sampled occurrence per capture render ID leaves 2,265 unique render frames across both videos: 228 positives and 2,037 negatives. The current app method accepts 185/228 correct (81.1%); the expanded method accepts 222/228 (97.4%). Both still have zero false positives and wrong accepted rows. Distinct render IDs and adjacent ticks are also temporally correlated; this deduplication does not make them independent statistical trials.

## Combined counts, with development clearly identified

| Cohort | Pre-integration app coverage | Expanded research correct-row coverage | False positives for either method |
|---|---:|---:|---:|
| Four reused development recordings | 1,396/1,513 (92.3%) | 1,496/1,513 (98.9%) | 0/11,918 |
| Two separate recordings | 280/349 (80.2%) | 343/349 (98.3%) | 0/2,184 |
| All six, pooled by frame counts | **1,676/1,862 (90.0%)** | **1,839/1,862 (98.8%)** | **0/14,102 (0% observed)** |

Combined accepted-label precision is 1,676/1,676 for the pre-integration app method and 1,839/1,839 for the expanded method: **100% observed**, with zero wrong accepted rows. These denominators must accompany that phrase. The expanded method abstains on 23 positive samples; the pre-integration app abstains on 186. Overall frame-classification accuracy is not claimed because abstentions are not No-fire classifications.

The expanded method is now the first-person Auto implementation for 0.3.0, with exact production parity verified separately. The UI gives only the result summary: “In testing, it detected 98.8% of first-person fire samples, with no false positives or wrong sprite labels.” Detailed denominators and limitations remain here. This experiment does not change the separate No-fire checker.

No population error confidence bound is claimed: reused development data, prior shared-preprocessing exposure, one local setup and temporal correlation prevent interpreting 14,102 negative frames as 14,102 independent generalization trials. A truly fresh recording from a different player/setup remains stronger evidence than these results. Do not advertise zero future false-positive probability or universal 100% accuracy.

## Reproduction and evidence

Use `fire-decode` with the video-specific capture logs, keeping the exact frame-ID/tick join. Raw logs are `labels-20261015-140934.jsonl` and `labels-20261017-170335.jsonl`. Run `pov_independent.py` for frozen native predictions, or `pov_independent.py --reuse` for scoring and combined development counts. No labels enter the native matcher.

The frozen native executable and every inference-source/asset hash match the prior completed V2 capture. Prediction metadata records video, joined-label, raw-capture-label and native hashes. Independently ran the freshly built video-only `fire_pov` entry point on all 653 later-video samples: **zero accepted-row differences** from the historical app-method branch extracted from the paired capture. Its threshold, auto veil and FOV selection match the pre-integration app scan source. Historical app scan source SHA-256: `ef21b8e76f7ef01cee57ab3aa783312dd64fb4ec772b40cf901aceb960a84509`.

| Input/output | SHA-256 |
|---|---|
| early video | `0378ce9394439c52af9d6aad10cc51f0146769bac3f5075e467857c0c596ef67` |
| later video | `6d1f2f9c44bced3c3e68cacf4f45f5c639ba969f3cf8d5e8e11d7c36d6f4aaa7` |
| early joined truth | `e58468fe3449760f166cf800b23aba18ca1c37fca4d3a030dd1cfdd44b7e5324` |
| later joined truth | `b673c6542626c8eb860379be55b762da895fe68eac46440620ffed8e15eff6d2` |
| early predictions | `aeea4a02fd63d642bcf47b2c2adeacf464ce378d1b76e7bc7132aa62a67788e0` |
| later predictions | `da71b6a076942c646a836c97970f15f41c3c5373c369bfd631cdfe67308d312c` |
| analysis | `45ebd919056a966f78c411ef622800d16d3787d2f377892c01f096f8afb834a4` |

Validation: 48 POV Python tests, including distinct metric denominators, undefined rates, invalid-truth exclusion, repeated-render deduplication, frozen shipped-branch behavior and count-weighted pooling; five existing automation UI tests pass. No recordings, raw labels, assets or prediction caches are committed.
