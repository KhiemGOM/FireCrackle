# GUI presence on downloaded footage

## Current policy: colour tolerance with independent tooltip repair

The current policy uses channel tolerance32 with the original80% border,
70% interior and90% fixed-control requirements. It also recognizes short breaks
in independently detected tooltip rims. The previous36 /75% /65% /85% policy
and its initial sample results below are historical, not the current settings.

Restoring shape gates alone was insufficient. On original frames0–35999,
colour32 with the old tooltip detector rejected all14 known snowy-world false
frames but also rejected eight actual chest frames29311–29314 and29317–29320.
Colour36 with the restored shape gates lost the same eight and retained one
snow false positive (1646). An eight-combination check at tolerance32 showed
that globally weakening border/interior gates recovered the tooltip frames
only while also accepting snow. Fixed-control relaxation did not resolve it.

The eight chest failures have a visible Wooden Axe tooltip. The independent
tooltip detector returned no rectangle on inspected failures29311,29317,29320:
short breaks in the faint bottom rim fragmented its line, and shortened line
endpoints exceeded the former4px pairing tolerance. They were therefore counted
as GUI mismatches rather than known occlusion. The repair allows up to12px in
the rim run scan and12px endpoint disagreement. Missing rim pixels are **not**
credited as matches:85% horizontal coverage,75% side coverage,55% dark fill,
geometry bounds and the GUI visible-support requirements remain unchanged.
These12px values are measured capture-space tolerances, not game constants.
No GUI mismatch is reclassified as an occlusion merely to improve a match.

Source evidence was rechecked in the local1.21.11 `TooltipRenderUtil`
(`gvm.a(GuiGraphics,int,int,int,int,ResourceLocation)`): it draws separate
`tooltip/background` and `tooltip/frame` sprites, with optional custom styles.
The prior source manifest is `.board/gui-calibration-plan/tooltip-source-evidence.json`;
the actual decompiled class and source assets were reread for this repair.
The downloaded video's exact version remains unverified. This is robustness
work on the existing default-style signature, not a claim to recognize every
version, custom tooltip style or resource pack.

The owner requested economical independent labelling. `gpt-6-luna` reviewed
all46 previous candidate midpoints, all92 surrounding frames,120 evenly spaced
frames at2.5+5k seconds, and three full-size tooltip failures. Midpoints1–6
were non-GUI and7–46 were GUI; all92 surrounding frames were non-GUI.
The systematic sample has11GUI and109non-GUI frames. Initial small-sheet ID
transcription errors were corrected by rereading all120 images with large
printed IDs; the discarded IDs and correction remain in the private record.
These are model visual labels, not owner or renderer ground truth. No claim of
exhaustive recall follows from sampled labels.

Private `.board/gui-balance/` records frozen policies, per-frame decisions,
original-PTS verification, labelled review sheets, source hashes and results.
The earlier256-frame pool remains a regression check; its previously inspected
later block is not a new unseen holdout for this follow-up. No new AI model,
training or synthetic fire data is involved. Generic GUI unit fixtures check
the rejection and occlusion behavior without committing private footage/assets.

### Final full-frame result

The final production implementation was run directly on **all 36,000 original
frames**, including every previous negative; original frame identities and PTS
were verified. It reports **3,483 frames in 40 contiguous GUI intervals**.
Its entire difference from the prior relaxed scan is removal of the14 snow
frames forming six false intervals. It loses no other prior positive frame,
adds no positive frame, and preserves the exact40 remaining interval boundaries.
Both the reported chest5064–5120 and tooltip-covered chest29269–29412 remain
continuous. No temporal merging, smoothing or minimum-duration filter was used.

| Policy | Positive frames | Raw intervals | Known snow frames accepted | Tooltip gap frames recovered |
|---|---:|---:|---:|---:|
| Original24 /80 /70 /90 |1,271|64|0/14|0/8|
| Previous relaxed36 /75 /65 /85 |3,497|46|14/14|8/8|
| Colour32 /80 /70 /90, old tooltip |3,475|42|0/14|0/8|
| Colour36 /80 /70 /90, old tooltip |3,476|43|1/14|0/8|
| Final32 /80 /70 /90, repaired tooltip |3,483|40|0/14|8/8|

For the first comparison, all prior positives were evaluated under the frozen
stricter policies; the colour32 policy was additionally evaluated on every
prior negative. Baseline/colour36 negative results use the prior relaxed scan
as their screening bound. The final repaired policy was evaluated directly on
every frame, without that bound or any cached decision substitution.

