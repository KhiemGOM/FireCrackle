import unittest
import numpy as np
from features import features,unveil
class FeaturesTest(unittest.TestCase):
 def test_conditional_unveil_recovers_known_gradient_and_leaves_true_dark_frames(self):
  rgb=np.full((90,160,3),[200,130,30],dtype=np.uint8);a=(192+(np.arange(90)+.5)*16/90)/255
  veiled=np.rint(rgb*(1-a[:,None,None])+16*a[:,None,None]).astype(np.uint8)
  fixed,found,_=unveil(veiled);self.assertTrue(found);self.assertLessEqual(np.abs(fixed.astype(float)-rgb).max(),3)
  black=np.zeros_like(rgb);fixed,found,_=unveil(black);self.assertFalse(found);np.testing.assert_array_equal(fixed,black)
 def test_tiny_fire_pixels_are_kept_and_features_are_finite(self):
  rgb=np.zeros((90,160,3),np.uint8);a,_=features(rgb);rgb[45,80]=[255,130,0];b,_=features(rgb)
  self.assertTrue(np.isfinite(b).all());self.assertGreater(b[0],a[0]);self.assertGreater(b[1],a[1])
if __name__=='__main__':unittest.main()
