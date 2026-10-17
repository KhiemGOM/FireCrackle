FireCrackle v{{VERSION}} - Windows x64 test build

Extract the entire archive, then open FireCrackle.exe.
Third-party tools are downloaded on first use and cached in your account's app data.
Internet is needed for the first FFmpeg/FFprobe setup and the first online-video download.
Later local-video use works offline. An installed FFmpeg/FFprobe pair is reused when available.
You do not need Node.js or Rust.
Requires Windows 10/11 x64 and Microsoft Edge WebView2 Runtime:
https://developer.microsoft.com/microsoft-edge/webview2/#download-section
The optional Setup.exe installs the app and downloads WebView2 if it is missing (internet required).

Open a video to begin. Labels autosave beside the video in its .firecrackle folder;
keep that folder with the video. Export labels from the toolbar to share them.
Settings and preview geometry are saved for your Windows account.

Upgrading: FireCrackle checks once a day whether a newer version exists and shows a
banner (switch that off, or check now, with the Software updates button). To upgrade,
close FireCrackle, then run the newer Setup.exe (it replaces the installed version) or
extract the newer ZIP (to the same place or a new folder) and run its FireCrackle.exe.
Your labels live beside each video in its .firecrackle folder, so an upgrade never
touches them. Do not open a project with an older FireCrackle than the one that made it.

Quick keys: Left/Right = video frames; Up/Down = animation phases;
R = flip; T = switch sheet; E = preview opacity; Enter = confirm candidate;
Ctrl+S = save. Use the keyboard icon for the full list.

This is an unsigned {{VERSION}} test build; Windows may show an unrecognized-app warning.
When reporting a bug, include the version, reproduction steps and a screenshot.
Share a short video/label export only if you want others to see that content.

FFmpeg/FFprobe, yt-dlp and Deno are separate upstream tools, not included in this archive.
Credits, upstream links and license details are in THIRD_PARTY_NOTICES.txt.
Downloaded tools have notices and source/checksum information beside their cached files.
Original app code is MIT-licensed (LICENSE.txt); third-party and Minecraft
materials keep their own rights (THIRD_PARTY_NOTICES.txt).
No recordings, saved labels or developer settings are included in this package.
