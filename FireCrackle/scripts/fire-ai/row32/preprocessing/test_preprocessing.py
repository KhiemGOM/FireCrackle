import unittest
import numpy as np
import torch
from run import transform,blend,choose_weight

class PreprocessingTests(unittest.TestCase):
    def test_identity_and_gamma_direction(self):
        image=np.full((128,128,3),64,np.uint8);before=image.copy()
        self.assertIs(transform(image,'unchanged'),image)
        self.assertGreater(int(transform(image,'gamma_0.8')[0,0,0]),64)
        self.assertLess(int(transform(image,'gamma_1.25')[0,0,0]),64)
        np.testing.assert_array_equal(image,before)
    def test_median_removes_isolated_noise_and_preserves_constants(self):
        image=np.full((128,128,3),50,np.uint8);image[64,64]=250
        self.assertEqual(int(transform(image,'median_3')[64,64,0]),50)
        flat=np.full((128,128,3),100,np.uint8)
        np.testing.assert_array_equal(transform(flat,'unsharp_1'),flat)
    def test_probability_blend_endpoints_and_calibration_selection(self):
        a=torch.tensor([[.9,.1],[.2,.8]]);b=1-a;y=torch.tensor([0,1])
        torch.testing.assert_close(blend(a,b,0),a);torch.testing.assert_close(blend(a,b,1),b)
        weight,_=choose_weight(a,b,y);self.assertEqual(weight,0.)
        weight,_=choose_weight(a,b,1-y);self.assertEqual(weight,1.)

if __name__=='__main__':unittest.main()
