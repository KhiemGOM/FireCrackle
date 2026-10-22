# Phase method comparison: job 11, 2026-10-15

Historical experiment below. The subsequently approved combined checker is now integrated; see
[IMPLEMENTATION.md](IMPLEMENTATION.md) for the final validation and behaviour.

## Decision

Circular PELT is the strongest next candidate, but **do not replace the shipped checker yet**.
It improves aggregate cut recall on both recordings and seeds, with fewer grouped events. A half-second
bin can nevertheless hide a single wrong label which the current checker catches. The real long-gap
control also produces an extra raw segmentation boundary on clip2 for PELT/PCID. The next implementation
must preserve the original fine-scale evidence alongside the global circular model.

This completes the human-approved methods experiment. Job 11's original production-replacement
acceptance remains open. No Session/Workspace/UI behaviour was changed by this experiment.

## Paired random-cut results

Each cell is caught / valid cuts (percentage), using emitted events, not hidden optimiser boundaries.
Each recording has 2000 proposed cuts per seed; proposals running past the recording end are excluded
identically for all methods. Seed 1 reproduces the previous 1744/1869 and 1664/1822 baselines exactly.

| Method | Clip1, seed 1 | Clip2, seed 1 | Clip1, seed 2 | Clip2, seed 2 |
|---|---:|---:|---:|---:|
| Current greedy checker | 1744/1869 (93.31%) | 1664/1822 (91.33%) | 1753/1877 (93.39%) | 1669/1820 (91.70%) |
| Fixed-rate circular check | 1763/1869 (94.33%) | 1690/1822 (92.76%) | 1767/1877 (94.14%) | 1697/1820 (93.24%) |
| Circular PELT | 1764/1869 (94.38%) | 1697/1822 (93.14%) | 1771/1877 (94.35%) | 1699/1820 (93.35%) |
| PCID adaptation | 1759/1869 (94.11%) | 1684/1822 (92.43%) | 1779/1877 (94.78%) | 1681/1820 (92.36%) |

**PELT does not dominate every bucket.** On clip1 seed 1, cuts >=2 ticks fall slightly from 99.29% to
98.99%; clip2 improves from 98.32% to 99.19%. On seed 2 the same bucket improves on both recordings.
These are paired development recordings, not an independent footage-level generalisation test.

Small-cut results for seed 1:

| Method | Clip1 <1 tick | Clip1 1-2 ticks | Clip2 <1 tick | Clip2 1-2 ticks |
|---|---:|---:|---:|---:|
| Current | 3/83 (3.6%) | 70/103 (68.0%) | 12/100 (12.0%) | 72/115 (62.6%) |
| PELT | 18/83 (21.7%) | 80/103 (77.7%) | 20/100 (20.0%) | 83/115 (72.2%) |

Do not interpret better sub-tick recall as elimination of the information limit: repeated observations
can support a small persistent shift, while an individual frame is quantised and noisy. Exactly whole
cycles remain unobservable from rows alone. No ROC, uncertainty interval or globally calibrated false
alarm probability is claimed.

## Clean recordings and event grouping

| Method | Clip1 emitted events | Clip2 emitted events |
|---|---:|---:|
| Current | 22 | 13 |
| Fixed | 12 | 5 |
| PELT | 5 | 2 |
| PCID adaptation | 4 | 1 |

The recordings contain real timing/capture anomalies, so these counts are **not** false-positive rates
for anomaly detection. New methods group departures that return within 60 s, and separately report held
animation. PELT's clip2 pair comprises a broad recovered departure and the held-animation interval;
they overlap and must not be advertised as two independent incidents. Some broad grouped intervals
span tens of seconds. Fewer list entries does not prove all useful fine-scale evidence was retained.

Recovered departures and held animation are soft. Persistent offsets request review; they do not
prove a labelling error. No recorded-frame jump is classified using a supposed 10-tick capture limit.

## Long gaps and the common clock

In both real recordings, remove all fire observations between 20 s and 120 s without changing video
timestamps. All methods detect an injected five-row offset after the gap, and keep exactly the same
early clock reference. The fixed method gives no extra boundary for the matching gap. PELT and PCID
produce an extra **raw** boundary at clip2's first post-gap observation even without an injected edit.
This is a reason to keep candidate segmentation distinct from review alerts and to retain the global
residual checks. The JSON reports record this control explicitly.

Every occupied bin also reports its residual relative to one circular-median reference anchored to the
first eight occupied bins. It never re-anchors across a gap. The anchor itself may be wrong if the early
labels are wrong; these residuals are diagnostic evidence rather than independently calibrated flags.

## Clock-rate diagnostic

The bounded wrapped-concentration search estimates **19.9985 Hz for clip1 and 20.0000 Hz for clip2**,
with lower-edge residual quantiles also reported. It does not modify detector timestamps or the 20 Hz
reference. This is an exploratory rate fit, not a certified clock estimate: cuts, correlated sampling,
startup anomalies and aliasing can bias it. The earlier endpoint averages (20.024/20.036) should not be
automatically substituted for the nominal rate.

