# Plan: how a user upgrades FireCrackle

Status: Phase 1 is built (update banner, Software updates dialog, install-kind detection, shared asset-name contract,
Upgrading sections in the packaged READMEs). Phase 2 (signed in-app install) is not started. Decisions taken: Phase 1
first; automatic check on by default (once a day, one switch); READMEs updated now.

## What exists today

- Releases are public on GitHub (`KhiemGOM/FireCrackle`), published as normal releases (not drafts, not pre-releases).
  Asset names are stable: `FireCrackle-<v>-windows-x64.zip`, `...-windows-x64-Setup.exe`, `...-linux-x86_64.AppImage`,
  `...-linux-amd64.deb`, plus `SHA256SUMS.txt` (Windows) and `SHA256SUMS-linux-x64.txt` (Linux).
- Sizes are small on Windows (ZIP 4.3 MB, Setup 3.3 MB, because FFmpeg and yt-dlp download separately); AppImage is 84 MB.
- The ZIP is the default Windows package (portable: extract, run `FireCrackle.exe`). The setup EXE is optional and installs
  per user (`installMode: currentUser`).
- The app knows its version (`package.json`, shown in the header). It has verified, cancellable downloads
  (`src-tauri/src/external_tools.rs`: reqwest, SHA-256, progress polled by the UI) and the opener plugin.
- No update check, no updater plugin, no instructions for users. A user who wants a newer version has to find the release page.

## What an upgrade must never do

- Touch labels. They live beside each video in `<video>.firecrackle/` (`project.json`, `labels.jsonl`, `settings.json`, `thumbs/`),
  which no package contains. The cached tools (FFmpeg, yt-dlp) live in the account's app data, separate from the program.
- Lose the project list and UI settings. These sit in the web view's storage, which is keyed by the app identifier
  `com.firecrackle.app`; keep that identifier unchanged (tested by hand, see Verification).
- Interrupt work. No check blocks the UI, nothing downloads or installs without a click, nothing needs the network to label.

## Data compatibility (the part that makes upgrades safe)

- `project.json` has a version (`PROJECT_VERSION`, now 1). Older files must open in newer versions; a file from a *newer*
  version is refused today (`UnsupportedVersion`). Rules to adopt:
  1. Opening an older project migrates it in memory and writes it back only after saving `project.json.bak-v<old>` beside it.
  2. A newer project shows "made by FireCrackle <x>: update to open it", with the update button (below) when one exists.
  3. A format version is bumped only together with a migration and a test that opens the previous version's file.
- `settings.json` stays lenient (missing keys use defaults; unknown keys are kept or ignored, never an error).
- `labels.jsonl` is append-only; a new label field must be optional so older logs replay.
- Downgrading is not supported; say so in the release notes when a format version changes.

## The update flow

### Phase 1: "Update available" (small, no signing, no installer automation)

1. **Check.** On start (at most once per 24 h, remembered) and from a "Check for updates" button (Credits/About or Settings),
   `GET https://api.github.com/repos/KhiemGOM/FireCrackle/releases/latest` from the Rust side with a `User-Agent: FireCrackle/<v>`.
   Setting "Check for updates automatically" (on by default, off disables every request). Offline, rate-limited (403/429) or
   malformed answers fail silently for the automatic check and say so for the manual one. No telemetry: one request, no ids.
2. **Compare.** Parse the tag (`v0.2.10`) as semver numbers (0.2.10 is newer than 0.2.9); ignore drafts and pre-releases,
   ignore anything not newer. A "Skip this version" choice is remembered per version.
3. **Tell.** A dismissible banner: "FireCrackle 0.2.3 is available (you have 0.2.2)", the release notes (the release body),
   and buttons: **Download** (the right asset for this install, below), **Release page**, **Skip this version**, **Later**.
4. **Download.** Opens the asset URL in the browser (opener plugin), so the browser does the download and Windows shows its
   normal protections. The banner also shows the asset's SHA-256 so a user can compare. It comes from the `digest` field
   GitHub's API gives for every release asset, so no second request is needed (fetching `SHA256SUMS*.txt` from a page would
   likely be blocked by cross-origin rules).
