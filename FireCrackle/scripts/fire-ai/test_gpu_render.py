import unittest
import numpy as np
import torch
from gpu_render import Renderer,homography,projected,mask_input
from render import UV,load_sprites,raster,rectify
from prepare_backgrounds import safe_frames


class BatchedRendererTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2);cls.renderer=Renderer(np.zeros((2,160,160,3),np.uint8),'cpu')

    def test_homography_matches_corners(self):
        q=torch.tensor([[[12.,8],[100,25],[114,120],[22,100]]],dtype=torch.float64)
        np.testing.assert_allclose(projected(homography(q),torch.tensor(UV)).numpy()[0],q.numpy()[0],atol=1e-9)

    def test_native_sampling_matches_numpy_renderer(self):
        q=np.array([[16.,16],[144,16],[144,144],[16,144]])
        labels=torch.tensor([0,11,64,127]);qq=torch.tensor(q,dtype=torch.float32)[None].expand(4,-1,-1)
        actual=np.rint(self.renderer.raster(labels,qq).numpy().transpose(0,2,3,1)*255).astype(np.uint8)
        sprites=load_sprites()
        for i,label in enumerate(labels):np.testing.assert_array_equal(actual[i],raster(sprites[label],q))

    def test_seed_repeats_exactly(self):
        a=self.renderer.batch(torch.tensor([0,64]),123);b=self.renderer.batch(torch.tensor([0,64]),123)
        self.assertTrue(torch.equal(a,b));self.assertEqual(a.shape,(2,4,64,64));self.assertTrue(torch.isfinite(a).all())

    def test_mask_has_no_candidate_input(self):
        rgb=torch.tensor([.8,.5,.1])[None,:,None,None].expand(1,3,64,64)
        x=mask_input(rgb);self.assertTrue((x[:,3]==1).all())

    def test_rectification_matches_native_pixel_coordinates(self):
        from torch.nn import functional as F
        yy,xx=np.mgrid[:160,:160];rgb=np.stack([xx,yy,np.full_like(xx,20)],-1).astype(np.uint8)
        q=np.array([[12.,8],[100,25],[114,120],[22,100]])
        xy=projected(homography(torch.tensor(q,dtype=torch.float32)[None]),self.renderer.uv).reshape(1,64,64,2)
        tensor=torch.tensor(rgb.transpose(2,0,1).copy())[None].float()/255
        crop=F.grid_sample(tensor,xy/80-1,align_corners=False)
        actual=np.uint8((crop[0].numpy().transpose(1,2,0)*255).clip(0,255))
        self.assertLessEqual(np.abs(actual.astype(int)-rectify(rgb,q).astype(int)).max(),1)

    def test_background_guard_rejects_near_fire_and_unsynced_frames(self):
        rows=[dict(tick_ok=True,label=dict(fire=False,fires=[])) for _ in range(11)]
        self.assertEqual(safe_frames(rows,1,2),list(range(2,9)))
        rows[5]['label']=dict(fire=True,fires=[{}])
        self.assertEqual(safe_frames(rows,1,2),[2,8])
        rows[8]['tick_ok']=False
        self.assertEqual(safe_frames(rows,1,2),[2])


if __name__=='__main__':unittest.main()
