# Final targeted GUI miss iteration

Automatic interaction-GUI presence is **258/261 (98.9%)**, with **0 false
detections in 289 closed-GUI samples**. The same 636 segment midpoints were
rerun. One previous miss is recovered and no previous detections are lost.
This remains same-session development evidence, not independent accuracy.

The separate full supplied-mask rerun remains **260/261 (99.6%)**, with no
regressions and **0/289 closed false detections**. The tiny creative sample at
frame 22380 remains missed. This uses independently logged renderer slot/mouse
geometry, not an automatic video-only occlusion estimator; the same caveats in
[the mask protocol](GUI_OCCLUSION_MASK_CHECK.md) apply.

## What was wrong and what changed

The merchant visit at supplemental video frame 1026 has sufficient visible
source evidence: at `(650.25,353.25)` and scale 2.25, border agreement is 100%
and structure agreement is 93.2%. The old search skipped this alignment. Its
nearest border-passing candidate at x 650.625 had 88.0% global structure agreement
but failed a regional quorum (15/22 instead of the required 70%).

Minecraft 1.21.11's `AbstractContainerScreen.init` (`gti.bg_`) performs integer
`(logicalViewport-panelSize)/2` before scaling. `Window.setGuiScale(int)`
(`fyk.a(int)`, official mapping lines 415–421) rounds the logical viewport
dimensions upward; its actual class bytecode was inspected. Centring the
already-scaled rectangle can therefore skip the source raster alignment.

The detector now tries that source-rounded x/y pair in addition to its original
nine origin pairs. It adds at most one pose per scale/stretch/recipe shift.
Fixed-top layouts retain their vertical anchoring. No thresholds, colour
tolerance, source assets or occlusion definitions changed.

The initial Cartesian expansion recovered the same merchant but nearly doubled
median runtime to about 19 ms, so it was replaced by the bounded single-pair
implementation. The final run measured median 12.207 ms / 11.976 ms for the two
clips, versus 10.218 ms / 9.812 ms in the preceding run. These are sequential local
observations, not a controlled speed benchmark.

## Why it is still not 100%

| Recording/frame | Remaining automatic miss | Evidence |
|---|---|---|
| Main 22380 | Tiny creative search inventory | Downscaled edges plus a visible tooltip covering the lower/right panel; source-template trace rejects border and interior evidence. The supplied slot/mouse mask does not fully cover the tooltip. |
| Main 22573 | Tiny creative search inventory | Border can pass 90.6%, but visible structure reaches 81.25%, below 85%. Independently supplied potential-content masks recovered this sample in the previous diagnostic. |
| Main 24639 | Filled dispenser/dropper | Border 100%; structure151/192=78.65%. The earlier probe audit located failures on item/count/stack overlays. Supplied neutral exclusions recover it. |

Those agreement values are from the actual source scorer at the logged pose,
not calibrated probabilities. They identify rejected evidence, not proof that
every mismatching pixel was occluded. Creative inventory also has variable
search input: `CreativeModeInventoryScreen.init` (`gua.bg_`) constructs its
80x9 search field at panel-relative(82,6). Variable text is not reliable fixed
identifying evidence. No mismatch-derived masks or unconditional acceptance
exceptions were added to force 100% on these inspected samples.

For a workflow excluding tiny creative GUIs and sign editing, the two creative
misses are low priority; the filled-container miss remains relevant. The useful
next improvement is independently inferred foreground exclusions and new-session
validation, rather than weakening all GUI gates to clear one observed tooltip.

## Checks and private provenance

- 17 GUI integration tests plus the source-origin unit test pass.
- The origin test verifies the previously skipped 650.25 alignment, unchanged
  fixed-top behaviour and deduplication at integral viewport scales.
- The fractional-render fixture verifies detection while acknowledging that
  multiple fractional origins can rasterize identically.
- `cargo fmt --check` and `git diff --check` pass.
- Source assets remain `.board/gui-soft-guard-check/assets-v10`, unchanged.
- `.board/gui-final-miss-check/trace-{12,15,17,18}.json` snapshots the actual
  pre-fix source scorer on each remaining miss; `source.sha256` identifies it.
- `check-v12/{report.json,predictions.jsonl,coverage.json}` records the final
  full automatic check, all decisions, source/binary hashes and coverage.
- `window-bytecode.txt` and `fyk.class` preserve local source-rule evidence.
- Recorded clips, textures, snapshots and scratch outputs remain private/ignored.
- `mask/check_visits.py` and `mask/supplied-mask-visits.json` preserve the final
  636-sample supplied-mask check, source/binary hashes and individual decisions.
