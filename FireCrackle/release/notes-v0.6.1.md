FireCrackle 0.6.1 for Windows x64 and Linux x86_64.

- **Much smaller downloads:** the Windows installer and zip are back to about 25 MB, down from about 330 MB. Linux packages are about 300 MB lighter. Since 0.4.2 every package carried the two quad-phase AI models (163 MB each).
- **Quad AI models download when first used:** the models now download the first time Match needs them, like FFmpeg and yt-dlp. They come from the `quad-phase-model-v1` release, are checked against their pinned SHA-256 and are kept for next time. Until a model has downloaded, Match uses the colour matcher and its details show the download's progress. An install from 0.4.2 to 0.6.0 that already has the models keeps using them, with no download.
- **Releases can't grow like that again:** the release checks now reject any package that contains a tool or model the app downloads itself, or that goes over its size budget.

Linux requires FFmpeg and ffprobe; an FFmpeg with libdav1d is recommended for AV1 videos.
