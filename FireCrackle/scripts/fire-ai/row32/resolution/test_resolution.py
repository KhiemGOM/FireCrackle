import sys
from pathlib import Path
import unittest
import numpy as np
ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(ROOT/'FireCrackle/scripts/fire-ai'))
from render import rectify

class CropTests(unittest.TestCase):
    def test_default_stays64_and128_reads_native_detail(self):
        image=np.zeros((128,128,3),np.uint8);image[:,::2]=255
        quad=np.array([[0,0],[128,0],[128,128],[0,128]],float)
        small=rectify(image,quad);large=rectify(image,quad,size=128)
        self.assertEqual(small.shape,(64,64,3));self.assertEqual(large.shape,(128,128,3))
        self.assertTrue(np.array_equal(image,large));self.assertLess(float(small.std()),1);self.assertGreater(float(large.std()),100)
    def test_reject_invalid_size(self):
        with self.assertRaises(ValueError):rectify(np.zeros((2,2,3),np.uint8),np.zeros((4,2)),size=0)

if __name__=='__main__':unittest.main()
