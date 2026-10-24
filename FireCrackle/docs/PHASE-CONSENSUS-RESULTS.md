# One animation phase for all of a frame's fire quads

2026-10-24. Every fire sprite on screen is drawn from the same global texture animation: sheet 1 always runs 16 frames
ahead of sheet 0, whatever a quad's own sheet or mirror (all 4,640 quad1 frames with fire). So instead of trusting each
quad's match alone, all of a frame's quads vote on the phase they share, and each then takes its best sprite at it.

## The vote (`src/lib/phaseConsensus.ts`)

1. A quad's evidence for phase *p* is its best matcher score among candidates showing *p* (phase = (row − 16·sheet) mod
   32; any sheet, either mirror).
2. Normalised per quad, robustly: (evidence − median) / (1.4826 · MAD) over the 32 phases. The size of a quad's scores
   does not matter; a flat quad carries no weight.
3. Clipped to [−0.5, 8]: one occluded or mismatched quad can neither veto the shared phase nor decide the frame alone.
4. Summed over the quads. The phase with the most support wins; confident when it leads the runner-up by 2.
5. Each quad's label: its best (sheet, mirror) at that phase.

It takes the matcher's full table per quad (`matchFireQuad(..., {phaseEvidence: true})` → `phaseCandidates`), so any
multi-quad use (a multi quad-mask mode, the 3D quad's planes) can call it as is.

## Protocol

The real-quad dataset of `docs/ACTUAL-QUAD-RESULTS.md` (quad1, native 1920×1080 frames, every 60th frame, exact logged
outlines, fixed corners; tune frames `n < 4136`, validation `n ≥ 4376`), matched by today's matcher. Truth (sheet, row,
mirror) is used only for scoring. The premise was checked: every frame has exactly one true phase (0 of 76 frames
otherwise). Clip bounds were chosen on the tune split only; validation is reported for the chosen bounds.

Reproduce from `FireCrackle`:
`node scripts/actual-quad-eval.mjs src-tauri/target/actual-quad1 tune consensus fixed 1 --full-table` (and
`validation`), then `node scripts/phase-consensus-eval.mjs src-tauri/target/actual-quad1 consensus [--grid]`.

## Results

| Validation: 300 quads, 28 frames | Each quad alone | Shared phase |
|---|---|---|
| Exact sprite (sheet + row + mirror) | 87 (29.0 %) | **123 (41.0 %)** |
| Right phase | 121 (40.3 %) | **218 (72.7 %)** |
| Frames with the right phase | — | 21 / 28 (75.0 %) |
| Confident answers right | — | 77.1 % of 279 quads |

| Tune: 690 quads, 48 frames | Each quad alone | Shared phase |
|---|---|---|
| Exact sprite | 43 (6.2 %) | 143 (20.7 %) |
| Right phase | 188 (27.2 %) | 469 (68.0 %) |

On tune, no cap at all scored slightly higher (72.0 % phase against 68.0 %), and on validation the same as the cap of 8.
The cap is kept for robustness. A cap of 4 or lower is clearly worse (40 % phase on tune): the quads that see the fire
well carry the frame, and must be allowed to.

## What it does and does not fix

- **The phase is the big win**: 40 % → 73 % of quads on validation, 27 % → 68 % on tune. It needs several quads per
  frame (almost every frame here has 4+).
- **The exact sprite gains less** (29 % → 41 %): with the phase fixed, each quad still has to pick its sheet and mirror
  alone, and those stay hard.
- Next: pick the sheet per *fire block* rather than per quad (a block's planes share their variant), and use the phase
  in the 3D quad tool, whose planes come from one block.
