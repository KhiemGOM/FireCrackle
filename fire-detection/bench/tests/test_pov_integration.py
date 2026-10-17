from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pov_integration import ordered_records


class ProductionOutputTests(unittest.TestCase):
    def test_parallel_order_is_not_a_missing_frame(self):
        self.assertEqual(ordered_records([{'n': 5}, {'n': 0}, {'n': 10}], {0: None, 5: None, 10: None}),
                         [{'n': 0}, {'n': 5}, {'n': 10}])

    def test_duplicate_missing_or_wrong_frame_is_rejected(self):
        for records in ([{'n': 0}, {'n': 0}], [{'n': 0}], [{'n': 0}, {'n': 10}]):
            with self.assertRaises(AssertionError):
                ordered_records(records, {0: None, 5: None})
