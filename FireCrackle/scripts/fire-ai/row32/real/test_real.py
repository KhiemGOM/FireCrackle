import unittest
from train import validate_splits
from inventory import phase

class SplitTests(unittest.TestCase):
    def test_video_leak_rejected(self):
        rows=[dict(video=v,split=s,phase=3) for v,s in [('a','train'),('b','calibration'),('a','test')]]
        with self.assertRaisesRegex(ValueError,'crosses'):validate_splits(rows)
    def test_three_separate_recordings(self):
        validate_splits([dict(video=v,split=s,phase=31) for v,s in [('a','train'),('b','calibration'),('c','test')]])
    def test_phase_import_is_common_clock(self):
        for p in range(32):self.assertEqual(phase(0,(p-16)%32),phase(1,p))

if __name__=='__main__':unittest.main()
