FireCrackle 0.4.1 hotfix for Windows x64 and Linux x86_64.

- **Visible failures:** errors now open a popup with a copyable report. This includes video import, FFmpeg, scans, saving, matching and unexpected application errors. Repeated failures are grouped, playback pauses, and labelling shortcuts stay blocked while the popup is open. A broken screen offers Reload app.
- **Working water eyedropper:** pick a colour directly from the displayed video or image, including desktop runtimes without a working browser eyedropper. The compact colour controls keep the atlas visible; the reset action is labelled Untint.
- **Steadier quad editing:** grabbing a corner preserves its position under the pointer, avoiding the initial jump. Resize and rotation use the same stable mapping.
- **Clearer Linux import errors:** file-chooser failures are reported, and missing or broken FFmpeg/ffprobe checks include actionable details and Fedora installation guidance. If the chooser fails, paste the video path on Home.
- **Material tools:** Animation and Comparison proof are available for the additional texture atlases, with refreshed shortcut help.

The reported Fedora import issue has not been reproduced on Fedora; this hotfix makes chooser and video-tool failures visible so their cause can be identified.

Extra texture sources remain off by default. Automatic labellers and quad matching still support normal fire only; alternate-material labels are manual. Auto runs locally and may use AI/GPU acceleration where supported. Unusual hardware or drivers can reduce compatibility or speed; CPU fallback remains available. Review automatic labels when reliable phase evidence is needed.

Downloads: Windows setup EXE / portable ZIP, Linux AppImage / Debian package, with SHA-256 checksums. Linux requires system FFmpeg and ffprobe.
