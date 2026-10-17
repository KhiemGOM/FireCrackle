import unittest
from refine_v3 import fitting_crops,validate_crop_roles

class Contracts(unittest.TestCase):
    def test_rejected_crop_does_not_become_negative(self):
        rows=[{'id':'a','source':'clip1','frame':0,'file':'a.npy'},{'id':'b','source':'quad1','frame':30,'file':'b.npy'}]
        self.assertEqual(fitting_crops({'positives':rows},{'a':True,'b':False}),rows[:1])
    def test_calibration_recording_is_never_auxiliary_training(self):
        with self.assertRaises(ValueError):fitting_crops({'positives':[{'id':'a','source':'clip2','file':'a.npy'}]},{'a':True})
    def test_same_recording_development_frame_is_also_refused(self):
        class Base:
            def target_rows(self,*args):return ({30:{'role':'development','fire':True}}, {})
        with self.assertRaises(ValueError):validate_crop_roles([{'source':'clip1','frame':30}],Base())

if __name__=='__main__':unittest.main()