The final implementation also passed398 native-image checks: earlier256 pool
(93GUI/163non-GUI), Luna's120 systematic frames (11GUI/109non-GUI), the14 snow
frames and eight tooltip failures. Source-policy parity was checked on these
images. These pools overlap and must not be pooled into an independent accuracy
estimate. All33 targeted Rust tests and the native app compilation check passed.
The new incomplete-border and broken-tooltip-rim regressions failed before
their respective repairs and pass afterward. Tooltip negative tests preserve
the horizontal coverage, side and fill requirements.

The final scan took453.73seconds (~79.3fps) with gallery work on this machine;
this is an observed run time, not a controlled performance comparison. The app
was not restarted. Its existing source-hashed GUI cache key includes both changed
detector files, so rebuilt versions invalidate prior GUI-scan decisions.
The private final directory contains40 individual blinks and seven gallery
sheets, per-frame outputs and a source/assets/video hash manifest.

## 2026-10-24: menu screens (pause, options, footers, 1.16.5 layouts)

Since Auto unveil decides from the GUI detector alone, a missed menu is an un-unveiled frame. Measured on the
renderer-truth recordings `2026-10-20 14-09-57.mkv` / `14-22-45.mkv` (1.21.11, every 5th native 1080p frame), the
pause screen was found on 50 of 88 frames and the options screen on 162 of 181. A per-gate probe of the missed
frames showed that border and structure passed; the fixed-control text failed, for two reasons:

- **Heading placed with the grid's rounding.** At 2.25 video px per GUI px the button grid matched only at its
  half-texel origin candidate, and the viewport-anchored heading ("Game Menu", "Options") was sampled with that
  same offset, one pixel too high (68/115 heading probes; 115/115 one pixel lower). A heading is drawn at a fixed
  logical y, independently of how the grid is rounded. Viewport-anchored identity probes now ignore the pose's
  origin rounding (fast path `jitter_y`, reference `viewport_anchored`).
- **Text below one video pixel per GUI pixel.** GUI scale 1 of a 1440p window recorded at 1080p draws one-texel
  glyphs at 0.75 px, resampled together with Minecraft's text shadow (the colour / 4, one texel down-right):
  identity 0.34-0.40 against 0.90. Below one px/texel, identity probes now also accept the glyph-over-shadow mix,
  through the same `blended` mechanism the panel probes already use. A plain button without its text still fails
  (button grey <= 118 is below the mix's range), and nothing changes at 1 px/texel and above.

No acceptance fraction or colour tolerance changed (still 32 / 80 / 70 / 90). New source packs come from the
existing generator (`prepare_assets.py`), not a separate matcher:

- 1.21.11 two-button footers: language select (Font Settings... + Done, at H-28 because its warning line shares the
  footer, measured on frame 3075) and resource packs (Open Pack Folder + Done, H-26).
- 1.16.5 options (Done at H/6+168, title at y=15), confirm-link (three 100 px buttons at H/6+96, title at y=70) and
  pause (H/4+8, title at y=40), with 1.16.5 `widgets.png` buttons drawn as two halves. Found on the other session's
  false clears in `2026-10-15 18-18-16.mkv` (clip2): frames 600, 630, 660, 14430, 14580, 15780, 15840 and 18510
  (options) and 18450 (confirm-link), previously none.

The previous 94 templates are byte-identical in the new bundle. Not covered: advancements, statistics, credits,
the game-mode switcher (no fixed controls in a source pack) and the modded Sodium video settings screen.

| Check | Before | After |
|---|---:|---:|
| Pause screen (renderer truth) | 50/88 | 88/88 |
| Options screen | 162/181 | 181/181 |
| Language select / resource packs | 0/6, 0/3 | 6/6, 3/3 |
| All open screens | 2,242/2,646 (84.7 %) | 2,308/2,646 (87.2 %) |
| Screen reported on closed/chat frames | 0/2,832 | 0/2,832 |
| 398 labelled native images | 112 GUI, 0 false | same, 0 decision changes |
| First-person sample (`later`, `early`) vs `results/prune-check` | 0 FP | 0 row changes, 0 FP |
| `recovered-video.mkv` frames 0-35,999 | 3,483 frames | 3,483 frames, 0 decision or position changes |

## 2026-10-23: one GUI scale per frame, shortened tooltip rims, tooltips in the screen mask

Owner reports on another downloaded recording (`yt-LNsxw4VRTgQ.mkv`, 2560x1440, 839,408 frames):

- Frame 1743 (snow) was scanned as a creative-inventory tab at 0.75 video px per GUI px, a 146x102 box at the
  screen centre, while the frame's HUD fits at exactly 3.0. Vanilla draws the HUD and every screen with the
  window's one GUI scale, so the HUD's many pieces outvote one panel match. The app scan now uses
  `InteractionDetector::detect_at_hud_scale`: the HUD scale (`GuiDetector::hud_scale_with_hint`, the hotbar fit
  only) is measured only on frames where a panel was found; on disagreement the search repeats at the HUD scale.
  Without a reliable HUD nothing changes. The mask path already passed the HUD scale.
- Frame 12559: an item tooltip over the inventory went undetected at the app's 1280x720 display size, because the
  faint end of its bottom rim was compressed away (29 px short of the 12 px endpoint slack), so unveil found no
  screen and brightened the inventory. The bottom rim may now come up short at either end if it lies within the
  top rim's span and covers 60 % of it; the side, fill and coverage requirements are unchanged.
- Tooltips found over a matched panel are now part of the screen mask (`ItemTooltip`), so unveil protects them.

Regression check against this document's final results (`misc/dream/recovered-video.mkv`, frames 0-35,999 at
native size, the stored `final/frames.jsonl`, and the 398 labelled native images):

