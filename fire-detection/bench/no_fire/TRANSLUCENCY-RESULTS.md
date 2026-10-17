# Translucency detector for the 91-TP no-fire baseline

## Result

The deterministic material-veto prototype catches portal effects/blocks and
textured blue water/tinted-glass candidates. It applies **before** accepting a
no-fire clear. It is an abstention rule, not a fire-positive classifier.

The no-fire component rule and its 2,198 threshold stay unchanged. All 104
originally cleared evaluation frames were decoded again at native 1920x1080
resolution and their recorded substantial-fire truth was preserved.

| No-fire method | TP: correct clears retained | FP: fire wrongly cleared |
| --- | ---: | ---: |
| Original component rule | 91 | 13 |
| Earlier purple-only guard | 75 | 8 |
| Material detector v1 | 64 | 4 |
| Material detector v2 | 68 | 4 |
| Material detector v3 | **71** | **4** |
| Material detector v3 + actual GUI mask | **70** | **4** |

V3 prevents nine of the original 13 wrong clears, while giving up 20 correct
clears. Many of those 20 pictures actually contain water or portal surfaces:
abstaining on them is the requested material policy even when they contain no
fire. Some avoidable colour/material ambiguity remains.

Prevented original fire misses:

- clip1: 21330, 22860, 22950, 23040, 23310 (blue-surface candidates).
- survival1: 50760, 51840, 51930, 52020 (portal candidates).

Remaining original fire misses:

- clip1 22230; quad1 5310 and 5760: previously accepted as negligible by owner.
- survival1 41850: still an unacceptable visible-fire miss. This frame has no
  detected portal/water/glass cue; a translucency veto does not solve it.

The raw 91/13 comparison above does not silently substitute those owner reviews.
Under the separate amended owner review, original 97 acceptable / 7 unacceptable
clears become 74 acceptable / 1 unacceptable. This is bookkeeping on the same
cohort, not independent validation.

## Material detection review

The new 533-second video is used for **material-presence evaluation**, not simply
to count its no-fire clears. Reviewed 29 portal/water/glass positive frames and
29 opaque-surface controls distributed through the recording:

| Target material | Detected / present |
| --- | ---: |
| Water | 10 / 11 |
| Blue tinted glass | 10 / 11 |
| Portal blocks/fullscreen effect | 7 / 7 |
| All target translucent surfaces | **27 / 29** |
| Opaque controls incorrectly vetoed | **2 / 29** |

The two material misses are the small water region at 250 seconds and small
glass region at 436 seconds. The opaque false alarms are 74 and 76 seconds
(purple enchanted-item appearances). V2 requires variation **inside** the
blue-tinted region, rather than at its boundary with a white cloud. Native
resolution still exposed pale blue cloud shading, so v3 requires a stronger
blue/green ratio. This removes the six native sky/cloud control false alarms.

These are manually labelled development cases. V2/V3 were revised after inspecting
earlier errors; 27/29 is not a held-out generalization estimate. Final material
review and the original 91/13 regression both use fresh native RGB decodes.
Earlier JPEG-review and v2-native reports remain in local caches. Opaque controls
mean absence of the target large world
surfaces, not a proof that no small blended particle occurs anywhere.

## Implementation and limits

`translucency.py::detect` first calls the one shared automatic menu-unveil binding.
It then measures 48x48-native-pixel patches using 3-pixel sampling:

- Brighter purple support plus texture variation proposes a portal/effect region,
  avoiding the previous guard's blanket rejection of dark obsidian.
- Blue tint, internal edge variation and neighbouring patch support propose
  water or blue tinted glass. Flat blue sky alone does not qualify.
- A caller-supplied world/GUI mask can replace the temporary GUI envelope.

No learned model, new inverse implementation, fire boxes or fire labels enter
the detector. The region threshold deliberately loses very small materials.
It does not claim universal alpha detection, colourless glass, arbitrary tinted
glass, all particle types, or shader/resource-pack independence. Opaque materials
can resemble these candidates. A no-hit never proves opacity.

This remains a research detector; it has not silently replaced production app
behaviour. The actionable improvement is the 13-to-4 fire-miss reduction, with
the explicit 91-to-71 correct-clear cost. Do not advertise it as 91 TP / 0 FP.

## Reproduction

Run `python -m unittest test_translucency.py` from this folder, then
`python translucency_pilot.py --old` from the same folder. The pilot expects the
existing fragment-score caches, local videos, native shared-unveil build and
the decoded new-video gallery. Three source decoders run concurrently.

Gallery: <http://127.0.0.1:8794/translucency-detector/>. Its `report.json` stores
all manual material labels and all 104 regression decisions; `report-v1.json`
preserves the initial result. `lost-tp.jpg` displays the correct clears vetoed.
All videos, review images and caches remain local and ignored.

## Finished GUI mask follow-up

Replaced the temporary GUI rectangles with `fire_core::gui_mask::detect_gui`,
using default settings and all five local vanilla atlas files. The thin
`gui_mask_bridge.rs` / `gui_mask_native.py` binding reuses that one implementation;
it does not port its rules. A batch consumer must explicitly confirm vanilla
1.16.5 footage. Full class and piece-id planes are preserved (piece ids exceed
15). Known opaque/translucent GUI is excluded from material evidence; unknown
hotbar-item/effect-icon/crosshair interiors are also GUI, while ambiguous edge
slivers remain eligible. An unreliable fit means unavailable GUI information.

On the same 58 material-development frames:

- **29 TP, 0 FN**: water 11/11, glass 11/11, portal 7/7.
- **4 FP, 25 TN** on the unchanged opaque-control labels.
- GUI fit reliable on **53/58**; five unavailable fits are explicitly recorded.

The four control vetoes occur at 54, 74, 76 and 428 seconds. Frame 54 has no
reliable GUI fit; 74/76 contain purple enchanted tools. Frame 428 contains the
held blue-glass item, making its original opaque-world control label ambiguous
for an "any translucent thing" policy. It remains counted as FP above rather
than silently relabelled after seeing the result.

On all 104 original clear candidates, the result is **70 TP / 4 FP**, compared
with 91/13 originally and 71/4 with proxy rectangles. The actual mask confirms
GUI scale on **97/104**. Seven unavailable fits do not become proof of no GUI.
This experiment holds the fire-component scores fixed and changes only the
translucency veto; it is not a full recalibration of GUI-masked fire scoring.

Thus the real mask recovers the two small material misses from the proxy run,
with two more recorded control vetoes and one fewer correct no-fire clear. The
remaining four fire misses are unchanged. Under the separate owner reviews,
the current result is 73 acceptable / 1 unacceptable clear on the same cohort.

Reproduce with `python translucency_pilot.py --old --gui-mask`. The native bridge
loads local mask assets; the mask core source hash is recorded in the report. Eight targeted
Python tests cover material checks, cloud rejection, GUI piece interpretation
and the vanilla-confirmation requirement. No app or production defaults changed.
