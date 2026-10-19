# Mandatory video training catalogue

- Before any AI training, fine-tuning, distillation, calibration or model-comparison run,
  read [`docs/TRAINING_DATA_CATALOGUE.md`](docs/TRAINING_DATA_CATALOGUE.md) and refresh
  its inventory with `python scripts/catalogue_training_data.py --write`.
- Default full-data runs use **all relevant, eligible training sources** in that growing
  catalogue, including newly recorded videos. Do not silently reuse an old hard-coded
  subset. Every run must save a coverage manifest accounting for each original recording
  and relevant dataset family as train/validation/test/excluded/unavailable, with reasons,
  actual sample counts, source hashes and preprocessing versions. Explicit ablations may
  use subsets but must identify themselves and account for omitted data.
- Preserve held-out recordings/time blocks and temporal purge gaps; never put validation
  or test data into training just to claim full coverage. Deduplicate overlapping caches,
  repeated renderer frames and augmented descendants by original source/target identity.
  Keep partial/unknown ownership, material identity and label provenance. Predictions,
  auto-labels, weak masks and GUI clock reports are not interchangeable with ground truth.
- Add new recordings, schemas, label streams and reusable derived pools to the catalogue
  before use. Keep the catalogue, generated inventory and per-run coverage reports current.
  Never commit the actual private recordings, labels, tensors, game assets or model caches.

# Shared image preprocessing

## One automatic unveil implementation

- The sole production source of veil detection, GUI-neutral rules, gradient constants,
  inverse colour math and rounding is `fire-detection/core/src/veil.rs`.
- Animated portal fitting, known-RGBA-layer inverse and conservative translucency
  guard live in its `portal.rs` implementation module (`veil::portal`). Native/WASM
  ABI remains `veil_abi.rs`; Python `portal_undo.py` is a thin binding. No parallel
  language-specific inverse. Game textures are loaded locally, never committed.
- For confident no-fire decisions, detected/suspected world translucency means
  abstain. Portal correction is inspection/post-processing, not permission to clear.
  The current automatic guard recognizes purple portal/effect candidates and accepts
  caller-supplied translucent-world masks; absence is NOT proof of opacity. Do not
  claim unimplemented water/glass/ice recognition. GUI masking stays separate.
- Native Rust callers use `fire_core::veil::detect_veil` / `detect_pixels`,
  `unveil_in_place` / `unveil_rgb`, or `row_transform` + `restore_channel` for sparse probes.
  Standalone research binaries include that same source module; do not port its code.
- Python research uses `fire-detection/bench/no_fire/veil_native.py::apply`.
  `features.py::unveil` is a compatibility wrapper. The binding builds/loads a native library
  from `core/src/veil_abi.rs`; it contains no pixel rules.
- The browser uses `FireCrackle/src/lib/veil.ts`, a thin WebAssembly binding to the same
  Rust source. Call `initVeil()` before synchronous APIs; `processFrame` handles initialization.
  Preserve Off/Auto/On and the existing share/margin/slack settings.
- `npm run dev`, `npm test`, and `npm run build` compile the WASM and generate constants.
  Build prerequisite: `rustup target add wasm32-unknown-unknown`. Generated `.wasm` and
  `veil.generated.ts`, native libraries and research caches must not be committed.
- Fix detection or inverse math **once in `veil.rs`**, then verify native/Python/WASM parity.
  Do not introduce independent TypeScript, Python, shader, CLI or model-specific unveil math.
  Historical strict-window primitives exist only for reproducibility/reference tests;
  new production callers use the shared automatic detector.
- Known GUI greys and tooltip fill are neutral **only in veil judgment**. They are not
  fire-positive pixels. Retain the background quorum and true-black rejection. GUI-piece
  masks are a separate preprocessing concern and must not duplicate unveil logic.
- Cached experiment scores/models are tied to preprocessing version/source hashes. Keep
  historical results, and explicitly rerun/recalibrate before presenting changed preprocessing
  as equivalent. Independent background/tint hypotheses must be identified, not silently added.

Use targeted tests for changed paths. Coordinate shared-file work through Swarmboard and
preserve unrelated agents' changes. Never commit local game assets, recordings or caches.
