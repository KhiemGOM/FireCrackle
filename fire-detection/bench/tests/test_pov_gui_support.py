import copy
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pov_gui_support as support
import pov_gui_spatial as spatial


def record(used=20, score=12):
    stats = []
    for i in range(8):
        sz = [0.] * 32
        sz[4] = 2.
        stats.append({'sz': sz, 'cz': [0.] * 32, 'sum': [score] * 32,
                      'used': [used] * 32, 'total': [100] * 32, 'weight': 2.})
    return {'n': 0, 'stats': stats}


class SupportTests(unittest.TestCase):
    def test_fewer_usable_probes_do_not_reduce_normalized_agreement(self):
        a = support.features(record(20, 12))
        b = support.features(record(10, 6))
        self.assertEqual(a['visible_evidence'], b['visible_evidence'])
        self.assertEqual((a['hits'], b['hits']), (16, 8))
        self.assertEqual(a['row'], 4)

    def test_no_usable_evidence_cannot_accept(self):
        f = support.features(record(0, 0))
        decision, _ = support.decisions([f])
        self.assertFalse(decision.any())
        self.assertEqual(f['visible_evidence'], 0)

    def test_all_gates_preserve_baseline_and_opaque_matches(self):
        a = support.features(record())
        b = dict(a, base=False, opaque=True, visible_evidence=-1)
        decision, _ = support.decisions([a, b])
        self.assertTrue(decision.all())

    def test_margin_is_selected_row_against_best_other(self):
        r = record()
        r['stats'][6]['sz'][9] = 5
        f = support.features(r)
        self.assertEqual(f['raw_margin'], 2)
        self.assertEqual(f['mask_margin'], -3)

    def test_held_out_labels_do_not_affect_rule_selection(self):
        k = len(support.RULES)
        def metric():
            return {name: [0] * k for name in
                    ['correct', 'false_positives', 'wrong_rows', 'lost_correct']}
        data = {name: metric() for name in ['a', 'b', 'held']}
        data['a']['correct'][3] = 2
        selected = support.choose_rule(data, 'held')
        changed = copy.deepcopy(data)
        changed['held']['false_positives'][selected] = 999
        changed['held']['correct'][5] = 9999
        self.assertEqual(selected, support.choose_rule(changed, 'held'))

    def test_metrics_separate_wrong_sprite_and_presence_errors(self):
        m = support.metrics(np.array([4, 5, -1]), np.array([4, 4, 4]),
                            np.array([[True], [True], [True]]), np.array([True, False, False]))
        self.assertEqual(m, {'correct': [1], 'false_positives': [1], 'wrong_rows': [1],
                             'new_correct': [0], 'lost_correct': [0]})

    def test_spatial_support_needs_agreement_and_enough_matching_probes(self):
        used, hits = np.zeros(16, dtype=int), np.zeros(16, dtype=int)
        used[[0, 3, 12, 15]] = [20, 20, 20, 4]
        hits[[0, 3, 12, 15]] = [16, 16, 10, 4]
        f = spatial.spatial_features(used, hits)
        self.assertEqual(f['bins'], 2)
        self.assertEqual(f['x_span'], 4)
        self.assertEqual(f['y_span'], 1)
        self.assertEqual(f['both_sides'], 1)

    def test_empty_spatial_support_has_zero_span(self):
        self.assertEqual(spatial.spatial_features([0] * 16, [0] * 16),
                         {'bins': 0, 'x_span': 0, 'y_span': 0, 'both_sides': 0, 'never': 0})


if __name__ == '__main__':
    unittest.main()
