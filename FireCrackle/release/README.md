# Releasing FireCrackle

Current target: **0.4.0**. See [release readiness](READINESS-0.4.0.md) for completed
preparation and feature-freeze gates. Wait for active feature owners before making
the final release snapshot. The `prepare_release.py` command below pushes a release
branch and requests publication; it is not a preparation-only command.

If both platform builds passed but publication failed, reuse their artifacts with
`gh workflow run firecrackle-publish.yml --ref main -f commit=FULL_FROZEN_SHA -f windows_run=RUN_ID -f linux_run=RUN_ID`.
This uses current publisher tooling with the frozen version/notes, checks every job attempt,
and still requires matching commit provenance and all artifact/server checksums. A newer failed
platform build cannot be replaced by an older success. Existing published bytes are never overwritten.
The same run ID can supply both platforms. No package rebuild is required.

If GitHub's workflow token cannot create a release tag for an older commit, create the tag at
the verified frozen SHA with the authenticated local GitHub CLI, then run publish-only recovery.
Do not move an existing tag. Cancel the redundant tag-triggered package run when reusing passed builds.

Run from the repository root with Git, Python 3 and an authenticated GitHub CLI:

```powershell
python FireCrackle/scripts/prepare_release.py --version 0.1.1 --source main
```

Choose the committed branch or SHA containing the intended release. Uncommitted
development edits are excluded. The command creates `codex/release-v0.1.1` in
`.release-worktrees/v0.1.1`, updates the app and both lockfile versions, commits
only those version files, pushes that branch, and starts the release workflow.
It never switches or stages the development checkout. Agents can continue the
next version there. Do not edit a release workspace once its builds start.

The workflow builds and tests Windows x64 ZIP/setup and Linux x86_64
AppImage/Debian packages from the same frozen commit. Linux packages get content,
dependency and virtual-display startup checks. The publisher checks build
provenance and local/server SHA-256 hashes before publishing through a draft.
Both platforms must pass. Repository visibility and access remain unchanged.

For build-only testing, dispatch **FireCrackle release** manually with **Publish**
off (the default); choose one or both platforms. A `v*` tag also builds and
publishes both, so do not tag unfinished work. Tags must match the source version.

Before anything is pushed, `prepare_release.py` runs `cargo fmt --check` on the three
Rust crates the CI checks. A failure stops the cut before the branch is pushed and
removes the workspace and branch it just made, so fix `main` and run it again. Add
`--clippy` to also run the stricter lint check (slower: it compiles), or
`--skip-preflight` to skip the checks.

Builds restore compiled Rust dependencies and the pinned FFmpeg package from a cache
instead of recompiling them. A new release branch can only read caches made by `main`,
which the **Warm Rust cache** workflow keeps fresh (when a lockfile changes, and
weekly). If a cut is the first after a toolchain update, expect one slower run.

**Do not start a new run to retry a failure.** Re-run only what failed, which keeps
the platform that already passed (its artifacts are reused by publishing):

```powershell
gh run list --workflow firecrackle-release.yml --limit 5
gh run rerun <run-id> --failed
```

If a build fails otherwise, fix the release branch and run the workflow again. If upload
fails, inspect the draft and rerun the failed publish job; publication retries
verify the same commit and bytes. Once published, assets are immutable: fixes
need a new version. A draft targeting a different commit is deliberately rejected;
inspect/remove that draft before rebuilding a changed cut. Never force-move a
published tag. Existing release workspace/branch names are refused on a second
cut, preserving evidence instead of overwriting it.

Merge the release infrastructure back into development separately from the frozen
release tag. Keep the isolated workspace until publication is verified, then use
`git worktree remove` on that exact workspace after checking it is clean.
