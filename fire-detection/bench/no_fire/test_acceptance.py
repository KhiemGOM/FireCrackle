import unittest
import numpy as np
from train import threshold_zero_false_clear,metrics
class AcceptanceTest(unittest.TestCase):
 def test_calibration_uses_lowest_fire_and_never_clears_ties(self):
  scores=np.array([.01,.03,.03,.8]);truth=np.array([[0,0,0,0],[1,.0001,1,1],[0,0,0,0],[1,.1,0,0]])
  threshold=threshold_zero_false_clear(scores,truth[:,0]);self.assertEqual(threshold,.03)
  result=metrics(scores,truth,threshold);self.assertEqual(result['false_clear_fire'],0);self.assertEqual(result['cleared_no_fire'],1)
 def test_tiny_fire_and_veiled_fire_stay_in_false_clear_denominator(self):
  truth=np.array([[1,.000001,1,1],[1,.1,0,0],[0,0,0,0]])
  result=metrics(np.array([.01,.9,.01]),truth,.1)
  self.assertEqual(result['false_clear_fire'],1);self.assertEqual(result['fire_groups']['tiny_lt_0.1pct'],{'frames':1,'cleared':1});self.assertEqual(result['fire_groups']['truth_veiled']['cleared'],1)
 def test_nonfinite_calibration_is_rejected(self):
  with self.assertRaises(ValueError):threshold_zero_false_clear([float('nan'),.2],[True,False])
 def test_no_fire_only_calibration_is_rejected(self):
  with self.assertRaises(ValueError):threshold_zero_false_clear([.1,.2],[False,False])
if __name__=='__main__':unittest.main()
