import unittest
from blob_pilot import metrics


def row(fire, substantial, raw_pair=0, auto_pair=0):
    return {'truth': {'fire': fire, 'substantial': substantial}, 'evidence': {
        'raw': {'pixels': 1000, 'single': 1000, 'pair': raw_pair, 'separated': raw_pair},
        'auto': {'pixels': 1000, 'single': 1000, 'pair': auto_pair, 'separated': auto_pair}}}


class BlobMetricsTests(unittest.TestCase):
    def test_negligible_fire_is_separate_and_either_colour_branch_keeps_review(self):
        result = metrics([row(False, False), row(True, False), row(True, True),
                          row(True, True, auto_pair=32)])
        self.assertEqual(result['substantial_fire'], 2)
        self.assertEqual(result['negligible_fire'], 1)
        gate = result['variants']['all:separated<16']
        self.assertEqual(gate['cleared_no_fire'], 1)
        self.assertEqual(gate['cleared_negligible_fire'], 1)
        self.assertEqual(gate['missed_substantial_fire'], 1)
        self.assertEqual(gate['missed_any_fire'], 2)
        self.assertEqual(result['variants']['all:pixels<16']['cleared_no_fire'], 0)


if __name__ == '__main__': unittest.main()
