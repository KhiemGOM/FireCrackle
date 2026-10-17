import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pov_gui_remaining as m


class RemainingTests(unittest.TestCase):
    def test_known_opaque_is_always_neutral_and_translucent_is_fractional(self):
        w=m.weights([0,4,4],[4,0,4])
        self.assertTrue(np.all(w[:,0]==0))
        self.assertEqual(w[m.MASKS.index((0,.25)),1],.25)
        self.assertTrue(np.all(w[:,2]==1))

    def test_expansion_does_not_turn_excluded_pixels_into_negative_evidence(self):
        w=m.weights([1,4],[4,4])
        self.assertEqual(w[m.MASKS.index((0,1.)),0],1.)
        self.assertEqual(w[m.MASKS.index((1,1.)),0],0.)

    def test_cell_pool_omits_missing_cells_and_removes_area_bias(self):
        score,count=m.cell_pool(np.array([1.,1.,-1.]),np.ones(3),np.array([0,0,1]))
        self.assertEqual((score,count),(0.,2))
        score,count=m.cell_pool(np.array([1.,1.,-1.]),np.array([1.,1.,0.]),np.array([0,0,1]))
        self.assertEqual((score,count),(1.,1))

    def test_modulo_wrap_and_two_sided_temporal_support(self):
        frames=np.array([0,3,6]); rows=np.array([[31],[0],[1]],dtype=np.uint8)
        accepted=np.ones((3,1),dtype=bool);segments=np.ones(3)
        self.assertTrue(m.temporal_gate(frames,rows,accepted,segments).all())
        self.assertEqual(m.temporal_gate(frames,rows,accepted,segments,both=True).ravel().tolist(),[False,True,False])

    def test_temporal_support_cannot_cross_detected_cut(self):
        got=m.temporal_gate([0,3],np.array([[31],[0]]),np.ones((2,1),bool),[1,2])
        self.assertFalse(got.any())

    def test_scene_signal_uses_images_and_gap_without_fire_truth(self):
        segments,cuts=m.cut_segments([0,3,60],np.array([[0,0],[255,255],[255,255]]),60,.3)
        self.assertEqual(cuts.tolist(),[True,True,True])
        self.assertEqual(segments.tolist(),[1,2,3])

    def test_protected_labels_survive_new_candidate_and_gate_changes(self):
        d={'rows':np.zeros((1,256),dtype=np.int16),'scores':np.zeros((1,256)),
           'margins':np.zeros((1,256)),'spans':np.zeros((1,256)),
           'protected':np.array([True]),'saved_rows':np.array([17])}
        rows,accept=m.primary_predictions(d)
        self.assertTrue(accept.all());self.assertTrue(np.all(rows==17))

    def test_authored_cut_positions_are_not_used_as_detector_input(self):
        order,boundaries=m.synthetic_order(100)
        self.assertEqual(boundaries,[30,65]);self.assertEqual(len(order),100)
        self.assertEqual(order[30],55);self.assertEqual(order[65],10)
        _,cuts=m.cut_segments(np.arange(100)*5,np.zeros((100,3)),60,.15)
        self.assertFalse(cuts[30]);self.assertFalse(cuts[65])

    def test_native_and_numpy_aggregation_match_for_weighted_cell_methods(self):
        m.OUT.mkdir(parents=True,exist_ok=True)
        layout={'offsets':list(range(0,48,3)),'disc':list(range(16)),
                'pred':[[int((i+row)%3==0) for i in range(16)] for row in range(32)],
                'indices':[list(range(16)) for _ in range(32)],
                'cells':[[i//2 for i in range(16)] for _ in range(32)]}
        layouts=[m.prepare(layout),m.prepare(layout)]
        obs={'warm':[int(i%3==0) for i in range(16)],'hits':[int(0xAAAAAAAA)]*16,
             'hard':[0,1,2,3]+[4]*12,'trans':[4]*4+[0,1,2,3]+[4]*8}
        record={'n':0,'obs':[obs,obs]}
        a=m.frame_features(record,layouts,native=False);b=m.frame_features(record,layouts,native=True)
        for x,y in zip(a,b):np.testing.assert_allclose(x,y,atol=1e-10,rtol=0)

    def test_fixed_matrix_contract(self):
        self.assertEqual(len(m.MODELS),256)
        self.assertEqual(len(m.METHODS),768)
        self.assertEqual(len(m.CONFIGS),6144)

    def test_skipping_protected_targets_preserves_final_temporal_decisions(self):
        rng=np.random.default_rng(123)
        frames=np.arange(30)*3
        rows=((frames[:,None]/3+np.arange(4)[None,:])%32).astype(int)
        accept=rng.random((30,4))>.3;keep=rng.random(30)>.6;accept[keep]=True
        full=m.temporal_gate(frames,rows,accept,np.ones(30))|keep[:,None]
        fast=m.temporal_gate(frames,rows,accept,np.ones(30),targets=~keep)|keep[:,None]
        np.testing.assert_array_equal(full,fast)

    def test_secondary_anchor_union_keeps_anchor_sprite_and_reports_extra_errors(self):
        data={'frames':np.array([0,3,6]),'truth':np.array([4,5,-1]),
              'rows':np.tile(np.array([4,3,13])[:,None],(1,256)),
              'scores':np.full((3,256),.6),'margins':np.ones((3,256)),
              'spans':np.full((3,256),2),'thumbs':np.zeros((3,3)),
              'protected':np.zeros(3,dtype=bool),'saved_rows':np.array([4,5,13]),
              'original_accept':np.zeros(3,dtype=bool)}
        base,_,union=m.evaluate(data,60,np.array([4,5,13]),np.array([False,True,False]))
        self.assertEqual(base['correct'][0],1);self.assertEqual(base['wrong_rows'][0],1)
        self.assertEqual(union['correct'][0],2);self.assertEqual(union['wrong_rows'][0],0)
        self.assertEqual(union['false_positives'][0],1)


if __name__=='__main__':unittest.main()
