# Synthetic learned quad matcher: first pilot

The small model learns the synthetic task and runs quickly, but **does not
transfer reliably to the real clips**. Keep the application matcher unchanged.
This is a research experiment, not an automatically accepted labeller.

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
