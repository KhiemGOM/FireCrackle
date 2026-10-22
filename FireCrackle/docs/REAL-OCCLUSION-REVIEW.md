# Real occluder intervention and related research

17 October 2026. This is an independent annotation/intervention pilot on existing footage, not a new trained model or a real ownership oracle. Production matcher and recorder are unchanged.

## What was actually obtained

Reviewed 50 real patches from 50 distinct frames. Each review card showed native context with the selected quad and a rectified view. It did **not** show the answer sprite, model masks or matcher predictions. The reviewer was Codex, not an independent human; some frames had been seen in earlier research, so this is not perfectly blinded annotation.

Selection used geometry alone: combine the separated survival36 and additional38 pools from the prior pilot, take the quad with largest minimum projected edge per frame, choose 50 evenly spaced frames from the55 unique frames, then shuffle with seed1702. No class correctness, model ranking or image-colour filtering selected cases.

The annotation file records polygons in rectified coordinates0..100 and a reason for each case. There are31 cases with a marked non-target region and37 with an uncertain region; these sets overlap. The remaining unmarked area is **potential evidence**, not certified visible target fire.

Three states are kept conceptually separate:

- **Visible non-target material:** recognizable rod/head interior, shield/arm, held block, solid geometry, crosshair or particle interior. Some such material may be behind a transparent target texel rather than physically occluding the plane. The label means its observed RGB is unrelated to the target, not a certified depth ordering.
- **Uncertain:** blended boundaries, extreme grazing angles, heavily compressed or overlapping fire faces. No visible ownership is invented for these pixels.
- **Unmarked:** leave the unchanged native colour gate and matcher to use the pixel. This does not certify that it belongs to the target plane.

This corrects an important limitation of the original proposal: manually drawing outlines from RGB does **not** produce exact per-plane ground truth when two flames share colours and pixel grids. We can test clear non-target removal now. We cannot recover an unrecorded dense oracle mask merely by reviewing the old video. These annotations must not be marketed as such or used as unquestioned dense supervision.

All seven unannotated contact sheets and all seven rendered annotation-overlay sheets were inspected. Polygons were frozen before their first matching evaluation. No polygons were changed in response to results. The displayed contact sheets withheld the sprite identity; the metadata file still retains the original labels for subsequent scoring.

## Result of removing those regions

Every condition uses exactly the original native samples,128 appearance candidates, shared-gain scorer and supplied quad. Masks only attenuate fixed sample weights: no normalization by remaining area, hidden-texture reconstruction or candidate-conditioned mask. Fields are64x64 and bilinearly sampled at the existing four probes per texel. These are exact supplied quads only; rough-quad masking would require explicitly reprojecting the annotation field, so no rough result is inferred from this experiment.

| Intervention | Correct top1 /50 | Nonzero correct | Clear results | Wrong clear | Zero-evidence cases |
|---|---:|---:|---:|---:|---:|
| Existing colour mask |18|18|31|20|1|
| Exclude marked non-target polygons |17|17|30|19|1|
| Exclude only eroded polygon interiors |18|18|31|20|1|
| Expand non-target polygons by1 mask pixel |17|17|30|19|1|
| Exclude non-target plus uncertain regions |16|16|27|17|9|
| Spatial placebo: circularly shifted polygons |18|18|27|19|1|

Core/expanded conditions erode/dilate the excluded region by one64x64 mask pixel using a3x3 filter. The placebo shifts the original region17 rows and23 columns with wraparound. It preserves excluded **mask area**, not the amount of colour-qualified/native-weighted evidence, and is therefore a limited spatial placebo.

The unmodified baseline matches the prior per-case results exactly. All50 cases stay in the denominator. A zero-score rank is not counted as useful nonzero evidence. Clear status uses the existing support/region/.03-margin gates, unchanged; these gates are visibly unreliable on this world-quad set. Reducing wrong-clear counts by suppressing evidence is not equivalent to improving recognition.

The definite/expanded masks change one correct result to wrong: r06 /29040-0-5. That patch is dominated by grey particles with tiny surviving warm/white fragments. Coarse polygons can erase a discriminating fragment or alter an already fragile ranking. Eroding to the interiors removes that loss but creates no rescue. Excluding uncertain regions creates one rescue and three losses, while increasing zero-evidence cases from1 to9. It mostly discards evidence rather than resolving ownership.

