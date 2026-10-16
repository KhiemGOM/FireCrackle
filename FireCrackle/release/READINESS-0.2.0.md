# 0.2.0 readiness check — 2026-10-16

Local Windows checks pass for the new Phase workspace. Nothing was uploaded or
published. Version metadata remains the development value, 0.1.1; the isolated
release workflow must stamp 0.2.0 before producing public artifacts.

## UI verified in the full app browser

- Timing, Sprites, Compare and Flags are separate views. Clock/source settings,
  ruler controls, explanations and credits are collapsed instead of filling the
  chart workspace.
- Fullscreen focuses the selected view. Escape exits. Compare can show all
  diagnostics together or one selected plot.
- Dedicated X/Y axis drag handles zoom independently. Double-click resets only
  that axis. Canvas dragging still pans time; video navigation retains original
  frame numbers and timestamps.
- Actual survival recording/Jolt data was used via the local read-only browser
  connection. Y drag changed ±16 to about ±3.15 without changing the time range;
  subsequent X drag changed 7:28–22:30 to 12:13–17:45 without changing Y.
- Responsive SVG coordinates keep fullscreen tick labels at normal text size.

## Validation

| Check | Result |
|---|---|
| `npm test` | 61 files, 534 tests passed |
| `npm run build` | TypeScript and Vite passed |
| `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib` | 13 passed; 2 existing opt-in tests ignored |
| `cargo test --offline --manifest-path crates/studio_core/Cargo.toml --lib --tests` | Passed, including real-video open/decode/label/reopen and source/save round trips |
| `cargo test --offline --manifest-path ../fire-detection/core/Cargo.toml` | Passed |
| Python release preparation/publication tests | 11 passed |
| `scripts/release.ps1 -SkipChecks` | Optimized Windows build and portable ZIP checks passed; tests were run separately above |
| Packaged startup | Window created and process remained alive for 8 seconds with isolated test profile |

The first startup attempt alongside the development instance failed with
WebView2 HRESULT 0x800700AA (resource in use). Retrying using a process-local
`WEBVIEW2_USER_DATA_FOLDER` in ignored test scratch passed, without closing the
user's app or changing its profile. The override is a documented
[WebView2 option](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl).
This validates isolated startup, not coexistence with the development profile.

## Local packaging evidence

Local development-version ZIP (not the public 0.2.0 release):

`releases/v0.1.1/20261016-122856-362622/FireCrackle-0.1.1-windows-x64.zip`

- 4,248,696 bytes.
- SHA-256: `26bdf81b4bf98e48c61a10dbc1ae5a4c7ffb2f5218255bef42554550939d5b5a`.
- Archive contents and every packaged checksum passed the release checker.
- Only the app, README, licenses/notices and release/checksum metadata are in
  the ZIP. FFmpeg and yt-dlp remain separate downloads. No recordings or labels
  are bundled.
- This local package records a dirty development checkout, so it is validation
  evidence only. Rebuild from the frozen release commit for publication.

## Remaining before publication

Use the existing isolated release workflow with version **0.2.0** and the
intended committed source. Public Windows installer and Linux AppImage/Debian
build/startup checks have not been run in this local pass. Both platform jobs,
provenance and server checksum checks must pass before publication is called
complete. See [release workflow](README.md).

Local scratch evidence: `.board/readiness-0.2/startup.json`, startup logs and
`ui-fullscreen.png`. Original videos, labels and native user profile were not
modified by this UI work.
