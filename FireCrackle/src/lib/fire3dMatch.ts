// Match for the 3D quad. Each of the fire's planes, projected to the screen, is a 2D quad for the app's matcher
// (lib/quadMatch.ts, at the fixed outline: the solved camera places it). One fire block shows one variant on every plane
// and every fire on screen shows one phase, so the planes vote on the phase (lib/phaseConsensus.ts) and then agree on
// one sheet and mirror at it. A plane seen from behind shows its sprite flipped (`mirrored`) and a plane the model draws
// from the other sheet (`sheet`: an entity's fire layers alternate fire_0 and fire_1) shows the same phase there: each
// plane's candidates are turned into the tool's own sprite setting before the planes are compared.
import { matchFireQuad, type MatchImage } from "./quadMatch";
import { consensusTries, phaseConsensus, sharedSprites, spriteAtPhase, spritePhase, type ScoredSprite } from "./phaseConsensus";
import type { ManualQuad } from "./quadMask";
import { canvasFrameIo, type FrameIo } from "./veilFrame";

/** One plane on the picture: its quad (0-1 of the picture), its own flip and the sheet the model draws it from. */
export interface MatchPlane { quad: ManualQuad; mirrored: boolean; sheet?: 0 | 1 }

export interface PlaneMatchCandidate { sheet: 0 | 1; row: number; mirrored: boolean; phase: number; support: number }
export interface PlaneMatch {
  /** Three tries, best first (lib/phaseConsensus.ts consensusTries): sprites the planes share at the winning phase, and
   * when the vote is unsure one at the runner-up phase. */
  candidates: PlaneMatchCandidate[];
  confident: boolean;
  /** Planes the matcher could read. */
  planes: number;
}

export function matchFirePlanes(image: MatchImage, sheets: [Uint8ClampedArray, Uint8ClampedArray], planes: MatchPlane[]): PlaneMatch | null {
  const tables: ScoredSprite[][] = [];
  for (const plane of planes) {
    // any plane with evidence votes, however thin alone (as the vote was measured: scripts/phase-consensus-eval.mjs);
    // a flat one carries no weight. Only planes too small or too empty to sample at all give none.
    const m = matchFireQuad(image, sheets, plane.quad, { refineGeometry: false, phaseEvidence: true });
    if (!m.phaseCandidates?.length) continue;
    tables.push(m.phaseCandidates.map(c => {
      const sheet = (c.sheet ^ (plane.sheet ?? 0)) as 0 | 1;
      return { sheet, row: spriteAtPhase(sheet, spritePhase(c.sheet as 0 | 1, c.row)), mirrored: c.mirrored !== plane.mirrored, score: c.score };
    }));
  }
  const vote = phaseConsensus(tables);
  if (!vote) return null;
  const candidates = consensusTries(vote, phase => sharedSprites(tables, phase).map(s =>
    ({ sheet: s.sheet, row: spriteAtPhase(s.sheet, phase), mirrored: s.mirrored, phase, support: vote.support[phase] })));
  return { candidates, confident: vote.confident, planes: vote.used };
}

/** The picture worker's `match3d` task: decode the native frame, then match its planes. */
export async function matchPicture({ bytes, sheets, planes }: { bytes: ArrayBuffer; sheets: [Uint8ClampedArray, Uint8ClampedArray]; planes: MatchPlane[] }, io: Pick<FrameIo, "decode"> = canvasFrameIo): Promise<PlaneMatch | null> {
  return matchFirePlanes(await io.decode(bytes), sheets, planes);
}
