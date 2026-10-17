import unittest
import numpy as np
from pipeline import tile_boxes, split_role, clear_threshold, decisions, strip_crop


class ContractTests(unittest.TestCase):
    def test_tiles_cover_every_pixel(self):
        covered = np.zeros((1080, 1920), bool)
        for x0,y0,x1,y1 in tile_boxes(1920,1080):
            covered[y0:y1,x0:x1] = True
        self.assertTrue(covered.all())

    def test_strip_is_excluded_before_views(self):
        image = np.zeros((1080,1920,3), np.uint8)
        image[:12] = 255
        self.assertEqual(int(strip_crop(image).max()), 0)

    def test_test_and_calibration_never_fit(self):
        for n in range(0,10000,90):
            self.assertEqual(split_role('survival1',n,10000),'test')
            self.assertEqual(split_role('clip2',n,10000),'calibration')
        self.assertEqual(split_role('clip1',0,10000),'train')
        self.assertEqual(split_role('clip1',9999,10000),'development')
        self.assertEqual(split_role('clip1',8000,10000),'excluded_guard')

    def test_ties_and_translucency_abstain(self):
        threshold = clear_threshold(np.array([.1,.3,.8]), np.array([0,1,1]))
        np.testing.assert_array_equal(decisions(np.array([.1,.3,.05]),threshold,np.array([0,0,1])),[True,False,False])

    def test_invalid_calibration_rejected(self):
        with self.assertRaises(ValueError): clear_threshold(np.array([np.nan]),np.array([1]))
        with self.assertRaises(ValueError): clear_threshold(np.array([.1]),np.array([0]))


if __name__ == '__main__': unittest.main()
