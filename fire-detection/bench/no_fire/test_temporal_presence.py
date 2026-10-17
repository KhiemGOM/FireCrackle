import unittest
import numpy as np
from temporal_presence import phase_shift, translate, texture_scores, calibrate, metrics


class TemporalPresenceTests(unittest.TestCase):
    def test_registration_direction_and_no_wrapping(self):
        a=np.random.default_rng(3).normal(size=(96,96));b=np.roll(a,(4,-7),(0,1))
        shift,confidence=phase_shift(a,b)
        np.testing.assert_allclose(shift,[-4,7],atol=.15);self.assertGreater(confidence,8)
        rgb=np.ones((10,10,3),np.uint8);moved,valid=translate(rgb,2,-3)
        self.assertEqual(int(valid.sum()),56);self.assertFalse(valid[0,0]);self.assertFalse(valid[4,9])
        self.assertEqual(int(moved[4,9].sum()),0)

    def test_static_warm_colour_is_not_temporal_fire_evidence(self):
        a=np.full((64,64,3),[180,90,0],np.uint8);v=np.ones((64,64),bool)
        self.assertEqual(texture_scores(a,a,a,v),{'change':0,'reversal':0})
        b=a.copy();b[20:28,20:28]=[240,160,30]
        scores=texture_scores(a,b,a,v)
        self.assertEqual(scores['change'],64);self.assertEqual(scores['reversal'],64)

    def test_zero_score_fire_cannot_be_ignored_in_strict_calibration(self):
        rows=[{'truth':{'substantial':True},'scores':{'change':0}},
              {'truth':{'substantial':False},'scores':{'change':0}},
              {'truth':{'substantial':False},'scores':{'change':None}}]
        threshold=calibrate(rows,'change',0)
        self.assertEqual(threshold,0)
        self.assertEqual(metrics(rows,'change',threshold)['TP'],0)
        self.assertEqual(metrics(rows,'change',threshold)['FP'],0)

    def test_positive_means_no_fire_and_unknown_scores_stay_review(self):
        rows=[{'truth':{'substantial':False},'scores':{'change':1}},
              {'truth':{'substantial':True},'scores':{'change':1}},
              {'truth':{'substantial':True},'scores':{'change':None}},
              {'truth':{'substantial':False},'scores':{'change':3}}]
        result=metrics(rows,'change',2)
        self.assertEqual([result[k] for k in ['TP','FP','FN','TN']],[1,1,1,1])
        self.assertEqual(result['false_positive_rate'],.5)
        self.assertEqual(result['forced_review'],1)

    def test_unknown_fire_calibration_abstains(self):
        rows=[{'truth':{'substantial':True},'scores':{'change':None}},
              {'truth':{'substantial':False},'scores':{'change':5}}]
        self.assertEqual(calibrate(rows,'change',0),0)


if __name__=='__main__':unittest.main()
