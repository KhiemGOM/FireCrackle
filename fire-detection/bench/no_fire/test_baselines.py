import unittest
import numpy as np
from legacy import report,stump_tree,tree_predict
from clustering import fit_clusters,clustered
class BaselineTest(unittest.TestCase):
 def test_legacy_objective_does_not_drop_low_scoring_fire(self):
  result=report([0,1,0,0],[True,False,False,True],np.array([1,1,0,0],bool),np.array([0,0,1,1],bool))
  self.assertEqual(result['threshold'],0);self.assertEqual(result['cleared_no_fire'],0);self.assertEqual(result['test_fire'],1)
 def test_tiny_tree_separates_training_features(self):
  x=np.r_[np.zeros((50,2)),np.ones((50,2))];y=np.r_[np.zeros(50,bool),np.ones(50,bool)]
  p=tree_predict(stump_tree(x,y),x);self.assertTrue((p[:50]<.5).all());self.assertTrue((p[50:]>.5).all())
 def test_color_clusters_are_deterministic_and_keep_unseen_colors_assignable(self):
  images=np.stack([np.full((32,32,3),[200,100,20],np.uint8),np.full((32,32,3),[10,60,190],np.uint8)])
  a,lut=fit_clusters(images,k=2);b,lut2=fit_clusters(images,k=2);np.testing.assert_array_equal(a,b);np.testing.assert_array_equal(lut,lut2)
  f=clustered(images[0],lut);self.assertEqual(f.shape,(64,));self.assertTrue(np.isfinite(f).all());self.assertAlmostEqual(float(f[:16].sum()),1)
if __name__=='__main__':unittest.main()
