# Direct32 animation-phase CNN pilot

19 October2026. Research only. **Separate normal-fire and soul-fire models**, each
predicting animation phase0–31 from one outlined RGB quad. No app integration or
automatic labelling change. These are phase-only results, not the earlier exact
sheet + phase + mirror metric.

## Outcome

The independent-colour models do not beat the established matcher overall.
The soul model is effectively tied on this small reused test segment. Adding
real entity training improves the normal model, but it remains worse than the
deterministic phase result on the independent test recording.

| Experiment | Test crops /frames | CNN phase correct | Deterministic phase correct | CNN top3 |
|---|---:|---:|---:|---:|
| Normal, block-only real training |99 /18|35 (35.4%)|59 (59.6%)|50|
| Normal, additional entity recording |99 /18|41 (41.4%)|59 (59.6%)|45|
| Soul, own-colour temporal training |115 /13|46 (40.0%)|45 (39.1%)|67|

Normal test subgroups:

| Test source | Block-trained normal CNN | Entity-trained normal CNN | Deterministic |
|---|---:|---:|---:|
| Blocks,20 crops /5 frames |11|12|12|
| Entities,79 crops /16 frames |24|29|47|

There is no demonstrated meaningful gain from the separate-colour setup here.
The first normal model's data shortage is real: all its real fitting crops are
blocks, while most test crops are entities. The additional recording addresses
that omission and still does not close the gap. That does not establish that
all AI models or larger/better supervised datasets would fail.

## Models and input

- Torchvision ImageNet-pretrained ResNet-18, independently initialized and trained
  per colour.11,242,080 parameters, roughly45MB of float32 parameters each.
-64x64 RGB quad rectified from decoded native1920x1080 pixels. Original pixel
  centres and bilinear sampling reuse the established research rectifier.
- Stride1 input convolution, no initial max-pool,2x2 final spatial pooling,
  and32 logits. Inputs are RGB only, with standard pretrained normalization.
- Model output/API/reporting uses animation phase0–31. Sheet, mirror, frame
  number, timestamp, expected alpha and candidate sprites are not model inputs.
  Selecting the normal or soul model is a separate caller choice.
- Common geometry screen: fully on-screen, >=3 native pixels per sprite texel
  in the minimum local singular direction, directional anisotropy <=2.5.
  This does not certify clean visible ownership of a fire plane.

## Training, splits and provenance

The main prepared corpus has456 readable crops:163 normal and293 soul.
Original early/later segment boundaries are retained. Existing capture labels
can describe a plane partly hidden by another flame; they are not dense visible
ownership supervision. Test denominators retain those errors.

| Separate model | Real fitting crops /frames /observed phases | Calibration crops /frames /phases | Test crops /frames /phases |
|---|---:|---:|---:|
| Normal initial |37 /10 /9|15 /5 /5|99 /18 /14|
| Soul |87 /16 /10|91 /6 /6|115 /13 /9|

Calibration uses the final quarter of the early segment's distinct frames.
Fitting ends more than240 video frames before calibration begins; original
later test segments retain a further >=240-frame gap. Calibration chooses the
checkpoint and threshold; later test pixels are not used for either. There are
zero exact crop duplicates between these fitting and test portions. These are
temporally separated parts of one recording per colour, not independent-video
generalization. Real tests cover only the observed phases in the table, not all32.

Synthetic pretraining covers all32 phases and both sheets/mirrors, restricted
to the model's own colour. Foreign flame layers are also restricted to that
colour. It uses independent backgrounds from recordings `2026-10-15 14-48-36.mkv`
and the historical background-validation recording, neither of which is a target
test recording. Native-raster projection, lighting, fog, partial foreground
rectangles, overlapping foreign flames, blur, noise and small outline errors
provide explicit training augmentation. This is an isolated-plane compositor,
not a complete Minecraft renderer or measured codec simulator.

Each separate model trains8 epochs x64 batches x128 synthetic crops =65,536
generated views. A fixed1,024-example synthetic validation set chooses the
pretraining checkpoint. Normal reaches1020/1024 and soul1017/1024 correct at
epoch7; these high synthetic figures do not establish real-video accuracy.
Real adaptation mixes64 real and64 generated views for12 steps x12 epochs.
Real sampling balances distinct frames rather than weighting frames by their
number of captured quads. The synthetic checkpoint remains an eligible epoch0
candidate. Calibration-loss selection chooses normal epoch2 and soul epoch4.
Synthetic fits use AdamW lr.0005, real adaptation lr.00005, with.03 label
smoothing; batch-normalization statistics are frozen during real adaptation.
The two separate runs take239.1s combined on an RTX4060 Laptop GPU.

### Additional normal-fire recording

The second normal experiment starts from its **normal-only synthetic checkpoint**
and fits only a third recording, `2026-10-16 18-23-42.mkv`. Its held-out test
recording is `2026-10-16 00-40-22.mkv`; no test-recording pixels are used for fitting
or calibration.175 readable training crops from155 frames include153 entity and
22 block crops.15 calibration crops come from14 later frames, with a large
temporal purge. The same12x12 mixed adaptation steps take24.1s; source calibration
selects epoch8.

