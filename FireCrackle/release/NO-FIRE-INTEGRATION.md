# AI no-fire integration for 0.3.0

The Auto popup scans native 1920×1080 RGB video with the frozen orange-fragment + MobileNetV3 Small ensemble. It saves only untouched frames as no-fire, in one undoable batch, with the no-fire tool's patterned colour strips. Existing human labels remain protected. Missing GUI evidence, uncertain menus and suspected translucency abstain. A clear decision is not proof that no tiny/unreadable flame exists.

## Portable inference audit

The research CUDA run used TF32. Exact Pillow-compatible RGB input did not make full-precision ONNX logits identical: clip2 frame0 changed from0.087879613 to0.08101057. The deployment threshold was recalibrated only on the original hash-locked218reserved frames (125fire/93eligible), not the full-video evaluation. CPU threshold=-1.7570972442626953, with0.0001 additional abstention margin. CPU/DirectML maximum score drift on that cohort was0.00001034. `scripts/export_no_fire.py --calibration-dataset DATASET` reproduces this audit; a changed cohort hash fails closed.

Model SHA-256 and native runtime archive hashes are pinned in `no-fire-model.json`. Weights, downloaded libraries, recordings and caches remain ignored. The installed application needs no Python, torchvision or CUDA for CPU operation.

## Full native recording check

19,553 frames of the familiar clip2 recording, native1920×1080 at60fps. Two bounded frame workers, two inference CPU threads, one shared model session. Entire sequential decode/preprocessing/inference/write:551.585seconds (35.45frames/second), with other agent CPU work present; not an isolated speed record.

- TP:1158/8908eligible frames=13.00%.
- FP:95/10645meaningful-fire frames=0.8924%.
-1253totalclear decisions;7.58%wrong under the original size-based truth definition.
-10decisions differ from the original TF32 research implementation; two fewerTP, sameFPtotal. Do not overwrite historical results or call changed preprocessing identical.

This is correlated familiar-video evidence, not an independent generalization estimate. The original24px-wide box proxy is not a human-readability oracle. The218reserved calibration frames came from this recording.

## Performance and acceleration

Windows warm nine-view model-only medians: CPU2threads13.6ms; CPU4threads14.2ms; DirectMLadapter0 8.3ms; adapter1 34.4ms. More threads or a GPU can be slower. Automatic selection benchmarks available adapters against CPU and rejects score drift over0.0001 or a speed gain under10%. WindowsGPUinitial setup measured about30seconds; the loaded engine is reused for later scans. Setup cancellation cannot interrupt an in-progress native runtime graph compilation.

A paired2,200-frame run took134.744seconds with1worker vs69.615seconds with2workers (1.94�faster), identical243clears and frame decisions. Model sessions used2CPUthreads in both runs.

Frame gates run with two bounded workers; model access stays serialized to avoid oversubscribing the GPU or CPU inference threads. Orange threshold queries stop once the decision is known; prepared GUI detection caches immutable templates/geometry, never a previous frame's detected mask. Both optimizations have exact-decision targeted tests. Cancellation during scan prevents saving a partial batch.

Linux CUDA inference was actually tested under WSL2 on the RTX4060Laptop, ONNX Runtime1.22.0, CUDA12.9/cuDNN9.27. Warm9view medians CPU22.8275ms vsCUDA22.8812ms, maximumscore difference0.00000215; setupCPU0.144s,CUDA1.068s. This setup offers no measured speed gain, so automaticselection should stayCPU. All218original reserved calibration frames also agreed on clear/retain decisions against WindowsCPU, maximumlogit drift0.00001440. This is WSL evidence, not a full nativeLinuxhardwarematrix. Linuxpackages include the CUDA-enabledruntime withCPUfallback; CUDA12/cuDNN9 remain separately installed vendor dependencies. CUDA TF32 is explicitly off. Native OpenVINO and MIGraphX providers are considered only when supplied by the loaded runtime, and must pass the same checks; their presence in code is not evidence of tested AMD/Intel hardware.
