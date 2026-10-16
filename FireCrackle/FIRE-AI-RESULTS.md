# Learned quad matcher experiments

The small model learns the synthetic task and runs quickly, but **does not
transfer reliably to the real clips**. Keep the application matcher unchanged.
This is a research experiment, not an automatically accepted labeller.

The experiments below preserve the small synthetic pilot, survival fine-tuning,
and the subsequent large synthetic-only run on real no-fire backgrounds.

## Model and protocol

- Torchvision MobileNetV3-Small, trained **from scratch**, no ImageNet weights.
- Input 64×64 RGB rectified from the supplied quad, plus a candidate-independent
  rough fire-colour mask. The mask has no access to the expected sprite.
- First convolution changed to 4 channels/stride 1 to retain spatial detail;
  classifier changed to 128 appearances: sheet×64 + row×2 + mirror.
- 1,649,200 parameters, local checkpoint 6,719,849 bytes. PyTorch 2.10.0+cu128,
  Torchvision 0.25.0+cu128; RTX 4060 Laptop 8 GB. No model/runtime bundled in the app.
- 16,384 synthetic training crops (128/class), 20 epochs, AdamW, fixed seed 17.
  Training took 74.27 s. Checkpoint selection used **only** the 1,024 synthetic
  validation crops; first maximal top 1 checkpoint was epoch 11.
- Frozen checkpoint SHA-256:
  `c0594f7251b5aab0d2fe0619e8bf4bc4dcc7247db517dcb2407a77131fe9ef0c`.
  No training, fine-tuning or threshold selection used real crops or codec tests.
  CPU/GPU floating-point training is not promised bit-identical on other hardware.

## What the synthetic renderer does

`scripts/fire-ai/render.py` loads the local vanilla 16×512 sprite sheets, selects
the exact 16×16 animation row and mirror, projects a physical 3-D rectangle through
a pinhole camera, and samples nearest texels at native delivery pixel centres.
Low-alpha fragments are discarded; transparent sprite pixels leave the background
visible. There are no separately rasterized cell borders or artificial grid lines.
Rectification uses bilinear native-image sampling into 64×64.

This models **one isolated cutout plane**, not the full Minecraft renderer.
It does not reproduce the complete block/entity plane assembly, depth buffering,
smoke, per-fragment lightmap, GUI, atlas UV inset, mipmapping or post-processing.
Those omissions matter; synthetic success is not proof of Minecraft recognition.

Randomization includes physical yaw/pitch up to about 57°, roll up to 37°, aspect
ratio 0.55–1.45, position/distance, native projected size, procedural block-like
backgrounds, brightness, mild fog/noise/blur, solid foreground occluders, and
1.7% corner noise in training. Rendering is at 160×160 before rectification; the
source sprite is never enlarged and degraded directly at model-input resolution.
Train/validation/test use distinct seeds and scenes. All 128 classes necessarily
share the same known source sprites: this tests recognition of known appearances,
not generalization to unseen textures/resource packs.

## Synthetic results

Exact top 1 means the correct sheet, row and mirror, not merely the right row.

| Frozen evaluation | Exact top 1 | Top 3 | Wrong at softmax≥0.95 / above threshold |
|---|---:|---:|---:|
| Clean independent scenes |2048/2048 (100%)|2048/2048|0/2047|
| Occlusion/noise/blur, smaller planes |2022/2048 (98.7%)|2041/2048|1/1980|
| Rough supplied corners, independent scenes |2036/2048 (99.4%)|2047/2048|4/2024|
| Animated shots, uncompressed |1024/1024 (100%)|1024/1024|0/1021|
| Same shots, H.264 4:2:0 CRF 24 |989/1024 (96.6%)|1013/1024|6/936|
| Same shots, H.264 4:2:0 CRF 32 |723/1024 (70.6%)|866/1024|47/602|

Codec tests use actual FFmpeg/libx264,32 held-out 32-frame shots at 60 fps,
one sprite step every 3 frames, a stable background/lighting/plane per shot,
slight motion, and keyframes at shot boundaries. Frames within a shot are
correlated: these are 32 independent scenes, not 1,024 independent recordings.
This is a local 160×160 CRF test, **not an exact YouTube encoding simulation**.
Neither actual H.264 nor JPEG was included in the first training set; blur/noise
were only approximate training variation. Codec test data was not used to retrain.

