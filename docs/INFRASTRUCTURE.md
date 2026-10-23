# Shared infrastructure: reuse it, never rebuild it

**This is a hard rule for every agent and contributor.** A lot of this repository is infrastructure that was
built once, measured, optimized and made bit-exact: decoding, colour conversion, unveil, GUI masks, scan
journals, job control, atomic writes, frame lookup, projection. Every time an agent writes "its own quick
version" instead, the project gets a second implementation that is slower, subtly different, untested against
the real recordings, and that the next fix will miss. That has happened over and over. Stop it.

## The rules

1. **Search before you build.** Before writing any helper, decoder, parser, converter, cache, mask, projection,
   progress tracker, file writer or tool runner, look it up here, then `git log --oneline | grep -i -E "one |shared|unif"`
   and grep the code. Most "new" things already exist.
2. **Extend the canonical implementation; do not write a parallel one.** Not in another language, not in a
   research script, not in a benchmark, not in a GUI tool, not "just for this experiment". If the existing one
   lacks a feature, add the feature *there*, with a test.
3. **Other languages bind; they never port.** Python and TypeScript call the Rust source through the existing
   bindings (`veil_abi.rs` → `veil_native.py` / `veil.ts` WASM, `portal_undo.py`, `gui_mask_native.py`). If a
   piece you need has no binding yet, add a thin binding the same way. Copying the math into a second language
   is forbidden.
4. **"My version is simpler / faster" is not a reason.** The optimized paths have measured parity (byte-
   identical output against FFmpeg/swscale, identical decisions on the real recordings) and measured speed. A
   replacement must, in one change: beat the existing one on the same benchmark, reproduce its results exactly
   on the real recordings, switch **every** caller over, and delete the old code. Otherwise improve the
   existing one instead. Two live implementations of the same thing is never an acceptable end state.
5. **Experiments are not exempt.** Research code that reimplements production logic produces numbers that do
   not transfer to production. Use the production code from research (the bindings exist for this).
6. **Register what you add.** A new reusable piece goes into the table below in the same commit, with its one
   entry point.
7. **Found a duplicate? Don't copy from it.** Note it under "Known duplicates" and fold it into the canonical
   one when you touch that code.

If you truly cannot reuse something (wrong process boundary, licensing), stop and ask the owner before writing
a second implementation, and record the decision here.

## Registry

### Video decoding, frames and time

| What | Canonical | Notes |
|---|---|---|
| FFmpeg / ffprobe / yt-dlp / JoltCracker download, pinning, lookup | `FireCrackle/src-tauri/src/external_tools.rs` (`video_tools`, `link_tools`, `command`) + `FireCrackle/release/runtime-lock.json` | Bundled FFmpeg is the gyan **full** build (libdav1d), pinned by hash; guarded by `scripts/test_runtime_lock.py`. Never fetch or assume another FFmpeg. |
| App scan decode feed (decoder choice, NVDEC/dav1d probe, yuv vs rgb pipe, priority, worker budget) | `ScanFeed` in `FireCrackle/src-tauri/src/pov.rs` | Shared by all three scans. See `fire-detection/perf-lab/REPORT.md` for why each choice was made. |
| yuv420p → rgb24 | `fire_core::yuv::yuv420p_to_rgb24` (`fire-detection/core/src/yuv.rs`) | Bit-identical to the bundled swscale (BT.709/601 by stream tag). Do not write another colour conversion. |
| Frames from a pipe, parallel frame workers, ffprobe parsing | `fire_core::video` (`read_frame`, `parallel_frames*`, `scan_workers`, `parse_probe`) | |
| Exact frame timestamps from `showinfo` | `studio_core::frames::{ShowinfoTimes, parse_showinfo}` | Exact integer pts × time base; `pts_time` only as a fallback. |
| Frame index, nearest frame, keyframe before, frame at time | `studio_core::index` (`build_index`, `nearest_frame`, `nearest_by`, `FrameIndex::frame_at_time`, `keyframe_at_or_before`) | Frontend: `src/lib/frameMath.ts` (`clamp`, `clampFrame`, `frameAtTime`). Never `time × fps`. |
| Preview / exact-frame decode | `studio_core::frames::{decode_preview, decode_exact_png, decode_job, seek_arg}`; frontend `src/lib/frameBuffer.ts`, `exactFrame.ts` | |
| Timecode text | `src/lib/timecode.ts` | |

