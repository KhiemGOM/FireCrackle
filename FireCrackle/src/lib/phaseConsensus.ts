// One animation phase for many fire quads. Every fire sprite on screen is drawn from the same global texture animation:
// sheet 1 always runs 16 frames ahead of sheet 0, whatever each quad's own sheet or mirror. So quads matched one by
// one (lib/quadMatch.ts) can vote on the phase they share, and each then takes its own best sprite at that phase.
//
// The vote, explicitly:
//  1. a quad's evidence for phase p is its best candidate score at p (any sheet, either mirror);
//  2. normalised per quad, robustly: (evidence − median) / (1.4826 · median absolute deviation) over the 32 phases, so
//     the size of a quad's scores does not matter and a flat quad (no deviation) carries no weight;
//  3. clipped to [low, high], so one occluded or mismatched quad can neither veto the shared phase nor crown its own;
//  4. summed over the quads; the phase with the most support wins, confident when it leads the runner-up by `margin`.

export interface ScoredSprite { sheet: 0 | 1; row: number; mirrored: boolean; score: number }

const PHASES = 32;
/** Sheet 1's frame is always this many frames on from sheet 0's (the label logs: every frame of every recording). */
export const SHEET_PHASE_OFFSET = 16;

/** The shared phase a sprite shows: sheet 0's frame. */
export function spritePhase(sheet: 0 | 1, row: number): number {
  return (((row - SHEET_PHASE_OFFSET * sheet) % PHASES) + PHASES) % PHASES;
}
/** The row of `sheet` that shows `phase`. */
export function spriteAtPhase(sheet: 0 | 1, phase: number): number {
  return (((phase + SHEET_PHASE_OFFSET * sheet) % PHASES) + PHASES) % PHASES;
}

/** A quad's evidence for each of the 32 phases: its best candidate there (−∞ where it has none). */
export function phaseEvidence(table: ScoredSprite[]): number[] {
  const e = new Array<number>(PHASES).fill(-Infinity);
  for (const c of table) {
    if (!Number.isFinite(c.score) || !Number.isInteger(c.row)) continue;
    const p = spritePhase(c.sheet, c.row);
    if (c.score > e[p]) e[p] = c.score;
  }
  return e;
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b), m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export interface ConsensusOptions {
  /** Lowest vote a quad gives a phase (how far it can push one down). */
  low?: number;
  /** Highest vote a quad gives a phase (how far it can push one up). */
  high?: number;
  /** Support lead over the runner-up for a confident answer. */
  margin?: number;
}
/** Chosen on the tune split of quad1's labelled quads (docs/PHASE-CONSENSUS-RESULTS.md): a floor of −0.5; a cap of 8
 * costs nothing measurable there and keeps one wildly confident quad from deciding a frame alone. */
export const CONSENSUS_DEFAULTS: Required<ConsensusOptions> = { low: -0.5, high: 8, margin: 2 };

export interface Consensus {
  phase: number;
  /** Summed clipped votes per phase. */
  support: number[];
  /** The winner's lead over the runner-up. */
  margin: number;
  confident: boolean;
  /** Each quad's best sprite at the shared phase (null for a quad with no candidate there). */
  labels: (ScoredSprite | null)[];
  /** Quads that voted (not flat). */
  used: number;
}

/** The phase all `tables` (one per quad: every candidate the matcher scored) share; null when no quad has evidence. */
/** A quad's robust scale (step 2): the median and scaled MAD of its phase evidence; null for a flat quad. */
function robustScale(e: number[]): { m: number; mad: number } | null {
  const finite = e.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const m = median(finite), mad = 1.4826 * median(finite.map(v => Math.abs(v - m)));
  return mad > 0 ? { m, mad } : null;
}

export function phaseConsensus(tables: ScoredSprite[][], options: ConsensusOptions = {}): Consensus | null {
  const { low, high, margin } = { ...CONSENSUS_DEFAULTS, ...options };
  const support = new Array<number>(PHASES).fill(0);
  let used = 0;
  for (const table of tables) {
    const e = phaseEvidence(table), scale = robustScale(e);
    if (!scale) continue;
    used++;
    for (let p = 0; p < PHASES; p++) support[p] += Number.isFinite(e[p]) ? Math.max(low, Math.min(high, (e[p] - scale.m) / scale.mad)) : low;
  }
  if (!used) return null;
  const order = support.map((_, p) => p).sort((a, b) => support[b] - support[a]);
  const lead = support[order[0]] - support[order[1]];
  const phase = order[0];
  const labels = tables.map(table => {
    let best: ScoredSprite | null = null;
    for (const c of table) if (spritePhase(c.sheet, c.row) === phase && Number.isFinite(c.score) && (!best || c.score > best.score)) best = c;
    return best;
  });
  return { phase, support, margin: lead, confident: lead >= margin, labels, used };
}

/** For quads that also share their variant (one fire block's planes): every sheet and mirror at `phase`, most summed
 * support first, each quad's scores normalised as in the vote. Only the floor is clipped here: at the shared phase the
 * sprites differ by small amounts, and a cap would flatten exactly that difference. The score is the summed support. */
export function sharedSprites(tables: ScoredSprite[][], phase: number, low = CONSENSUS_DEFAULTS.low): ScoredSprite[] {
  const sum = new Map<string, ScoredSprite>();
  for (const table of tables) {
    const scale = robustScale(phaseEvidence(table));
    if (!scale) continue;
    for (const c of table) {
      if (!Number.isFinite(c.score) || !Number.isInteger(c.row) || spritePhase(c.sheet, c.row) !== phase) continue;
      const key = `${c.sheet}${c.mirrored}`, vote = Math.max(low, (c.score - scale.m) / scale.mad);
      const s = sum.get(key);
      if (s) s.score += vote; else sum.set(key, { sheet: c.sheet, row: c.row, mirrored: c.mirrored, score: vote });
    }
  }
  return [...sum.values()].sort((a, b) => b.score - a.score);
}
/** The one sheet and mirror at `phase` the quads agree on most (sharedSprites' first); null with no quads. */
export function sharedSprite(tables: ScoredSprite[][], phase: number, low = CONSENSUS_DEFAULTS.low): ScoredSprite | null {
  return sharedSprites(tables, phase, low)[0] ?? null;
}

/** The tries a user gets (M then 1-3), where what matters is that any of them is right. `at(phase)` gives the sprites
 * at a phase, best first. A confident vote is rarely wrong about the phase, so all tries go to sprites at it (the sheet
 * and mirror are what is then missed); an unsure vote keeps one try for the runner-up phase. Chosen on the tune split
 * (docs/PHASE-CONSENSUS-RESULTS.md: per fire, exact sprite in the top 3 on validation 41.7 % with three phases → 58.7 %). */
export function consensusTries<T>(vote: Consensus, at: (phase: number) => T[], n = 3): T[] {
  const order = vote.support.map((_, p) => p).sort((a, b) => vote.support[b] - vote.support[a]);
  return vote.confident ? at(order[0]).slice(0, n) : [...at(order[0]).slice(0, n - 1), ...at(order[1]).slice(0, 1)];
}
