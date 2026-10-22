# Experimental fire ownership recorder

This is an opt-in **prototype**, not certified oracle data. It does not change the shipped matcher or train a model. All exported metadata explicitly says `ground_truth: false` until full in-game validation is completed.

## What it does

While vanilla submits geometry, the recorder replays `GlStateManager.drawArrays` into its own framebuffer using the currently bound vertex arrays/VBO, matrices, texture coordinates, alpha cutoff, culling, viewport, scissor and depth state. Its depth attachment matches the source attachment format. It follows the actual ordering of wall, entity, fire, hand and GUI draws; it does not estimate visibility using bounding boxes or raycasts.

Every four vertices of a world fire-atlas quad receive a frame-local ID. The recording path reads submitted CPU vertex buffers, caches only fire vertices for static VBOs, and projects those vertices with the submitted matrices. Clip-space coordinates use CPU float arithmetic and require a numerical tolerance; they are not bit-identical GPU transform feedback. The GPU transform-feedback path is retained only for renderer controls. Quads are identified only when all four UVs are within a fire sprite; unmapped fire fragments become unknown. IDs are not persistent entity/block tracking IDs.

Opaque non-fire fragments erase ownership where they actually cover fire. Fragments that actually mix with the destination write a separate, conservative uncertainty union after the same depth test. Fully opaque standard-alpha blending is kept as opaque evidence. The union starts once fire has been submitted, so earlier sky blending cannot poison later targets. Later draws cannot erase this uncertainty. This can exclude pixels that were subsequently covered by opaque geometry; it favours less evidence over false ownership. Hand/HUD geometry is replayed for coverage, but is not labelled as world fire.

Depth clears are mirrored, including the hand pass. Colour blits, custom shaders, stencil, multisampling, partial RGB writes and exceeded geometry budgets reject a sample through its metadata. Uninstrumented third-party draw entry points cannot be guaranteed detectable, so even a sample with no issues remains experimental.

## Run

From `fire-detection/mod`, build with Java 21 (required by Fabric Loom); the isolated Minecraft development client was tested with Java 17:

```powershell
./gradlew.bat runClient -PfirelabelDebug=false -PfirelabelOwnership=true
```

The defaults sample every 180 world frames and export at most 8 frames containing submitted fire geometry. Empty scenes do not consume the export limit. To capture more:

```powershell
./gradlew.bat runClient -PfirelabelDebug=false -PfirelabelOwnership=true -PfirelabelOwnershipEvery=30 -PfirelabelOwnershipLimit=200
```

Installed Minecraft JVM arguments use the equivalent `-Dfirelabel.ownership=true`, `-Dfirelabel.ownershipEvery=30`, `-Dfirelabel.ownershipLimit=200`. Leave the feature off for normal recordings. Sampling replays geometry and queues three image transfers into a reusable pixel buffer. Subsequent frames poll a GPU fence with a zero timeout; only completed transfers are mapped. A single background worker copies the pixels, writes PNGs and metadata, and hashes the files. There is at most one pending sample; busy capture opportunities are skipped. No per-draw transform-feedback readback or PNG encoding runs on the game thread. Driver submission and replay can still cost time, so capture is not suitable for timing/lag benchmarks until measured in the actual scene.

For ownership-mask collection alone, add `-PfirelabelLegacyLabels=false` (installed JVM: `-Dfirelabel.legacyLabels=false`). This skips the older per-frame raycast/bounding-box labeller and its matrix/entity capture. Sync IDs and sampled ownership metadata remain available, but no normal dense label log is emitted. Legacy labels remain enabled by default. `-Dfirelabel.profile=true` logs their CPU time periodically when enabled.

## Export contract

Files live under `<game directory>/firelabel/ownership-<session UUID>/`:

- `frame-00000123-rgb.png`: lossless RGB, captured before sync strip/debug overlays.
- `frame-00000123-ids.png`: raw RGBA **data**, not a display image.
- `frame-00000123.json`: completion marker, capture frame ID/client tick, dimensions, image SHA-256 hashes, issue list and quad metadata.

Decode `id = R + 256*G + 65536*B`. Zero is non-target coverage/background; `16777215` is unknown. Other values identify one quad in the JSON. Alpha is `sheet+1`, or 255 for unknown. Read the PNG bytes directly without premultiplying alpha or compositing it; the low alpha values are metadata, not opacity. All PNGs have top-left origin. For a selected quad, its ID is visible target ownership; unknown pixels must be ignored, and other IDs are other planes.

`clip_corners` are four `(x,y,z,w)` clip coordinates in submitted vertex order. Convert a corner to image coordinates as `x_px=(x/w+1)*width/2`, `y_px=(1-y/w)*height/2`; clip against the view volume before cropping. `uv` gives local fire texture coordinates, preserving mirroring. `sheet` and `row` name the sprite actually displayed. These full quad corners can exist even when the visible ID mask is empty. They are not an inferred amodal visibility mask.

RGB and IDs are read from the same rendered frame. JSON is written last; ignore incomplete pairs without it. The matching `frame_id` links to the recorder's normal label/sync frame counter, but the standalone RGB omits the strip intentionally. No alignment to an externally encoded video is assumed without checking that video's sync strip.

