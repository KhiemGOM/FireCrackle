import unittest
from blob_calibration import meaningful, scores, clear


class BlobCalibrationTest(unittest.TestCase):
    def test_training_width_boundary_and_any_source(self):
        self.assertFalse(meaningful([[1,1,24.99,200]]))
        self.assertTrue(meaningful([[1,1,25,2]]))
        self.assertTrue(meaningful([[1,1,3,500],[2,2,30,4]]))
        self.assertFalse(meaningful([[1910,0,1950,10]]))
        self.assertFalse(meaningful([[0,1200,100,1300]]))

    def test_unveil_can_only_keep_more_for_review(self):
        evidence={k:{'pair':2} for k in ['raw','auto','raw_nohud','auto_nohud']}
        evidence['auto']['pair']=100
        self.assertEqual(scores(evidence)['all:pair'],100)

    def test_guard_and_unknowns(self):
        config={'all_pair_threshold':112,'nohud_pair_threshold':5,'large_single_guard':4096}
        self.assertTrue(clear({'all:pair':111},config))
        self.assertFalse(clear({'all:pair':112},config))
        self.assertTrue(clear({'nohud:pair':0,'nohud:single':4095},config))
        self.assertFalse(clear({'nohud:pair':0,'nohud:single':4096},config))
        self.assertFalse(clear({},config))


if __name__=='__main__':unittest.main()
