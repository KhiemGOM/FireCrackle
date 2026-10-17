import unittest
import numpy as np
from sprite_readability import audit


class ReadabilityTest(unittest.TestCase):
    def test_sharp_edges_pass_and_flat_edges_fail(self):
        sprite=np.zeros((16,16,4),np.uint8);sprite[:,:,3]=255
        sprite[:,::2,:3]=[255,180,40];sprite[:,1::2,:3]=[160,40,0]
        rgb=np.repeat(np.repeat(sprite[:,:,:3],4,axis=0),4,axis=1)
        h=np.diag([64.,64.,1.])
        sharp=audit(rgb,sprite,h);flat=audit(np.full_like(rgb,100),sprite,h)
        self.assertEqual(sharp['retained_pairs'],240)
        self.assertEqual(flat['retained_pairs'],0)

    def test_same_width_does_not_mean_readable(self):
        sprite=np.zeros((16,16,4),np.uint8);sprite[:,:,3]=255
        sprite[:,::2,:3]=255
        sharp=np.repeat(np.repeat(sprite[:,:,:3],2,axis=0),2,axis=1)
        h=np.diag([32.,32.,1.])
        self.assertGreater(audit(sharp,sprite,h)['retained_pairs'],0)
        self.assertEqual(audit(np.full_like(sharp,127),sprite,h)['retained_pairs'],0)


if __name__=='__main__':unittest.main()