| Run | Positive frames | Intervals | Snow accepted | Tooltip gap recovered | Changed vs final |
|---|---:|---:|---:|---:|---:|
| Shortened-rim tooltip only | 3,483 | 40 | 0/14 | 8/8 | 0 frames |
| Plus one GUI scale per frame | 3,483 | 40 | 0/14 | 8/8 | 0 frames |

The 398 images: 112/112 GUI, 0 false detections, no decision change in either run. With the tooltip change
alone one image (#161) kept its decision but matched a small wrong panel first (154x138 instead of the full
528x498 at scale 3); with the one-scale rule it is the full panel again, so the combination has zero decision or
position changes. On `yt-LNsxw4VRTgQ.mkv` frame 1743 is now rejected (HUD 3.0) and inventory frames 12520-12550
are still detected at scale 3.00, including two with tooltips. Speed: no cost on frames without a panel (the HUD
fit runs only on positives); the comparison runs shared the machine with other work, so no timing is claimed.

## Historical first relaxation

The first relaxation accepted channel differences up to36
(previously24), border agreement75% (80%), interior/presence agreement65% (70%),
and fixed-control agreement85% (90%). These are engineering settings, not
Minecraft constants or confidence probabilities. The owner explicitly requested
more lenient source-template matching and a check on this downloaded video.

## Continuous ten-minute follow-up: false positives found

The owner's subsequent full-frame check supersedes any implication that the
sampled zero false detections establishes a zero-FP production policy.
Every original frame0–35999 (PTS0.000–599.983) was scanned with unchanged
`320fc2a` settings at native2560x1440 RGB24. All36000 output identities and PTS
were verified. The isolated run took722.77sec, about49.8fps on this machine
while generating review images; this is not an isolated detector speed benchmark.

The3497 detected frames form46 raw contiguous candidates. Visual inspection
of every candidate midpoint finds40 visible interaction GUIs and six ordinary
snowy-world false candidates: frames1490,1643–1647,1811,1813–1816,2206–2207,
and2411 (14 falsely accepted frames in those intervals). The original app's
cached scan recorded no GUI on those frames. This is an observed false-positive
failure, not a harmless unknown boundary or a claim of perfect recall elsewhere.

The reported chest frames5069 and5082 now lie inside one continuous
5064–5120 candidate, with no visible GUI in the inspected after-frame5121.
That local fragmentation improved; the policy still needs work on small false
panel matches. Do not silently raise/merge boundaries to conceal those candidates.
No thresholds changed during this continuous check.

Private `.board/gui-ten-minute-review/` preserves the native per-frame outputs,
source/video hashes, timestamp verification, all46 original before/after GIFs,
eight numbered animated gallery sheets and midpoint inspection sheets. Every
raw candidate is included; none of the false candidates was removed from the
owner's chat gallery. This is not full ground-truth annotation of every GUI
open/closed frame, so it does not establish full-video recall.