5. **Install** is the user's step, explained in the banner:
   - Windows setup EXE (installed): close FireCrackle, run the new setup; it replaces the old version.
   - Windows ZIP (portable): close FireCrackle, extract the new ZIP over or beside the old folder, run the new exe.
   - Linux AppImage: replace the file. Debian package: install the new `.deb` with the package manager.

Which asset is "right": detect how this copy runs: an `uninstall.exe` beside the executable means installed (Setup);
otherwise portable (ZIP). On Linux the `APPIMAGE` environment variable means AppImage; otherwise the `.deb`.
Both detections must be confirmed on a real install (see Verification). When unsure, show all assets for the platform.

### Phase 2 (later, only if Phase 1 is not enough): in-app install, signed

Use Tauri's updater plugin for the installed Windows build and the AppImage: it checks an update manifest
(`latest.json`, hosted as a release asset), downloads, verifies a minisign signature against a public key built into the
app, installs and restarts. Needs: a signing key kept as a repository secret (never committed), `createUpdaterArtifacts`,
the release publisher generating and verifying `latest.json` and `.sig` files, and a key-rotation note. It does not cover
the portable ZIP or `.deb`; those stay manual. Do not self-replace the portable exe from a download without that signature
check: downloads made by the app carry no Mark-of-the-Web, so a hash from the same release page is not authentication.

## Release pipeline changes

- Phase 1 needs none for the assets. Add a test to the publisher (`publish_release.py`) that the asset names match the
  patterns the app looks for, so a rename cannot silently break update checks.
- Release notes (`release/notes-v<v>.md`) are shown in the banner: keep them short and user-facing; say when a data
  format version changes.
- `README-template.txt` and `README-linux.txt` get an "Upgrading" section with the steps above (wording only).

## Tests (written first when built)

- Pure version logic: tags `v0.2.9` < `v0.2.10`; equal; older remote; garbage tag; pre-release/draft ignored; skip-version.
- Release-JSON parsing against recorded real responses (a normal release, a pre-release, no assets, an unknown platform).
- Asset choice per install kind (setup, portable, AppImage, deb, unknown) with a table test.
- The daily limit and the off switch (no request when off, none within 24 h, one on the manual button).
- Failure modes: offline, 403/429, truncated or non-JSON body, huge body (size cap), redirect to another host (refused),
  clock going backwards (a stored "last check" in the future is treated as due).
- Project migration: a recorded v1 `project.json` opens in the current version; a file with a higher version is refused with
  the "update to open it" message and is left untouched; the backup is written before any rewrite.

## Verification by hand (before announcing)

1. Install version N with the setup EXE, label a video, install N+1 over it: labels, project list, settings and cached
   tools still there; the banner no longer shows.
2. Same with the ZIP: extract N+1 beside N; confirm project list/settings carry over (they should, via the same app
   identifier) and note what happens if the user extracts to a different folder.
3. Confirm the installed/portable detection on both, and the AppImage/deb detection on Linux.
4. Open a project made by N+1 in N: refused with the clear message, nothing changed on disk.

## Built (where to look)

- `src/lib/updateCheck.ts` (versions, release parsing, URL allow-list, asset choice, schedule, settings, fetch), `updateController.ts`
  (scheduling, skip/later, the off switch), `hooks/useUpdates.ts`, `components/UpdateBanner.tsx`, `UpdatesDialog.tsx`.
- `release/asset-names.json`: the file-name contract shared with `scripts/publish_release.py` (`expected_asset_names`).
- `crates/studio_core/src/install_kind.rs` and the `install_kind` Tauri command.
- Still to do by hand: the verification list above (install over install, portable detection, Linux detection).

## Decisions (taken)

1. Phase 1 first, Phase 2 only if Phase 1 is not enough.
2. Automatic check on by default (one request a day, one switch to turn it off).
3. The "Upgrading" section is in the packaged READMEs now.
