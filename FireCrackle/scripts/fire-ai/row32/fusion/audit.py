"""Targeted fusion math checks and independent recount of frozen predictions."""
import json
import unittest
import numpy as np
from run import OUT,fuse,select,metrics

class FusionTests(unittest.TestCase):
    def test_endpoints_and_unsupported_matcher(self):
        p=np.array([[.8]+[.2/31]*31]);s=np.arange(32,dtype=float)[None,:]
        np.testing.assert_allclose(fuse(p,s,np.array([True]),.1,1),p)
        np.testing.assert_allclose(fuse(p,s,np.array([False]),.1,0),1/32)
        mixed=fuse(p,s,np.array([True]),.1,.5)
        self.assertEqual(int(mixed.argmax(1)[0]),31)
        np.testing.assert_allclose(mixed.sum(1),1)

    def test_one_ranking_has_three_distinct_phases(self):
        p=np.ones((1,32))/32;s=np.zeros((1,32))
        f=fuse(p,s,np.array([False]),.1,.5)
        rank=np.argsort(-f,axis=1,kind='stable')[:,:3]
        np.testing.assert_array_equal(rank,[[0,1,2]])
        self.assertEqual(metrics(f,np.array([2]))['top3'],1)

def audit():
    r=json.loads((OUT/'results.json').read_text());z=np.load(OUT/'predictions.npz')
    chosen,bank=select(z['calibration_cnn'],z['calibration_scores'],z['calibration_usable'],z['calibration_truth'])
    assert chosen==r['selection']['chosen'] and bank==r['selection']['bank']
    p=fuse(z['cnn'],z['scores'],z['usable'],chosen['temperature'],chosen['cnn_weight'])
    np.testing.assert_allclose(p,z['fused']);assert np.isfinite(p).all()
    np.testing.assert_allclose(p.sum(1),1,atol=1e-6)
    ranks=np.argsort(-p,axis=1,kind='stable');y=z['truth']
    assert len(y)==617 and (ranks[:,:3]==y[:,None]).any(1).sum()==r['test']['fusion']['top3']
    assert (ranks[:,0]==y).sum()==r['test']['fusion']['top1']
    assert sum(r['paired_vs_cnn'].values())==617 and r['baseline_parity']==617
    print(json.dumps(dict(audit_passed=True,selected=chosen,top3=r['test']['fusion']['top3'],top1=r['test']['fusion']['top1'])))
if __name__=='__main__':
    tests=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(FusionTests))
    if not tests.wasSuccessful():raise SystemExit(1)
    audit()
