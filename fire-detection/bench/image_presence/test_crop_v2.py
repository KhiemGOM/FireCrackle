import unittest
import numpy as np
from crop_v2 import crop_box, classify_role, validated_review, dense_boxes, scan_views

class CropContract(unittest.TestCase):
    def test_crop_clamps_and_preserves_native_scale(self):
        self.assertEqual(crop_box([0,0,24,80]),(0,12,320,332))
        b=crop_box([1900,1000,1920,1080])
        self.assertEqual(b,(1600,760,1920,1080))
    def test_dense_views_cover_screen_after_strip(self):
        covered=np.zeros((1080,1920),bool)
        for x,y,r,b in dense_boxes(): covered[y:b,x:r]=True
        self.assertFalse(covered[:12].any())
        self.assertTrue(covered[12:].all())
    def test_heldout_not_in_crop_fit(self):
        self.assertEqual(classify_role('clip2',0,20000),'calibration')
        self.assertEqual(classify_role('survival1',0,80000),'test')
        self.assertEqual(classify_role('clip1',8000,10000),'excluded_guard')
    def test_review_must_cover_every_candidate(self):
        with self.assertRaises(ValueError): validated_review(['a','b'],{'a':True})
        with self.assertRaises(ValueError): validated_review(['a'],{'a':'yes'})
        self.assertEqual(validated_review(['a','b'],{'a':True,'b':False}),['a'])
    def test_capture_strip_cannot_enter_scan(self):
        image=np.zeros((1080,1920,3),np.uint8);image[:12]=255
        self.assertEqual(int(scan_views(image).max()),0)

if __name__=='__main__': unittest.main()
