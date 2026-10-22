# HUD info overlay — Java 1.21.11 (Fabric, Sodium-compatible)

Replicates the always-on top-left line from the reference footage so you can record control
footage for `fire-detection/hud-cadence`:

```
XYZ: 2340.293 / -24.999 / 838.915 | Yaw: 104.8 Pitch: 21.8 | Direction: west | FPS: 146
```

The FPS value is `MinecraftClient.getCurrentFps()`, the same once-per-second number F3 shows, so the
cadence check applies unchanged. The text is drawn exactly like the vanilla F3 lines (vanilla font, light grey on a translucent grey box, no shadow) at GUI (2, 2); a 256×3 GUI-px frame-ID sync strip (same encoding as mod-gui) is drawn in the bottom-right corner (clear of the text and of top-right toasts), and every rendered HUD frame is logged to `run/hudinfo/<session>.jsonl` with `System.nanoTime` and the displayed FPS;
use **GUI scale 3** in Video Settings to match the reference's 3×3-pixel glyphs at 1440p. Both are drawn after any open screen, so they stay crisp under the pause menu or inventory; they are
hidden only while F3 is open or the HUD is hidden (F1).

## Run

1. `python install-sodium.py` once: downloads the pinned Sodium and Fabric API jars into `run/mods`
   (hash-checked). Fabric API is only there for Sodium.
2. `record-hud.cmd`: starts the isolated `run/` instance with Java 21 via `gradlew runClient`.
3. Record normally in OBS at a constant 60 fps. For a splice experiment, record one continuous session,
   then cut and re-join a copy; run `hud-cadence scan` on both.

`gradlew build` produces `build/libs/hud-info-0.1.0.jar` for a normal launcher profile; it needs only
Fabric Loader 0.18.4+ (no Fabric API).

Not built or run in this checkout's sandbox (Gradle needs a loopback socket there); `gradlew test`
runs the formatter tests.
