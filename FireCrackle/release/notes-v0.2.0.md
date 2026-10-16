FireCrackle 0.2.0 for Windows x64 and Linux x86_64.

- **Jolt as canonical time:** import a Jolt report for the same video and switch Timing/Sprites between video time and recovered GUI ticks. Fire labels remain unchanged. Fits stay within reported continuous sections and do not bridge clock breaks.
- **Jolt + Fire:** an aligned Jolt timeline and fire–Jolt phase agreement chart make it easier to inspect events together. Recovered readings, estimated sections and reported clock breaks remain distinct.
- **A focused Phase workspace:** persistent flags sidebar, fullscreen chart view, numbered X axes, independent X/Y zoom and two-axis panning. Video inspection opens separately with an explicit Close control.
- **Readable chart evidence:** full fire-label evidence reaches canonical analysis; zooming restores detail. Overview rendering preserves interior rows and phase levels. Ruler opacity is adjustable, and deviation lines split correctly at wrapped row/phase boundaries.
- **FFmpeg compatibility:** detect supported frame-sync options at runtime, including newer Linux FFmpeg versions.
- Includes the current main-branch review fixes for restored-image clipboard paste, project resume, downloaded-video paths, downloader cleanup, timecodes and tool-cache validation, plus the TypeScript update.

**Interpreting Jolt estimates:** between recovered readings, GUI time is estimated. Uneven tick progression or a brief hold can produce a temporary apparent fire–Jolt phase peak even when the actual clocks agree. These peaks and timing flags are review prompts, not proof of an edit. A cut can preserve fire–GUI phase, and changes by a whole 32-tick cycle cannot be distinguished by fire phase alone.

Windows: use the setup EXE, or extract the ZIP and run `FireCrackle.exe`. FFmpeg and yt-dlp remain separate, verified downloads when needed. Linux: use the AppImage or Debian package and install your distribution's FFmpeg. See the packaged instructions and in-app credits.

Verify downloads with `SHA256SUMS.txt` (Windows) or `SHA256SUMS-linux-x64.txt` (Linux). These are unsigned experimental builds. Original code is MIT-licensed; third-party assets and tools retain their own licenses.
