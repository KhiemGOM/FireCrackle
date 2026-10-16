import unittest
import numpy as np
from render import homography,project,UV,raster,rectify,load_sprites,sample,colour_mask


class RendererTests(unittest.TestCase):
    def test_homography_corners(self):
        q=np.array([[12,8],[100,25],[114,120],[22,100]])
        np.testing.assert_allclose(project(homography(q),UV),q,atol=1e-10)

    def test_pixel_centres_and_no_cracks(self):
        s=np.zeros((16,16,4),np.uint8);s[:]=[240,120,10,255]
        r=raster(s,[[16,16],[80,16],[80,80],[16,80]],96)
        self.assertEqual(np.count_nonzero(r[:,:,3]),64*64)
        self.assertTrue((r[16:80,16:80,:3]==[240,120,10]).all())

    def test_alpha_discard(self):
        s=np.full((16,16,4),255,np.uint8);s[:8,:,3]=0
        r=raster(s,[[0,0],[64,0],[64,64],[0,64]],64)
        self.assertEqual(np.count_nonzero(r[:,:,3]),32*64)

    def test_orientation_and_row(self):
        s=load_sprites()
        for i in range(0,128,2):np.testing.assert_array_equal(s[i,:,::-1],s[i+1])
        q=[[0,0],[64,0],[64,64],[0,64]]
        for i in [0,11,64,127]:
            r=raster(s[i],q,64)
            expected=s[i].copy();expected[expected[:,:,3]<26]=0
            np.testing.assert_array_equal(r[2::4,2::4],expected)

    def test_rectification_identity(self):
        im=np.random.default_rng(1).integers(0,255,(64,64,3),dtype=np.uint8)
        np.testing.assert_array_equal(rectify(im,[[0,0],[64,0],[64,64],[0,64]]),im)

    def test_repeatable_and_mask_has_no_truth(self):
        s=load_sprites();a,m,_=sample(s,12,42);b,n,_=sample(s,12,42)
        np.testing.assert_array_equal(a,b);self.assertEqual(m,n)
        self.assertEqual(colour_mask(a).shape,(64,64))


if __name__=="__main__":unittest.main()
