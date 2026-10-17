FireCrackle - Linux x86_64 test build

Built on Ubuntu 22.04. Intended for Ubuntu 22.04+ and compatible glibc-based
desktop distributions. ARM64 and musl/Alpine are not included in this release.

AppImage:
  Install FFmpeg using your distribution's package manager first.
  On Ubuntu: sudo apt install ffmpeg libfuse2
  chmod +x FireCrackle-*-linux-x86_64.AppImage
  ./FireCrackle-*-linux-x86_64.AppImage
  Without FUSE, use: ./FireCrackle-*-linux-x86_64.AppImage --appimage-extract-and-run

Debian/Ubuntu package:
  sudo apt install ./FireCrackle-*-linux-amd64.deb
  Open FireCrackle from the desktop menu, or run firecrackle.
  apt installs the declared FFmpeg and desktop-library dependencies.

Upgrading:
  FireCrackle checks once a day whether a newer version exists and shows a banner
  (switch that off, or check now, with the Software updates button). Close FireCrackle first.
  AppImage: replace the old file with the newer one and make it executable.
  Debian/Ubuntu package: sudo apt install ./FireCrackle-<new version>-linux-amd64.deb
  Labels live beside each video in its .firecrackle folder, so an upgrade never touches them.
  Do not open a project with an older FireCrackle than the one that made it.

Unlike the Windows package, Linux packages use system ffmpeg and ffprobe.
No Windows video-tool executables are bundled. Node.js and Rust are not needed.

Labels autosave beside the video in its .firecrackle folder. Keep that folder
with the video, or export labels using the toolbar. Preferences are stored
in your user account. The application needs write access beside the video.

This is an unsigned experimental build. Timing flags are review prompts, not
proof of an edit. Report the version, distribution and reproduction steps.
Do not share recordings or labels unless you intend others to see them.

Original code is MIT-licensed. Minecraft-derived assets keep separate rights;
see LICENSE.txt and THIRD_PARTY_NOTICES.txt. FFmpeg is provided and licensed
separately by your distribution. SHA256SUMS-linux-x64.txt verifies the downloads.
