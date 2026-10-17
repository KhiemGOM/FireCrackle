# FireCracking

FireCrackle is a desktop app for matching Minecraft fire animations to video frames, with Windows x64 and Linux x86_64 packaging. This repository also contains the detector, recording mod and research tools used to evaluate it.

**Version 0.1.1 is an experimental analysis tool.** A timing flag is a reason to inspect the footage, not proof of an edit. Automatic labels are distinguished from human checks; recording stalls, game lag and model mismatches can all affect the result.

- [Download builds](https://github.com/KhiemGOM/FireCrackle/releases)
- [App development and packaging](FireCrackle/README.md)
- [Detector, recording mod and experiments](fire-detection/README.md)
- [Experimental/risky no-fire preview: all assumptions and known failures](fire-detection/bench/no_fire/EXPERIMENTAL-ASSUMPTIONS.md) — reviewable research suggestions only; never automatic label confirmation.
- [Contributing and verification](CONTRIBUTING.md)
- [Third-party assets and licensing](THIRD_PARTY_NOTICES.md)

## Layout

| Directory | Purpose |
| --- | --- |
| `FireCrackle/src` | React UI and matching/geometry helpers |
| `FireCrackle/crates/studio_core` | Video projects, labels, autosave and timing analysis |
| `FireCrackle/src-tauri` | Windows desktop commands, video encoding and background matching |
| `fire-detection/core` | Rust matching library and research CLIs |
| `fire-detection/mod` | Original Fabric recording/ground-truth mod |
| `fire-detection/{obs,augment,bench}` | Python recording, degradation and evaluation tools |
| `scripts` | Repository hygiene checks |

## Develop the app

On Windows x64, install Node.js 24, Rust stable MSVC and the Visual Studio C++/Windows SDK build tools. From this repository:

```powershell
Set-Location FireCrackle
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-runtime.ps1
$env:PATH = "$(Join-Path $PWD 'src-tauri/runtime');$env:PATH"
npm run tauri dev
```

The runtime preparation downloads a pinned FFmpeg package and verifies its checksum. See the app README for portable ZIPs, optional setup EXEs and RAR packaging.

## Data and game dependencies

Recordings, exported labels, per-video `.firecrackle` projects and generated benchmark tables stay local and are ignored by Git. Research commands that require those inputs must be given the corresponding local files; the ordinary tests use small purpose-built fixtures or synthetic video.

Minecraft game source, decompiled classes, game JARs, Yarn mapping artifacts and Gradle caches must not be committed or uploaded. The Fabric mod declares upstream dependencies that Gradle resolves locally; it does not vendor Minecraft or Yarn. The small Minecraft-derived texture fixtures currently used by the matcher have separate ownership; see the notices before redistributing them.

Original project code is MIT-licensed. That grant does not relicense third-party software, Minecraft assets or user recordings.

## Source history

This repository is public. Its early history, from before the clean-up, still contains old generated research data and historical game-code excerpts that have been removed from the current tree; the current files contain neither. The history has not been rewritten. If a separate history without them is wanted, commit all source changes and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-source-snapshot.ps1
```

This checks the source boundary and creates a one-commit `codex/clean-source-snapshot` branch with the same current files and no parent history. It does not switch your checkout, erase history, push anything or change repository visibility. Existing branches are never overwritten. Using the snapshot as the public history would still need the owner's decision and the asset-rights review in the third-party notices.
