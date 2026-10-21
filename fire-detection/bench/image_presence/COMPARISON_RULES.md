# V3 CNN versus the hand-written no-fire detector

Research only, separate from 0.2.1. Same familiar survival recording; no new
training, threshold changes or independent validation.

## Matched comparison

Both methods use the same 919 frame IDs, including 542 eligible no-fire/tiny-fire
targets and 377 above-width24 fire targets. TP means a correct eligible clear;
FP means above-cutoff fire wrongly cleared. Lower-than-cutoff fire is explicitly
allowed under the existing benchmark policy.

| Method | TP / 542 | Coverage | FP / 377 |
| --- | ---: | ---: | ---: |
| Hand-written orange/blob + retention | 23 | 4.24% | 0 |
| V3 CNN | 30 | 5.54% | 0 |
| Either method clears, descriptive union | 43 | 7.93% | 0 |

The CNN is modestly ahead here, by seven frames. It is not a replacement for
the rules: only ten clears overlap, while 20 are CNN-only and 13 rules-only.
All 33 unique-method frames were visually checked on the contact sheets.
CNN-only cases include dark/warm Nether scenery, glowstone/lava/held objects
that retain lots of orange evidence. Rules-only cases include menus and dark
Overworld/mining scenes that remain above the CNN's conservative threshold.

Five CNN clears (all CNN-only) contain recorded fire below the width24 cutoff;
none of the rules' clears contain recorded fire. If the target were literally
any recorded fire instead, the matched CNN would have 25 correct clears and
five tiny-fire errors, versus the rules' 23 correct clears and zero recorded-fire
errors. Neither target definition is an exact pixel-visibility oracle.

## What was held equal

- Native 1920x1080 RGB, original frame IDs and width24 truth from the same joined
  dataset. No labelled geometry enters inference.
- Canonical Rust automatic menu unveil; both retain raw and automatic evidence.
- Shared uncertainty vetoes: reliable canonical vanilla GUI fit; abstain when
  menu-like share is at least .80 but automatic unveil fails; GUI-conditioned
  material-v3 portal/blue-translucency check; and the original shared purple guard.
- GUI rules and local textures are identical. GUI pixels are used to exclude
  HUD from material/retention checks; they are not erased from either main score.
  This keeps the CNN's trained pixel distribution intact. GUI/material detection
  remains heuristic and cannot prove opacity or perfect interface masking.

Each method keeps its existing score: strict frozen CNN threshold -1.7583287954,
versus orange merged-component area below2198 with restored-only strong-orange
retention128/24/8. No labels or weights were changed to make the comparison win.

The candidate union contains 91 frames before vetoes. These were freshly decoded
at original CFR60 timestamps; every raw/automatic CNN view matched its original
cache byte-for-byte. Recomputed native orange scores exactly matched their
historical scores on all91. All other828 frames necessarily stay in review under
both fixed score thresholds, so their full-resolution veto computation was
unnecessary. Both denominators remain all919 frames.

## Why these counts differ from earlier results

The original CNN's 44 clears become30 under the additional shared safety checks:
12 have no reliable GUI fit, one triggers weak-menu uncertainty, and one triggers
the material veto. Its images, weights, calibration threshold and truth are
unchanged; these are additional abstentions.

The older offline hand-written policy, without strict missing-GUI/weak-menu
abstentions or the CNN's extra purple guard, gives43 correct clears and0
above-cutoff errors on this same919-frame sample. Desktop-style research gates
give27/0, and matching the CNN's additional purple guard brings that to23/0.
The desktop-style row is research emulation using NumPy material-v3; it is not
an app-binary parity result. The main table applies exactly the same uncertainty
policy to both methods.

Thus the original configurations are nearly tied (44 versus43), and the matched
safety-policy comparison favours the CNN slightly (30 versus23). The descriptive
union suggests complementary evidence, but it is post-hoc and not adopted into
the app. Zero observed errors on correlated familiar frames is not a guarantee.
Fresh-video validation remains the next requirement before adopting either
the CNN or a combined rule.

## Reproduction

Run `compare_rules.py OUT --data-root ROOT --baseline-run RUN1 --cnn-run V3_ARM`.
Use a fresh OUT. Existing calibration/checkpoint hashes, shared preprocessing,
frame IDs and truth are checked. Orange and retention scoring include the frozen
Rust source directly, rather than copying their pixel rules. Tests check TP/FP
direction and symmetric uncertainty vetoes.

Local artifacts: `.board/image-presence/continuation/comparison1/`, containing
the frozen protocol, all91 evidence records, all919 prediction rows, report and
candidate contact sheets. No data, textures or model binaries are committed.
