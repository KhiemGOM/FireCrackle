# Shared image preprocessing

## One automatic unveil implementation

- The sole production source of veil detection, GUI-neutral rules, gradient constants,
  inverse colour math and rounding is `fire-detection/core/src/veil.rs`.
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
