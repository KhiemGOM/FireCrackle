# Security and privacy

Do not attach access tokens, OBS passwords, personal recordings or private label/project files to a public issue. Report a suspected vulnerability through GitHub's private vulnerability reporting feature if available; otherwise contact the repository owner privately and agree on a private channel before sending details.

FireCrackle processes local video through external FFmpeg/FFprobe processes. Use the checksum-verified runtime supplied by the packaging script or a trusted installation. Keep runtime and app dependencies updated. Imported label files are data, not commands.

Labels and project caches are stored alongside a video in its `.firecrackle` directory. UI preferences and recent video state are stored per Windows account. Export only the labels you intend to share. Automatic matching runs locally; it does not upload recordings.

Version 0.1.x test builds are unsigned. Download them from the owner's official release page and compare the supplied SHA-256 hashes. A research score or timing flag does not establish that a recording was edited.
