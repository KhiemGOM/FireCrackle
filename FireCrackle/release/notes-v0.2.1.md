FireCrackle 0.2.1 for Windows x64 and Linux x86_64.

- **Smooth video playback:** playing a video no longer stalls, and the app no longer freezes while a frame loads. On 1080p 60 fps recordings, normal-speed playback went from 0.76× to 0.98× real time (7 stalls of up to 1.1 s became a single wait for the first frame), 2× now plays at full speed, 4× reaches about 3.3×, and stepping backwards through 100 frames never waits. FireCrackle keeps about ten seconds of video decoded ahead and two behind, fills it in the background right after any jump, and no longer holds up every other control while a frame is decoded.
- **What is still slow:** the first frame after jumping to a distant part of a video takes about 0.8 seconds, because the video has to be decoded from its previous keyframe. Playback right after that jump can pause briefly at 2× speed while the rest of the window loads.
- **Less work while playing:** the recent-projects list is saved about once a second instead of on every frame step.
- **Jump to a frame or timecode:** type a frame number or a timecode to go straight there.
- **Portal animation undo and GUI mask:** the animated Nether portal overlay can be fitted and removed from a frame, and frames where the world may be translucent (portal, purple effects) stay in review instead of being called no-fire. An optional GUI mask overlay outlines the game's own interface (hotbar, text and similar) so you can see what covers the world; it asks once whether the video uses the vanilla interface.
- **Version shown in the app:** the release version appears beside the app name in the header.

Windows: use the setup EXE, or extract the ZIP and run `FireCrackle.exe`. FFmpeg and yt-dlp remain separate, verified downloads when needed. Linux: use the AppImage or Debian package and install your distribution's FFmpeg. See the packaged instructions and in-app credits.

Verify downloads with `SHA256SUMS.txt` (Windows) or `SHA256SUMS-linux-x64.txt` (Linux). These are unsigned experimental builds. Original code is MIT-licensed; third-party assets and tools retain their own licenses.
