# More lenient GUI presence on downloaded footage

The production interaction detector now accepts channel differences up to36
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

See [the data catalogue](TRAINING_DATA_CATALOGUE.md),
[previous development recording results](GUI_ALL_FRAMES_CHECK.md), and
[the historical miss audit](GUI_MISSED_FRAME_CATALOGUE.md).
