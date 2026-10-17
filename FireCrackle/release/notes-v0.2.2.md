FireCrackle 0.2.2 hotfix for Windows x64 and Linux x86_64.

- **Independent frame and time editing:** clicking a frame number or timecode now edits only that value, in exactly the same space. Both labels and the total frame count stay visible, and the status row no longer shifts.
- **Fixed timecode separators:** `:` and `|` stay in place while typing or deleting digits. Enter jumps; Escape or clicking away cancels. Switching fields also cancels an unfinished time lookup.
- **Maintenance fixes:** reopening a project resumes its saved frame, forgotten projects stay forgotten, URL downloads stop when the app closes, and Windows network download paths are handled correctly. Phase-chart gaps show their own explanation when hovered.

Windows: use the setup EXE, or extract the ZIP and run `FireCrackle.exe`. FFmpeg and yt-dlp remain separate downloads when needed. Linux: use the AppImage or Debian package and install your distribution's FFmpeg.

Verify downloads with `SHA256SUMS.txt` (Windows) or `SHA256SUMS-linux-x64.txt` (Linux). These are unsigned experimental builds. This hotfix replaces no assets from earlier releases.