The current production colour matcher was also run on the same fixed 128 native
frames (one every 8 frames across the 32 shots). Both methods received identical
native frames and exact supplied corners; neural rectification is its preprocessing.

| Same 128 cases | Current matcher top 1 | Neural top 1 | Current matcher top 3 | Neural top 3 |
|---|---:|---:|---:|---:|
| Uncompressed |128|128|128|128|
| H.264 CRF 24 |117|125|121|126|
| H.264 CRF 32 |64|96|82|110|

The neural model ranks more compressed synthetic cases correctly, but its raw
softmax confidence is uncalibrated. These numbers do not establish safe acceptance.
On 256 independent background-only negative controls,8 still received a sprite
prediction with softmax≥0.95. A closed-set 128-class network is not a no-fire detector.

## Real recordings and transfer

The earlier statement that only one recording had quads was wrong. Streaming the
local logs confirms the survival recording also has actual per-plane corners/UVs:

| Recording | Decoded labelled frames | Block quad entries | Entity quad entries | Overlay quad entries |
|---|---:|---:|---:|---:|
|quad1|7094|59030|10696|212|
|survival1|82686|940501|84856|22830|

These are repeated per-frame entries, **not independent clean examples**.
`vis` includes scene/GUI visibility checks, but does not guarantee that another
fire plane or smoke has not obscured the particular labelled appearance.

Survival screening selected at most one candidate per 5 seconds from frames at
stride 120, with known corners, consistent winding/UV/mirror, visibility≥0.95,
veil≤0.05, fully onscreen, minimum native edge 40 px and edge ratio≤5. Selection
uses only geometry/visibility, never model predictions.52 candidates survived.
All 52 HUD strips were visually checked and show survival hearts/hunger; no
creative-only HUD cases are included. No frame number, game tick, Jolt value,
source type or expected label is an input to the network.

| Real diagnostic set | Current matcher top 1 | Neural top 1 | Current matcher top 3 | Neural top 3 |
|---|---:|---:|---:|---:|
|quad1 existing 310 quad validation cases /28 frames|87/310|31/310|102/310|45/310|
|survival 52 screened candidates /52 frames|24/52|8/52|26/52|15/52|

At raw softmax≥0.95, the neural model was wrong on 49/64 above-threshold quad1
cases and 17/24 survival cases. These thresholds are **diagnostic only**, not
calibrated acceptance criteria. The current matcher's own clear gate is also
unreliable on overlapping block faces (17 wrong clear results on survival).

Visual paired contact sheets show many screened quads still contain overlapping
faces, smoke or hidden portions. None of these 52 cases is automatically certified
as clean training data. Four visually more plausible survival cases were recorded
before inspecting their per-case predictions: `3720-2-5`, `28200-10-0`,
`48360-2-4`, `53160-1-1`. Only 1/4 was predicted correctly by the neural model
(current matcher 2/4). This tiny illustrative subset does not establish accuracy,
but prevents attributing every transfer failure solely to obviously cluttered crops.
One nonexistent fifth ID was a contact-sheet transcription mistake and removed;
no replacement was selected after inspecting predictions.

The older quad1 validation set has already been used repeatedly during classical
matcher research. It is not a pristine final holdout. Survival is separate from
this pilot's training, but its 52 candidates are not a representative random sample
of the recording. Report both real sets as diagnostics, not deployment benchmarks.

## Local timings

CPU 4 threads: model-only median 3.46 ms/p 954.46 ms. Including 64×64 rectification,
rough mask, normalization, model and argmax from an already-decoded 1920×1080 frame:
median 9.97 ms/p 9511.87 ms. Native video decoding, app UI, model startup/loading and
geometry optimization are excluded.

CUDA batch 1 including preparation/transfers was 11.10 ms median, slower than CPU.
Batch 256 model-only was 15.45 ms median (~0.060 ms/crop); preprocessing and transfers
are excluded from that batching number. These are one local run under normal
desktop load, not ONNX/INT 8 timings or a promised app throughput.

## Follow-up: survival training, quad1 validation

At the user's request, a second pilot uses survival for real-data training and
quad1 as the cross-recording development validation set. The synthetic-only
checkpoint and all first-pilot metrics above are preserved separately.

Survival was sampled every 11 frames to avoid repeatedly landing on the same
animation-row parity. This is denser sampling, **not more independent scenes**.
Only frames below 54000 were considered. Training is before 42000; later survival
diagnostics are 45000–53999, with a 3000-frame/50-second gap. There are no random
adjacent-frame splits or quad1examples in training.

