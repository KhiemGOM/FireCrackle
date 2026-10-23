# FireCrackle

Video labelling and fire-sprite matching app for Windows x64 and Linux x86_64. Downloads are published to [KhiemGOM/FireCrackle](https://github.com/KhiemGOM/FireCrackle/releases); access follows that repository's visibility.

## Build something to share

On Windows with Node.js 24, Rust stable (MSVC), Visual Studio C++ build tools and Windows SDK:

```powershell
Set-Location FireCrackle
npm run release
```

This verifies/downloads pinned FFmpeg for build tests, installs dependencies on a fresh checkout (or checks existing ones), runs checks, builds the app and creates a portable ZIP in `releases/v<version>/<build>/`. Send that ZIP; testers extract it and run `FireCrackle.exe`. Testers need Windows 10/11 x64 and Edge WebView2. External executables are not packaged: FFmpeg/FFprobe download on first use when a suitable installed pair is unavailable (Windows requires dav1d AV1 decoding). They are verified and cached in account app data for subsequent offline use.

For a single installer EXE that installs WebView2 when missing (internet required):

```powershell
npm run release -- -Installer
```

For a RAR, install WinRAR (including `Rar.exe`), then:

```powershell
npm run release -- -Format rar
```

ZIP is the default so Windows can extract it directly. Both portable and setup packages omit third-party tool binaries. First-use setup requires internet; later local-video use works offline with cached tools. Builds are unsigned; this pipeline does not publish them or configure an updater.

Each run has a fresh output folder, `release.json` containing commit/build/runtime versions, and SHA-256 checksums. Only the executable, notices and tester instructions are packaged, never third-party tool binaries, recordings or labels. Normal builds run checks; `-SkipChecks` is an explicit shortcut. `-CleanInstall` forces locked `npm ci` as CI does; stop any dev command first so its native modules can be replaced. Validate prerequisites/configuration without building with `npm run release -- -ValidateOnly`.

FFmpeg comes from [Gyan's Windows builds](https://www.gyan.dev/ffmpeg/builds/), pinned in `release/runtime-lock.json`; its original license/build notices and source links remain beside cached tools. Update version, archive kind, URL, SHA-256 and source together when upgrading. Windows uses the full build with dav1d; hash-specific cache directories keep older running windows untouched. `.release-cache` and `src-tauri/runtime` hold developer test tools, not packaged runtime files. Neither is committed.

## Picture correction

The video and image toolbars place **Portal** beside **Veil**, both off by default.
Portal **Auto-undo** fits the full-screen vanilla portal animation and reverses it
only when the shared detector accepts the fit. It runs in a cancellable background
worker. Veil correction runs first when enabled; an uncertain fit leaves the picture
unchanged. Original files and labels are preserved.

On videos, portal correction uses the GUI mask and its existing per-video vanilla
1.16.5 question. It waits for a reliable mask for the current frame and excludes
opaque, translucent and unknown GUI pixels from fitting and correction. Images
have no project GUI mask; the status explicitly says they have no GUI protection.
This is an inspection tool for the full-screen overlay; it does not undo a portal
block's world-space surface or certify no fire. Badly conditioned pixels remain
unchanged. The vanilla portal texture is extracted from a local 1.16.5 client at
build time, or downloaded from Mojang's hash-verified client when unavailable;
the source texture/archive is never committed.

## Online video links

Use **Open link** in the toolbar or paste a link on Home. Select a destination folder; the app downloads one video and opens it using the ordinary timestamp/label workspace. Progress and cancellation are available in the link panel. Existing videos and label files are preserved. Closing the panel lets a download continue; reopen it to see the result.

Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp), [Deno](https://deno.com), and FFmpeg. Official x64 Windows/Linux yt-dlp and Deno releases are pinned with SHA-256 in `release/download-tools.json` and downloaded into app data only when needed. Credits and upstream license links are in the app and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Site support follows yt-dlp; private, login-protected, restricted, or live videos may be unavailable. Upstream fixes require refreshing the pinned release metadata and rebuilding FireCrackle.

## Automated build

The repository's **FireCrackle release** workflow builds Windows ZIP/setup EXE and Linux AppImage/Debian packages. Manual runs default to build-only; enabling Publish requires both platforms to pass. A matching `v*` tag also builds and publishes both. Use the [isolated release command](release/README.md) to freeze a committed source ref, update all version files together and start the workflow while development continues separately. Packages are verified locally and against uploaded checksums before publication through a draft. The whole repository is required because the app uses `fire-detection/core` and embedded fire assets.

## Linux builds

Linux packages target x86_64 glibc-based desktops and are built on Ubuntu 22.04. ARM and musl/Alpine are not included. The AppImage needs system `ffmpeg`/`ffprobe`; install FFmpeg with your distribution's package manager. On Ubuntu, `sudo apt install ffmpeg libfuse2`, then make the AppImage executable and open it. Without FUSE, launch it with `--appimage-extract-and-run`. For Debian/Ubuntu, `sudo apt install ./FireCrackle-*-linux-amd64.deb` installs the declared dependencies.

To build on Linux, install Node.js 24, Rust stable, FFmpeg, the [Tauri Linux dependencies](https://v2.tauri.app/start/prerequisites/#linux), plus `patchelf`, `libfuse2`, `xvfb` and `dbus-x11`. Then run:

```sh
cd FireCrackle
bash scripts/release-linux.sh
```

The script runs frontend, video-core, detector and desktop tests, including a real FFmpeg encode/decode check. It builds AppImage and Debian bundles, packages original-code/third-party notices and build metadata, verifies checksums and contents, and starts both packages under a virtual display. Outputs go to a fresh `releases/v<version>/linux-x64-<build>/` directory. FFmpeg is supplied and licensed by the Linux distribution; Windows runtime files are not bundled into Linux packages.

## Develop

```powershell
npm ci
npm run tauri:dev
```

`tauri:dev` is the only way to get the Vite dev server (hot reload): it builds without the default
`custom-protocol` feature. Every other build, including a plain `cargo build --release` in `src-tauri`, embeds the
frontend from `dist/` (run `npm run build` first), so an exe never silently points at `localhost:1420`.

The app reuses FFmpeg/FFprobe from `PATH` or a legacy adjacent `tools` folder when available; on Windows the FFmpeg build must include libdav1d. Windows otherwise fetches them into app-local data; Linux uses distribution packages. Labels autosave alongside the video; UI preferences are per account.
