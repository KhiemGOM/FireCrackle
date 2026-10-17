# Repository readiness

Audit date: 2026-10-16. This describes the cleaned source tree. The repository is public, and its early history predates the clean-up (see [Source history](../README.md#source-history)). Nothing here grants rights to third-party assets.

## Source boundary

- Original application, detector, recording mod and research tooling are MIT-licensed. [Third-party notices](../THIRD_PARTY_NOTICES.md) identify separate ownership and license obligations.
- Minecraft source, decompiled classes, game JARs, Yarn mapping artifacts and local build caches are excluded. The only tracked JAR is the Gradle bootstrapper.
- Recordings, per-video projects, joined benchmark outputs and local agent state are ignored. Previously tracked personal/generated files were removed from the index only; their local contents were preserved and checked against their original Git blobs.
- The cleaned tracked tree is approximately 5.5 MiB, down from approximately 277 MiB. Old commits still contain removed data and historical code excerpts, and because the repository is public that history is visible. Use the [source snapshot procedure](../README.md#source-history) if a separate source history is needed.

Run the boundary check before staging a release or preparing a source snapshot:

```powershell
node --test scripts/check-repository.test.mjs
node scripts/check-repository.mjs
```

The check inspects tracked paths and content for generated/private files, upstream game packages, oversized files and common credential signatures. It supplements review; it is not a complete secret detector or license audit.

## Verification

The cleanup was checked locally with:

- Frontend: 373 tests and a production build.
- App core: 472 Rust tests; desktop commands: five tests, with one test requiring a specific private video intentionally ignored.
- Detector: full Rust tests with real FFmpeg available, formatting and strict Clippy checks.
- Video integration: 111 FFmpeg-enabled tests and a real H.264 compression smoke check.
- Python recording/evaluation tools: 108 tests plus six subtests; separate quad geometry checks also passed.
- Release automation: script regressions, an optimized portable ZIP and a Windows setup EXE. Archive contents and checksums were verified, including the MIT license and third-party notices. The installer was built without launching it.
- Dependency audit: npm reported zero known vulnerabilities for both production dependencies and the complete dependency set at audit time.

The [Source checks workflow](../.github/workflows/ci.yml) repeats source-boundary, frontend, Rust, Python and original Fabric-mod checks on fresh GitHub runners. Its result is the authority for the particular commit being reviewed; local success alone does not establish fresh-clone success. The first verification run passed Python and the recording mod, and exposed newer Rust lints that were then corrected without weakening strict checks.

## Distribution limits

The source repository is public (as of 2026-10-16). Preparing or verifying a snapshot does not change visibility. No replacement binaries were uploaded by this cleanup.

Minecraft-derived texture fixtures and campfire artwork remain separately owned; the MIT license does not cover them or establish redistribution permission. Review their rights before any wider asset distribution. FFmpeg releases retain their own GPL notices and source links. See [third-party notices](../THIRD_PARTY_NOTICES.md) and [app packaging](../FireCrackle/README.md).

Version 0.1.0 remains experimental. Timing flags indicate review priority, not proof of an edit. Private footage and external game behavior cannot be validated by this repository's synthetic fixtures alone.
