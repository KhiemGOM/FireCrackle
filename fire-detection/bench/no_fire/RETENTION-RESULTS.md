# Small fire after menu unveil: retention follow-up

## Original regression

The remaining owner-unacceptable miss, survival1 frame 41850, is correctly detected
as veiled by the shared automatic unveil (share0.949). Its old largest joined
orange score is1,523, below the2,198 no-fire threshold. The problem is the area
threshold, not absent automatic unveil or translucency detection.

Added a separate deterministic abstention rule: **only after confirmed automatic
menu unveil**, retain a frame containing a restored saturated-orange8-connected
component with at least128 pixels, width24 and height8. Colour support is R≥96,
0.30R≤G≤0.85R, B≤0.25R and R−B≥80. It ignores white. Canonical GUI masking
excludes known HUD contents. No texture fitting, CNN, or frame-id exceptions.

This rule prevents a no-fire clear; it does not automatically label fire. An
open screen can contain uncovered GUI icons, so evidence can mean world fire
**or unavailable GUI coverage**. On41850, the restored qualifying region is
753pixels at[1722,414]–[1792,434], overlapping the independently recorded fire.

| Same104 original clear candidates | TP | FP |
| --- | ---: | ---: |
| Original component rule | 91 | 13 |
| Material veto + actual GUI mask | 70 | 4 |
| Add restored-menu retention | **69** | **3** |

The three remaining raw fire-labelled clears (clip1 frame 22230, quad1 frames
5310 and 5760) were
previously accepted as negligible by the owner. Thus no owner-unacceptable
clear remains **in this original reviewed cohort**. Raw capture truth remains
unchanged; do not present the raw result as zero FP.

The additional correct clear held for review is quad1 frame 4860, a creative inventory
search containing campfire/fire-charge/blaze-rod icons. The GUI-mask author
confirmed open inventories/creative panels/pause screens are not covered by the
current in-game HUD masker. This remains GUI-unknown, not verified world fire.

The first unrestricted saturated-orange variant yielded51TP/2FP, losing19
correct clears to warm objects. Restricting the extra rule to restored RGB after
confirmed menu unveil yields69/3, losing only one. The original104-frame cohort
was used for this refinement: these are development/regression results.

## Audit of the21 material abstentions

Visually reviewed every originally correct clear vetoed by material+GUI masking:
**18 contain visible water,3 contain visible portal surfaces/effects**. No clear
material false alarm was identified among those21. Their lost clear throughput
is intentional under the owner's rule to abstain whenever translucency appears.

The local report records each case and judgment. This audit concerns those21
original true clears, not every detector veto on every video.

## Frozen-rule check on separate recordings

After selecting the restored-only policy, kept its constants fixed and sampled
every120video frames across two other recordings at native1920×1080 RGB:

- `2026-10-15 14-15-51.mkv`:79 samples across156.684s.
- `2026-10-17 17-04-31.mkv`:28 samples across54.417s.

There are107samples and six final clear outputs. Manual review finds **five
visually no-fire outputs and one unsafe pause-menu output**, conservatively
counted as FP. Three of the five are loading/saving screens; only two are
ordinary gameplay. This is a weak clearance sample, not a broad accuracy claim.

The unsafe output is the first recording at156s: automatic unveil rejects it
(share0.882 below0.90), so the restored-only rule never runs. A faint, partly
covered orange fire-like region sits above the pause-menu button. Conservatively
retain this as an error/uncertainty rather than claiming zero FP; no independent
pixel mask certifies that tiny region. Forced inverse is shown **for inspection
only**, never used to generate its decision. The canonical GUI HUD mask does
not certify an open pause screen even when its hotbar anchor is reliable.

The extra retention rule activates on all five detected-menu samples in the two
recordings; they were already retained by the existing pipeline. It changes no
clear output in this separate test. No threshold or rule was adjusted afterward.
Sampling every2s does not cover every video frame. These separate recordings
were not used to choose this extra retention rule; they remain Minecraft footage
from the same local setup, not a broad external benchmark.

## Reproduction and review

Compile `retention_rules.rs` with `rustc --edition 2021 -O`, placing its research
executable at `.board/no-fire-parallel/fragment-review/retention/score.exe`.
Run `python retention_pilot.py` for fresh native regression, or
`--reuse-evidence` to apply the final policy to saved component evidence. Then
run `python retention_validation.py` for the frozen separate-recording scan.
The tools expect existing local fragment/material caches, source videos, GUI
assets and the shared native-unveil runtime. No local assets or binaries are
committed.

Targeted checks: one native component test rejects white/brown and masked GUI;
four Python policy tests enforce confirmed unveil and restored-only evidence.
The new rule is a research abstention prototype and does not change app labels
or production defaults.

Gallery: <http://127.0.0.1:8794/retention/>. `report.json` includes all104
decisions and the21-case audit; `validation.json` includes all107new decisions
and the conservative manual review. Initial unrestricted results are preserved.

Next limitation exposed by this test: open-screen recognition/coverage and the
borderline pause-menu unveil rejection, rather than another global orange
threshold reduction.
