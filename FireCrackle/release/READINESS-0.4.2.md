# FireCrackle 0.4.2 readiness

- Two separate real-data 128px ResNet101 phase models, using the existing native ONNX Runtime path; no Python runtime.
- Fixed three-phase fusion: 25% CNN probability plus 75% deterministic probability, temperature 0.01. Each phase retains its best appearance and optional geometry fit. Atlas filters still restrict admission; suggestions require user confirmation.
- Ordinary-fire ranking unchanged. Soul deterministic control uses its evaluated G,B,R channel order and loose shared-gain tolerances. Shared automatic Rust/WASM unveil precedes both inputs.
- Both CPU sessions initialize eagerly; GPU preparation runs outside their inference locks. Each material keeps its own model, checksum, session and CPU retry path.
- Normal benchmark: 514/617 phase-in-top-three. Soul primary holdout: 1,588/1,983; older secondary check: 86/115. The new soul train/test recordings share a game session/world. Nearby quads are correlated; these rates are not universal guarantees.
- Soul ONNX export: nine actual calibration/test crops checked against CPU PyTorch (maximum logit error under 0.000005); nine frontend pixel/scorer cases plus 2,276 cached fusion vectors pass. Existing normal 772-vector fusion and native-pixel parity checks pass.
- Native real-crop routing and both DirectML sessions pass on the local RTX 4060 setup. Observed native GPU inference: normal 15.1 ms, soul 13.4 ms; CPU remains usable while GPU sessions prepare.
- Staging validates both model hashes and fails loudly if either required asset is unavailable. Release resources include both models beside the shared runtime. Source control contains only manifests/provenance, never model weights, textures, recordings or crops.

Local gates passed: all 83 targeted UI/scorer tests under the exact checked-in dependency lock; frontend production build; optimized Windows desktop build; portable ZIP contents/checksums including both phase models; three model-staging tests; native CPU/DirectML routing/parity; all three release Rust formatting checks; Linux verifier shell syntax and its new native phase smoke executable. Rebuilding the frontend under the restored lock produced byte-identical assets to the built executable. The portable archive is explicitly a local tester with dirty-source provenance, not a frozen public-release artifact.

Linux package validation now requires both model files/metadata in Debian and AppImage outputs and runs both packaged phase models through the native CPU engine. Actual Linux package builds/startup checks still require CI.

Pending before publication: explicit approval to upload the private-recording-derived model weights as public build resources (automatic approval review rejected that upload; none were uploaded); verify public asset hashes/URLs; run both platform release builds from a frozen commit and verify their provenance. Both model manifests deliberately keep their public URLs unset until that approval and upload succeed.
