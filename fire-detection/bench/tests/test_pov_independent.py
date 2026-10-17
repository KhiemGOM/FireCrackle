import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pov_independent import evaluate, pool_metrics, predict, read_truth, summarize


class IndependentTests(unittest.TestCase):
    def test_precision_coverage_and_false_positive_have_distinct_denominators(self):
        cases = [{'frame': i, 'truth': t, 'row': r, 'accepted': a}
                 for i, (t, r, a) in enumerate([(1, 1, True), (2, 3, True),
                                                (4, 4, False), (None, 2, True),
                                                (None, 0, False)])]
        x = summarize(cases)
        self.assertEqual(x['correct_row_coverage'], 1 / 3)
        self.assertEqual(x['accepted_label_precision'], 1 / 3)
        self.assertEqual(x['false_positive_rate'], 1 / 2)
        self.assertEqual((x['false_positives'], x['wrong_rows'], x['positive_abstentions']), (1, 1, 1))

    def test_empty_denominators_are_not_zero_error_claims(self):
        x = summarize([])
        self.assertIsNone(x['correct_row_coverage'])
        self.assertIsNone(x['accepted_label_precision'])
        self.assertIsNone(x['false_positive_rate'])

    def test_combined_rates_weight_frame_counts_not_clip_percentages(self):
        a = summarize([{'frame': 0, 'truth': 1, 'row': 1, 'accepted': True}])
        b = summarize([{'frame': n, 'truth': 2, 'row': 2, 'accepted': False}
                       for n in range(9)])
        x = pool_metrics([a, b])
        self.assertEqual(x['correct_row_coverage'], .1)
        self.assertEqual(x['accepted_label_precision'], 1.)
        self.assertIsNone(x['false_positive_rate'])

    def test_invalid_join_is_excluded_not_negative(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'truth.jsonl'
            rows = [{'n': 0, 'f': 9, 'tick_ok': False, 'label': None},
                    {'n': 1, 'f': 10, 'tick_ok': True, 'label': {'fire': False, 'fires': []}}]
            p.write_text('\n'.join(map(json.dumps, rows)))
            truth, count, excluded = read_truth(p)
            self.assertEqual(count, 2)
            self.assertNotIn(0, truth)
            self.assertIsNone(truth[1]['row'])
            self.assertEqual(excluded, {'invalid_tick': 1})

    def test_shipped_method_uses_raw_auto_only(self):
        f = {'row': 7, 'raw': .49, 'opaque': .9, 'broad': .9, 'margin': 1, 'span': 3}
        r = {'auto': False, 'modes': [{'fov': 0, 'fovs': [f]}]}
        self.assertEqual(predict(r, 'shipped'), (7, False))

    def test_repeated_render_frames_are_also_reported_once(self):
        mode = {'fov': 0, 'fovs': [{'row': 7, 'raw': .7}]}
        records = [{'n': n, 'auto': False, 'modes': [mode]} for n in (0, 5)]
        truth = {n: {'row': 7, 'render_frame': 4} for n in (0, 5)}
        x = evaluate(records, truth, 'shipped')
        self.assertEqual(x['sampled']['frames'], 2)
        self.assertEqual(x['unique_render_frames']['frames'], 1)
        with self.assertRaises(ValueError):
            evaluate(records + records, truth, 'shipped')
