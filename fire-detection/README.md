# Fire detection research tools

This directory contains the capture mod, video/label synchronization tools and classical
fire detectors used by [FireCrackle](../FireCrackle/README.md). The desktop app is the
user-facing tool; these commands are for research and reproducible evaluation.

## Current scope

- `mod/`: Fabric **Minecraft 1.16.5** client mod. It draws a synchronization strip and
  logs per-frame fire sources, geometry, texture rows and visibility.
- `core/`: Rust strip decoder, video tools, template/colour/blob experiments and
  first-person overlay matcher. `fire_pov` accepts an ordinary video without mod labels.
- `bench/`: coverage and detector reports, plus experimental shallow-tree training.
- `augment/`: reproducible ffmpeg degradation chains and calibration tools.
- `obs/`: optional Python OBS recording controller; its automated tests use a fake client.
- `sync/`: strip format. Game-specific findings are in [the internals notes](NOTES-minecraft-1.16.5.md).

First-person matching supports the vanilla 1.16.5 uncropped viewport and tries the
70/60-degree overlay geometries. It can abstain; low confidence does not prove that fire
is absent. Existing results were measured on recordings also used to select constants,
so they do not establish accuracy on unseen recordings or YouTube compression.
See [acceptance status](bench/FIRST_PERSON_STATUS.md), the historical
[detector experiments](core/DETECT_PLAN.md) and [performance measurements](../FireCrackle/docs/POV-PERFORMANCE.md).
World-fire localization and reliable small/distant-fire detection remain research work.

## Prerequisites

- Rust stable and a native linker (MSVC build tools on Windows).
- Python 3.10+ for Python tools. Create a local environment and install the declared dependencies:

  ```powershell
  python -m venv .venv
  .\.venv\Scripts\python.exe -m pip install -r requirements.txt
  ```

- `ffmpeg` and `ffprobe` on PATH for video commands, encoding tests and degradation tools.
  The video-only `fire_pov` command also accepts explicit `--ffmpeg` / `--ffprobe` paths.
- JDK 17+ for the Gradle 9.2.1 wrapper and Fabric Loom 1.14.10. The wrapper downloads
  Gradle and game/dependency artifacts on the first build; offline use requires those caches.
  Java source is compiled for release 8. No Minecraft client is needed for Rust/Python tests.

Commands below run from `fire-detection/` unless stated otherwise.

## Build and test

```powershell
cargo test --manifest-path core/Cargo.toml
cargo build --release --manifest-path core/Cargo.toml
.\.venv\Scripts\python.exe -m pytest bench/tests obs/tests augment/tests
Push-Location mod
.\gradlew.bat test build
Pop-Location
```

Some video tests skip when ffmpeg is unavailable; a green Rust test run alone does not
prove the encoding round trips ran. Gradle may fail in restricted shells before it reaches
the build; [environment notes](NOTES-minecraft-1.16.5.md#7-environment-gotchas-for-building)
describe the known local restriction. Never start a game client as part of automated checks.

## Video-only first-person detection

```powershell
cargo run --release --manifest-path core/Cargo.toml --bin fire_pov -- VIDEO --stride 5
```

JSONL is written to stdout. `row` is an accepted row or `null`; `candidate_row` is diagnostic.
`--limit N` limits emitted predictions and `--threshold` sets an explicit score threshold
(default 0.5). Input indices count decoded frames. The default asset path is relative to
the source tree; moved executables need `--assets DIR` containing `fire_1.rgba`.

## Capture and evaluate

1. From `mod/`, run `.\gradlew.bat runClient -PfirelabelDebug=false` when recording.
   The default dev client enables debug outlines, which should not enter evaluation footage.
   Label logs are written under the game directory's `firelabel/` folder.
2. Record the whole viewport with the sync strip visible. See [capture plan](data/CAPTURE_PLAN.md).
3. Join labels with the video:

   ```powershell
   .\core\target\release\fire-decode.exe VIDEO --labels labels.jsonl --out joined.jsonl
   ```

   Strip IDs detect duplicate/missing frames and mismatched labels; do not substitute wall-clock sync.
4. Run the relevant evaluator (`fire-eval`, `fire-overlay`, `fire-blobs`, etc.), then a `bench/` report.
   The acceptance report and its required CSV schema are documented in [FIRST_PERSON_STATUS.md](bench/FIRST_PERSON_STATUS.md).
5. Use `augment/` to assess degradation separately. Its ranges are assumptions until calibrated
   against real delivered files; see [encoding research](augment/YOUTUBE_ENCODING.md).

## Data and interpretation

Recordings, joined reports, label sidecars, trained model outputs and benchmark caches are local
research data, excluded from the source tree. A fresh clone can run synthetic/unit checks using
the small checked-in fixtures; reproducing recording-specific numbers requires the original
private inputs. Keep those inputs and their hashes when comparing results. `data/joined/tree.json`
and `tree3.json` are experimental outputs, supplied explicitly with `--model`, not build dependencies.

The research mod logs physical texture rows. FireCrackle exposes animation indices and handles
the fire_0 metadata offset at its boundary. Consult the internals notes before joining these
different representations. Animation is driven by client ticks; 20 Hz is a reference clock,
not proof that a captured recording has no stalls, cuts, repeated images or world transitions.
