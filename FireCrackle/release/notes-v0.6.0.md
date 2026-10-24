FireCrackle 0.6.0 for Windows x64 and Linux x86_64.

- **3D quad (Label, D):** place the fire in 3D instead of drawing a flat quad. The camera comes from an automatic guess for the frame plus a few clicked block corners. There is one fire in three modes: a fire block, a burning block with the faces you choose, or a burning entity with any mob's hitbox. Every plane is drawn with the chosen sprite, in depth order, and each layer of a burning entity uses its own sheet.
  - To check the camera, show the block grid and the fire's box.
  - **Lock grid** holds the camera while you type corners.
  - The cursor shows its x and z on the grid floor, so you can read a corner's position instead of counting blocks.
  - The FFmpeg compression preview and comparison proof work with it too.
  - Undo and redo work, and each frame's work is remembered.
- **Match for every tool:** Match is now a mode with the same panel for the quad mask, the 3D quad and first-person fire, each with three tries (M then 1–3).
  - On the 3D quad, every plane of the fire votes on one animation phase and one sprite, using the atlas filters.
  - On first-person fire, the POV labeller reads the frame's row and FOV.
- **Redo:** a Redo button beside Undo, plus Ctrl+Y and Ctrl+Shift+Z.
- **One image viewer for every picture:** it opens full window, with zoom against native resolution, pan, fit and 1:1, and the pixel position.
- **Frame comparison:**
  - Unveil, portal, Enhance and the open-GUI mask run on the native frame, losslessly.
  - The aim gallery is auto-unveiled and can pair frames across a GUI opening.
- **GUI detector:**
  - finds menu screens, such as pause and options, and masks the whole screen;
  - finds the recipe book and its tabs;
  - keeps one GUI scale per frame;
  - finds tooltips whose rim compression cut short;
  - unveils 1.21+ menus by their own background.
  - Auto unveil and the no-fire AI decide from the GUI detector, on native frames only.
- **Faster pause:** the full-quality frame shows in about 0.4 s instead of 1.1 s. Picture work runs off the UI thread, and display frames show the video's real colours.
- **Timeline:** drag the playhead to scrub frame by frame.
- **Downloads** of FFmpeg, yt-dlp and JoltCracker show speed and time left. One Stop now covers every background job.
- **The video view comes back where you left it.** Before, it drifted each time the app opened and could open off the picture.
- The header shows the open project's name.

Automatic GUI scan caches from 0.5.x are rebuilt the first time a video is scanned.

Linux requires FFmpeg and ffprobe; an FFmpeg with libdav1d is recommended for AV1 videos.
