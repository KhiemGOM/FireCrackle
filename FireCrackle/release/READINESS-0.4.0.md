# FireCrackle 0.4.0 release preparation

Status: preparation only. No release tag, public draft, workflow dispatch or final
package has been created for 0.4.0. Freeze the final source only after the active
feature owners finish and the checks below pass. Do not publish an intermediate
checkout while their queued patches are still being assembled.

## Source and feature gates

| Item | State |
|---|---|
| Package, npm lockfile, Tauri config, Rust package and Rust lockfile versions | Prepared as 0.4.0 |
| Concise release notes | Prepared; add final feature-owner summaries before freeze |
| Alternate animation atlases and independent material charts | Committed in `7418cc5` |
| Stronger Enhance presets, gamma and edge controls | Committed; redundant Edge overlay preset removed |
| GUI screen-driven Auto unveil and compressed-shadow rounding | Committed in `fb77e58` |
| Animated comparison proof formats and fade | Committed in `606b82a` / `4d5e50a` |
| Water tint / prerendered atlases / fluid Jolt views and layout fixes | Committed in `74f0707` |
| Inline water colour picker replacing broken native dialog | Fixed in `19ae49a`; browser verification and full 1,324-test frontend suite passed |
| Joint texture phase-offset chart | Completed in `38b51e2`; actual Timing renderer reused, superseding the separate chart in `92b2e31` |
| Still / Flowing fluid naming | Completed in `b730a6f`; 49 targeted tests and typecheck passed |
| Separate still/flowing water/lava atlas choices and isolated filters | Pending owner follow-up job 196; keeps feature freeze on hold |
| Final source SHA and clean release snapshot | Pending fluid-source separation and final combined checks |

The water/fluid owner supplied `74f0707` and `19ae49a`: tint/overlay, Jolt import,
in-app picker clicks/drag/hue changes, TypeScript/Vite and the full 1,324-test
frontend suite passed. Joint integration `38b51e2` now reuses the actual Timing
chart, retaining its run/gap shading, ruler, sidebar and controls. Its owner
reports 1,323 tests, TypeScript/production build, exact Fire geometry parity and
native/browser flag selection/focus/Fit checks passing. Provisional wrap choices
are not a claim of unique agreement; no joint automatic flags are generated.
The latest user-directed follow-up separates the four fluid atlas choices and
their filters (job 196). Keep that owner's active patches out of the final freeze
until its completion report arrives.

## Preparation checks

| Check | Result |
|---|---|
| Release preparation, publisher and workflow regression tests | 39 passed |
| AI model/runtime packaging regression tests | 11 passed |
| Windows packaging configuration, retry and archive regressions | Passed for 0.4.0 |
| All five version files / both npm root versions agree | Verified as 0.4.0; build-only publication plan validated without dispatch |
| Repository source/asset hygiene | Passed; latest audit covers 900 tracked files, with 4 boundary regression tests previously passing |
| Animation / GUI / portal asset-generation regressions | 8 passed; metadata geometry/order checks included |
| Rust release preflight | Formatting and strict Clippy (`--all-targets --no-deps -- -D warnings`) passed for all four CI crates |
| Latest pre-freeze desktop build | 0.4.0 preview built and launched before the latest feature follow-ups; not a final package |
| Full final frontend/native checks and clean installation | Pending feature freeze |
| Windows setup/ZIP from frozen source | Pending feature freeze |
| Linux AppImage/Debian build, dependency and startup checks | Pending Linux CI after feature freeze |
| Artifact provenance and local/server SHA-256 verification | Pending package builds |

GitHub was checked during preparation: the latest public release is still
[v0.3.0](https://github.com/KhiemGOM/FireCrackle/releases/tag/v0.3.0). The latest
completed [source CI run](https://github.com/KhiemGOM/FireCrackle/actions/runs/39079456199)
passed at `7b57731`; that is older source and does not certify this 0.4.0 candidate.

Targeted feature checks already recorded: 137 tests for the GUI veil fix, 76 for
the final preset list and 13 for user-preset gamma repair. These do not replace
checks on the combined final commit. Avoid repeatedly running the entire suite
while the other agents are editing; run their changed-path checks now and the
release checks against the frozen source once it is ready.

## Final cut

1. Obtain the fluid-source separation follow-up's completion report and commit;
   resolve its queued patches and update the notes with the delivered picker
   scope. Joint Timing integration and the inline water picker are complete;
   job 196 is the remaining feature hold.
2. Confirm no uncommitted feature work is omitted. Select and record a final
   source SHA. Keep later development out of the release snapshot.
3. Verify versions, source hygiene and asset generation from a clean checkout.
   Never commit local Minecraft/Yarn code, extracted game textures, recordings,
   labels, model caches or generated WASM. Check generated animation atlases are
   recreated by the build rather than committed as PNG assets.
4. Run the configured frontend, native, packaging and source CI checks. Smoke-test
   existing fire projects and new material labels through save/reopen, GUI unveil,
   proofs and the final chart interactions. Use an isolated profile for package
   startup so the user's running app and project data remain intact.
5. Build both platforms from that same frozen SHA. Use build-only dispatch first
   when validating packages; do not push a `v*` tag during preparation because it
   triggers public release publication. Do not push feature branches as part of
   this preparation.
6. Verify package contents, runtime/model files, licenses, update asset names,
   startup and recorded source provenance. Require successful Windows and Linux
   jobs and matching checksums before publishing. Reuse successful artifacts when
   retrying a failed publisher; never replace published bytes or move a tag.

See [release procedure](README.md) for existing build/publication and recovery
commands. `prepare_release.py` pushes a release branch and requests publication;
it is not a preparation-only command and must not be run at this stage.

## Compatibility and rollback

Existing normal-fire labels must retain their meaning. New material labels use
the `texture` representation: preserve a project backup before downgrading to an
older version that does not support it. Automatic labellers and matching remain
normal-fire-only; other material labels require manual review. Water tint is a
display aid and must not silently change phase timing or historical label meaning.

Keep the previous public installers available. If the new package fails startup,
save/reopen or runtime loading, stop publication and fix the candidate. After a
public release, ship fixes under a new version instead of overwriting 0.4.0.

Shared unveil preprocessing changed in `fb77e58`; cached research results/models
remain tied to their original source hashes. No 0.3.0 detection rate is being
re-certified for 0.4.0 by these packaging/UI checks.
