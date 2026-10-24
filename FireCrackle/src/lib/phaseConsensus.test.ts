// Every fire sprite on screen shows one global animation phase (sheet 1 is always 16 frames on from sheet 0), whatever
// each quad's own sheet or mirror. phaseConsensus takes every quad's matcher scores and picks the one phase they share.
import { describe, expect, it } from "vitest";
import { CONSENSUS_DEFAULTS, phaseConsensus, phaseEvidence, sharedSprite, spritePhase, spriteAtPhase, type ScoredSprite } from "./phaseConsensus";

/** A full candidate table (2 sheets × 32 rows × 2 mirrors) with a small noise floor and chosen peaks. */
function table(peaks: { sheet: 0 | 1; row: number; mirrored: boolean; score: number }[], seed = 1): ScoredSprite[] {
  let s = seed;
  const noise = () => { s = (s * 1103515245 + 12345) % 2147483648; return (s / 2147483648) * 0.05; };
  const out: ScoredSprite[] = [];
  for (const sheet of [0, 1] as const) for (let row = 0; row < 32; row++) for (const mirrored of [false, true]) {
    const peak = peaks.find(p => p.sheet === sheet && p.row === row && p.mirrored === mirrored);
    out.push({ sheet, row, mirrored, score: peak ? peak.score : 0.1 + noise() });
  }
  return out;
}

describe("phase of a sprite", () => {
  it("sheet 0's row is the phase; sheet 1 runs 16 frames ahead; it wraps", () => {
    expect(spritePhase(0, 5)).toBe(5);
    expect(spritePhase(1, 21)).toBe(5);
    expect(spritePhase(1, 3)).toBe(19);
    expect(spriteAtPhase(0, 5)).toBe(5);
    expect(spriteAtPhase(1, 5)).toBe(21);
    expect(spriteAtPhase(1, 20)).toBe(4);
  });
  it("a quad's evidence for a phase is its best candidate at that phase, any sheet or mirror", () => {
    const e = phaseEvidence(table([{ sheet: 1, row: 21, mirrored: true, score: 0.9 }]));
    expect(e).toHaveLength(32);
    expect(e[5]).toBe(0.9);
    expect(Math.max(...e.filter((_, i) => i !== 5))).toBeLessThan(0.2);
  });
});

describe("phaseConsensus", () => {
  it("quads with different sprites agree on one phase, and each gets its own sprite at it", () => {
    const c = phaseConsensus([
      table([{ sheet: 0, row: 5, mirrored: false, score: 0.6 }], 1),
      table([{ sheet: 1, row: 21, mirrored: true, score: 0.5 }], 2),
      table([{ sheet: 0, row: 5, mirrored: true, score: 0.7 }], 3),
    ])!;
    expect(c.phase).toBe(5);
    expect(c.confident).toBe(true);
    expect(c.labels.map(l => l && [l.sheet, l.row, l.mirrored])).toEqual([[0, 5, false], [1, 21, true], [0, 5, true]]);
  });
  it("a quad that alone picks the wrong phase is corrected by the others (its runner-up is the shared phase)", () => {
    const c = phaseConsensus([
      table([{ sheet: 0, row: 12, mirrored: false, score: 0.55 }, { sheet: 1, row: 21, mirrored: false, score: 0.5 }], 4),
      table([{ sheet: 0, row: 5, mirrored: false, score: 0.6 }], 5),
      table([{ sheet: 1, row: 21, mirrored: true, score: 0.6 }], 6),
    ])!;
    expect(c.phase).toBe(5);
    expect(c.labels[0]).toMatchObject({ sheet: 1, row: 21, mirrored: false });
  });
  it("one quad that is wildly confident about another phase cannot outvote several that agree (votes are capped)", () => {
    const c = phaseConsensus([
      table([{ sheet: 0, row: 30, mirrored: false, score: 50 }], 7),
      table([{ sheet: 0, row: 5, mirrored: false, score: 0.5 }], 8),
      table([{ sheet: 1, row: 21, mirrored: false, score: 0.5 }], 9),
    ])!;
    expect(c.phase).toBe(5);
  });
  it("scores of any scale count alike: one quad's scores ten times larger change nothing", () => {
    const a = table([{ sheet: 0, row: 9, mirrored: false, score: 0.6 }], 10), b = table([{ sheet: 1, row: 25, mirrored: false, score: 0.5 }], 11);
    const scaled = a.map(c => ({ ...c, score: c.score * 10 }));
    expect(phaseConsensus([scaled, b])!.phase).toBe(phaseConsensus([a, b])!.phase);
    expect(phaseConsensus([scaled, b])!.support).toEqual(phaseConsensus([a, b])!.support.map(v => expect.closeTo(v, 9)));
  });
  it("a flat quad (no evidence) carries no weight; none at all, or only flat ones, give no answer", () => {
    const flat = table([]).map(c => ({ ...c, score: 0.2 }));
    const c = phaseConsensus([flat, table([{ sheet: 0, row: 7, mirrored: false, score: 0.6 }], 12)])!;
    expect(c.phase).toBe(7);
    expect(c.used).toBe(1);
    expect(phaseConsensus([])).toBeNull();
    expect(phaseConsensus([flat])).toBeNull();
  });
  it("two phases equally supported are not a confident answer", () => {
    const c = phaseConsensus([
      table([{ sheet: 0, row: 3, mirrored: false, score: 0.6 }], 13),
      table([{ sheet: 0, row: 11, mirrored: false, score: 0.6 }], 14),
    ])!;
    expect(c.confident).toBe(false);
    // the capped peaks tie; only the noise floors differ, which stays under the confidence margin
    expect(c.margin).toBeLessThan(CONSENSUS_DEFAULTS.margin);
  });
});

// ---- one sprite for quads that share their variant too (one fire block's planes: the 3D quad)

describe("sharedSprite", () => {
  it("at a phase, the sheet and mirror the quads agree on most (scores normalised per quad)", () => {
    const tables = [
      table([{ sheet: 0, row: 5, mirrored: false, score: 0.55 }, { sheet: 1, row: 21, mirrored: true, score: 0.6 }], 21),
      table([{ sheet: 0, row: 5, mirrored: false, score: 0.9 }], 22),
      table([{ sheet: 0, row: 5, mirrored: false, score: 0.7 }, { sheet: 1, row: 21, mirrored: true, score: 0.5 }], 23),
    ];
    expect(sharedSprite(tables, 5)).toMatchObject({ sheet: 0, row: 5, mirrored: false });
  });
  it("only sprites showing that phase are considered; no quads, no sprite", () => {
    const tables = [table([{ sheet: 1, row: 30, mirrored: false, score: 0.9 }, { sheet: 1, row: 21, mirrored: false, score: 0.6 }], 24)];
    expect(sharedSprite(tables, 5)).toMatchObject({ sheet: 1, row: 21, mirrored: false });
    expect(sharedSprite([], 5)).toBeNull();
  });
});