## Real-video sample

`misc/dream/recovered-video.mkv` is a downloaded YouTube recording:2560x1440,
AV1,60fps,561619 frames/about156min. Its exact game version and capture/encoding
pipeline are unverified. This changes no game-mechanics or source-layout rules;
the existing local official source-texture bank is unchanged.

256 exact original frames were independently visually reviewed from contact
sheets before policy evaluation:93 open interaction GUIs and163 closed frames.
These are assistant visual presence labels, not owner labels, renderer truth,
exact GUI-type labels or detector predictions. Every selected image was reviewed;
no uncertain sample was silently assigned a closed label.

- Development:96 systematic timestamps in15–4490sec, plus64 early examples
  (six known-miss neighbours and58 baseline-positive-enriched frames). Baseline
  positives selected enrichment only; visual review established presence.
  Final development labels:80 open,80 closed.
- Holdout:96 systematic timestamps in4815–9340sec:13 open,83 closed. This later
  block has a325-second selection-range gap from development. It is from the
  same recording, not an independent recording/session. Policy selection was
  frozen in a timestamped file before holdout evaluation.
- The systematic selection uses the midpoint of each of96 equal time bins in
  each declared interval, mapped to the first original frame PTS at/after it.
  FFmpeg copyts/showinfo verifies exact original PTS. Native RGB24 lossless PNGs
  are detector inputs; JPEG contact sheets are review aids only. No resizing,
  unveil/portal correction, synthetic footage, model or training is involved.
- Closed examples include overworld, snow, water, caves, trial chambers,
  Nether/bastions/fortress, End, combat, first-person fire, portals, subtitles,
  debug/HUD overlays and recipe toasts. This is a sampled check, not exhaustive
  certification of the full video.

## Results

Counts are frame-level; nearby enriched positives are correlated.

|Policy|Development open found|Development false detections|Heldout open found|Heldout false detections|
|---|---:|---:|---:|---:|
|Previous24 /80% /70% /90%|70/80|0/80|8/13|0/83|
|Colour-only32 /80% /70% /90%|80/80|0/80|Not used for selection|Not used for selection|
|Selected36 /75% /65% /85%|80/80|0/80|13/13|0/83|
|Rejected40 /70% /60% /80%|80/80|4/80|Not used for selection|Not used for selection|

The selected policy gives93/93 observed GUI frames and0/163 observed closed
false detections, versus78/93 and0/163 previously. The more permissive40 policy
produced four development false detections, so it was rejected. The32 policy
also recovered all development positives;36 plus lower agreement gates was
selected to provide the requested colour/evidence margin without observed
development false detections. Do not claim a statistically proven superiority
over32 or universal zero false positives.

The two reported chest misses5069 and5082 are recovered. Their visible border
white was aroundRGB227–234; a source-white255 probe previously required231+
in every channel. Small encoded colour changes repeatedly crossed that cutoff.
The sampled evidence establishes this rejection mechanism, not the upstream
reason for the recording's shifted white levels.

## Production behavior and limits

The source bank, pose search, source alias folding, deterministic worker order
and independently detected tooltip exclusions are unchanged. Known covered
probes remain neutral in mismatch counts and denominators. The existing minimum
visible-support requirements remain. This patch changes the named presence
settings, not the separate legacy exact-type reference detector's defaults.

`gui_scan` includes the changed source bytes in its cache key; a rebuilt app
invalidates old GUI scan evidence. Existing running apps/scans are not restarted
or modified by this work. Existing manual labels are unaffected.

This reduces false interaction fragmentation, but no missing-template match
proves a GUI closed. The interaction builder's handling of uncertain boundaries
remains a separate limitation; these sampled results do not prove exact
open/close boundaries throughout561619 frames.

Private evidence is in `.board/gui-relax-downloaded/`:sample/visual-label JSON,
original images, contact sheets, before/after per-frame outputs, source/frame/
video hashes, decode timestamps, exclusion coverage and timestamped selection.
Other catalogue sources are excluded from this explicitly requested single-video
audit, not represented as heldout or full-data results. Two inventory parse errors
are unrelated performance-lab run logs and are excluded from this GUI audit.

See [the data catalogue](../TRAINING_DATA_CATALOGUE.md),
[previous development recording results](GUI_ALL_FRAMES_CHECK.md), and
[the historical miss audit](GUI_MISSED_FRAME_CATALOGUE.md).