These additional crops reuse a **historically prepared, template-quality-screened
training cache**. They were filtered by recorded visibility and matching colour
coverage, so they preferentially represent easy/template-consistent examples.
That is training-supervision selection, not certified ownership, and test crops
receive no such filter. Historical crop pixels are reused unchanged; this is not
a claim of newly reprocessed native/full-frame equivalence. The source cache's
manifest and train/validation NPZ hashes are retained in the local audit.

Current native shared automatic unveil is used for the main corpus. Soul frames
were already processed in the earlier native preparation; they are not unveiled
twice. One normal frame,7080, changes under current shared automatic unveil:
three corresponding deterministic test controls are recomputed on those exact
processed native pixels. Their aggregate phase baseline stays59/99. No new GUI
inverse, shader rule or colour eligibility is introduced.

## Confidence and inference speed

Thresholds are chosen on source calibration only: scan confidence0..1 by.01,
require at least5 correct accepted crops across at least2 frames and no observed
calibration error. If none qualifies, abstain on everything. Softmax confidence
is not a correctness probability.

| Run | Calibration-selected threshold | Accepted correct /wrong on test |
|---|---:|---:|
| Normal initial |.83|19 /0|
| Soul separate |abstain all|0 /0|
| Normal additional entity recording |0|41 /58|

The additional normal calibration set is all correct, so its rule admits every
test crop and fails badly under the recording change. This is a direct warning
against using these gates for automatic confirmation. The19/0 initial result is
also a small correlated sample, not proof of a safe automatic gate.

Warm batch1 timings below include native-frame quad rectification, RGB tensor
conversion, normalization, inference, softmax and returning probabilities to CPU.
The native frame is already decoded in memory. Each benchmark uses20 warm-ups
and100 measured calls, CPU4 threads, GPU synchronization and no concurrent training.
Cold weight loading and video decoding are excluded.

| Model | CPU median /p95 | RTX4060 Laptop median /p95 |
|---|---:|---:|
| Normal additional entity recording |15.32 /24.25ms|2.93 /3.65ms|
| Soul separate |17.47 /23.51ms|3.31 /4.28ms|

Thus single-match inference speed is reasonable here. Deployment runtime speed
has not been measured: this pilot uses PyTorch, not the application's runtime.

## Earlier shared-model trial retained

Before the owner's two-model correction, a shared-colour synthetic model was
adapted using orange or soul footage and tested on the opposite recording.
Orange-to-soul gives51/115 phases versus45 deterministic; soul-to-orange gives
33/99 versus59. That setup did not test the requested independent-colour models.
Its results remain in `predictions.csv` and ignored `.board/row32/results.json`;
they are not substituted for the final separate-model measurements. Do not
compare their larger fitting portions directly with the smaller guarded fitting
portions above as if the architectures alone changed.

The final separate models'214 per-case predictions are in
`scripts/fire-ai/row32/separate-predictions.csv`. The additional normal run's99
predictions are in `extra-predictions.csv`. Cases repeat across experiments;
these are not527 independent test examples. Checkpoints, images, crop caches,
training histories, split lists and source/data hashes remain ignored under
`.board/row32/`; no game assets, recordings or model weights are committed.

## Reproduction and targeted checks

```text
node FireCrackle/scripts/fire-ai/row32/prepare.mjs .board/row32
python FireCrackle/scripts/fire-ai/row32/data.py .board/row32
node FireCrackle/scripts/fire-ai/row32/controls.mjs .board/row32
python FireCrackle/scripts/fire-ai/row32/test_row32.py
python FireCrackle/scripts/fire-ai/row32/separate.py .board/row32 --backgrounds .board/fire-ai/backgrounds-reviewed
python FireCrackle/scripts/fire-ai/row32/audit_separate.py .board/row32
node FireCrackle/scripts/fire-ai/row32/extra_selection.mjs .board/fire-ai/survival-train-dense .board/row32/extra-eligible.json
python FireCrackle/scripts/fire-ai/row32/extra_orange.py .board/row32 --extra .board/fire-ai/survival-train-dense --backgrounds .board/fire-ai/backgrounds-reviewed
python FireCrackle/scripts/fire-ai/row32/audit_extra.py .board/row32 .board/fire-ai/survival-train-dense
python FireCrackle/scripts/fire-ai/row32/benchmark.py .board/row32 --checkpoint .board/row32/separate/soul/best.pt
```

Use the existing research Python environment with PyTorch2.10.0+cu128 and
Torchvision0.25.0. The official pretrained ResNet-18 weights are stored in the
ignored experiment-local Torch cache. Four targeted tests pass:32-logit shape
and finite values; repeatable synthetic generation and phase coverage;
strict colour isolation; and confidence-gate frame/evidence requirements.
Split audits verify phase targets, disjoint/purged indices, crop duplicates,
different recording identity for the extra normal run, prediction recounts and
all exported case counts. No broad app tests or frontend rebuild are needed.
