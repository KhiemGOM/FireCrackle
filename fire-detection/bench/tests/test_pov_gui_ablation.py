"""Metric contract: acceptance must not hide wrong rows or overlay false positives."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('pov_gui_ablation',Path(__file__).parents[1]/'pov_gui_ablation.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MetricsTests(unittest.TestCase):
 def test_wrong_rows_and_false_positives_are_separate(self):
  rows=[{'truth':4,'base_row':'4','base_ev':'.5'}, {'truth':7,'base_row':'8','base_ev':'.9'},
        {'truth':None,'base_row':'4','base_ev':'.8'}, {'truth':9,'base_row':'9','base_ev':'.49'}]
  out=m.metrics(rows,'base')
  self.assertEqual(out,{'frames':4,'overlay_frames':3,'accepted':3,'correct':1,'false_positives':1,'wrong_rows':1,'correct_acceptance_rate':1/3})
 def test_no_overlay_does_not_make_undefined_recall_zero(self):
  out=m.metrics([{'truth':None,'mask_row':'2','mask_ev':'.1'}],'mask')
  self.assertIsNone(out['correct_acceptance_rate']);self.assertEqual(out['false_positives'],0)
if __name__=='__main__':unittest.main()
