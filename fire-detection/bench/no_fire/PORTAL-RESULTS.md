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

This is not separate-video validation. The new translucency-heavy recording is
pending processing/alignment confirmation; do not consume it before it is ready.

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
