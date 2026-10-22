# hud-cadence

Reads a once-per-second HUD counter (the F3 `FPS` value, also shown by overlay mods that read
`MinecraftClient.currentFps`) from video frames and checks that its update moments keep a constant
phase modulo one second of frames.

Why that is a continuity check: `MinecraftClient.render` updates the value in
`while (now >= nextDebugInfoUpdateTime + 1000) { ...; nextDebugInfoUpdateTime += 1000; }`
(1.16.5 and 1.21.11 alike). The grid is anchored to the process clock and never re-based, so lag
cannot move it. Only the recording can: dropped/duplicated capture frames shift the phase by one
frame (drift); a cut that removes a non-integer number of seconds shifts it by more (jump). A cut of
exactly N seconds (±1 frame) is invisible to this check.

Reader: the vanilla bitmap font (`assets/ascii.png`, from the game jar) at an integer GUI scale,
threshold 170 on grey. `FPS: ` is found by template, then up to four digits are matched per 5×7 cell.
On the 1440p60 recording every frame of a 36,000-frame window read, with at most 25 of 360 cell
pixels differing from the template (typically 0–3).

```
cargo run --release -- sweep <video> --ffmpeg <ffmpeg.exe> [--scale 3] [--out sweep.json]
cargo run --release -- scan  <video> --ffmpeg <ffmpeg.exe> --start S --duration S [--fps 60] [--strip bottom-right --width 2560] [--prescale 2560:1440] [--out scan.json]
cargo run --release -- replay scan.json
cargo run --release -- truth  scan.json --log <run/hudinfo/session.jsonl>
cargo run --release -- labels scan.json --log <run/hudinfo/session.jsonl> --out <dir> [--source <video> --ffmpeg <ffmpeg.exe>]
```

`labels` writes one JSONL per usable segment (consecutive strip-readable frames, at least 2 s): per video
frame the renderer frame ID, the game clock (`nanos`), the logged FPS value, whether this is the first video
frame showing a new value, and what the reader read. With `--source` it also cuts each segment out of the
video (re-encoded, frame-exact). `fire-detection/data/labels/` holds the label files for our control clips.

`--strip bottom-right` (mod-hud; `top-right` for the first build) or `left` (mod-gui) also decodes the frame-ID strip on every frame, which
tells how the recorder sampled the game (new / duplicated / skipped renderer frames). `truth` then
takes the mod's per-frame log and reports, for every logged FPS change, the video frame that first
shows it versus the frame the reader detected, plus the game's own phase (nanoTime mod 1 s).

`sweep` decodes keyframes only and lists the spans where the overlay is readable. `scan` decodes
every frame of a window, prints the phase histogram (change frame mod period) and the drift/jump
events. Decoding is the cost: ~370 fps on the 1440p AV1 file with the dav1d FFmpeg build.
