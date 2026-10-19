import unittest
from pathlib import Path
import numpy as np
import torch
from model import make_model,normalize
from synthetic import PhaseRenderer
from train import calibrate

class PhaseTests(unittest.TestCase):
    def test_output_is32_phases_and_normalization_preserves_shape(self):
        torch.set_num_threads(2)
        model=make_model().eval();x=torch.rand(2,3,64,64)
        with torch.inference_mode():y=model(normalize(x))
        self.assertEqual(tuple(y.shape),(2,32));self.assertTrue(torch.isfinite(y).all())

    def test_synthetic_reproducibility_and_all_phase_labels(self):
        sheets=np.zeros((4,32,16,16,4),np.uint8)
        for c in range(4):
            for r in range(32):sheets[c,r]=[20+r*3,100,120,255]
        bg=np.zeros((3,3,160,160),np.uint8).transpose(0,2,3,1).copy()
        renderer=PhaseRenderer(bg,sheets,'cpu')
        a,y=renderer.batch(128,213);b,z=renderer.batch(128,213)
        self.assertTrue(torch.equal(a,b));self.assertTrue(torch.equal(y,z));self.assertEqual(set(y.tolist()),set(range(32)))
        self.assertEqual(tuple(a.shape),(128,3,64,64));self.assertTrue((a>=0).all() and (a<=1).all())

    def test_separate_models_cannot_sample_other_colour(self):
        sheets=np.zeros((4,32,16,16,4),np.uint8);bg=np.zeros((1,160,160,3),np.uint8)
        for kind,lo,hi in [('orange',0,128),('soul',128,256)]:
            renderer=PhaseRenderer(bg,sheets,'cpu',kind)
            self.assertEqual(set(renderer.labels.tolist()),set(range(lo,hi)))

    def test_confidence_gate_requires_two_frames_and_five_correct_cases(self):
        logits=torch.zeros(6,32);logits[:,0]=10;truth=torch.zeros(6,dtype=torch.long)
        self.assertEqual(calibrate(logits,truth,[0]*6),1.01)
        self.assertEqual(calibrate(logits,truth,[0,0,0,1,1,1]),0)
        truth[0]=1;self.assertEqual(calibrate(logits,truth,[0,0,0,1,1,1]),1.01)

if __name__=='__main__':unittest.main()
