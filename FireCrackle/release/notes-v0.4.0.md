FireCrackle 0.4.0 for Windows x64 and Linux x86_64.

- **Optional extra texture sources:** off by default, preserving the 0.3 fire-only interface. Enable Settings → Enable extra texture sources for soul fire, separate still/flowing lava and water pickers, quad previews and material charts. Normal-fire filters stay available. Each material keeps its own timing; still lava's direction remains ambiguous where images repeat. Each source also has its own absence label.
- **Water tint and fluid clocks:** an in-app colour picker, hue slider and hex input update both water atlases and the quad overlay. Each fluid also has its own Jolt comparison and material-specific animation period.
- **Joint timing view:** All textures overlays material-coloured offsets directly in the familiar Timing chart, keeping its shading, ruler, zoom and flag sidebar. Choose a modulus to review different clock cycles. Provisional phase choices remain marked; this view does not generate automatic joint flags or prove a cut.
- **Stronger inspection views:** High contrast includes gamma compensation, Dark scene lifts shadows harder, Fire focus isolates orange, and Texture detail sharpens aggressively. Find edges shows an outline map. Gamma and sharpening have wider ranges, with fewer overlapping presets. Effects apply to paused frames.
- **More reliable GUI unveil:** confirmed inventory/menu matches can trigger Auto-undo, and compressed dark menus no longer fail on a rounding boundary. Ordinary HUD matches do not trigger unveiling; Off remains available.
- **Animated comparison proofs:** copy or save before/after proofs in the available formats, including a square animation that fades the mask over the original and carries the sprite details.

Automatic labellers and quad matching still support normal fire only. Alternate-material labels are manual. Keep a project backup before opening new material labels in an older app version.

Auto runs locally and may use AI/GPU acceleration where supported. Unusual hardware or drivers can reduce compatibility or speed; CPU fallback remains available. Review automatic labels when you need reliable phase evidence. Older accuracy measurements are not a new 0.4.0 benchmark.

Downloads: Windows setup EXE / portable ZIP, Linux AppImage / Debian package, with SHA-256 checksums. FFmpeg remains a separate dependency.
