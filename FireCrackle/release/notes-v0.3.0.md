FireCrackle 0.3.0 for Windows x64 and Linux x86_64.

- **AI no-fire scan:** Auto can now combine colour rules with a small image model to save no-fire labels. Runs locally, protects existing labels and supports Undo. Automatic labels have clear patterned tool colours.
- **Measured behaviour:** a complete familiar 19,553-frame recording cleared 13.00% of eligible frames, with 0.89% of meaningful-fire frames wrongly cleared. Tiny, obscured or unreadable fire can still be cleared; review automatic labels if you need phase readings from those scenes. This is a benchmark, not an accuracy guarantee.
- **Smoother playback:** bounded frame buffering, cancellable decoding and presentation-aware playback avoid racing ahead of the displayed picture.

For best results use native 1920×1080 footage, standard supported Minecraft graphics/GUI, and readable fire. Modified resource packs, shaders, overlays, strong compression and translucent objects can reduce reliability. Unknown/uncertain cases may stay unlabelled.

- **First-person labeller:** now uses the shared GUI and veil handling. In testing it detected 98.8% of first-person fire samples with no false positives or wrong sprite labels. The stronger checks take more processing time.
- **GPU support:** Windows uses compatible DirectML GPUs; Linux includes the NVIDIA CUDA backend with CPU fallback. Linux GPU use requires compatible CUDA 12/cuDNN 9 runtime libraries. Backends must pass score and speed checks before automatic selection.

Download the setup EXE or portable ZIP on Windows; AppImage or Debian package on Linux. FFmpeg remains a separate dependency. Check the supplied SHA-256 sums before sharing.
