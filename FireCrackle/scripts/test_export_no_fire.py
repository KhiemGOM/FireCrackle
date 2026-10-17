"""Tests for the frozen model-export contract; model weights stay outside Git."""
import importlib.util, math, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('export_no_fire',Path(__file__).with_name('export_no_fire.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ExportContract(unittest.TestCase):
    def test_changed_checkpoint_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'best.pt';p.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'checkpoint'):module.verify_checkpoint(p)
    def test_numeric_margin_abstains(self):
        self.assertFalse(module.is_clear(module.THRESHOLD-0.00001))
    def test_strict_finite_threshold(self):
        self.assertTrue(module.is_clear(-2))
        for score in [module.THRESHOLD,math.nan,math.inf,-math.inf]:self.assertFalse(module.is_clear(score))
if __name__=='__main__':unittest.main()
