# Experimental fire ownership recorder

This is an opt-in **prototype**, not certified oracle data. It does not change the shipped matcher or train a model. All exported metadata explicitly says `ground_truth: false` until full in-game validation is completed.

## What it does

While vanilla submits geometry, the recorder replays `GlStateManager.drawArrays` into its own framebuffer using the currently bound vertex arrays/VBO, matrices, texture coordinates, alpha cutoff, culling, viewport, scissor and depth state. Its depth attachment matches the source attachment format. It follows the actual ordering of wall, entity, fire, hand and GUI draws; it does not estimate visibility using bounding boxes or raycasts.

Every four vertices of a world fire-atlas quad receive a frame-local ID. Transform feedback exports the actual submitted clip-space corners and texture coordinates. Quads are identified only when all four UVs are within a fire sprite; unmapped fire fragments become unknown. IDs are not persistent entity/block tracking IDs.

Opaque non-fire fragments erase ownership where they actually cover fire. Fragments that actually mix with the destination write a separate, conservative uncertainty union after the same depth test. Fully opaque standard-alpha blending is kept as opaque evidence. The union starts once fire has been submitted, so earlier sky blending cannot poison later targets. Later draws cannot erase this uncertainty. This can exclude pixels that were subsequently covered by opaque geometry; it favours less evidence over false ownership. Hand/HUD geometry is replayed for coverage, but is not labelled as world fire.

Depth clears are mirrored, including the hand pass. Colour blits, custom shaders, stencil, multisampling, partial RGB writes and exceeded geometry budgets reject a sample through its metadata. Uninstrumented third-party draw entry points cannot be guaranteed detectable, so even a sample with no issues remains experimental.

## Run

From `fire-detection/mod`, with Java 17:

```powershell
./gradlew.bat runClient -PfirelabelDebug=false -PfirelabelOwnership=true
```

The defaults sample every 120 world frames and export at most 8 frames containing submitted fire geometry. Empty scenes do not consume the export limit. To capture more:

```powershell
./gradlew.bat runClient -PfirelabelDebug=false -PfirelabelOwnership=true -PfirelabelOwnershipEvery=30 -PfirelabelOwnershipLimit=200
```

Installed Minecraft JVM arguments use the equivalent `-Dfirelabel.ownership=true`, `-Dfirelabel.ownershipEvery=30`, `-Dfirelabel.ownershipLimit=200`. Leave the feature off for normal recordings. Sampling performs GPU readbacks and synchronous PNG writes and can hitch; these captures are not suitable for timing/lag benchmarks.

## Export contract

Files live under `<game directory>/firelabel/ownership-<session UUID>/`:

- `frame-00000123-rgb.png`: lossless RGB, captured before sync strip/debug overlays.
- `frame-00000123-ids.png`: raw RGBA **data**, not a display image.
- `frame-00000123.json`: completion marker, capture frame ID/client tick, dimensions, image SHA-256 hashes, issue list and quad metadata.

Decode `id = R + 256*G + 65536*B`. Zero is non-target coverage/background; `16777215` is unknown. Other values identify one quad in the JSON. Alpha is `sheet+1`, or 255 for unknown. Read the PNG bytes directly without premultiplying alpha or compositing it; the low alpha values are metadata, not opacity. All PNGs have top-left origin. For a selected quad, its ID is visible target ownership; unknown pixels must be ignored, and other IDs are other planes.

`clip_corners` are four `(x,y,z,w)` clip coordinates in submitted vertex order. Convert a corner to image coordinates as `x_px=(x/w+1)*width/2`, `y_px=(1-y/w)*height/2`; clip against the view volume before cropping. `uv` gives local fire texture coordinates, preserving mirroring. `sheet` and `row` name the sprite actually displayed. These full quad corners can exist even when the visible ID mask is empty. They are not an inferred amodal visibility mask.

RGB and IDs are read from the same rendered frame. JSON is written last; ignore incomplete pairs without it. The matching `frame_id` links to the recorder's normal label/sync frame counter, but the standalone RGB omits the strip intentionally. No alignment to an externally encoded video is assumed without checking that video's sync strip.

## Validation so far (2026-10-17)

Direct Java 8-target compilation against cached Minecraft/Fabric dependencies passed. The cached JUnit launcher ran **207 tests: 207 passed**, including ID byte preservation at low alpha, PNG vertical orientation and opaque RGB export.

Real OpenGL controls ran in a hidden GLFW compatibility window on an NVIDIA RTX 4060 Laptop GPU (OpenGL 4.6, driver 592.82): **16,449 assertions passed**. This count includes a byte-by-byte framebuffer comparison; it is not 16,449 independent scenes. Controls cover:

- isolated planes and distinct front/back ownership for overlapping fire;
- an opaque wall covering half the target;
- actual texture alpha-test holes;
- blended coverage and persistent uncertainty under later opaque draws;
- depth-clear/hand ordering;
- culling, viewport, scissor, 24-bit IDs;
- client arrays and chunk-style VBO arrays, nonzero vertex offsets;
- GPU corner/UV capture and graphics-state restoration;
- identical source RGBA with replay enabled versus disabled.

These controls test the renderer directly. They **do not verify Minecraft mixin invocation or a real recorded world**. Gradle's full `test remapJar ownershipSmoke` build could not start its daemon in this execution environment (`Unable to establish loopback connection`), including IPv4 and no-daemon attempts. Direct compilation and the JUnit/GPU controls were used instead. No newly remapped/distributable mod jar is claimed as built.

The normal reproducible checks, when Gradle can start, are:

```powershell
./gradlew.bat test remapJar ownershipSmoke
```

## Required before training

Run a dedicated Minecraft capture with isolated fire, a wall, a burning entity/body, crossed planes, thin occluders, coplanar ties, particles, HUD/hand, offscreen clipping and a moving camera. Compare normal RGB with instrumentation off/on in a deterministic scene, inspect ID/unknown masks and geometry alignment, and verify sync IDs. Check vanilla graphics modes separately; fabulous/postprocessing and shader mods are not supported by this prototype.

Inspect sampling/texture filtering boundaries and mark a boundary band uncertain when making compressed training crops. Do not train on rejected samples, silently promote experimental samples to oracle data, or treat hidden texture as observed. Once validated, this renderer can supply per-plane visible ownership labels for the occlusion model; existing survival footage still has no retroactive oracle masks.
