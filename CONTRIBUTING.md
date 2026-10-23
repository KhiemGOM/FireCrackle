# Contributing

Keep behavior changes separate from formatting or refactors. Describe the concrete problem, the resulting behavior and the checks you ran. Preserve existing label logs, source tags, autosave compatibility and undo semantics.

## Checks

CI (`.github/workflows/ci.yml`) runs the checks below; run the ones for the code you changed before opening a pull request. Prerequisites: Node.js 24, Rust stable with `rustup target add wasm32-unknown-unknown` (the frontend scripts build the shared veil WebAssembly), and Python 3.10 for the research tools.

From the repository root:

```powershell
node --test scripts/check-repository.test.mjs
node scripts/check-repository.mjs
```

For each Rust crate: `FireCrackle/crates/studio_core`, `fire-detection/core`, `FireCrackle/crates/no_fire_cnn` and `FireCrackle/src-tauri`:

```powershell
cargo fmt --manifest-path <crate>/Cargo.toml -- --check
cargo clippy --manifest-path <crate>/Cargo.toml --all-targets --no-deps -- -D warnings
cargo test --manifest-path <crate>/Cargo.toml
```

For video integration tests, put FFmpeg/FFprobe on `PATH` (`FireCrackle/scripts/prepare-runtime.ps1` fetches the pinned build into `FireCrackle/src-tauri/runtime`); otherwise tests that require them may explicitly skip. For the frontend, run `npm ci`, `npm test` and `npm run build` in `FireCrackle`. Python checks: `python -m pytest fire-detection/obs fire-detection/augment fire-detection/bench`. Mod instructions are in `fire-detection/README.md`.

## Pull requests

Branch from `main` and open a pull request against it; CI must pass. Keep one concern per pull request.

`npm run release -- -Installer` in `FireCrackle` builds local tester downloads. Publishing a release or changing repository visibility is a separate action requiring the owner's instruction.

## Files for AI coding agents

`AGENTS.md`, `CLAUDE.md` and `.swarmboard.json` are instructions and coordination settings for the AI coding agents that also work in this repository. You can ignore them; the project rules that matter to you are repeated here and in the READMEs.

## Source and data boundaries

- Keep synthetic/minimal test fixtures small and explain their purpose.
- Keep recordings, generated feature/label tables and `.firecrackle` projects out of Git.
- Never commit Minecraft source/JARs, decompiled sources, Yarn mapping artifacts, local caches or credentials.
- Dependency declarations and original mod code are allowed; vendoring upstream game/mapping content is not.
- Keep third-party notices intact and do not apply the project's MIT label to upstream assets.

The repository hygiene check catches common mistakes in tracked files. It supplements review; it is not a proof that a file has no sensitive content or that upstream redistribution permission exists.