Fixed cleanup rules, established using survival alone:

1. Consistent corners/UV/winding, fully onscreen, minimum edge 40 native pixels,
   edge ratio≤5, recorded visibility≥0.95, GUI veil≤0.05; exclude overlays.
2. At least 70%of the **labelled** sprite's opaque texels must have compatible
   observed chromaticity and a shared brightness gain (±0.25 stop, gain 0.2–1.3).
   This is label-assisted template-consistency screening, biased toward easier
   appearances; it is not an independently measured visibility mask.
3. Remove exact duplicate crops and all conflicting labels on identical crops.
4. Visually inspect every remaining crop, omitting prominent smoke, crossing
   faces, foreign opaque objects, crosshairs and ambiguous appearances. This is
   Codex visual screening, **not human-certified ground truth**. Mild background
   clutter, limited partial occlusion and blur remain; don't call this pristine.

Of 86625 quad entries considered at the sampled frames,5791 passed geometry and
319 passed colour coverage. The earlier stride 60 trial had only 49 coverage passes;
it was not trained. Visual review of all 288 training and 31 later candidates kept:

| Split | Crops | Distinct frames | Appearances | Sources |
|---|---:|---:|---:|---|
|Survival training|100|80|41/128|78 entity,22 block|
|Later survival diagnostic|15|14|14/128|12 entity,3 block|

The explicit accepted IDs and review rules are in
`scripts/fire-ai/survival-review.json`. Selection happened before fine-tuning and
before examining fine-tuned predictions. They remain strongly correlated within
encounters. The native clip contains far more entries than this small curated
set, but raw entry count is not a clean or balanced training-data count.

Fine-tuning starts from the synthetic model, mixes class-balanced sampled real
crops with synthetic replay 50:50 per batch, and applies labelled horizontal flips,
brightness/tint and sub-texel translation. All 128 appearances remain present in
synthetic replay. AdamW learning rate 0.0002, seed 29, fixed 10 epochs/16 batches per
epoch;11.18 seconds. A final checkpoint was frozen **before** quad1evaluation:
`0c7202718ed0911cc5bd77e6308fffb2648aba5c3c780c6a0b7667d21db36fa6`.
Survival validation was monitored but no best-epoch checkpoint was selected:
15 examples are too few to justify that choice. No quad1metric changed the fit.

| Evaluation | Synthetic-only top 1 / top 3 | Survival fine-tuned top 1 / top 3 |
|---|---:|---:|
|Later curated survival1 5|13/15 /15/15|14/15 /15/15|
|Existing full quad1diagnostic 310|31/310 /45/310|30/310 /56/310|
|quad1label-consistency screen only 6|5/6 /5/6|5/6 /5/6|

The same fixed colour-coverage rule retains just 6 of the existing 310 quad1cases;
these 6 were not further visually certified. That tiny, label-assisted subset is
not a reliable accuracy estimate. Full 310 results remain visible to avoid hiding
failures by filtering. At raw softmax≥0.95 the fine-tuned model is wrong relative
to recorded labels on 46/61 above-threshold full-quad1cases. No acceptance gate is
proposed. Neither full-set errors nor the easier subset establish what proportion
of failures is genuinely unidentifiable versus a correctable model/data issue.

This first survival fine-tune **does not improve exact cross-recording matching**.
It improves the small curated survival diagnostic by one example and full-quad1
top 3 by 11, while top 1 drops by one. Do not retune on quad1to make that result look
better. Broader reviewed real coverage and a properly curated cross-recording
evaluation are needed before drawing stronger conclusions or shipping a model.

## Decision and next experiment

Keep the app unchanged. The first experiment establishes that a small model has
adequate capacity and useful inference speed. It also exposes severe synthetic
domain bias and unsafe confidence on real imagery. It does **not** show that a
larger model is needed or that training on all recorded labels would fix it.

Before the next training run, visually curate visible front planes from both
recordings, group duplicates/nearby frames, and reserve whole scenes/recordings.
Separate overlapping/partial/too-small examples from clean identification cases;
keep them as explicit stress/abstention tests. Include no-fire/hard negatives and
actual codec augmentation, and investigate real-versus-synthetic appearance using
training scenes only. The neural classifier does not inherit the classical
matcher's mathematical positive-only evidence guarantee. Any future acceptance
rule needs separate validation; missing pixels must not be claimed harmless.

