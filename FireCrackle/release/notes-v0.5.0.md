FireCrackle 0.5.0 for Windows x64 and Linux x86_64.

- **Much faster automatic scans:** the first-person and no-fire scans run 2–4× faster on 1440p recordings and up to 2× faster at 1080p, with the same results. Video is decoded with the GPU (NVIDIA NVDEC for H.264, HEVC and VP9) or dav1d for AV1, frames travel to the scanner at half the size, and the GUI and fire checks do the same work with far less repetition.
- **No-fire scan at any resolution:** recordings that are not 1920 × 1080 can now be scanned; the scan works on a 1920 × 1080 view of each frame.
- **GUI detection tab:** source-verified detection of inventories, editors and menus, resumable interaction scans, a blinking-boundary interval list, cached gallery previews and an image-only aim jump gallery ranked by motion.
- **Full-quality paused frames:** when playback is paused, the Label view shows the frame losslessly at the video's own resolution and zooms without smoothing, so single pixels stay sharp. GUI veil, portal and Enhance corrections run on that full-quality frame too. Playback still uses the faster preview frames.
- **Misc tools:** frame comparison with difference, blink and annotated proof export, and fixed-sprite alignment polish for quad matches.
- **Small improvements:** live scan speed and remaining time, split playback button with slow-speed presets, faster seeking and preview decoding, one undo history for labels, masks and tools.

Scan results are checked against the previous version on real recordings: every first-person and no-fire decision matched. Automatic scan caches from earlier versions are rebuilt the first time a video is scanned. Speed depends on hardware: without a supported NVIDIA GPU, decoding falls back to the CPU and scans are slower, but results are the same.

Linux requires FFmpeg and ffprobe; an FFmpeg with libdav1d is recommended for AV1 videos.
