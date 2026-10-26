FireCrackle 0.6.2 for Windows x64 and Linux x86_64.

- **Timeline thumbnails no longer fail on some videos:** a video whose keyframes FFmpeg reads differently from the video's index showed "Create thumbnails: thumbnail keyframes differ from the index". It now gets its thumbnails, each one checked against the frame it shows.
- **A thumbnail failure is reported once:** if thumbnails really can't be made, the error shows once for the opened video instead of after every app start and screen switch. Reopening the video tries again.

Linux requires FFmpeg and ffprobe; an FFmpeg with libdav1d is recommended for AV1 videos.