Paired frame bootstrap,10,000 resamples, seed1703, unadjusted95% percentile intervals for percentage-point change: definite -6..0, core0..0, expanded -6..0, non-target+uncertain -12..+4, spatial placebo0..0. Frames remain from the same recording and methods were tried together; these intervals are descriptive, not generalization proof.

**Interpretation:** obvious non-fire exclusion alone did not improve this sample. This neither proves that accurate fire-plane ownership is useless nor establishes that a better model will fix it. The difficult flame-on-flame regions remain mostly uncertain, and the polygons themselves are approximate. We should not train another model on these as if they were exact masks.

## What related work actually offers

The following are primary papers, author repositories or official implementation documentation, inspected17 October2026. Their relevance to Minecraft is an engineering inference; none provides a measured result on our footage in this task. No pretrained weights were downloaded and no SAM/XMem/GrabCut/Omnimatte inference benchmark was run.

| Work | Method supported by the source | Application to our case and limitation |
|---|---|---|
| [GrabCut, Rother et al., SIGGRAPH2004](https://www.microsoft.com/en-us/research/publication/grabcut-interactive-foreground-extraction-using-iterated-graph-cuts/) | Interactive segmentation combining regional colour modelling and edge information through iterative graph-cut optimization; also discusses border matting | Can help expand a few marked rod/body/overlay interiors into outlines. It does not supply object identity when foreground and occluder share fire colours. |
| [SAM2, Ravi et al.,2024](https://arxiv.org/abs/2408.00714), [official video predictor](https://github.com/facebookresearch/sam2/blob/main/sam2/sam2_video_predictor.py) | Promptable image/video segmentation with streaming memory; official code accepts points, boxes and masks and supports corrective input | Candidate annotation assistant for an identifiable occluder across nearby frames. A box around the fire is not a guarantee of separating its individual crossed planes. Treat outputs as predictions and review them. |
| [XMem, Cheng and Schwing, ECCV2022](https://arxiv.org/abs/2207.07115), [author implementation](https://github.com/hkchengrex/XMem) | Video object segmentation with sensory, working and long-term feature memories | Temporal identity can help keep track of a rod/body/foreground object while it crosses fire. Rapid sprite changes and similar overlapping flames still require a task-specific test. |
| [Omnimatte, Lu et al., CVPR2021](https://omnimatte.github.io/) | Given video and rough subject masks, estimates subject-associated colour/alpha layers, including effects such as smoke and reflections; trained on the input video | Useful related layered-compositing idea for translucent contamination. Its objective often associates smoke with its source, whereas we want smoke excluded from the target fire texture. It is not a ready-made ownership oracle. |
| [BOP visibility implementation](https://github.com/thodan/bop_toolkit/blob/master/bop_toolkit_lib/visibility.py) | Computes visible object surface masks by comparing scene distance images with rendered target distance images within a tolerance | Directly motivates known-scene visibility labels. RGB-only footage lacks those depth images; cutout alpha, transparent particles, overlapping quads and draw order need additional handling. BOP19's missing-depth-visible policy should not be copied as certified visibility in our pipeline. |
| [BlenderProc BOP generation](https://dlr-rm.github.io/BlenderProc/examples/datasets/bop_object_pose_sampling/README.html), [segmentation output](https://dlr-rm.github.io/BlenderProc/examples/basics/semantic_segmentation/README.html) | Generates RGB with instance segmentation and pose data from known scenes | Supports the general engine-generated-label approach. Our Minecraft renderer is the relevant engine; re-creating it in Blender would introduce another domain/rendering mismatch. |

The useful distinction is **visible target-instance segmentation**, not just semantic fire segmentation. Amodal segmentation predicts hidden shape; it is not the evidence mask we want. We should not score guessed hidden texture as observed evidence.

## Recorder inspection: what exists and what is missing

Inspection was read-only. Relevant local sources:

- `fire-detection/mod/src/main/java/org/firecracking/firelabel/EntityFireCapture.java` and `mixin/EntityRenderDispatcherMixin.java` capture the actual emitted entity-fire vertices and assemble quads. This gives an appropriate geometric identity hook, but does not record which pixels survive final rendering.
- `core/QuadVisibility.java` samples texture opacity and projected cells, caches occlusion per macro cell, and accumulates counts and a bounding box. It stores no dense visibility bitmap. GUI coverage is sampled9 times per projected cell rather than preserved as a per-plane native image.
- `FireLabeler.WorldOccluder` tests opaque full-cube blockers. `EntityOccluder` uses hitboxes rather than rendered entity models, and the burning entity is excluded from its own fire's hitbox test. These are intentional approximations; they cannot produce exact per-pixel body/rod/fire ownership.
- `GuiMask.java` uses framebuffer alpha after the world pass to measure what the GUI draws. That is a useful overlay-coverage mechanism, but it does not isolate individual fire planes or account for every world/particle layer, and the old JSON only retains summaries.
- Block-fire tracking currently notices rendered fire blocks; it is not itself a final-fragment plane-ID output.

Simply exporting the existing `vis` cache as a PNG would make an approximate mask look precise. It would retain the same model/hitbox and inter-plane limitations. I do not recommend labelling that export as ground truth.

## Proposed reliable mask source for a short future recording

This is a design, **not an implemented or game-validated export**. A short new capture becomes useful after these checks pass; no new recording is needed for the completed manual pilot.

1. Assign a per-frame ID to **each fire quad**, not only each entity/fire block. Link it to capture frame, entity/block source, emitted quad index, UVs and sprite frame. Stable cross-frame identity is separate from correct within-frame ownership.
2. Produce a separate render attachment/pass that follows the actual scene's projection, geometry, texture-alpha discard, culling, depth testing/writing and draw order. Capture surviving fire-fragment IDs alongside other occluders. Replaying only all fire quads against a final depth buffer is insufficient where other fire or transparent layers do not leave the necessary depth/identity information. An ID pass must not alter the displayed RGB or feed its labels into the user-facing matcher.
3. Preserve a separate coverage/contamination channel for translucent particles, smoke-like layers, GUI and first-person elements. A mixed pixel need not have a single trustworthy owner. Use an explicit unknown state or a verified contribution threshold, rather than forcing it to one plane.
4. Save native-resolution visible-ID/unknown images, per-plane quad metadata and, if useful, a target-alone coverage image. The target-alone image describes full coverage, not visibility. Validate that the visible mask never creates target evidence outside its alpha-tested coverage. Coincident fragments require reproducing actual depth ties/render order or being flagged uncertain.
5. Align every mask to the actual captured framebuffer frame. Save capture IDs, dimensions, video/capture alignment metadata and hashes. RGB compression can blend neighbouring ownership regions even if the pre-encode ID mask is exact; train with codec degradation and exclude/sensitivity-test boundary bands.
6. Validate in game with isolated fire, opaque wall, own burning entity body, narrow blaze rods, crossed fire planes, coplanar ties, translucent particle overlay, GUI/crosshair, partial off-screen quads and moving camera. Compare RGB pass unchanged with export disabled/enabled, including frame timing/alignment. Only after these pass should we call the resulting labels render-derived ground truth.

Once available, train on real RGB patches paired with those masks, retaining separate recordings for final matching validation. SAM2/XMem can be tested meanwhile as annotation accelerators on visible occluders, but they should not be mistaken for engine ground truth or automatically trusted on same-colour flame overlaps.

## Reproduction and evidence

```text
python FireCrackle/scripts/fire-ai/occlusion_review/prepare.py
python FireCrackle/scripts/fire-ai/occlusion_review/masks.py
node FireCrackle/scripts/fire-ai/occlusion_review/evaluate.mjs
python FireCrackle/scripts/fire-ai/occlusion_review/summarize.py
```

Use the existing `.board/fire-ai/venv/Scripts/python.exe`. `prepare.py` selects geometry and generates review cards; `annotations.json` contains the50 reviewed polygon records. `masks.py` rasterizes only those records and refuses to silently replace an existing freeze. The evaluator verifies the annotation hash before reading truth for scoring. `summarize.py` rechecks the baseline against previous results, all per-case counts, module hashes and the frozen manifest/annotation hashes.

Frozen annotations SHA256: `093ead00bb4c05ec85b7c5c46a46d346f7068e5794ef241f1d2979a0340f4b73`. Six conditions x50 cases =300 method evaluations. No model was trained on the review masks. Six Python controls pass for identity masks, nested erode/dilate regions, uncertainty, placebo area, polygon validation and50 unique annotation records. Raw RGB, contact sheets, generated mask fields, freeze and score/audit JSON remain ignored under `.board/occlusion-review/`; no Minecraft assets or pretrained dependencies are bundled.

**Decision:** keep production unchanged. The existing footage supports conservative non-target interventions and literature-guided feasibility work, but not a dense real ownership oracle. A render-faithful export is the stronger route to reliable training masks; coarse hand masks and generic fire segmentation did not establish a useful replacement here.
