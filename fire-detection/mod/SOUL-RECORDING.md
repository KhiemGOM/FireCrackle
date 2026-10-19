# Soul fire quad recording

Windows: double-click `record-soul.cmd`. This launches the updated recording-safe
dev client with soul labels enabled and debug drawing disabled.

Build: `gradlew.bat build`. Alternatively launch the dev client with
`gradlew.bat runClient -PfirelabelDebug=false -PfirelabelLegacyLabels=true`.
Ownership export is optional and remains normal-fire-only; leave it off for this recording.

Record vanilla Minecraft 1.16.5 at native output size, 60 fps, with the sync strip
visible at the top left. Use the existing OBS setup, no crop/rescale or colour filters.
Labels are written automatically to `run/firelabel/labels-YYYYMMDD-HHMMSS.jsonl`.
Keep that file with the video. No game textures or recordings belong in Git.

Record about 2–3 minutes: isolated soul fire on soul sand/soil; walk around at
near/medium/far distances; look down and across it; then a few overlapping flames,
dark surroundings, a menu/inventory, partial obstruction, and normal+soul together.
Spend at least 5 seconds at each angle so all 32 animation rows appear. Include
some ordinary fire for comparison. A short second recording in another location
is useful as a separate validation set.

The log preserves ordinary `fires`, `fire`, `f0` and `f1`. Soul blocks are stored
separately in `soul_fires`, with their own `s0`/`s1` displayed physical PNG rows
and `soul` presence flag. Each source has the same parts and exact projected
quad corner/UV/sheet/mirror/visibility schema as normal fire. Missing `soul_fires`
in an older log means unsupported, not absent. Soul sheet 0's physical row must
be converted to the app's shared animation step by `(row + 16) % 32` during
benchmark preparation; do not apply this offset twice.

Soul campfires, soul torches and blue-looking particles are not soul-fire block
quad targets. Burning entities and the first-person burning overlay still use
ordinary fire textures in vanilla. Existing visibility estimates do not fully
resolve fire-over-fire overlap; retain those failures in evaluation.
