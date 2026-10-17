import unittest
from unittest.mock import patch
import numpy as np
from burst_pilot import orange, local, texture, score


class BurstTest(unittest.TestCase):
    def test_white_and_still_orange_do_not_flicker(self):
        a=np.full((30,30,3),[230,130,20],np.uint8)
        self.assertTrue(orange(a).all())
        self.assertEqual(texture([a,a,a],np.ones((30,30),bool)),{'change':0,'reversal':0})
        self.assertFalse(orange(np.full_like(a,255)).any())

    def test_boundary_and_diagonal_fragment_count(self):
        m=np.zeros((50,50),bool);m[-1,-1]=True;m[-2,-2]=True
        self.assertEqual(local(m),2)

    def test_neighbour_fire_cannot_be_anchor_fire(self):
        a=np.zeros((30,30,3),np.uint8);b=np.full_like(a,[230,130,20]);c=np.full_like(a,[100,40,5])
        self.assertEqual(texture([a,b,c],np.ones((30,30),bool)),{'change':0,'reversal':0})

    def test_shifted_auto_unveil_forces_motion_review(self):
        a=np.full((30,30,3),[230,130,20],np.uint8)
        with patch('burst_pilot.apply',return_value=(a,True,1)),patch('burst_pilot.phase_shift',return_value=([0,10],100)):
            scores,info=score([a,a,a])
        self.assertEqual(info['reason'],'auto_shift_uncertainty')
        self.assertIsNone(scores['all:change'])
        self.assertIsNotNone(scores['all:anchor'])


if __name__=='__main__':unittest.main()
