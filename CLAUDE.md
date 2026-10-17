# Project instructions

Read and follow [`AGENTS.md`](AGENTS.md).

**Use ONE automatic unveil implementation:** `fire-detection/core/src/veil.rs`.
It owns detection, GUI-neutral evidence, all gradient/constants and inverse pixel math.
Rust calls it directly; Python uses `bench/no_fire/veil_native.py`; the app uses the
thin `FireCrackle/src/lib/veil.ts` WASM binding compiled from `core/src/veil_abi.rs`.

Do not copy/port unveil into another language, detector, GUI tool or benchmark. Improve
the canonical Rust implementation and verify the bindings instead. Keep Off/Auto/On
and the existing settings. Known GUI colours are neutral veil evidence, never evidence
of fire. The shared GUI-piece mask is separate from unveil and should supply metadata,
not another inverse or detector implementation.

Frontend prerequisite: `rustup target add wasm32-unknown-unknown`; normal npm dev/test/build
scripts generate the ignored WASM and metadata. Python's binding builds a source-hashed
native library in ignored `.board/shared-veil/`. Historical result hashes must remain honest.
