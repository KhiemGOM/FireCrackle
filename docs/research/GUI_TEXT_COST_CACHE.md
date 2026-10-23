# GUI text-cost cache — 21 October 2026

The profile after verified GUI-scale reuse identifies action-bar text parsing as
an avoidable repeated-work hotspot. `parse_centred` compares each glyph against
the same absolute image columns for both dynamic-programming states and again
for every proposed centred line start. The integer mismatch/hit counts do not
depend on either state or line start.

The new private `GlyphCosts` stores those two counts lazily per absolute column
and glyph. Its borrowed inputs tie it to one current-frame ink band, font and
colour/tolerance hypothesis. Nothing survives to another hypothesis or frame.
Parser candidate order, float gain arithmetic, tie behavior, free-border checks,
allowed glyphs and all acceptance thresholds stay unchanged. Action bars,
centred title/subtitle validation and captions share this reader. This changes
no Minecraft mechanics or GUI-layout rules and does not cache screen presence.

## Fresh profile

The workload is 1,200 consecutive 1080p V03 frames, video seconds 20–40, through
the production hinted GUI detector and 12 ordered frame workers. Around 1,100
fits reuse verified geometry. External StackWalk64 sampling with matching
optimized PDBs runs separately from throughput measurements.

| Inclusive busy-stack share | Before | After |
| --- | ---: | ---: |
| Action-bar recognition | 30.9% | 11.9% |
| Centred parser, including its cached score work | 30.1% | 10.6% |
| GUI interaction merge | 25.3% | 33.2% |

These are sampled busy-looking wall stacks, not exact CPU timings or percentages
of total scan wall time. Overlapping inclusive functions must not be added.
The remaining interaction share rises because the text work shrank; it does not
show that panels became slower. The benchmark also hashes both full mask planes,
so the harness contributes work beyond normal GUI calls.

## Isolated GUI speed and parity

An unsampled before/after/after/before run processed all 1,200 frames each time:
**109.7 → 137.2 fps (+25.1%)**, weighted by total frames divided by total seconds.
All complete per-frame class/piece mask hash vectors matched across all four
runs. Both paths already include verified prior-fit reuse. Different worker
scheduling slightly changes how many hints are reused, without changing the
checked masks on this clip. A preliminary run overlapped tests and was excluded
from the reported timing.

Full Auto scans, using verified hints in both binaries:

| Scanner | Before | After |
| --- | ---: | ---: |
| No-fire, 1,800 frames / 1080p | 172.5 fps | 181.1 fps |
| First-person, 600 frames / 1440p | 54.0 fps | 57.9 fps |
| First-person, 1,800 frames / 1080p | 175.3 fps | 175.9 fps |

Complete decision vectors matched in every pass (308 no-fire clears, zero
1440p accepts and 110 1080p first-person accepts). The 32 time-spread GUI controls
also preserve frozen stateless mask bytes and their pre-cache hinted results.
No-fire reported `GPU (DirectML 0)` with initialization/warm-up outside timing.
The Auto comparison ran the baseline process before the optimized process,
each taking two hinted passes inside a full/hint/hint/full run. Smaller gains
are local paired observations, not a fully interleaved causal benchmark.
The 1080p first-person clip rarely needs GUI analysis and is effectively flat.

The full results, controls, hashes and native build are recorded in
[`GUI_TEXT_COST_CACHE.json`](GUI_TEXT_COST_CACHE.json). No training, calibration, model
selection, model thresholds or shared unveil math changed. Prediction parity
is not ground-truth TP/FP validation. Short local clips cannot establish a
cross-machine or Linux speed guarantee.

## Verification

**89 targeted tests passed**; core and native Clippy passed with warnings denied.
Targeted checks cover action bars, captions, chat, titles/subtitles, misleading
world/fire colours, GUI scale fallback, ordinary HUD pieces and first-person
matching. The new parser test covers exact glyph ties, nearby proposed starts,
repeat reads and separate ink hypotheses. Frozen real-image masks and complete
Auto decision vectors are compared with the pre-change binary.

Memory is bounded by the current band width and font size; only columns reached
by the parser allocate a score row. It is released at the end of each colour
hypothesis. No persistent cache or new shared worker lock is introduced.

The native release build passed in 4m 20s. Its executable hash is in the manifest.
The running app is left open; no active scan is interrupted.
