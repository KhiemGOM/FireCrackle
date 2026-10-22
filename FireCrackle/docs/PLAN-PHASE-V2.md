# Job 11: phase methods comparison

Human-approved direction: compare fixed 20 Hz continuity, circular PELT, and PCID before choosing a replacement. Keep real anomalies; recovered stalls are soft. Check across long gaps and against a common clock. Whole-cycle ambiguity is accepted.

## Order

1. Re-read local Yarn 1.16.5 sources and mod tick instrumentation. Distinguish game render from recorder sample; do not infer a 47-tick game-render catch-up from video alone.
2. Write synthetic specifications and an exhaustive small-data oracle before implementation. Run red and retain test hashes.
3. Implement an isolated `phase_compare` module with documented research controls in `config.rs`. Keep the shipped checker available as baseline.
4. Compare the same cut trials on both recordings; report clean events, small-cut recall, localisation, runtime and long-gap behaviour. Hold settings fixed across clips. Reserve a second random seed for validation.
5. Promote only a method that earns it; document failures instead of silently replacing the shipped checker with a worse one.

## Methods

- Fixed clock: common circular reference with local block departures and cross-gap comparisons.
- Circular PELT: minimise sum of circular dispersion plus change penalty. Prefix sine/cosine sums; cost `2*(32/(2*pi))^2*(n-|sum exp(i*theta)|)` in tick-squared units. Triangle inequality gives the PELT pruning condition with K=0. Verify against exhaustive partitions. Exact optimisation is on explicit time bins, not every original video frame; report this qualification.
- PCID: use the paper's circular resultant contrast and alternating left/right expanding intervals. Deterministic block permutations are an adaptation for correlated captures; p-values are exploratory, not calibrated probabilities that an edit exists. Preserve the paper's detection/restart rule. Do not call ordinary binary segmentation PCID.
- Rate fit: diagnostic wrapped regression around 20 Hz; never automatically warp timestamps or absorb changes. Report alias/insufficient-evidence cases.

## Failures and tests

Empty/singleton input; invalid config, NaN, ordering and invalid labels; sheet normalisation and phase wrap; perfect clock at 20 and 60 fps; persistent jumps, isolated wrong labels, recovered freezes exceeding one cycle; long unobserved gaps with matching/mismatching endpoints; exact whole-cycle invisibility; two close opposite jumps; sub-tick persistent changes; correlated duplicate frames; seed reproducibility; unequal sampling density. PELT must match an exhaustive objective oracle. Test that no future sighting silently resets a fixed global clock. A stable row is evidence of held animation, not proof of identical pixels.

## Sources

- Killick et al., PELT: https://arxiv.org/abs/1101.1438
- Loizidou et al., PCID (2026 preprint), equations 6-8, Algorithms 1-2: https://arxiv.org/html/2603.10772v1
- McKilliam et al., wrapped phase regression: https://digital.library.adelaide.edu.au/items/92b72a91-d421-4660-b759-97e9b0d19c66
- Biswas et al., circular mean/concentration changes: https://arxiv.org/html/2403.00508v2

Do not use unlimited-sampling guarantees: bandlimited dense-sampling assumptions are not established for edited, sparsely observed game footage.

## Boundary refinement follow-up

Time bins lose boundary precision. Before changing refinement, add a specification for a five-tick cut
inside a half-second bin at 60 fps (all methods must locate its original observation), then run red.
Refine only detected bin boundaries using the original circular observations in neighbouring bins;
do not consult ground-truth ticks. Risks: overlapping refinement windows, sparse gaps, false sub-bin
precision, outliers pulling the split, and empty sides. Keep refined boundaries ordered and constrained
between adjacent candidate-bin midpoints. A gap boundary means first observed evidence, not edit location.

## Global reference follow-up

Expose residuals to one anchored clock, separately from local segmentation. Use the circular median of
the first configured occupied bins; never re-anchor after a gap or estimate the anchor from future
segments. Test a sequence of small offsets whose accumulated error exceeds the reporting threshold.
This anchor is a reference, not proof the first labels are right. Report the diagnostic fitted rate
separately. Keep both raw optimiser boundaries and emitted events in benchmark output: a hidden
segmentation boundary must never be scored as an actionable alert.

## Promotion gate

Add an existing-behaviour test explicitly demonstrating the time-bin blind spot: one wrong row for one
video frame is caught by the shipped checker but may disappear in a half-second circular mean. This
test starts green and documents why a standalone replacement is not yet justified despite improved
aggregate cut recall. A future combined checker must retain that evidence and pass the gap controls.

## Approved combined checker implementation

The human approved integration. Hard means a large/strong timing discrepancy and MAY be lag; it never
means proved editing or proved bad labels. Keep `analyze` as the frozen benchmark baseline. Add
`phase_v2::analyze` for sessions: PELT supplies persistent-change evidence and primary runs, the existing
checker supplies raw-frame events, and none of its flags are silently removed. Suppress only duplicate
PELT events whose boundary is already represented. Do not add raw statistical boundaries as flags.
Detect held canonical steps only over contiguous observations; interpolate the nominal clock THROUGH
the hold. Recovery is tested on several actual observations before and after, relative to the same
clock, not the frozen row. Report unwrapped held-time departure separately from wrapped phase.

Expose PELT bin/penalty/anchor, held duration/gap, recovery sample count/tolerance and supplemental-change
floor as documented generated settings. Existing min-shift remains authoritative for raw events and
can raise the supplemental floor. Keep the historical max_lag_ticks key for compatibility but explain
it as hard-discrepancy magnitude, not a Minecraft/capture cap. Invalid combined settings return errors.

Tests before code: normal/empty/single frame; one wrong row/sheet; all legacy flags retained; persistent
PELT change and filtered duplicates; a >32-tick held row followed by catch-up; no recovery evidence at
end; gap is not evidence of a freeze; matching/mismatching long gaps; different clock rate; invalid
settings. Session and chart must deliver the combined model, frozen global reference, and explanations.
UI shows evidence, a labelled common reference line and neutral hard/soft wording. UI text tests verify
that a hard event may be lag and never claims proof. Old settings deserialize with new defaults.

Risks: extra duplicate alerts; noisy post-gap splits; losing short errors; wrong starting reference;
misclassifying sparse repeated rows as held video; circular winding beyond one cycle; accidentally
changing legacy benchmark; settings changes serving a stale cache; unbounded fit on every label edit.
Do not fit/auto-correct the clock in the session's hot path. Benchmark combined emitted events against
legacy with the same proposals and both seeds, retaining fine-bucket results and clean event counts.

Validation follow-up: the real matching-gap control exposed a supplemental PELT boundary inside the
raw checker's allowed arc. Add a red synthetic sparse-gap fixture with a 1.2-tick distribution change
inside the configured two-tick spread. Require enough discrepancy to exceed that spread before adding
a gap-only supplement; retain every existing flag. The existing Workspace settings-count assertion
must change from 36 to 44 for the eight approved additions (mechanical schema expectation update).

Hold robustness follow-up: a short contradictory label inside a held row must not split the underlying
hold into two misleading non-recoveries. Add a red case with one wrong row in a >32-tick capture hold;
bridge a short interruption only if the same canonical row returns in fewer than phase.min_run
observations, with contiguous frames/timestamps throughout. Keep the raw odd-observation flag and
its explanation independent. This is held-animation evidence, never confirmation of identical pixels.