## Validation so far (2026-10-17)

Direct Java 8-target compilation against cached Minecraft/Fabric dependencies passed. The cached JUnit launcher ran **216 tests: 216 passed**, including ID byte preservation at low alpha, PNG vertical orientation and opaque RGB export.

Real OpenGL controls ran in a hidden GLFW compatibility window on an NVIDIA RTX 4060 Laptop GPU (OpenGL 4.6, driver 592.82): **32,835 assertions passed**. This count includes a byte-by-byte framebuffer comparison; it is not 16,449 independent scenes. Controls cover:

- isolated planes and distinct front/back ownership for overlapping fire;
- an opaque wall covering half the target;
- actual texture alpha-test holes;
- blended coverage and persistent uncertainty under later opaque draws;
- depth-clear/hand ordering;
- culling, viewport, scissor, 24-bit IDs;
- client arrays and chunk-style VBO arrays, nonzero vertex offsets;
- GPU corner/UV capture and graphics-state restoration;
- identical source RGBA with replay enabled versus disabled;
- asynchronous PBO transfer byte parity and buffer reuse. The test uses `glFinish` to complete deterministically; production only polls without waiting.

These controls test the renderer directly. A real Minecraft world also opened and exported samples, verifying hook invocation. Those intermediate samples were rejected: the first implementation treated vignette darkening as full-screen uncertainty, and the next had missing geometry/unmapped fragments. The current build skips the explicit vanilla vignette pass and refreshes the fire atlas cache on sprite replacement; fresh in-world validation is still pending. Do not use those earlier sessions for training. The controls alone do not certify real-world masks. The full offline Gradle `test remapJar ownershipSmoke` build subsequently passed with Java 21 and the process-local socket-directory flag below. All 216 tests and GPU controls passed under Gradle too, and `build/libs/firelabel-0.1.0.jar` was remapped successfully. The cached LWJGL smoke process printed an unsupported-JNI-version warning on Java 21; the same controls also passed under Java 17. Latest-build Minecraft world validation is separate and still pending.

The normal reproducible checks, when Gradle can start, are:

```powershell
./gradlew.bat test remapJar ownershipSmoke
```

## Required before training

Run a dedicated Minecraft capture with isolated fire, a wall, a burning entity/body, crossed planes, thin occluders, coplanar ties, particles, HUD/hand, offscreen clipping and a moving camera. Compare normal RGB with instrumentation off/on in a deterministic scene, inspect ID/unknown masks and geometry alignment, and verify sync IDs. Check vanilla graphics modes separately; fabulous/postprocessing and shader mods are not supported by this prototype.

Inspect sampling/texture filtering boundaries and mark a boundary band uncertain when making compressed training crops. Do not train on rejected samples, silently promote experimental samples to oracle data, or treat hidden texture as observed. Once validated, this renderer can supply per-plane visible ownership labels for the occlusion model; existing survival footage still has no retroactive oracle masks.

## Java 17 selector / world-open crash

A direct development client reached the title screen, but opening a single-player world failed in Netty `NioEventLoop.openSelector`, with `Unable to establish loopback connection` and `UnixDomainSockets.connect0: Invalid argument: connect`. A process-local socket directory fixes the selector/pipe check on this machine:

```text
-Djdk.net.unixdomain.tmpdir=<repo>/fire-detection/mod/build/ownership-launch/socket-tmp
```

Create that directory before launch. This changes only the launched JVM, not Windows networking/security settings. An isolated `Selector.open()` plus `Pipe.open()` test passed with this setting, and Minecraft was relaunched with it. World entry and intermediate sample export succeeded with it. Current optimized ownership masks still need fresh live validation. Gradle also starts successfully with this setting. Use Java 21 for Fabric Loom; Java 17 cannot load the build plugin.

## Legacy labeller performance changes

Normal label semantics are preserved: the GUI coverage buffer is read lazily once per frame and shared across fire regions, projected texel bounds avoid temporary arrays/boxes, and entity-hitbox occlusion uses an exact bounding-volume hierarchy before the original ray-box leaf test. The hierarchy is checked against the previous linear search over 10,000 randomized queries, including excluded entities and camera-inside cases. Block/world raycasts are still required and can remain expensive.

A same-input 8,192-quad CPU visibility benchmark (median of five batches) measured 128.597 ms before versus 117.700 ms after, with identical checksum -4896984729345595583: about 8.5% lower CPU time for that kernel. Both versions allocated 1.188 MiB after JIT optimization; no allocation improvement is claimed. A separate cold entity benchmark with 1,500 boxes and 20,000 rays produced the same 2,014 hits: linear search 351.541 ms; indexed queries 30.483 ms plus 12.815 ms to build the index. These are isolated workload measurements, not measured game FPS gains.

The intermediate live export at 2560x1440 spent about 49 ms replaying and 108 ms in synchronous image readback (writer work was already off-thread). This motivated the deferred PBO transfer. Latest-build live frame-time and mask validation are pending; no smooth-recording claim is made from unit tests.