### Image preprocessing (detection)

| What | Canonical | Notes |
|---|---|---|
| Automatic unveil (veil detection, inverse colour) | `fire-detection/core/src/veil.rs` | Bindings: `veil_abi.rs` → `bench/no_fire/veil_native.py`, `FireCrackle/src/lib/veil.ts`. See `AGENTS.md` and `CLAUDE.md`. |
| Portal undo, world-translucency abstention | `fire-detection/core/src/portal.rs` (`veil::portal`) | Binding `bench/no_fire/portal_undo.py`. |
| GUI-piece mask (scale fit, HUD, screens) | `fire-detection/core/src/gui_mask.rs` | Binding `bench/no_fire/gui_mask_native.py`; app reader `src/lib/guiMask.ts`. Metadata only, no second inverse. App packing `studio_core::gui::pack` flags open-screen pixels (`SCREEN_FLAG`); unveil protects only those (`screenWorld` / `guiScreenCoverage`), never the HUD. The app analyzer uses the shared `studio_core::gui::pov_textures`. |
| GUI presence / interaction detector | `fire-detection/core/src/gui_interaction_fast.rs` (policy, geometry cache, workers), `gui_screens.rs`, `gui_tooltip.rs` | `PanelMatch::recipe_book` = matched at the recipe-book pose; `merge_neutral_panel` then masks the book, its tabs and any item tooltip (`Detection::tooltips`, piece `ItemTooltip`). One frame has one GUI scale: scans use `detect_at_hud_scale` with `GuiDetector::hud_scale_with_hint` (studio_core `GuiAnalyzer::hud_scale`); the mask path passes the HUD scale itself. Add new screen layouts here, never in a separate matcher. |
| First-person acceptance, on-fire overlay | `fire-detection/core/src/pov.rs`, `overlay.rs` | |

### Geometry and projection

| What | Canonical | Notes |
|---|---|---|
| Minecraft perspective projection (vertical FOV, view space → pixels) | `fire_core::overlay::project` (`fire-detection/core/src/overlay.rs`) | **Any camera / perspective work (camera fitting, perspective reversal, projecting world blocks into frames) builds on this.** Do not write another projection. |
| Minecraft camera (eye, yaw, pitch, roll, FOV) and the camera solver (perspective reversal) | `fire_core::camera` (`Camera::project`, `solve` for any clicked points, `solve_guided` for the automatic guess + 1–4 clicks, `fit`, `fit_label_frame` for label logs, `corner_rms` to score a camera on logged quads; `logged_blocks` / `logged_quads` parse label rows) | Built on `overlay::project`. Run on label logs: `cargo run --release --bin fire_camera <labels.jsonl>`. |
| Vanilla fire block geometry (every baked quad by attachment, with per-corner UV) | `fire_core::fire_model` (`block_quads`, `block_candidates`); locating a fire from a camera + box: `fire_core::fire_locate` (`locate`, `predicted_box`) | 1.16.5 `BakedQuadFactory` rules; identical models in 1.21.11. Entity fire is not in it yet. |
| Straight edge segments in a frame (LSD-style; true direction of staircase edges) | `fire_core::lines` (`segments`) | Use it for any line / edge-direction work; do not write another detector. |
| Automatic perspective reversal from pixels (stage 1: rotation and FOV from Manhattan vanishing points) | `fire_core::reversal` (`orientation`, `explain`, `rotation_error`) | Built on `lines` and `camera::Camera`. Scored on recordings with `cargo run --release --bin fire_reversal VIDEO JOINED.jsonl`. Later stages (block lattice, `camera::fit` with line residuals, tracking) extend this module. |
| Camera answer key in recordings | label mod `CameraPose` → `"cam"` in every captured row (schema v3.3, `fire-detection/mod/PLAN.md`) | |
| Fire quad fit, match, refine, rasterize | `src/lib/quadOptimizer.ts` (Nelder–Mead), `quadMatch.ts`, `quadRefine.ts`, `quadEcc.ts` + `ecc.ts` (masked homography ECC, OpenCV parity), `quadRaster.ts`, `quadTransform.ts` | |
| Animation atlases / sprite phases | `FireCrackle/docs/ANIMATION-ATLASES.md`, `src/lib/animationAtlases.ts`, `studio_core::label` | |

### App plumbing

