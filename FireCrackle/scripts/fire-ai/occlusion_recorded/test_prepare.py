import unittest
import numpy as np
from prepare import map_uv,project,rectify,split_frame,UNKNOWN


class PartialOwnershipTests(unittest.TestCase):
    def test_vertex_order_and_reversed_uv_preserve_correspondence(self):
        uv=np.array([[1,1],[1,0],[0,0],[0,1]],float)
        xy=np.array([[48,52],[50,12],[8,10],[6,48]],float)
        matrix=map_uv(uv,xy)
        np.testing.assert_allclose(project(matrix,uv),xy,atol=1e-10)

    def test_unknown_and_id_boundaries_never_become_negative_supervision(self):
        rgb=np.zeros((64,64,3),np.uint8);ids=np.zeros((64,64),np.uint32)
        ids[:,20:40]=UNKNOWN;ids[:,:20]=7
        _,labels,valid=rectify(rgb,ids,np.array([[64,0,0],[0,64,0],[0,0,1]],float))
        self.assertFalse(valid[:,19:41].any())
        self.assertTrue(valid[4:60,4:18].all())
        self.assertTrue((labels[4:60,4:18]==7).all())

    def test_pixel_centres_match_source_without_resampling_shift(self):
        rgb=np.repeat(np.arange(64,dtype=np.uint8)[None,:,None],64,axis=0).repeat(3,axis=2)
        ids=np.ones((64,64),np.uint32)
        crop,_,_=rectify(rgb,ids,np.array([[64,0,0],[0,64,0],[0,0,1]],float))
        np.testing.assert_array_equal(crop,rgb)

    def test_temporal_split_has_no_shared_or_immediate_neighbour_frames(self):
        groups={s:[] for s in ['train','validation','test']}
        for frame in range(170000,200000):
            split=split_frame(frame)
            if split:groups[split].append(frame)
        for a in groups:
            for b in groups:
                if a==b:continue
                nearest=np.searchsorted(groups[b],groups[a])
                arr=np.array(groups[b]);vals=np.array(groups[a])
                distances=np.minimum(abs(arr[np.clip(nearest,0,len(arr)-1)]-vals),abs(arr[np.clip(nearest-1,0,len(arr)-1)]-vals))
                self.assertGreaterEqual(distances.min(),201)


if __name__=='__main__':unittest.main()
