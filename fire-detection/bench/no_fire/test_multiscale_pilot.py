import unittest
from multiscale_pilot import aggregate, calibrate, counts, score, specifications


class MultiscaleTest(unittest.TestCase):
    def test_missing_evidence_cannot_clear(self):
        self.assertIsNone(aggregate([0., None], 'max'))
        self.assertIsNone(aggregate([0., float('nan')], 'mean'))
        self.assertIsNone(score({'scores': {}}, {'fields': ['a'], 'aggregate': 'min'}, {'a': 1}))

    def test_independent_normalization_and_strict_floor(self):
        fields = {f for spec in specifications().values() for f in spec['fields']}
        fire = {'truth': {'substantial': True}, 'scores': {f: 10 for f in fields}}
        empty = {'truth': {'substantial': False}, 'scores': {f: 0 for f in fields}}
        config = calibrate([fire, empty])
        spec = config['rules'][config['primary']]
        self.assertEqual(spec['threshold'], .8)
        self.assertEqual(score(fire, spec, config['normalization']), 1)
        self.assertEqual(counts([fire, empty], lambda r: score(r, spec, config['normalization']) < spec['threshold'])['TP'], 1)
        with self.assertRaises(ValueError):
            calibrate([empty])


if __name__ == '__main__':
    unittest.main()
