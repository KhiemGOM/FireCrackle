# Portal undo and translucency abstention

The no-fire policy now retains a frame for review when known or suspected world
translucency is present. Portal correction is for inspection/post-processing;
it cannot authorize a no-fire clear. This is a shared research API prototype,
not a new FireCrackle toolbar control.

## Existing-video results

Fresh native-resolution guard scans cover 1,579 sampled frames from four videos:
218 calibration frames and 1,361 evaluation frames. The component scores and
threshold (2,198) remain frozen; only the abstention gate changes.

| Evaluation decision | TP: correct no-fire clears | FP: meaningful fire cleared |
| --- | ---: | ---: |
| Original component rule | 91 | 13 |
| With translucency guard | 75 | 8 |

The guard abstains on 140 evaluation frames, removing 16 correct clears and five
wrong clears. Those five include all four reopened portal-overlay examples and
clip1 frame 21330. Two explicitly unacceptable examples remain: clip1 frame
22950 and survival1 frame 41850. The other six remaining capture-truth errors
were accepted as negligible in the owner's earlier visual review. These owner
decisions do not silently replace the original capture-truth metrics above.

This cohort is not separate-video validation. See the independent recording
review below for the subsequent frozen-threshold test.

## Portal reconstruction

The local 1.16.5 renderer uses a stretched animated portal RGBA texture with
ordinary alpha blending. Its overlay opacity follows `0.2 + 0.8 * time^4` below
full exposure. The local atlas has 32 frames, each 16 by 16 pixels. These facts
were checked against the locally mapped renderer and local texture, neither of
which is committed.

The shared Rust implementation searches atlas phase and opacity using robust
texture-grid boundary residuals, without fire boxes or fire labels. Given the
fitted alpha, it inverts the known blend per pixel. Low-transmittance or physically
inconsistent pixels remain unchanged and receive validity zero. Compression noise
and grid seams can remain, especially at high opacity. Actual world-space portal
block surfaces are not removed by this fullscreen-overlay inverse.

Four exact source frames were freshly decoded and their timestamps verified:

| survival1 frame | Video seconds | Phase | Opacity | Original score | Corrected score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 50760 | 846.0 | 20 | 0.3875 | 1257 | 26871 |
| 51840 | 864.0 | 29 | 0.4825 | 1404 | 204854 |
| 51930 | 865.5 | 15 | 0.9925 | 1293 | 193940 |
| 52020 | 867.0 | 15 | 0.9925 | 1293 | 193944 |

All four corrected scores retain fire at the old threshold. All four still abstain
under the new policy. The last two pictures are nearly identical, so these are
not four independent demonstrations. Nine nonportal review JPEG copies produce
no portal fit; those controls are not fresh native frame decodes.

## Guard coverage and shared APIs

`veil::portal` in `core/src/portal.rs` is the sole implementation. The native and
WASM ABI exports `portal_guard`, `portal_fit`, and `portal_inverse`; Python
`portal_undo.py` only binds those exports. `decide_no_fire` enforces abstention
before accepting a candidate clear. A supplied world mask excludes GUI pixels;
a supplied known-translucent mask triggers review for any included world pixel.

The current automatic candidate detector gates on at least 64 connected purple
pixels. It can also abstain on opaque purple objects. It does not yet recognize
water, glass or ice automatically, and no detector hit is not proof of opacity.
The benchmark uses a temporary fixed GUI-envelope proxy, not the promised GUI
oracle. Exact GUI and world-translucency masks can replace that proxy through
the existing arguments.

## Reproduction and review

Run `portal_pilot.py --jar <local-minecraft-client.jar> --out <gallery-dir> --scan`
from this repository using Python with NumPy and Pillow. The pilot expects the
existing fragment benchmark cache and its local native scoring helper. It scans
four sources in parallel. It loads the portal atlas locally; no game assets,
recordings, generated binaries or benchmark images belong in source control.

The report records atlas and Rust source hashes, exact extraction timestamps,
per-frame guards, fits, and original score provenance. Lint-only changes after
the scan started do not change its pixel algorithm; the report retains the actual
run's hashes. Targeted validation covers five Rust portal tests, 18 shared veil
tests, four Python portal tests (including native/WASM byte parity), shared Python
veil tests, 39 browser veil tests, and library Clippy with warnings denied.

Local before/after gallery: <http://127.0.0.1:8794/portal/>. Its parent gallery
keeps the three explicitly unacceptable and four reopened portal cases separate.

## Independent recording review: 2026-10-17

After the owner confirmed processing was done, scanned the complete 533.35-second
recording `2026-10-17 18-28-42.mkv` at native 1920 by 1080 resolution, sampling
every 120 video frames (two seconds): **267 frames**. No thresholds were tuned.
The original raw/automatic-unveil component score is retained conservatively
using their maximum, with the same 2,198 threshold and the existing GUI-envelope
proxy for the guard.

| Decision | Sampled frames |
| --- | ---: |
| Candidate clears before guard | 28 |
| Clears after guard | 18 |
| Translucency abstentions | 181 |
| Retained by orange fire evidence without guard hit | 68 |

The final three rows partition the 267 frames. This is a decision distribution,
**not TP/FP**: the producer confirmed incomplete/rejected ownership masks remain,
so absent masks are not used as negative labels. The 18 clear thumbnails contain
no obvious fire on visual review; this does not certify occluded/very small fire
or unsampled frames.

The test exposes poor material specificity. Portal scenes trigger, but opaque
obsidian and purple enchanted tools can also trigger. Water scenes at 182–202
seconds pass the purple guard; several become clears, violating an unconditional
"any translucency means abstain" material policy even though no obvious fire is
visible there. Glass scenes commonly abstain with other purple objects present;
that does not establish that glass itself was detected. General water/glass
recognition remains unimplemented.

Separately decoded seven inspection frames at 170, 174, 178, 300, 450, 480 and
520 seconds. The overlay fitter activates only at 170 and 174 seconds (phases
10/20, opacity 0.1925/0.9325); the five non-overlay inspection frames reject the
fullscreen fit. At 174 seconds the correction visibly removes the fullscreen
veil and preserves the actual portal-block surface. Some seams remain. Both
overlay frames still abstain for no-fire decisions.

The useful next step is a dedicated material/occlusion mask; expanding a purple
colour gate is not a substitute for one. Keep the portal inverse for inspection.

Review gallery: <http://127.0.0.1:8794/translucency-new/>. Local `report.json`
contains every sampled decision, `examples.json` the seven fit diagnostics,
`clears.jpg` all 18 proposed clears, and numbered contact sheets the full sample.