## Freeze evidence resolved

See `../docs/PHASE-EVIDENCE.md` E9. The cap is 10 ticks per **game render**. Clip2 repeats game render 22323
through video frame 14003, then captures game render 22529 at frame 14004: **206 game renders elapsed**,
with 47 executed ticks. The sheet advances `47 mod 32 = 15`, as observed. This does not contradict
vanilla and does not establish a client render-thread freeze. It establishes held capture output;
the precise recorder/GPU component responsible remains unknown.

## Methods and qualifications

- Fixed: nominal 20 Hz circular phases, sequential local departures, plus the same anchored global
  residuals. It does not fit a new clock after each fire sighting.
- PELT: exact penalised optimisation on occupied half-second circular means; resultant-vector cost
  `2*(32/(2*pi))^2*(n-|sum exp(i*theta)|)`, penalty 5 tick-squared. The K=0 pruning inequality follows
  from the triangle inequality. Exhaustive partitions verify the optimum on 1080 small random cases.
  Raw observations refine only detected boundaries; this refinement is not part of the exact optimum.
- PCID: the circular contrast and alternating interval-isolation/restart procedure from the paper,
  adapted to two overlapping tilings of windows of 256 occupied bins, expansion 16, 199 permutations
  of two-bin blocks, per-test alpha .05 and seed 1. It is **not** the paper's calibrated PCID-W;
  pre-screening, block permutation and overlapping tilings invalidate importing its error guarantees.
- All thresholds/defaults are documented in `PhaseResearchConfig` in `config.rs`; experimental settings
  are passed as an optional JSON file to the benchmark, not added to the shipped Settings UI.

Settings were held fixed across both recordings and seeds. Changes before the paired runs: recovery
window 30 -> 60 s to satisfy the planned long-return synthetic case; permutation blocks 3 -> 2 and
replicates 99 -> 199 to resolve the planned short synthetic cut. No settings were selected by tuning
the reported cut recall. Seed 2 changes the cut proposals, not the detector's randomisation seed.

## Reproduce

From repository root, with ffprobe on PATH:

```powershell
$env:CARGO_TARGET_DIR = "$PWD/FireCrackle/phase-research/target"
cargo test --offline --manifest-path FireCrackle/crates/studio_core/Cargo.toml
cargo run --offline --release --manifest-path FireCrackle/crates/studio_core/Cargo.toml --example compare_phase -- fire-detection/data/joined/clip1.jsonl "fire-detection/data/video/2026-10-15 14-48-36.mkv" FireCrackle/phase-research/clip1-seed1.json 2000 1
```

Repeat with clip2/18-18-16, then seed 2. Complete machine-readable reports are the four
`clip{1,2}-seed{1,2}.json` files here. Strict scoring requires an event at one of the first four observed
fire frames after a cut, or a newly ended recovered departure on one of the last three observations
before it. Also reported: one-second localisation tolerance and raw-boundary recall. Matches require
a new event extent versus that method's uncut baseline. No held-out footage claim is implied.

## Validation

The full studio_core suite passed, including real video import/decode integration tests. An initial
attempt used an old FFmpeg lacking libx264; rerunning with a locally cached FFmpeg 6.1.1 resolved that
environment failure without changing tests. 14 comparison tests pass, including an exhaustive PELT
oracle, phase wrap, 60 fps clock, opposite changes, long gaps, clock drift, recovered >32-tick freezes,
invalid inputs, deterministic PCID, sheet normalisation and raw boundary refinement.

Test-first history: initial 11 specs failed for missing API, then passed unchanged. Boundary refinement
and global residual tests were appended separately, each run red before implementation. The final
promotion-gate test pins an existing blind spot and started green; no expectation was changed to fit
implementation. Final test SHA-256:
`07892e609a1acc4a00b4cc4e623913a0f2f1498b3095298c1656579a5c07227b`.

## Next production work

1. Preserve fine-scale outlier evidence before binning; add interval-aware cross-gap confirmation.
2. Combine that evidence with PELT's persistent-change model and explicit recovery explanations.
3. Test short cuts, wrong sheets and single-frame label errors inside recovered intervals; keep separate
   evidence rather than clearing an entire recovered span.
4. Compare against the saved paired baseline, including bucket-level regressions and gap controls.
5. Only then connect the selected model/explanations/global reference to Session and the Phase UI.

## Primary sources

- [Killick et al., PELT](https://arxiv.org/abs/1101.1438)
- [Loizidou et al., PCID, equations 6-8 and algorithms 1-2](https://arxiv.org/html/2603.10772v1)
- [McKilliam et al., Frequency Estimation by Phase Unwrapping](https://digital.library.adelaide.edu.au/items/92b72a91-d421-4660-b759-97e9b0d19c66)
- [Biswas et al., circular mean and concentration changepoints](https://arxiv.org/html/2403.00508v2)
