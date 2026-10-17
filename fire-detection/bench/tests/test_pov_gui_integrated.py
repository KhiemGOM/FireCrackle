import copy
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pov_gui_integrated as integrated
import pov_gui_stages as stages


def record():
    r = {'sz': [0.] * 32, 'cz': [0.] * 32, 'sum': [0.] * 32,
         'used': [100] * 32, 'total': [100] * 32, 'weight': 2.}
    r['sz'][1], r['cz'][1], r['sum'][1] = 3., 2., 60.
    mask = copy.deepcopy(r)
    mask['sz'][3], mask['cz'][4] = 10., 4.
    mask['used'] = [20] * 32
    mask['sum'] = [0.] * 32
    mask['sum'][3], mask['sum'][4] = 18., 17.
    return {'stats': [copy.deepcopy(r), copy.deepcopy(r),
                      *[copy.deepcopy(mask) for _ in range(6)]]}


class IntegratedTests(unittest.TestCase):
    def test_existing_ranking_and_visible_fov_reproduce_stage_combinations(self):
        r = record()
        r['stats'][7]['sum'][4] = 19.
        p = integrated.proposals(r)
        rows, scores, _ = stages.combine(r)
        for j, (coverage, silhouette, colour, fov) in enumerate(integrated.MODELS):
            if fov == 2:
                continue
            c = {'coverage': stages.COVERAGES[coverage], 'silhouette': silhouette,
                 'colour': integrated.COLOURS[colour], 'gate': 'visible',
                 'fov': 'frozen' if fov == 0 else 'visible'}
            i = stages.CONFIGS.index(c)
            self.assertEqual(p['row'][j], rows[i])
            self.assertAlmostEqual(p['visible'][j], scores[i], places=12)

    def test_empty_visible_region_is_omitted_not_negative_evidence(self):
        self.assertEqual(integrated.equal_region([20, 0, 0], [16, 0, 0]), (.6, 1))
        self.assertEqual(integrated.equal_region([0] * 16, [0] * 16), (-1., 0))

    def test_equal_region_pooling_differs_from_probe_pooling(self):
        score, count = integrated.equal_region([100, 10], [100, 0])
        self.assertEqual((score, count), (0., 2))
        self.assertGreater((200 - 110) / 110, .5)

    def test_spatial_gate_cannot_accept_insufficient_global_agreement(self):
        p = integrated.proposals(record())
        p['visible'][:] = .49
        self.assertFalse(integrated.gates(p).any())

    def test_wrong_sprite_and_presence_errors_stay_separate_with_changed_rows(self):
        truth = np.array([4, -1, 5])
        rows = np.array([[4, 3], [4, 4], [5, 5]])
        accepted = np.ones((3, 2), dtype=bool)
        m = integrated.measure(truth, rows, accepted, np.array([4, 4, 5]), np.array([1, 0, 1]))
        self.assertEqual(m['correct'], [2, 1])
        self.assertEqual(m['false_positives'], [1, 1])
        self.assertEqual(m['wrong_rows'], [0, 1])
        self.assertEqual(m['lost_correct'], [0, 1])

    def test_held_out_metrics_do_not_select_rules(self):
        def m():
            return {k: [0] * len(integrated.CONFIGS) for k in
                    ['correct', 'false_positives', 'wrong_rows', 'lost_correct']}
        sources = {'train': m(), 'held': m()}
        sources['train']['correct'][10] = 5
        i = integrated.choose(sources, 'held')
        sources['held']['false_positives'][i] = 100
        self.assertEqual(i, integrated.choose(sources, 'held'))

    def test_fixed_matrix_has_1008_unique_configurations(self):
        self.assertEqual(len(integrated.CONFIGS), 1008)
        self.assertEqual(len({tuple(c.values()) for c in integrated.CONFIGS}), 1008)


if __name__ == '__main__':
    unittest.main()