## Reproduction and local outputs

Commands from repository root. Dependencies are research-only in an ignored
environment; use the [official PyTorch installation instructions](https://pytorch.org/get-started/locally/)
for the appropriate platform. This run installed torch 2.10.0/torchvision 0.25.0
from `https://download.pytorch.org/whl/cu128`, plus NumPy 2.5.2/Pillow 12.3.0.
Source sprites are local inputs and are not copied into Git or model distributions.

```powershell
$py = '.board/fire-ai/venv/Scripts/python.exe'
& $py -m unittest discover -s FireCrackle/scripts/fire-ai -p 'test_*.py'
& $py FireCrackle/scripts/fire-ai/inventory.py .board/fire-ai/inventory.json
& $py FireCrackle/scripts/fire-ai/render.py .board/fire-ai/pilot --per-class 128
& $py FireCrackle/scripts/fire-ai/train.py .board/fire-ai/pilot --epochs 20
& $py FireCrackle/scripts/fire-ai/codec_test.py .board/fire-ai/codec --ffmpeg FireCrackle/src-tauri/runtime/ffmpeg.exe
& $py FireCrackle/scripts/fire-ai/evaluate.py .board/fire-ai/pilot/best.pt .board/fire-ai/codec --names uncompressed h264-crf24 h264-crf32
& $py FireCrackle/scripts/fire-ai/prepare_real.py survival .board/fire-ai/survival --ffmpeg FireCrackle/src-tauri/runtime/ffmpeg.exe
& $py FireCrackle/scripts/fire-ai/prepare_real.py quad1 .board/fire-ai/quad1
& $py FireCrackle/scripts/fire-ai/evaluate.py .board/fire-ai/pilot/best.pt .board/fire-ai/survival
& $py FireCrackle/scripts/fire-ai/evaluate.py .board/fire-ai/pilot/best.pt .board/fire-ai/quad1
& $py FireCrackle/scripts/fire-ai/render.py .board/fire-ai/negative --negative-only
& $py FireCrackle/scripts/fire-ai/evaluate.py .board/fire-ai/pilot/best.pt .board/fire-ai/negative --names negative
& $py FireCrackle/scripts/fire-ai/benchmark.py .board/fire-ai/pilot/best.pt .board/fire-ai/survival
node FireCrackle/scripts/actual-quad-eval.mjs .board/fire-ai/survival validation ai-baseline fixed 1
```

The quad1adapter reuses native frames prepared with
`scripts/prepare-actual-quad-eval.py`; see `ACTUAL-QUAD-RESULTS.md` for that prerequisite.
Run the same baseline command on each `.board/fire-ai/codec/{name}` directory for
the paired 128-case comparison. No synthetic/real frames, checkpoints, upstream
sprites, predictions or Python dependencies are committed. Local evidence lives
under `.board/fire-ai/`: `summary.json`, each set's metrics and per-case predictions,
`pilot/history.json`, frozen checkpoint, renderer seed/quad manifests, FFmpeg command
manifest, contact sheets, survival HUD audit and review notes.

Thirteen targeted checks pass: projection corners, native pixel coverage/no cracks,
alpha discard, sheet-row/mirror orientation, identity rectification, deterministic
sampling, label-free mask inputs, output shape/parameter count, and counting wrong
confident predictions (including background negatives), quality-screen positive
and occluded controls, bounded-depth FFmpeg selection and label-correct flips.
The first renderer test
caught transparent-RGB expectations and the first report pass caught empty error
contact sheets; both were fixed before final evaluation. Production UI/native
code is untouched; unrelated application tests were not rerun for this isolated
Python research experiment.

Reproduce the survival-training follow-up after preparing the first-pilot data:

```powershell
& $py FireCrackle/scripts/fire-ai/prepare_survival_train.py .board/fire-ai/survival-train-dense --ffmpeg FireCrackle/src-tauri/runtime/ffmpeg.exe --stride 11
& $py FireCrackle/scripts/fire-ai/apply_review.py .board/fire-ai/survival-train-dense FireCrackle/scripts/fire-ai/survival-review.json .board/fire-ai/survival-curated
& $py FireCrackle/scripts/fire-ai/finetune.py .board/fire-ai/pilot/best.pt .board/fire-ai/survival-curated .board/fire-ai/pilot .board/fire-ai/survival-fit --epochs 10
# Use a separate copy of quad1/real.npz in survival-fit/quad1 to preserve the
# original predictions before evaluating the new checkpoint.
& $py FireCrackle/scripts/fire-ai/evaluate.py .board/fire-ai/survival-fit/best.pt .board/fire-ai/survival-fit/quad1
& $py FireCrackle/scripts/fire-ai/evaluate.py .board/fire-ai/survival-fit/best.pt .board/fire-ai/survival-curated --names val
```

`survival-train-dense/manifest.json` retains screening counts, candidates, hashes
and exact FFmpeg command; `survival-curated/review.json` retains the applied audit;
`survival-fit/freeze.json` records the checkpoint before the cross-recording test.
No real-data checkpoint, native crops or decoded frames are committed.

## Large synthetic-only run with real Minecraft backgrounds

This follow-up starts a **fresh random model**, not the survival-fine-tuned
checkpoint. The target sprites, labels, planes, perspectives and occluders are
generated; no actual fire crop or real quad label is used for training.

Background collection uses the original clip1 for training and clip2 for synthetic
validation. Survival and quad1 do not supply backgrounds, fire pixels, poses,
labels or clocks to training. Sampled frames must be synced and explicitly
labelled fire-free, with no recorded sources throughout a ±60-frame guard window.
Crop positions are independent of sprite labels. Source footage and per-crop
hashes are retained locally.

All 39 training and 37 validation full-frame previews were visually inspected.
One training frame (2220) visibly contained fire despite its no-fire flag; it
was excluded. Other exclusions remove open inventories/settings screens and
large chat overlays. The explicit review is `scripts/fire-ai/background-review.json`.
Remaining ordinary gameplay distractors include lava, portals, torches and
non-burning blaze entities; this is no *target fire-plane* background collection,
not a detector claiming that every orange/emissive pixel is absent.

After review: **344 training patches from 32 clip1 frames**, and **230 validation
patches from 27 clip2 frames**. Native source crops range from 160 to 480 pixels
and are resized into 160×160 background tiles. Exact background crop hashes are
disjoint across recordings. This is a limited background bank, not a million
independent real scenes.

The batched GPU renderer projects physical rectangles and samples native texels,
then composites the fire onto these backgrounds before rectifying to 64×64.
Augmentation includes brightness, mild fog/noise/blur, supplied-corner uncertainty,
and foreground rectangles textured with another no-fire patch. The class cannot
select either background. No real codec stage is added to training; the recorded
background already has its original encoding, but the newly inserted fire does
not. H.264 remains a separate stress test.

MobileNet architecture/inference inputs stay unchanged. Training uses seed 71,
AdamW learning rate 0.002, cosine decay, CUDA AMP and 128 balanced appearances per batch.
Each batch uses a fresh render seed. GPU geometry/rendering remains float32;
only model training uses mixed precision. The fixed budget is 16×512 batches
(1,048,576 freshly generated composites, 8,192 per appearance). Log fields named
`unique_training_examples` count fresh generation draws; exact image-hash
uniqueness of all million outputs was not measured.

The background change, data volume, random seed, augmentation implementation and
AMP training change together. This is an end-to-end variant, not a controlled
ablation proving which individual factor causes a difference. Renderer controls
check native sprite sampling against the original NumPy implementation and
rectification against pixel-centre coordinates (≤1 intensity level tolerance).

The preset run completed in **378.16 seconds**, drawing all 1,048,576 composites
from fresh generation seeds. The checkpoint selected solely on the 2,048-example
synthetic validation set was epoch 12 (786,432 training draws at that point),
with 2,047/2,048 exact matches. Later epochs were still run as preset; they did
not surpass that selection score. Frozen checkpoint SHA-256, recorded before any
real-crop evaluation:
`021b01d2459070ffd8cc813e43d5598413d3c6c87610793a1d4452550361932f`.
No ImageNet, small-pilot or survival-fine-tuned weights were used to initialize it.

### Frozen results

| Same real diagnostic data | Small synthetic-only | Large synthetic + real BG | Current colour matcher |
|---|---:|---:|---:|
|Survival, full 52 screened candidates, exact|8/52|15/52|24/52|
|Survival, full 52, top three|15/52|16/52|26/52|
|Later visually reviewed survival subset, exact|13/15|14/15|15/15|
|Quad1, full 310 cases, exact|31/310|26/310|87/310|
|Quad1, full 310, top three|45/310|45/310|102/310|
|Quad1, label-consistency screen only, exact|5/6|6/6|6/6|

The missing baseline cells were measured without tuning: the production colour
matcher ranked the exact appearance first on **15/15 reviewed survival cases**
(12 entity, 3 block), with all 15 marked clear and no errors on this subset.
The matcher took 0.446 seconds total, including native RGB-to-RGBA conversion
but excluding video decode and module compilation. The adapter verifies the
joined-label hash, case order, labels, and pixel-identical rectified AI crops.
For the six-case Quad1 subset, it selects the exact IDs from the existing full
310-case measurement and verifies unchanged geometry, labels and all five
matcher module hashes: **6/6 first, 6/6 top-three, all six clear**.
These two small, screened subsets do not establish general reliability; the
broader baseline still has wrong clear results (17/32 on survival, 20/61 on Quad1).
Evidence is saved in `.board/fire-ai/baseline-reviewed/summary.json` and the
per-case `reviewed-baseline-fixed-validation.json`. Reproduce with:

```powershell
& $py FireCrackle/scripts/fire-ai/measure_baseline.py
```

These remain development diagnostics with the limitations described above.
In particular, the six-case subset is tiny and label-assisted, and the full sets
contain ambiguous/overlapped fire planes. The large model gets 0/28 exact block
faces and 15/24 entity faces on survival; on quad1 it gets 2/129 block and 24/181
entity faces. None of these values is a calibrated deployment accuracy estimate.

A **new** 4,096-example synthetic test uses a third, disjoint render-seed range
and clip2 background patches (not training backgrounds): 4,085/4,096 exact (99.7%),
4,095/4,096 top-three. At raw softmax≥0.95, 3/4,046 above-threshold predictions
are wrong. On 256 no-foreground controls sampled from the held-out real background
bank, none exceeds 0.95 confidence (two exceed 0.8). The closed-set model still
always emits a sprite class; **this does not establish a no-fire detector**.

| Same old 32 synthetic animated shots | Small synthetic-only exact | Large real-BG synthetic exact |
|---|---:|---:|
|Uncompressed|1024/1024|1023/1024|
|Actual H.264 CRF24|989/1024|927/1024|
|Actual H.264 CRF32|723/1024|568/1024|

Compression robustness regresses. At raw softmax≥0.95, the large model is wrong
on 40/928 above-threshold CRF24 predictions and 114/533 CRF32 predictions. On the
actual real crops the corresponding wrong/above-threshold counts are 29/45 for
quad1 and 16/25 for survival. High softmax values still cannot authorize labels.

**Conclusion:** the larger synthetic-only variant improves the survival
diagnostic but worsens quad1 exact matching and codec robustness. It matches the
survival-fine-tuned model's 14/15 on the small reviewed survival subset without
using real fire for training. It is not a reliable replacement for the current
matcher. Background realism and data volume alone have not resolved this task;
the isolated-plane renderer still omits actual overlapping fire geometry, smoke,
lighting and codec effects. These are candidates for future experiments, not
proven explanations for every error. No retuning on these real results occurred,
and no application or release files changed.

### Reproduce the large run

```powershell
& $py FireCrackle/scripts/fire-ai/prepare_backgrounds.py .board/fire-ai/backgrounds --ffmpeg FireCrackle/src-tauri/runtime/ffmpeg.exe
& $py FireCrackle/scripts/fire-ai/review_backgrounds.py .board/fire-ai/backgrounds FireCrackle/scripts/fire-ai/background-review.json .board/fire-ai/backgrounds-reviewed
& $py FireCrackle/scripts/fire-ai/train_large.py .board/fire-ai/backgrounds-reviewed .board/fire-ai/large-bg --epochs 16 --steps 512
& $py FireCrackle/scripts/fire-ai/test_large.py .board/fire-ai/large-bg/best.pt .board/fire-ai/backgrounds-reviewed .board/fire-ai/large-bg/synthetic-test
# Copy each old evaluation NPZ to a separate large-bg/{dataset} directory first
# to retain the older model's predictions, then use the unchanged evaluator:
& $py FireCrackle/scripts/fire-ai/evaluate.py .board/fire-ai/large-bg/best.pt .board/fire-ai/large-bg/quad1
& $py FireCrackle/scripts/fire-ai/evaluate.py .board/fire-ai/large-bg/best.pt .board/fire-ai/large-bg/survival
& $py FireCrackle/scripts/fire-ai/evaluate.py .board/fire-ai/large-bg/best.pt .board/fire-ai/large-bg/curated-survival --names val
& $py FireCrackle/scripts/fire-ai/evaluate.py .board/fire-ai/large-bg/best.pt .board/fire-ai/large-bg/codec --names uncompressed h264-crf24 h264-crf32
```

The new renderer/background controls bring the research suite to **19 passing
tests**. They cover no-fire temporal guards, projection, native pixel equivalence,
rectification coordinates, deterministic sample seeds and candidate-independent
masking in addition to the earlier tests. Source, joined-label, video and crop
hashes, background review, fixed render seeds, epoch history, checkpoint freeze,
predictions and visual evidence are retained under ignored `.board/fire-ai/`.
New video provenance hashes are in `large-bg/background-video-hashes.json`.
As before, raw frames, upstream sprites, crops, model weights and dependencies
are not committed or bundled into the app.

## Larger architecture: paired ResNet-18 experiment

This experiment changes architecture/capacity under one fixed training recipe.
The small-input ResNet-18 has **11,235,072 parameters**, compared with
**1,649,200** for MobileNetV3-Small (6.81 times as many). Its stem is a 3x3,
stride-one, four-channel convolution with no initial max-pool; the residual
blocks are otherwise unchanged and the classifier has 128 outputs. Both start
from random weights, with no ImageNet or real-fire fine-tuning.

The paired run trains both models on the **same tensor and target labels at
every step**, with independent model RNG states. The label-order generator is
independent of model initialization and dropout. Each receives 16 epochs of
512 balanced 128-class batches: **1,048,576 fresh synthetic composites**.
Both use the same AdamW learning rate 0.002, weight decay 0.01, cosine epoch
schedule, CUDA mixed precision, 64x64 RGB plus rough colour mask, background
banks and renderer. These are fresh draws, not a claim of a million independent
real scenes or hash-deduplicated images. Architecture also changes inductive
bias and compute; this is not a parameter-count-only ablation or a search for
each architecture's best hyperparameters.

The original 2,048-example synthetic validation set and training preview are
byte-identical to the previous run. Each checkpoint is selected independently
by the first maximum synthetic validation top-one count. Both are frozen before
real evaluation. The new label RNG makes the paired small control a new run;
the older small model's metrics remain recorded above, rather than being
silently replaced. No real fire targets or real diagnostic checkpoint selection
are used. All earlier cautions about reviewed subsets and repeatedly used real
diagnostic clips still apply.

The preset, input hashes and executed Python source snapshot are retained in
`.board/fire-ai/resnet18/{protocol.json,evaluation-input-hashes.json,source/}`.
The architecture loader preserves older checkpoints without architecture
metadata. The research controls now contain **20 passing tests**, including
forward-output equivalence after both new and legacy checkpoint loading.

### Frozen paired results

The complete paired run took **1,678.85 seconds (28.0 minutes)**, including
training both models and synthetic validation. Both selected epoch 14; ResNet
scored 2,048/2,048 on selection validation and the small control 2,047/2,048.
These checkpoint hashes were recorded before real evaluation:

- ResNet-18: `8a9734236002f518fd780e06a6452259ab2584f13ee6b09dd652814cd324183d`
- Paired small control: `a31d7fc1d66704fdee42879da9f030bcd29782633c98b8a56ee3f1245b312607`

| Same real cases | Previous real-BG small AI | Paired small control | ResNet-18 | Our colour matcher |
|---|---:|---:|---:|---:|
|Survival, exact|15/52|13/52|16/52|24/52|
|Survival, top three|16/52|16/52|21/52|26/52|
|Reviewed survival, exact|14/15|15/15|15/15|15/15|
|Quad1, exact|26/310|35/310|45/310|87/310|
|Quad1, top three|45/310|54/310|66/310|102/310|
|Six-case Quad1 screen, exact|6/6|6/6|6/6|6/6|

The production matcher hashes are unchanged from the measured baseline above.
All copied evaluation input hashes are unchanged. The primary comparison is
**ResNet against the paired small control**, not against a different earlier
training stream. Exact matching means sheet, row and mirror all agree. The
reviewed and six-case subsets remain small and selected; the full sets remain
ambiguous development diagnostics, not a new untouched final test set.

| Same synthetic/codec tests, exact | Paired small control | ResNet-18 |
|---|---:|---:|
|Fresh held-out real-BG synthetic test|4090/4096|4096/4096|
|32 shots, uncompressed|1024/1024|1024/1024|
|Same shots, H.264 CRF24|958/1024|937/1024|
|Same shots, H.264 CRF32|623/1024|570/1024|

The larger model improves the synthetic distribution but **regresses codec
top-one accuracy against its paired control**. No actual codec augmentation
was added to this architecture experiment. At raw softmax >=0.95, wrong/above-
threshold counts are:

| Diagnostic gate | Paired small control | ResNet-18 |
|---|---:|---:|
|Survival|15/26|17/28|
|Quad1|30/50|24/45|
|CRF24|13/926|9/841|
|CRF32|88/579|37/388|

Confidence still cannot authorize real labels. Of the same 256 no-foreground
background controls, the small model gives 30/256 above 0.5, 4/256 above 0.8,
and 1/256 above 0.95; ResNet gives zero at all three thresholds. This remains
a narrow diagnostic: neither model has a no-fire output class.

### Measured inference cost

PyTorch 2.10.0+cu128, four CPU threads, RTX 4060 Laptop GPU. Both use the same
decoded native frame and quad, with 20 CPU/30 GPU warm-ups and 200 batch-one
measurements. Values include rectification, rough mask, normalization, forward
pass and argmax; GPU batch one also includes transfers and synchronization.
Video decode, UI, process/model startup and geometry optimization are excluded.

| Local timing, median / p95 | Paired small control | ResNet-18 |
|---|---:|---:|
|CPU, one quad|4.22 / 5.09 ms|17.07 / 23.53 ms|
|GPU, one quad|4.88 / 5.76 ms|2.90 / 3.48 ms|
|GPU, 256 crops, model only|12.25 / 12.71 ms|167.26 / 171.22 ms|
|Checkpoint bytes|6,719,913|45,012,683|

The bigger network is faster in this local GPU batch-one measurement, but
substantially slower on CPU and in GPU batching. These are one-machine timings,
not application latency guarantees; no ONNX or quantized runtime was tested.

**Finding:** the bigger architecture helps the broad real diagnostics modestly
(+3/52 survival, +10/310 Quad1 against the paired control), while our matcher
still ranks more exact appearances first. It fits the held-out synthetic task
perfectly yet retains a large real-data gap and weaker codec accuracy. Capacity
alone under this training recipe does not make it a useful replacement. This
does not rule out a different renderer, training recipe or pretrained model;
none of those was tested in this comparison. No production or release files
changed, and no real-data tuning followed these results.

### Reproduce the capacity experiment

```powershell
& $py FireCrackle/scripts/fire-ai/train_large.py .board/fire-ai/backgrounds-reviewed .board/fire-ai/resnet18 --architecture resnet18 --paired-control --epochs 16 --steps 512
# Copy the unchanged evaluation NPZs into separate {survival,quad1,curated-survival,codec}
# directories under resnet18 and resnet18/small-control; retain earlier predictions.
# Run these evaluation commands once for each model directory:
$run = '.board/fire-ai/resnet18' # then '.board/fire-ai/resnet18/small-control'
& $py FireCrackle/scripts/fire-ai/evaluate.py "$run/best.pt" "$run/survival"
& $py FireCrackle/scripts/fire-ai/evaluate.py "$run/best.pt" "$run/quad1"
& $py FireCrackle/scripts/fire-ai/evaluate.py "$run/best.pt" "$run/curated-survival" --names val
& $py FireCrackle/scripts/fire-ai/evaluate.py "$run/best.pt" "$run/codec" --names uncompressed h264-crf24 h264-crf32
& $py FireCrackle/scripts/fire-ai/test_large.py "$run/best.pt" .board/fire-ai/backgrounds-reviewed "$run/synthetic-test"
& $py FireCrackle/scripts/fire-ai/benchmark.py "$run/best.pt" .board/fire-ai/baseline-reviewed
```

Complete results are retained in `.board/fire-ai/resnet18/assessment.json`,
with per-case prediction arrays, freeze records, histories and timings in each
model directory. The six-case score selects the same frozen indices from each
full Quad1 prediction array. The current trainer uses independent label ordering;
the exact older training stream is preserved by the trainer at commit `cd4f8f3`.
No dependency, upstream asset, real crop or model weight is bundled or committed.
