// @ts-expect-error Node-only test API; the browser project intentionally excludes Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The playback path runs on every frame, so it is kept small on purpose (docs/PLAN-BUFFER.md, "lean pass"). A file that
 *  outgrows its budget fails here: shrink it, or move the extra work out of the per-frame path, before raising a number. */
const BUDGET: Record<string, number> = {
  "src/lib/frameBuffer.ts": 260,
  "src/lib/frameBufferDom.ts": 20,
  "src/lib/playbackStats.ts": 120,
  "src/lib/lateFrame.ts": 30,
  "src/lib/correctionGate.ts": 20,
  "src/components/PlaybackReadout.tsx": 40,
  "crates/studio_core/src/decode_gate.rs": 160,
};

describe("playback code stays lean", () => {
  for (const [file, max] of Object.entries(BUDGET)) {
    it(`${file} is at most ${max} lines`, () => {
      const lines = readFileSync(file, "utf8").split("\n").length;
      expect(lines, `${file} has ${lines} lines`).toBeLessThanOrEqual(max);
    });
  }
});
