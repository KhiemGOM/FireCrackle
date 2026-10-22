FireCrackle 0.5.1 for Windows x64 and Linux x86_64.

- **JoltCracker built in:** the Phase tab can now run [Splosh's JoltCracker](https://splosh.icu/jolt) on the open video and use its result as the Jolt clock, with progress and a Stop button. FireCrackle uses the newest copy already on your PC, or downloads the latest release from splosh.icu once (the Windows download is checked against the checksum published there). Integrated with Splosh's permission — thank you, Splosh.
- **GUI detector speed and time left:** the GUI scan now shows its speed and remaining time like the other scans, and a failed GUI scan no longer reads "Ready".
- **Quad mask remembers each confirmed frame:** returning to a frame you confirmed puts the mask back where you left it.
- **Jump box:** typing a time with the cursor at the end now works, and its error message is no longer hidden.
- **Safer background work:** opening another video or closing the app stops every running scan; a scan that crashes reports a failure instead of hanging; saves are written crash-safely.
- **More exact:** frame timestamps use FFmpeg's exact values on long videos, Jolt and texture charts open the exact frame, and saved per-video settings survive a different slash style or drive-letter case.

Automatic GUI scan caches from 0.5.0 are rebuilt the first time a video is scanned.

Linux requires FFmpeg and ffprobe; an FFmpeg with libdav1d is recommended for AV1 videos.
