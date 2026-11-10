FireCrackle 0.7.0 for Windows x64 and Linux x86_64.

- **Copy the frame you are on:** right-click the video or press Ctrl+Shift+C to copy the current frame as a PNG at the video's own resolution, without overlays. The right-click menu can also save it as a PNG.
- **Toasts are recognised as GUI:** settled "New Recipe(s) Unlocked!" and advancement toasts in the top right are part of the GUI mask, so they are never taken as evidence of fire. GUI scan results are rebuilt once for this.
- **Unveil leaves toasts as they are:** toasts are drawn over the darkened background of an open inventory or menu, so unveil no longer brightens them.
- **Console API for blink proofs:** in the app's developer console, `firecrackle.proof({first, last, path})` saves the frame comparison's blink proof of two frames, and `firecrackle.guiProof({first, last, pair, path})` saves the proof of a GUI opening or closing (`firecrackle.help()` lists the options). They use the same pictures, unveil and export as Misc tools.

Linux requires FFmpeg and ffprobe; an FFmpeg with libdav1d is recommended for AV1 videos.