| What | Canonical | Notes |
|---|---|---|
| Background job cancel / child-process stop / panic guard | `FireCrackle/src-tauri/src/jobs.rs` (`JobControl`, `guarded`) | Every scan, download and tool run. |
| Resumable scan journal + cache keys | `FireCrackle/src-tauri/src/scan_cache.rs` (`Journal`) | Keyed by the shared scan pipeline version and one video fingerprint. |
| Atomic file write, scratch dirs | `studio_core::fsutil::{write_atomic, ScratchDir}` | |
| Hidden-window process builder | `external_tools::command` | |
| Hex digest | `hex` in `FireCrackle/src-tauri/src/lib.rs` | |
| Status polling | `src/lib/poll.ts` (`startPolling`) | Non-overlapping, drops late answers. |
| Scan speed / time left | `src/lib/scanSpeed.ts` (`ScanSpeedTracker`) | Scans and downloads. |
| Per-video UI memory | `src/lib/videoStorage.ts` | |
| Image / canvas I/O | `src/lib/canvas.ts` | |
| Picture correction (veil → portal → Enhance) on one frame | `src/lib/veilFrame.ts` (`processFrame`) | Misc-tools comparison and gallery: `src/lib/comparisonPost.ts` (`comparisonPictures`, `unveilPreview`). |
| Gallery previews (raw and auto-unveiled), movement score | `src/lib/guiThumbnailCache.ts` (`previewFrames`, `unveiledPreviews`, `previewScreen`), `src/lib/guiAimReview.ts` (`previewPixelChange`, `keepMask`) | |
| Proof export (name, save dialog, download), MB formatting; copy / save any PNG picture | `src/lib/proofExport.ts` (`copyPicture`, `savePicture`) | |
| Image viewer (click a picture: zoom, pan, native size, pixel colour, copy, save) | `src/components/ImageViewer.tsx` (`Viewable`, `ViewButton`, `ImageViewerProvider`), logic `src/lib/imageViewer.ts` | **Every picture opens here**; only the Label/Images video viewer is its own tool. It shows the displayed picture's source as is (post effects come first, in the tool); its only logic is swapping in the same picture at native resolution (`native`). Pan/zoom math is `lib/zoom.ts`. |
| A frame at the video's own resolution | `src/lib/exactFrame.ts` (`nativeFrame`; `exactFrameUrl` for the paused Label picture) | `backend.frame` is the scaled display JPEG. A gallery card's unveiled frame at native size: `comparisonPost.ts` `boundaryPicture` (via `unveilPreview`). |
| Modal guard for hotkeys | `src/lib/shortcutFocus.ts` (`modalOpen`) | Any `aria-modal` dialog owns the keyboard. |
| Error text and error popup | `src/lib/appErrors.ts` (`failureMessage`, `reportError`) | Never `String(e)`. |

### Training data

| What | Canonical | Notes |
|---|---|---|
| Training data inventory and coverage | `docs/TRAINING_DATA_CATALOGUE.md`, `scripts/catalogue_training_data.py` | Required before any training run (see `AGENTS.md`). |

### Standalone tools

| What | Canonical | Notes |
|---|---|---|
| FPS-overlay cadence (cut detection from the F3 FPS counter) | `fire-detection/hud-cadence` (published as its own repo) | Kept out of FireCrackle by owner decision. Its reader, phase analysis and Jolt cross-check live only there. |
| Recording mods (labels, GUI, HUD) | `fire-detection/mod`, `mod-gui`, `mod-hud` | Learn from these before writing another mod. |

## Known duplicates (do not copy from these; fold them in when you touch them)

- `FireCrackle/src/lib/hudOverlay.ts` mirrors `fire_core::overlay`'s view transform and projection in
  TypeScript. New projection work goes into `overlay.rs` and reaches the browser through a WASM binding like
  `veil.ts`, not through more TypeScript math.
- `fire-detection/hud-cadence` runs its own FFmpeg pipe instead of `fire_core::video`. That is deliberate (it is
  a standalone public tool with no dependency on this repo); do not copy it into FireCrackle.
- Historical strict-window veil primitives exist only for reproducibility tests (see `AGENTS.md`).
- `VideoPane.tsx` `correct()` and `comparisonPost.ts` `comparisonPictures` both assemble the `processFrame` call
  (GUI coverages, screen evidence, portal world). Fold them into one shared helper when either is touched.
