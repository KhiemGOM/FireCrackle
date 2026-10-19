FireCrackle 0.4.2 for Windows x64 and Linux x86_64.

- **Better fire matching:** quad matching combines a 128px AI model with the colour matcher and suggests three distinct animation phases. Ordinary fire and soul fire use separate trained models.
- **Soul-fire Match tool:** use the same Match button and M / M+1–3 shortcuts on either soul-fire sheet. Candidates preserve the correct source, filters and quad controls. Preview a result, then Confirm/Enter to save it.
- **Ready when you need it:** both models load eagerly. Supported GPU backends run inference with CPU fallback; an unavailable AI model leaves the colour matcher available and reports the error. No Python installation is needed.
- **One default fire clock:** ordinary fire and soul-fire observations share the normal-mode analysis clock while retaining their source. Conflicting readings on the same frame are hard flags. All-source mode keeps sources separate.
- **Small improvements:** source-specific soul-fire filters are preserved, and preview pixel-grid strokes keep a consistent width while zooming.

On the held-out readable-quad benchmarks, the correct phase appeared in the top three suggestions for 83.3% of ordinary-fire examples and 80.1% of soul-fire examples. These are helper suggestions, not guaranteed labels. Small, squashed or heavily obscured fire remains harder to match; check every result before confirming.

AI/GPU performance depends on hardware and drivers. Unusual setups may use CPU inference or the colour matcher. Extra water/lava sources remain opt-in. Linux requires FFmpeg and ffprobe.
